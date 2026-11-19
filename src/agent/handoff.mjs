// Handoff: the fixer is an agent that is already in a session with the person
// (Cursor, Windsurf, Kiro, Copilot, Claude Code itself), not one Upkeep starts.
//
//   upkeep run --agent handoff     runs in the background and pauses when Kane
//                                  says an upgrade broke the app
//   upkeep wait                    blocks until there is a task (prints it) or
//                                  the run is over (prints the result)
//   upkeep continue                "I have edited the app": Upkeep checks the
//                                  edit with the guard and has Kane walk again
//
// The run keeps its state in memory and simply waits, so nothing has to be
// saved and restored. The two commands talk to it through small files in
// .upkeep/handoff/. The same guard applies as for any other agent.

import { mkdir, readFile, rename, rm, writeFile, appendFile, access } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

const exists = (path) => access(path).then(() => true, () => false);

export const handoffDir = (projectDir) => join(projectDir, '.upkeep', 'handoff');

/** Write the state file in one step, so a reader never sees half of it. */
export async function writeState(dir, state) {
  await mkdir(dir, { recursive: true });
  const temp = join(dir, `state.${process.pid}.tmp`);
  await writeFile(temp, `${JSON.stringify({ ...state, at: new Date().toISOString() }, null, 2)}\n`);
  await rename(temp, join(dir, 'state.json'));
}

export async function readState(dir) {
  try {
    return JSON.parse(await readFile(join(dir, 'state.json'), 'utf8'));
  } catch {
    return null;
  }
}

/** Start a fresh handoff: old tasks and signals from an earlier run are removed. */
export async function openHandoff(dir) {
  await rm(dir, { recursive: true, force: true });
  await writeState(dir, { status: 'working', pid: process.pid });
}

export async function noteProgress(dir, line) {
  if (line.trim()) await appendFile(join(dir, 'progress.log'), `${line}\n`).catch(() => {});
}

/**
 * The `ask` used by the fix loop in handoff mode: publish the task, then wait
 * until someone runs `upkeep continue`.
 * @param {{dir: string, pollMs?: number, timeoutMs?: number}} options
 */
export function makeHandoffAsk({ dir, pollMs = 1000, timeoutMs = 2 * 60 * 60_000 }) {
  let turn = 0;
  return async function ask({ prompt, cwd }) {
    const started = Date.now();
    turn += 1;
    const task = join(dir, `task-${turn}.md`);
    const signal = join(dir, `continue-${turn}`);
    await writeFile(task, prompt);
    await writeState(dir, { status: 'needs-fix', turn, task, worktree: cwd, pid: process.pid });

    while (!(await exists(signal))) {
      if (Date.now() - started > timeoutMs) {
        await writeState(dir, { status: 'working', pid: process.pid });
        return { ok: false, text: '', seconds: Math.round((Date.now() - started) / 1000), problem: `nobody continued the run within ${Math.round(timeoutMs / 60_000)} minutes` };
      }
      await sleep(pollMs);
    }
    const text = (await readFile(signal, 'utf8').catch(() => '')).trim();
    await writeState(dir, { status: 'working', pid: process.pid });
    return { ok: true, text: text || 'The agent continued without a note.', seconds: Math.round((Date.now() - started) / 1000) };
  };
}

const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === 'EPERM';
  }
};

/**
 * Block until the run needs a fix or is over.
 * @param {string} dir
 * @param {{timeoutMs?: number, pollMs?: number}} [options]
 * @returns {Promise<{status: 'needs-fix'|'finished'|'stopped'|'working'|'none'|'gone', [key: string]: any}>}
 */
export async function waitForTurn(dir, { timeoutMs = 9 * 60_000, pollMs = 1000 } = {}) {
  const started = Date.now();
  for (;;) {
    const state = await readState(dir);
    if (!state) return { status: 'none' };
    // A task that has been continued is no longer a task, even if the run has
    // not noticed yet. Handing it out again would look like Kane failed twice.
    const answered = state.status === 'needs-fix' && (await exists(join(dir, `continue-${state.turn}`)));
    if (state.status === 'needs-fix' && !answered) return { ...state, taskText: await readFile(state.task, 'utf8').catch(() => '') };
    if (state.status === 'finished' || state.status === 'stopped') return state;
    // The run died without saying so (killed, machine slept): do not wait forever.
    if (state.pid && !alive(state.pid)) return { status: 'gone', pid: state.pid };
    if (Date.now() - started > timeoutMs) {
      const log = await readFile(join(dir, 'progress.log'), 'utf8').catch(() => '');
      return { status: 'working', lastLine: log.trim().split('\n').pop() ?? '' };
    }
    await sleep(pollMs);
  }
}

/**
 * Tell the waiting run that the app has been edited.
 * @param {string} dir
 * @param {string} [note] what was changed, for the report
 * @returns {Promise<{turn: number}>}
 */
export async function continueRun(dir, note = '') {
  const state = await readState(dir);
  if (!state) throw new Error('no Upkeep run is waiting here. Start one with: upkeep run --agent handoff');
  if (state.status !== 'needs-fix') throw new Error(`the run is not waiting for a fix (it is ${state.status}). Run "upkeep wait" to see where it is.`);
  if (await exists(join(dir, `continue-${state.turn}`))) throw new Error('this task was already continued. Run "upkeep wait" for Kane\'s verdict.');
  await writeFile(join(dir, `continue-${state.turn}`), `${note}\n`);
  return { turn: state.turn };
}
