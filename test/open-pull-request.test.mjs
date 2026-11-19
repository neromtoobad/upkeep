import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openPullRequest, PullRequestFailed } from '../src/report/open-pull-request.mjs';
import { git } from '../src/workspace/worktree.mjs';

async function repo() {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'upkeep-pr-')));
  await git(['init', '-q', '-b', 'main'], dir);
  await git(['config', 'user.name', 'test'], dir);
  await git(['config', 'user.email', 'test@example.com'], dir);
  await writeFile(join(dir, 'package.json'), '{}');
  await git(['add', '-A'], dir);
  await git(['commit', '-q', '-m', 'app'], dir);
  await git(['branch', 'upkeep/test'], dir);
  return dir;
}

test('without a remote it says so and gives the commands to run by hand', async () => {
  const dir = await repo();
  try {
    await assert.rejects(
      openPullRequest({ repoRoot: dir, branch: 'upkeep/test', title: 'Upkeep: upgrade 3 packages', bodyFile: '/tmp/report.md' }),
      (error) => {
        assert.ok(error instanceof PullRequestFailed);
        assert.match(error.message, /has no remote called "origin"/);
        assert.match(error.message, /git push -u origin upkeep\/test && gh pr create --head upkeep\/test --base main/);
        return true;
      },
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('a push that fails is reported with what to run next', async () => {
  const dir = await repo();
  try {
    await git(['remote', 'add', 'origin', join(dir, 'does-not-exist.git')], dir);
    await assert.rejects(openPullRequest({ repoRoot: dir, branch: 'upkeep/test', title: 't', bodyFile: '/tmp/report.md' }), /could not push upkeep\/test/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
