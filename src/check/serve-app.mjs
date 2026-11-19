// Boots the app under test and waits until it answers, so Kane CLI has
// something to open. The caller stops it when the browser walk is done.

import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { stopGroup, tailBuffer, track } from './run-command.mjs';

/** True when anything answers at the URL, whatever the status. */
export async function answers(url, timeoutMs = 1500) {
  try {
    await fetch(url, { signal: AbortSignal.timeout(timeoutMs), redirect: 'manual' });
    return true;
  } catch {
    return false;
  }
}

/** Something else is already listening where the app should be served. */
export class AddressInUse extends Error {
  constructor(url) {
    super(`something is already answering at ${url}. Stop it (a dev server left running?) and try again.`);
    this.name = 'AddressInUse';
  }
}

/**
 * @param {string} command shell command that serves the app
 * @param {{cwd: string, url: string, env?: Record<string, string>, readyTimeoutMs?: number}} options
 * @returns {Promise<{ok: true, stop: () => Promise<void>, output: () => string} |
 *   {ok: false, reason: 'exited'|'timeout', output: string}>}
 */
export async function serveApp(command, { cwd, url, env, readyTimeoutMs = 90_000 }) {
  if (await answers(url)) throw new AddressInUse(url);

  const tail = tailBuffer();
  const child = track(
    spawn(command, {
      cwd,
      shell: true,
      detached: process.platform !== 'win32',
      env: { ...process.env, BROWSER: 'none', ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    }),
  );
  child.stdout.on('data', (chunk) => tail.push(chunk.toString()));
  child.stderr.on('data', (chunk) => tail.push(chunk.toString()));

  let exited = false;
  const closed = new Promise((resolve) => {
    child.on('close', () => {
      exited = true;
      resolve();
    });
    child.on('error', (error) => {
      tail.push(`\n${error.message}`);
      exited = true;
      resolve();
    });
  });

  const stop = async () => {
    if (exited) return;
    stopGroup(child, 'SIGTERM');
    await Promise.race([closed, sleep(4000)]);
    if (!exited) {
      stopGroup(child, 'SIGKILL');
      await Promise.race([closed, sleep(2000)]);
    }
  };

  const deadline = Date.now() + readyTimeoutMs;
  while (Date.now() < deadline) {
    if (exited) return { ok: false, reason: 'exited', output: tail.read().trim() };
    if (await answers(url)) return { ok: true, stop, output: () => tail.read().trim() };
    await sleep(250);
  }
  await stop();
  return { ok: false, reason: 'timeout', output: tail.read().trim() };
}
