import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, realpath, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { git, openWorktree, commitAll, discardChanges, branchName, worktreePathFor } from '../src/workspace/worktree.mjs';

async function repoWith(files) {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'upkeep-wt-')));
  const cache = await realpath(await mkdtemp(join(tmpdir(), 'upkeep-cache-')));
  process.env.UPKEEP_CACHE_DIR = cache;
  await git(['init', '-q', '-b', 'main'], dir);
  await git(['config', 'user.name', 'test'], dir);
  await git(['config', 'user.email', 'test@example.com'], dir);
  for (const [path, text] of Object.entries(files)) {
    await mkdir(join(dir, path, '..'), { recursive: true });
    await writeFile(join(dir, path), text);
  }
  await git(['add', '-A'], dir);
  await git(['commit', '-q', '-m', 'app'], dir);
  return { dir, cleanup: () => Promise.all([rm(dir, { recursive: true, force: true }), rm(cache, { recursive: true, force: true })]) };
}

const exists = (path) => access(path).then(() => true, () => false);

test('branchName is dated and sortable', () => {
  assert.equal(branchName(new Date(2026, 10, 19, 9, 5)), 'upkeep/2026-11-19-0905');
});

test('the worktree lives outside the repository, one fixed place per repo', async () => {
  const { dir, cleanup } = await repoWith({ 'package.json': '{}' });
  try {
    const path = worktreePathFor(dir);
    assert.ok(!path.startsWith(dir), 'nested worktrees would fall back to the repo node_modules');
    assert.equal(worktreePathFor(dir), path);
  } finally {
    await cleanup();
  }
});

test('openWorktree checks out HEAD on a new branch and leaves the checkout alone', async () => {
  const { dir, cleanup } = await repoWith({ 'package.json': '{"name":"shop"}\n', 'src/app.js': 'old\n' });
  try {
    await writeFile(join(dir, 'src/app.js'), 'uncommitted edit\n');
    const work = await openWorktree(dir, { branch: 'upkeep/test' });

    assert.equal(work.branch, 'upkeep/test');
    assert.equal(work.dirty, true);
    assert.equal(await readFile(join(work.projectDir, 'src/app.js'), 'utf8'), 'old\n', 'worktree is HEAD, not the dirty tree');
    assert.equal(await git(['rev-parse', '--abbrev-ref', 'HEAD'], work.projectDir), 'upkeep/test');
    assert.equal(await git(['rev-parse', '--abbrev-ref', 'HEAD'], dir), 'main');
    assert.equal(await readFile(join(dir, 'src/app.js'), 'utf8'), 'uncommitted edit\n');

    await work.remove();
    assert.equal(await exists(work.worktree), false);
    assert.match(await git(['branch', '--list', 'upkeep/test'], dir), /upkeep\/test/, 'the branch stays for review');
  } finally {
    await cleanup();
  }
});

test('a project in a subfolder maps to the same subfolder of the worktree', async () => {
  const { dir, cleanup } = await repoWith({ 'apps/web/package.json': '{"name":"web"}\n', 'README.md': 'mono\n' });
  try {
    const work = await openWorktree(join(dir, 'apps/web'), { branch: 'upkeep/test' });
    assert.equal(work.projectDir, join(work.worktree, 'apps/web'));
    assert.equal(await readFile(join(work.projectDir, 'package.json'), 'utf8'), '{"name":"web"}\n');
    await work.remove();
  } finally {
    await cleanup();
  }
});

test('a leftover worktree and a taken branch name do not stop a new run', async () => {
  const { dir, cleanup } = await repoWith({ 'package.json': '{}' });
  try {
    const first = await openWorktree(dir, { branch: 'upkeep/test' });
    // no remove(): simulates a run that was interrupted
    const second = await openWorktree(dir, { branch: 'upkeep/test' });
    assert.equal(second.branch, 'upkeep/test-2');
    assert.equal(second.worktree, first.worktree);
    await second.remove();
  } finally {
    await cleanup();
  }
});

test('commitAll commits changes but never local tool state; discardChanges resets the rest', async () => {
  const { dir, cleanup } = await repoWith({ 'package.json': '{"v":1}\n', 'src/app.js': 'old\n' });
  try {
    const work = await openWorktree(dir, { branch: 'upkeep/test' });

    assert.equal(await commitAll(work.projectDir, 'nothing'), null, 'no changes, no commit');

    await writeFile(join(work.projectDir, 'package.json'), '{"v":2}\n');
    await mkdir(join(work.projectDir, '.testmuai/evidence'), { recursive: true });
    await writeFile(join(work.projectDir, '.testmuai/evidence/run.evidence'), 'pack');
    await mkdir(join(work.projectDir, 'flows/output-checkout'), { recursive: true });
    await writeFile(join(work.projectDir, 'flows/output-checkout/steps.json'), '[]');
    const sha = await commitAll(work.projectDir, 'Bump v');
    assert.match(sha, /^[0-9a-f]{40}$/);
    assert.deepEqual((await git(['show', '--name-only', '--format=', 'HEAD'], work.projectDir)).split('\n').sort(), [
      'flows/output-checkout/steps.json',
      'package.json',
    ]);

    await writeFile(join(work.projectDir, 'src/app.js'), 'a patch that did not work\n');
    await writeFile(join(work.projectDir, 'src/new.js'), 'stray\n');
    await discardChanges(work.projectDir);
    assert.equal(await readFile(join(work.projectDir, 'src/app.js'), 'utf8'), 'old\n');
    assert.equal(await exists(join(work.projectDir, 'src/new.js')), false);
    assert.equal(await readFile(join(work.projectDir, 'package.json'), 'utf8'), '{"v":2}\n', 'landed work is kept');
    await work.remove();
  } finally {
    await cleanup();
  }
});

test('outside a git repository the error says what to do', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'upkeep-nogit-'));
  try {
    await assert.rejects(openWorktree(dir), /is not inside a git repository/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
