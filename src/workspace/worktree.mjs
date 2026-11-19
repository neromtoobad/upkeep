// Upkeep never touches your checkout. It works in a git worktree on its own
// branch, outside the repository folder, and leaves you a branch to review.
//
// Outside matters: Node resolves packages by walking up parent folders, so a
// worktree nested inside the repo would quietly fall back to the repo's own
// node_modules and hide exactly the breakages Upkeep is looking for.

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { access, mkdir, rm } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, join, resolve } from 'node:path';

const exec = promisify(execFile);

/** Run git and return trimmed stdout. Errors carry git's own message. */
export async function git(args, cwd) {
  try {
    const { stdout } = await exec('git', args, { cwd, maxBuffer: 64 * 1024 * 1024 });
    return stdout.trim();
  } catch (error) {
    const detail = (error.stderr || error.message || '').trim();
    throw new Error(`git ${args[0]} failed: ${detail}`);
  }
}

/** Like git(), but returns stdout exactly as printed (for file contents). */
export async function gitRaw(args, cwd) {
  try {
    const { stdout } = await exec('git', args, { cwd, maxBuffer: 64 * 1024 * 1024 });
    return stdout;
  } catch (error) {
    throw new Error(`git ${args[0]} failed: ${(error.stderr || error.message || '').trim()}`);
  }
}

const exists = (path) =>
  access(path).then(
    () => true,
    () => false,
  );

/** Where the worktree for a repository lives: one fixed place per repo path. */
export function worktreePathFor(repoRoot) {
  const cache = process.env.UPKEEP_CACHE_DIR || process.env.XDG_CACHE_HOME || join(homedir(), '.cache');
  const tag = createHash('sha256').update(repoRoot).digest('hex').slice(0, 8);
  return join(cache, 'upkeep', `${basename(repoRoot)}-${tag}`, 'work');
}

export function branchName(now = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `upkeep/${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`;
}

/**
 * @param {string} projectDir folder with package.json; may be a subfolder of the repo
 * @param {{branch?: string}} [options]
 * @returns {Promise<{repoRoot: string, worktree: string, projectDir: string, branch: string,
 *   base: string, dirty: boolean, remove: () => Promise<void>}>}
 */
export async function openWorktree(projectDir, options = {}) {
  let repoRoot;
  try {
    repoRoot = await git(['rev-parse', '--show-toplevel'], projectDir);
  } catch {
    throw new Error(`${projectDir} is not inside a git repository. Upkeep works on a branch, so it needs one.`);
  }
  let base;
  try {
    base = await git(['rev-parse', 'HEAD'], repoRoot);
  } catch {
    throw new Error('this repository has no commits yet. Commit your app first.');
  }

  const dirty = (await git(['status', '--porcelain'], repoRoot)) !== '';
  const worktree = worktreePathFor(repoRoot);

  // A previous run that was interrupted may have left its worktree behind.
  if (await exists(worktree)) {
    await git(['worktree', 'remove', '--force', worktree], repoRoot).catch(() => rm(worktree, { recursive: true, force: true }));
  }
  await git(['worktree', 'prune'], repoRoot);
  await mkdir(join(worktree, '..'), { recursive: true });

  let branch = options.branch ?? branchName();
  const taken = async (name) => (await git(['branch', '--list', name], repoRoot)) !== '';
  for (let n = 2; await taken(branch); n += 1) branch = `${options.branch ?? branchName()}-${n}`;

  await git(['worktree', 'add', '-b', branch, worktree, base], repoRoot);

  // Where the project sits inside the repository: "" at the root, "apps/web/" in a monorepo.
  const inside = await git(['rev-parse', '--show-prefix'], projectDir);

  return {
    repoRoot,
    worktree,
    projectDir: resolve(worktree, inside),
    branch,
    base,
    dirty,
    remove: async () => {
      await git(['worktree', 'remove', '--force', worktree], repoRoot).catch(() => rm(worktree, { recursive: true, force: true }));
      await git(['worktree', 'prune'], repoRoot);
    },
  };
}

/**
 * Commit everything changed in the project folder except local tool state.
 * @returns {Promise<string|null>} the new commit, or null when nothing changed
 */
export async function commitAll(worktreeProjectDir, message) {
  await git(['add', '-A', '--', '.'], worktreeProjectDir);
  // Evidence packs name the Kane account that made them, and .upkeep is scratch
  // space: neither is ever committed, even in a repo that does not ignore them.
  // (Excluding them in the `add` pathspec fails when they are already ignored.)
  await git(['reset', '-q', 'HEAD', '--', '.upkeep', '.testmuai/evidence'], worktreeProjectDir);
  const staged = await git(['diff', '--cached', '--name-only'], worktreeProjectDir);
  if (staged === '') return null;
  await git(['commit', '-q', '-m', message], worktreeProjectDir);
  return git(['rev-parse', 'HEAD'], worktreeProjectDir);
}

/** Throw away every uncommitted change in the project folder (installed packages stay). */
export async function discardChanges(worktreeProjectDir) {
  await git(['reset', '-q', '--hard', 'HEAD'], worktreeProjectDir);
  await git(['clean', '-fdq', '--', '.'], worktreeProjectDir);
}
