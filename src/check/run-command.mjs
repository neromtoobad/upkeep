// Runs one shell command to completion and keeps the end of its output, which
// is where install and build tools put the reason they failed.

import { spawn } from 'node:child_process';

const TAIL_BYTES = 12_000;

// Every child Upkeep starts (npm, the app server, Kane CLI, the agent) is kept
// here until it exits, so an interrupted run can stop all of them. They run in
// their own process groups, which a Ctrl-C in the terminal does not reach.
const running = new Set();

/** Remember a child until it exits. Returns the child. */
export function track(child) {
  running.add(child);
  const forget = () => running.delete(child);
  child.once('close', forget);
  child.once('error', forget);
  return child;
}

/** Stop everything Upkeep started that is still running. */
export function stopAll() {
  for (const child of running) stopGroup(child, 'SIGTERM');
  // Anything that ignores the polite request is killed shortly after.
  const timer = setTimeout(() => {
    for (const child of running) stopGroup(child, 'SIGKILL');
  }, 3000);
  timer.unref();
}

/** Keeps the last `limit` bytes of everything appended. */
export function tailBuffer(limit = TAIL_BYTES) {
  let text = '';
  return {
    push(chunk) {
      text += chunk;
      if (text.length > limit * 2) text = text.slice(-limit);
    },
    read() {
      return text.length > limit ? text.slice(-limit) : text;
    },
  };
}

/**
 * @param {string} command a shell command line
 * @param {{cwd: string, env?: Record<string, string>, timeoutMs?: number}} options
 * @returns {Promise<{code: number|null, timedOut: boolean, output: string, ms: number}>}
 */
export function runCommand(command, { cwd, env, timeoutMs = 15 * 60_000 }) {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const tail = tailBuffer();
    // detached: the command gets its own process group, so a timeout can stop
    // npm and everything npm started, not just the shell.
    const child = track(
      spawn(command, {
        cwd,
        shell: true,
        detached: process.platform !== 'win32',
        env: { ...process.env, ...env },
        stdio: ['ignore', 'pipe', 'pipe'],
      }),
    );
    child.stdout.on('data', (chunk) => tail.push(chunk.toString()));
    child.stderr.on('data', (chunk) => tail.push(chunk.toString()));

    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      stopGroup(child);
      // A command that ignores SIGTERM must not keep the run waiting forever.
      setTimeout(() => stopGroup(child, 'SIGKILL'), 5000).unref();
    }, timeoutMs);

    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, timedOut, output: tail.read().trim(), ms: Date.now() - started });
    });
  });
}

/** Stop a child started with detached: true, and everything it started. */
export function stopGroup(child, signal = 'SIGTERM') {
  if (child.exitCode !== null || child.signalCode !== null) return;
  try {
    if (process.platform === 'win32') child.kill(signal);
    else process.kill(-child.pid, signal);
  } catch (error) {
    if (error.code !== 'ESRCH') throw error;
  }
}
