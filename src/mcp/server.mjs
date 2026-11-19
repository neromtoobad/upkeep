// `upkeep mcp`: Upkeep as tools for any agent that speaks the Model Context
// Protocol (Cursor, Windsurf, Kiro, Claude Code, Claude Desktop, …).
//
// The tools are the handoff loop: start a run, wait for Kane's verdict, fix
// the app when Kane says an upgrade broke it, continue. The agent calling the
// tools is the fixer; Kane CLI stays the judge.
//
// Transport: stdio, one JSON-RPC 2.0 message per line. Written by hand because
// Upkeep has no dependencies; it implements what a tool server needs
// (initialize, tools/list, tools/call, ping) and nothing else.

import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { openSync, mkdirSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makePlan, renderPlan } from '../plan/make-plan.mjs';
import { handoffDir, waitForTurn, continueRun, readState } from '../agent/handoff.mjs';

const BIN = fileURLToPath(new URL('../../bin/upkeep.mjs', import.meta.url));
const PROTOCOL = '2025-06-18';

const dirProperty = { type: 'string', description: 'Absolute path of the project folder (the one with package.json). Defaults to where the server was started.' };

export const TOOLS = [
  {
    name: 'upkeep_plan',
    description: 'Show which npm packages of a project are behind, which upgrades may break the app, and which must move together and why. Read-only and free: no browser, no Kane credits.',
    inputSchema: { type: 'object', properties: { dir: dirProperty, target: { type: 'string', enum: ['latest', 'wanted'], description: 'latest (default): newest release. wanted: stay inside the ranges in package.json.' } } },
  },
  {
    name: 'upkeep_start',
    description:
      'Start upgrading the outdated packages on a new git branch in a separate worktree (the user\'s checkout is not touched). After each set of upgrades Upkeep installs, builds and boots the app, and Kane CLI walks the project\'s plain-English flows in a real browser. Passing upgrades are committed. Returns at once; call upkeep_wait next. Spends Kane credits (about 8 per passing check), so tell the user before starting. Needs `kane-cli login` and at least one *_test.md flow in the project.',
    inputSchema: {
      type: 'object',
      properties: {
        dir: dirProperty,
        only: { type: 'array', items: { type: 'string' }, description: 'Only these packages.' },
        exclude: { type: 'array', items: { type: 'string' }, description: 'Never these packages.' },
        budget: { type: 'number', description: 'Stop starting checks after this many Kane credits.' },
      },
    },
  },
  {
    name: 'upkeep_wait',
    description:
      'Wait for the run started with upkeep_start. Returns one of: a TASK (Kane CLI confirmed an upgrade broke the app; the text says what Kane saw and which folder to edit), the final RESULT, or "still working" (call again). When you get a task: edit the app in the worktree folder it names, follow its rules, then call upkeep_continue.',
    inputSchema: { type: 'object', properties: { dir: dirProperty, timeout_seconds: { type: 'number', description: 'How long to block before answering "still working" (default 50).' } } },
  },
  {
    name: 'upkeep_continue',
    description: 'Tell Upkeep you have edited the app for the current task. Upkeep undoes any edit to the flows, their recordings or the versions, then Kane CLI walks the app again. Call upkeep_wait afterwards for Kane\'s verdict.',
    inputSchema: { type: 'object', properties: { dir: dirProperty, note: { type: 'string', description: 'One or two sentences on what you changed and why. Goes into the report.' } }, required: ['note'] },
  },
];

const text = (value, isError = false) => ({ content: [{ type: 'text', text: value }], ...(isError ? { isError: true } : {}) });

/** @param {{cwd: string, startRun?: Function}} context */
export function makeHandlers({ cwd, startRun = startDetachedRun }) {
  const dirOf = (args) => resolve(args?.dir ?? cwd);
  return {
    async upkeep_plan(args) {
      return text(renderPlan(await makePlan(dirOf(args), { target: args?.target })));
    },

    async upkeep_start(args) {
      const dir = dirOf(args);
      const state = await readState(handoffDir(dir));
      if (state && (state.status === 'working' || state.status === 'needs-fix') && isAlive(state.pid)) {
        return text('A run is already going in this project. Call upkeep_wait to see where it is.', true);
      }
      const flags = ['run', '--cwd', dir, '--agent', 'handoff'];
      if (args?.only?.length) flags.push('--only', args.only.join(','));
      if (args?.exclude?.length) flags.push('--exclude', args.exclude.join(','));
      if (args?.budget) flags.push('--budget', String(Math.round(args.budget)));
      const log = await startRun(dir, flags);
      return text(`Started. The run works on a new branch in its own worktree; the checkout in ${dir} is not touched.\nIts output goes to ${log}.\nCall upkeep_wait now.`);
    },

    async upkeep_wait(args) {
      const seconds = Number.isFinite(args?.timeout_seconds) ? Math.max(0, args.timeout_seconds) : 50;
      const turn = await waitForTurn(handoffDir(dirOf(args)), { timeoutMs: seconds * 1000 });
      switch (turn.status) {
        case 'needs-fix':
          return text(`TASK\n\n${turn.taskText.trimEnd()}\n\n---\nEdit the app in this folder (a worktree, not the user's checkout): ${turn.worktree}\nWhen you have made the change, call upkeep_continue with a note on what you changed. Then call upkeep_wait again.`);
        case 'finished':
          return text(`RESULT\n\n${(turn.summary ?? []).join('\n')}`);
        case 'stopped':
          return text(`The run stopped: ${turn.message}`, true);
        case 'working':
          return text(`Still working${turn.lastLine ? `: ${turn.lastLine.trim()}` : ''}. Call upkeep_wait again.`);
        case 'gone':
          return text('The run is no longer running and did not finish. Call upkeep_start to begin again.', true);
        default:
          return text('No run has been started in this project. Call upkeep_start first.', true);
      }
    },

    async upkeep_continue(args) {
      const { turn } = await continueRun(handoffDir(dirOf(args)), args?.note ?? '');
      return text(`Continuing (task ${turn}). Upkeep is checking the edit and Kane CLI is walking the app again. Call upkeep_wait for the verdict.`);
    },
  };
}

function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === 'EPERM';
  }
}

/** Start `upkeep run --agent handoff` on its own, outliving this tool call. */
async function startDetachedRun(dir, flags) {
  const folder = join(dir, '.upkeep');
  mkdirSync(folder, { recursive: true });
  const log = join(folder, 'handoff-run.log');
  const out = openSync(log, 'w');
  const child = spawn(process.execPath, [BIN, ...flags], { cwd: dir, detached: true, stdio: ['ignore', out, out] });
  child.unref();
  // Give it a moment to write its first state, so an immediate upkeep_wait finds the run.
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const state = await readState(handoffDir(dir));
    if (state?.pid === child.pid) break;
    await new Promise((done) => setTimeout(done, 100));
  }
  return log;
}

/**
 * Answer one JSON-RPC message. Returns the reply, or null for a notification.
 * @param {object} message
 * @param {ReturnType<typeof makeHandlers>} handlers
 * @param {string} version
 */
export async function answer(message, handlers, version) {
  const reply = (result) => ({ jsonrpc: '2.0', id: message.id, result });
  const failure = (code, text_) => ({ jsonrpc: '2.0', id: message.id ?? null, error: { code, message: text_ } });
  if (message?.jsonrpc !== '2.0' || typeof message.method !== 'string') return failure(-32600, 'not a JSON-RPC 2.0 request');
  if (message.id === undefined) return null; // a notification: nothing to answer

  switch (message.method) {
    case 'initialize':
      return reply({
        protocolVersion: typeof message.params?.protocolVersion === 'string' ? message.params.protocolVersion : PROTOCOL,
        capabilities: { tools: {} },
        serverInfo: { name: 'upkeep', version },
        instructions: 'Upkeep upgrades outdated npm packages and keeps only what Kane CLI verifies in a real browser. Call upkeep_plan, then upkeep_start, then loop upkeep_wait / fix the app / upkeep_continue until upkeep_wait returns RESULT. You are the fixer; Kane is the judge.',
      });
    case 'ping':
      return reply({});
    case 'tools/list':
      return reply({ tools: TOOLS });
    case 'tools/call': {
      const handler = handlers[message.params?.name];
      if (!handler) return failure(-32602, `unknown tool: ${message.params?.name}`);
      try {
        return reply(await handler(message.params.arguments ?? {}));
      } catch (error) {
        // A tool that fails is a result the agent should read, not a protocol error.
        return reply(text(error.message, true));
      }
    }
    default:
      return failure(-32601, `method not found: ${message.method}`);
  }
}

/** Serve on stdin and stdout until stdin closes. */
export async function serve({ input = process.stdin, output = process.stdout, cwd = process.cwd() } = {}) {
  const { version } = JSON.parse(await readFile(new URL('../../package.json', import.meta.url), 'utf8'));
  const handlers = makeHandlers({ cwd });
  const lines = createInterface({ input, crlfDelay: Infinity });
  const pending = new Set();
  for await (const line of lines) {
    if (!line.trim()) continue;
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      output.write(`${JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'parse error' } })}\n`);
      continue;
    }
    // Tool calls can block for a while (upkeep_wait); answer each when it is ready.
    const work = answer(message, handlers, version).then((result) => {
      if (result) output.write(`${JSON.stringify(result)}\n`);
    });
    pending.add(work);
    work.finally(() => pending.delete(work));
  }
  await Promise.all(pending);
}
