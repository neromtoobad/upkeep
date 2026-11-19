import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { answer, makeHandlers, TOOLS } from '../src/mcp/server.mjs';
import { handoffDir, openHandoff, makeHandoffAsk, writeState } from '../src/agent/handoff.mjs';

const BIN = fileURLToPath(new URL('../bin/upkeep.mjs', import.meta.url));
const call = (id, method, params) => ({ jsonrpc: '2.0', id, method, ...(params ? { params } : {}) });
const tool = (id, name, args = {}) => call(id, 'tools/call', { name, arguments: args });
const project = async () => {
  const dir = await mkdtemp(join(tmpdir(), 'upkeep-mcp-'));
  await writeFile(join(dir, 'package.json'), JSON.stringify({ name: 'shop', version: '1.0.0', private: true }));
  return { dir, cleanup: () => rm(dir, { recursive: true, force: true }) };
};

test('initialize echoes the client’s protocol version and offers tools', async () => {
  const reply = await answer(call(1, 'initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'test', version: '0' } }), {}, '0.1.0');
  assert.equal(reply.result.protocolVersion, '2025-03-26');
  assert.deepEqual(reply.result.capabilities, { tools: {} });
  assert.deepEqual(reply.result.serverInfo, { name: 'upkeep', version: '0.1.0' });
  assert.match(reply.result.instructions, /You are the fixer; Kane is the judge\./);
});

test('tools/list describes the loop; every tool has an object schema', async () => {
  const reply = await answer(call(2, 'tools/list'), {}, '0.1.0');
  assert.deepEqual(reply.result.tools.map((t) => t.name), ['upkeep_plan', 'upkeep_start', 'upkeep_wait', 'upkeep_continue']);
  for (const t of TOOLS) {
    assert.equal(t.inputSchema.type, 'object');
    assert.ok(t.description.length > 40);
  }
});

test('notifications get no answer; unknown methods and tools get proper errors', async () => {
  assert.equal(await answer({ jsonrpc: '2.0', method: 'notifications/initialized' }, {}, '0'), null);
  assert.equal((await answer(call(3, 'resources/list'), {}, '0')).error.code, -32601);
  assert.equal((await answer(tool(4, 'nope'), {}, '0')).error.code, -32602);
  assert.equal((await answer({ id: 5 }, {}, '0')).error.code, -32600);
  assert.deepEqual((await answer(call(6, 'ping'), {}, '0')).result, {});
});

test('upkeep_plan returns the plan as text', async () => {
  const { dir, cleanup } = await project();
  try {
    const reply = await answer(tool(7, 'upkeep_plan', { dir }), makeHandlers({ cwd: tmpdir() }), '0');
    assert.match(reply.result.content[0].text, /Upkeep plan for shop/);
    assert.equal(reply.result.isError, undefined);
  } finally {
    await cleanup();
  }
});

test('a tool that fails is a result the agent can read, not a protocol error', async () => {
  const reply = await answer(tool(8, 'upkeep_plan', { dir: join(tmpdir(), 'upkeep-no-such-project') }), makeHandlers({ cwd: tmpdir() }), '0');
  assert.equal(reply.result.isError, true);
  assert.match(reply.result.content[0].text, /no package\.json in/);
});

test('the loop through the tools: start, wait gives the task, continue, wait gives the result', async () => {
  const { dir, cleanup } = await project();
  const started = [];
  // A stand-in for the background run: it publishes one task, waits to be continued, then finishes.
  const startRun = async (projectDir, flags) => {
    started.push(flags);
    const handoff = handoffDir(projectDir);
    await openHandoff(handoff);
    makeHandoffAsk({ dir: handoff, pollMs: 20 })({ prompt: '# Make this app work\nKane: the order page is blank.', cwd: '/work/tree' }).then(async (answered) => {
      await writeState(handoff, { status: 'finished', exit: 0, summary: ['Done in 4 min, 4 checks.', `  the agent said: ${answered.text}`] });
    });
    return join(projectDir, '.upkeep', 'handoff-run.log');
  };
  const handlers = makeHandlers({ cwd: dir, startRun });
  try {
    const start = await answer(tool(1, 'upkeep_start', { only: ['date-fns'], budget: 200 }), handlers, '0');
    assert.match(start.result.content[0].text, /Started\./);
    assert.deepEqual(started[0], ['run', '--cwd', dir, '--agent', 'handoff', '--only', 'date-fns', '--budget', '200']);

    const again = await answer(tool(2, 'upkeep_start', {}), handlers, '0');
    assert.equal(again.result.isError, true, 'a second run in the same project is refused');

    const task = await answer(tool(3, 'upkeep_wait', { timeout_seconds: 5 }), handlers, '0');
    assert.match(task.result.content[0].text, /^TASK\n\n# Make this app work\nKane: the order page is blank\./);
    assert.match(task.result.content[0].text, /Edit the app in this folder \(a worktree, not the user's checkout\): \/work\/tree/);

    const cont = await answer(tool(4, 'upkeep_continue', { note: 'Renamed the date tokens.' }), handlers, '0');
    assert.match(cont.result.content[0].text, /Continuing \(task 1\)/);

    const result = await answer(tool(5, 'upkeep_wait', { timeout_seconds: 5 }), handlers, '0');
    assert.match(result.result.content[0].text, /^RESULT\n\nDone in 4 min, 4 checks\.\n {2}the agent said: Renamed the date tokens\./);

    const early = await answer(tool(6, 'upkeep_continue', { note: 'x' }), handlers, '0');
    assert.equal(early.result.isError, true);
    assert.match(early.result.content[0].text, /not waiting for a fix/);
  } finally {
    await cleanup();
  }
});

test('upkeep_wait before any run says to start one', async () => {
  const { dir, cleanup } = await project();
  try {
    const reply = await answer(tool(1, 'upkeep_wait', { dir, timeout_seconds: 0 }), makeHandlers({ cwd: dir }), '0');
    assert.equal(reply.result.isError, true);
    assert.match(reply.result.content[0].text, /Call upkeep_start first/);
  } finally {
    await cleanup();
  }
});

test('the real server process speaks line-delimited JSON-RPC on stdio', async () => {
  const { dir, cleanup } = await project();
  try {
    const child = spawn(process.execPath, [BIN, 'mcp', '--cwd', dir], { stdio: ['pipe', 'pipe', 'inherit'] });
    let out = '';
    child.stdout.on('data', (chunk) => (out += chunk));
    const send = (message) => child.stdin.write(`${JSON.stringify(message)}\n`);
    send(call(1, 'initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '0' } }));
    send({ jsonrpc: '2.0', method: 'notifications/initialized' });
    send(call(2, 'tools/list'));
    send(tool(3, 'upkeep_plan'));
    child.stdin.write('this is not json\n');
    child.stdin.end();
    const code = await new Promise((resolve) => child.on('close', resolve));
    assert.equal(code, 0);
    const replies = out.trim().split('\n').map((line) => JSON.parse(line));
    const byId = new Map(replies.map((r) => [r.id, r]));
    assert.equal(byId.get(1).result.serverInfo.name, 'upkeep');
    assert.equal(byId.get(2).result.tools.length, 4);
    assert.match(byId.get(3).result.content[0].text, /Upkeep plan for shop/);
    assert.equal(byId.get(null).error.code, -32700);
    assert.equal(replies.length, 4, 'the notification got no reply');
  } finally {
    await cleanup();
  }
});
