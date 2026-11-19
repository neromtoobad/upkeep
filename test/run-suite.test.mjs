import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runKaneSuite, readCredits } from '../src/kane/run-suite.mjs';

// These tests drive run-suite.mjs through a real child process, but the
// process is test/stubs/kane-cli-stub.mjs, not Kane CLI.
const STUB = fileURLToPath(new URL('./stubs/kane-cli-stub.mjs', import.meta.url));

const START = { type: 'stream_start', cli_version: '0.10.6', surface: 'testrun' };
const plan = (...flows) => ({ type: 'testrun_plan', valid: true, members: flows.map((f) => ({ path: `/app/${f}` })) });
const end = (flow, status, message) => ({ type: 'testrun_member_end', path: flow, status, duration_s: 9, ...(message ? { failure: { message } } : {}) });
const pack = (id) => ({ type: 'coverage', status: 'skipped', pack: `/app/.testmuai/evidence/${id}.evidence` });

async function withStub(script, body) {
  const dir = await mkdtemp(join(tmpdir(), 'upkeep-kane-'));
  const file = join(dir, 'script.json');
  await writeFile(file, JSON.stringify(script));
  const before = { bin: process.env.UPKEEP_KANE_BIN, script: process.env.KANE_STUB_SCRIPT };
  process.env.UPKEEP_KANE_BIN = STUB;
  process.env.KANE_STUB_SCRIPT = file;
  try {
    return await body({ dir, argsOf: async (call) => JSON.parse(await readFile(`${file}.args.${call}`, 'utf8')) });
  } finally {
    if (before.bin === undefined) delete process.env.UPKEEP_KANE_BIN;
    else process.env.UPKEEP_KANE_BIN = before.bin;
    if (before.script === undefined) delete process.env.KANE_STUB_SCRIPT;
    else process.env.KANE_STUB_SCRIPT = before.script;
    await rm(dir, { recursive: true, force: true });
  }
}

const FLOWS = ['flows/a_test.md', 'flows/b_test.md'];

test('passes the flows to kane-cli as an agent-mode headless suite', async () => {
  await withStub([{ exit: 0, events: [START, plan(...FLOWS), end(FLOWS[0], 'passed'), end(FLOWS[1], 'passed'), pack('one')] }], async ({ dir, argsOf }) => {
    const result = await runKaneSuite({ cwd: dir, flows: FLOWS, parallel: 3 });
    assert.equal(result.outcome, 'pass');
    assert.deepEqual(result.packs, ['/app/.testmuai/evidence/one.evidence']);
    assert.deepEqual(await argsOf(0), ['testrun', 'run', ...FLOWS, '--agent', '--headless', '--parallel', '2']);
  });
});

test('heal can be turned off', async () => {
  await withStub([{ exit: 0, events: [START, plan(FLOWS[0]), end(FLOWS[0], 'passed')] }], async ({ dir, argsOf }) => {
    await runKaneSuite({ cwd: dir, flows: [FLOWS[0]], heal: false });
    assert.ok((await argsOf(0)).includes('--no-adaptive-heal'));
  });
});

test('a failed flow comes back as a failure with Kane’s reason', async () => {
  await withStub([{ exit: 1, events: [START, plan(...FLOWS), end(FLOWS[0], 'passed'), end(FLOWS[1], 'failed', 'The cart was empty after the reload')] }], async ({ dir }) => {
    const result = await runKaneSuite({ cwd: dir, flows: FLOWS });
    assert.equal(result.outcome, 'fail');
    assert.deepEqual(result.failing, ['b_test.md']);
    assert.match(result.summary, /The cart was empty after the reload/);
  });
});

test('a flow Kane could not run is retried alone, and its retry result is used', async () => {
  const script = [
    { exit: 1, events: [START, plan(...FLOWS), end(FLOWS[0], 'passed'), end(FLOWS[1], 'broken', 'v16-runner exited before ready'), pack('one')] },
    { exit: 0, events: [START, plan(FLOWS[1]), end(FLOWS[1], 'passed'), pack('two')] },
  ];
  await withStub(script, async ({ dir, argsOf }) => {
    const result = await runKaneSuite({ cwd: dir, flows: FLOWS });
    assert.equal(result.outcome, 'pass');
    assert.deepEqual(result.flows.map((f) => [f.flow, f.status]), [['a_test.md', 'passed'], ['b_test.md', 'passed']]);
    assert.deepEqual(result.packs, ['/app/.testmuai/evidence/one.evidence', '/app/.testmuai/evidence/two.evidence']);
    assert.deepEqual((await argsOf(1)).slice(0, 3), ['testrun', 'run', 'flows/b_test.md']);
  });
});

test('a flow that is still broken after the retry leaves the check unavailable', async () => {
  const broken = { exit: 1, events: [START, plan(...FLOWS), end(FLOWS[0], 'failed', 'real failure'), end(FLOWS[1], 'broken', 'Chrome did not start')] };
  const again = { exit: 1, events: [START, plan(FLOWS[1]), end(FLOWS[1], 'broken', 'Chrome did not start')] };
  await withStub([broken, again], async ({ dir }) => {
    const result = await runKaneSuite({ cwd: dir, flows: FLOWS });
    assert.equal(result.outcome, 'error');
    assert.deepEqual(result.unjudged, ['b_test.md']);
    assert.deepEqual(result.failing, ['a_test.md']);
  });
});

test('kane-cli refusing to start (not signed in) is unavailable, with its message', async () => {
  await withStub([{ exit: 2, events: [], stderr: 'error: not logged in. Run kane-cli login' }], async ({ dir }) => {
    const result = await runKaneSuite({ cwd: dir, flows: FLOWS });
    assert.equal(result.outcome, 'error');
    assert.match(result.summary, /not logged in/);
  });
});

test('a missing kane-cli says how to install it', async () => {
  const before = process.env.UPKEEP_KANE_BIN;
  process.env.UPKEEP_KANE_BIN = '/nonexistent/kane-cli';
  try {
    const result = await runKaneSuite({ cwd: tmpdir(), flows: FLOWS });
    assert.equal(result.outcome, 'error');
    assert.match(result.summary, /npm install -g @testmuai\/kane-cli/);
    assert.equal(await readCredits(), null);
  } finally {
    if (before === undefined) delete process.env.UPKEEP_KANE_BIN;
    else process.env.UPKEEP_KANE_BIN = before;
  }
});

test('readCredits parses the balance line', async () => {
  await withStub([{ exit: 0, events: [] }], async () => {
    assert.equal(await readCredits(), 1000);
  });
});
