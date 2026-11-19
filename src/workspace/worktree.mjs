// Upkeep never touches your checkout. It works in a git worktree on its own
// branch, outside the repository folder, and leaves you a branch to review.
//
// Outside matters: Node resolves packages by walking up parent folders, so a
// worktree nested inside the repo would quietly fall back to the repo's own
// node_modules and hide exactly the breakages Upkeep is looking for.

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { access, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
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
  // The branch a pull request should go to: the one checked out when the run starts.
  const baseBranch = await git(['rev-parse', '--abbrev-ref', 'HEAD'], repoRoot);
  const worktree = worktreePathFor(repoRoot);

  // One run per repository at a time. The worktree has a fixed place, so a
  // second run would delete the first one's work, including the edits of a
  // paused handoff run.
  await mkdir(join(worktree, '..'), { recursive: true });
  const lock = join(worktree, '..', 'run.lock');
  const holder = Number(await readFile(lock, 'utf8').catch(() => ''));
  if (holder && holder !== process.pid && isAlive(holder)) {
    throw new RunInProgress(`another Upkeep run is already working on this repository (process ${holder}). Wait for it to finish, or stop it first.`);
  }
  await writeFile(lock, String(process.pid));

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
    baseBranch,
    dirty,
    remove: async () => {
      await git(['worktree', 'remove', '--force', worktree], repoRoot).catch(() => rm(worktree, { recursive: true, force: true }));
      await git(['worktree', 'prune'], repoRoot);
      await rm(lock, { force: true });
    },
    /** Let another run start while keeping the worktree (used with --keep-worktree). */
    unlock: () => rm(lock, { force: true }),
  };
}

/** Another run holds this repository. */
export class RunInProgress extends Error {}

function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === 'EPERM';
  }
}

// Never committed, whatever the repository ignores: installed packages, scratch
// space, and evidence packs (they name the Kane account that made them).
const NEVER_COMMITTED = ['node_modules', '.upkeep', '.testmuai/evidence'];

/**
 * Commit everything changed in the project folder except local tool state.
 * @param {string[]} [paths] limit the commit to these paths (missing ones are skipped)
 * @param {string[]} [never] more paths that must not be committed (files Upkeep copied in, such as .env)
 * @returns {Promise<string|null>} the new commit, or null when nothing changed
 */
export async function commitAll(worktreeProjectDir, message, paths = ['.'], never = []) {
  const present = [];
  for (const path of paths) if (path === '.' || (await exists(join(worktreeProjectDir, path)))) present.push(path);
  if (present.length === 0) return null;
  // One path at a time: naming a path git ignores makes `git add` fail, and
  // an ignored path (recordings usually are) should just be left out.
  for (const path of present) {
    await git(['add', '-A', '--', path], worktreeProjectDir).catch((error) => {
      if (!/ignored by one of your \.gitignore/.test(error.message)) throw error;
    });
  }
  // Unstage what must never be committed, even in a repo that does not ignore it.
  // (Excluding these in the `add` pathspec fails when they are already ignored.)
  await git(['reset', '-q', 'HEAD', '--', ...NEVER_COMMITTED, ...never], worktreeProjectDir);
  const staged = await git(['diff', '--cached', '--name-only'], worktreeProjectDir);
  if (staged === '') return null;
  try {
    await git(['commit', '-q', '-m', message], worktreeProjectDir);
  } catch (error) {
    // The repository's own commit hooks or signing setup said no. That is the
    // person's rule, so it is reported, not bypassed.
    throw new Error(`the commit was refused (a commit hook, or signing): ${error.message.replace(/^git commit failed: /, '')}`);
  }
  return git(['rev-parse', 'HEAD'], worktreeProjectDir);
}

/**
 * Throw away every uncommitted change in the project folder.
 * @param {string[]} [keep] untracked paths to leave alone besides installed packages (files Upkeep copied in)
 */
export async function discardChanges(worktreeProjectDir, keep = []) {
  await git(['reset', '-q', '--hard', 'HEAD'], worktreeProjectDir);
  const excludes = ['node_modules', ...keep].flatMap((path) => ['-e', path]);
  await git(['clean', '-fdq', ...excludes, '--', '.'], worktreeProjectDir);
}
