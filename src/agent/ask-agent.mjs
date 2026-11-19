// Hands one task to a coding agent running headless in the worktree and waits
// for it to finish. The agent only edits files; Upkeep decides afterwards
// whether the edit worked, by running Kane CLI again.

import { spawn } from 'node:child_process';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { stopGroup, tailBuffer } from '../check/run-command.mjs';

/**
 * Known agents. Each gets the task on stdin.
 *
 * Claude Code is given file tools only (read, edit, search) and no shell, so
 * it cannot run the browser or reinstall packages: the only path to green is
 * fixing the app. Codex CLI runs in its own workspace-write sandbox, which
 * lets it edit the worktree and nothing outside it. Either way the guard in
 * guard-patch.mjs checks what was changed afterwards.
 */
export const AGENTS = {
  claude: {
    name: 'Claude Code',
    command: 'claude',
    args: ['-p', '--permission-mode', 'acceptEdits', '--allowedTools', 'Read,Edit,Write,Glob,Grep', '--output-format', 'json', '--no-session-persistence'],
    reply: (stdout) => {
      try {
        const parsed = JSON.parse(stdout);
        return { text: String(parsed.result ?? '').trim(), costUsd: parsed.total_cost_usd };
      } catch {
        return { text: stdout.trim() };
      }
    },
  },
  codex: {
    name: 'Codex CLI',
    command: 'codex',
    args: ['exec', '--sandbox', 'workspace-write', '-'],
    reply: (stdout) => ({ text: stdout.trim() }),
  },
};

/**
 * @param {string} spec "claude", "codex", or a command line of your own. In
 *   your own command, {prompt_file} is replaced by a file holding the task;
 *   without it the task is sent on stdin.
 */
export function resolveAgent(spec) {
  if (AGENTS[spec]) return { ...AGENTS[spec], id: spec };
  if (!spec || !spec.trim()) throw new Error('no agent given');
  return { id: 'custom', name: spec.trim().split(/\s+/)[0], shell: spec, reply: (stdout) => ({ text: stdout.trim() }) };
}

/**
 * @param {object} input
 * @param {ReturnType<typeof resolveAgent>} input.agent
 * @param {string} input.prompt
 * @param {string} input.cwd
 * @param {number} [input.timeoutMs]
 * @returns {Promise<{ok: boolean, text: string, costUsd?: number, seconds: number, problem?: string}>}
 */
export async function askAgent({ agent, prompt, cwd, timeoutMs = 20 * 60_000 }) {
  const started = Date.now();
  let scratch;
  let command = agent.command;
  let args = agent.args ?? [];
  let shell = false;
  let sendOnStdin = true;

  if (agent.shell) {
    shell = true;
    args = [];
    if (agent.shell.includes('{prompt_file}')) {
      scratch = await mkdtemp(join(tmpdir(), 'upkeep-task-'));
      await writeFile(join(scratch, 'task.md'), prompt);
      command = agent.shell.replaceAll('{prompt_file}', `"${join(scratch, 'task.md')}"`);
      sendOnStdin = false;
    } else {
      command = agent.shell;
    }
  }

  try {
    return await new Promise((resolve) => {
      let stdout = '';
      const stderr = tailBuffer(4000);
      const child = spawn(command, args, { cwd, shell, detached: process.platform !== 'win32', stdio: ['pipe', 'pipe', 'pipe'] });
      child.stdout.on('data', (chunk) => (stdout += chunk));
      child.stderr.on('data', (chunk) => stderr.push(chunk.toString()));
      child.stdin.on('error', () => {}); // an agent that exits early closes its stdin
      child.stdin.end(sendOnStdin ? prompt : '');

      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        stopGroup(child);
      }, timeoutMs);

      const seconds = () => Math.round((Date.now() - started) / 1000);
      child.on('error', (error) => {
        clearTimeout(timer);
        const problem = error.code === 'ENOENT' ? `${agent.name} is not installed or not on PATH (tried "${command}")` : error.message;
        resolve({ ok: false, text: '', seconds: seconds(), problem });
      });
      child.on('close', (code) => {
        clearTimeout(timer);
        const reply = agent.reply(stdout);
        if (timedOut) resolve({ ok: false, ...reply, seconds: seconds(), problem: `${agent.name} did not finish within ${Math.round(timeoutMs / 60_000)} minutes` });
        else if (code !== 0) resolve({ ok: false, ...reply, seconds: seconds(), problem: `${agent.name} exited ${code}: ${stderr.read().trim().split('\n').pop() ?? ''}`.trim() });
        else resolve({ ok: true, ...reply, seconds: seconds() });
      });
    });
  } finally {
    if (scratch) await rm(scratch, { recursive: true, force: true });
  }
}
