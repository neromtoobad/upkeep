import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { makeHandoffAsk, openHandoff, waitForTurn, continueRun, readState, writeState, noteProgress, handoffDir } from '../src/agent/handoff.mjs';

const run = promisify(execFile);
const BIN = fileURLToPath(new URL('../bin/upkeep.mjs', import.meta.url));
const fresh = async () => {
  const project = await mkdtemp(join(tmpdir(), 'upkeep-handoff-'));
  return { project, dir: handoffDir(project), cleanup: () => rm(project, { recursive: true, force: true }) };
};

test('the run publishes a task and waits; continue releases it with the note as the reply', async () => {
  const { dir, cleanup } = await fresh();
  try {
    await openHandoff(dir);
    const ask = makeHandoffAsk({ dir, pollMs: 20 });
    const answer = ask({ prompt: '# Make this app work\nKane: the order page is blank.', cwd: '/work/tree' });

    const turn = await waitForTurn(dir, { pollMs: 20 });
    assert.equal(turn.status, 'needs-fix');
    assert.equal(turn.worktree, '/work/tree');
    assert.match(turn.taskText, /Kane: the order page is blank\./);

    assert.deepEqual(await continueRun(dir, 'Renamed the date tokens in src/pages/Order.jsx'), { turn: 1 });
    const result = await answer;
    assert.equal(result.ok, true);
    assert.equal(result.text, 'Renamed the date tokens in src/pages/Order.jsx');
    assert.equal((await readState(dir)).status, 'working', 'back to work: Kane is walking the app');
  } finally {
    await cleanup();
  }
});

test('each round is its own task; a stale continue from the round before does not release the next', async () => {
  const { dir, cleanup } = await fresh();
  try {
    await openHandoff(dir);
    const ask = makeHandoffAsk({ dir, pollMs: 20 });
    const first = ask({ prompt: 'round 1', cwd: '/w' });
    await waitForTurn(dir, { pollMs: 20 });
    await continueRun(dir, 'first try');
    await first;

    let released = false;
    const second = ask({ prompt: 'round 2: Kane still fails', cwd: '/w' }).then((answer) => {
      released = true;
      return answer;
    });
    const turn = await waitForTurn(dir, { pollMs: 20 });
    assert.equal(turn.turn, 2);
    assert.equal(turn.taskText, 'round 2: Kane still fails');
    await new Promise((resolve) => setTimeout(resolve, 80));
    assert.equal(released, false, 'still waiting for a continue of its own');
    await continueRun(dir);
    assert.equal((await second).text, 'The agent continued without a note.');
  } finally {
    await cleanup();
  }
});

test('nobody continues: the round ends as "did not answer", not as a fix', async () => {
  const { dir, cleanup } = await fresh();
  try {
    await openHandoff(dir);
    const answer = await makeHandoffAsk({ dir, pollMs: 10, timeoutMs: 60 })({ prompt: 'task', cwd: '/w' });
    assert.equal(answer.ok, false);
    assert.match(answer.problem, /nobody continued the run/);
  } finally {
    await cleanup();
  }
});

test('wait reports the end of the run, a stop, a run that is still working, and a run that died', async () => {
  const { dir, cleanup } = await fresh();
  try {
    assert.deepEqual(await waitForTurn(dir), { status: 'none' });

    await writeState(dir, { status: 'finished', exit: 3, summary: ['Done in 12 min, 9 checks.'] });
    assert.equal((await waitForTurn(dir)).exit, 3);

    await writeState(dir, { status: 'stopped', message: 'Kane CLI is not signed in' });
    assert.equal((await waitForTurn(dir)).message, 'Kane CLI is not signed in');

    await writeState(dir, { status: 'working', pid: process.pid });
    await noteProgress(dir, '  ✓ check 2  axios');
    assert.deepEqual(await waitForTurn(dir, { timeoutMs: 40, pollMs: 10 }), { status: 'working', lastLine: '✓ check 2  axios' });

    await writeState(dir, { status: 'working', pid: 2 ** 22 + 12345 });
    assert.equal((await waitForTurn(dir, { pollMs: 10 })).status, 'gone');
  } finally {
    await cleanup();
  }
});

test('continue refuses when nothing is waiting, and says what to do', async () => {
  const { dir, cleanup } = await fresh();
  try {
    await assert.rejects(continueRun(dir), /no Upkeep run is waiting here\. Start one with: upkeep run --agent handoff/);
    await writeState(dir, { status: 'working', pid: process.pid });
    await assert.rejects(continueRun(dir), /the run is not waiting for a fix \(it is working\)/);
  } finally {
    await cleanup();
  }
});

test('the wait and continue commands: the task with where to edit, exit 10; then the result', async () => {
  const { project, dir, cleanup } = await fresh();
  try {
    await openHandoff(dir);
    const answer = makeHandoffAsk({ dir, pollMs: 20 })({ prompt: '# Make this app work\nKane: blank page.', cwd: '/work/tree' });

    const waiting = await run(process.execPath, [BIN, 'wait', '--cwd', project]).catch((error) => error);
    assert.equal(waiting.code, 10);
    assert.match(waiting.stdout, /Kane: blank page\./);
    assert.match(waiting.stdout, /Edit the app here \(a worktree, not your checkout\): \/work\/tree/);
    assert.match(waiting.stdout, /upkeep continue --message/);

    const cont = await run(process.execPath, [BIN, 'continue', '--cwd', project, '--message', 'fixed the tokens']);
    assert.match(cont.stdout, /Continuing \(task 1\)/);
    assert.equal((await answer).text, 'fixed the tokens');

    await writeState(dir, { status: 'finished', exit: 0, summary: ['Done in 3 min, 4 checks.', '  1 package upgraded and verified on branch upkeep/x'] });
    const done = await run(process.execPath, [BIN, 'wait', '--cwd', project]);
    assert.match(done.stdout, /Done in 3 min, 4 checks\.\n {2}1 package upgraded/);

    await writeFile(join(dir, 'state.json'), 'not json');
    const none = await run(process.execPath, [BIN, 'wait', '--cwd', project]).catch((error) => error);
    assert.match(none.stdout, /No Upkeep run has been started here/);
    assert.equal(await readFile(join(dir, 'task-1.md'), 'utf8'), '# Make this app work\nKane: blank page.');
  } finally {
    await cleanup();
  }
});
