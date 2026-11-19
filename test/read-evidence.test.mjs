import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readFailure, readSteps, consoleErrors, failedRequests } from '../src/kane/read-evidence.mjs';
import { makeZip } from './stubs/make-zip.mjs';

// result.yaml in the layout Kane CLI 0.10.6 writes (copied from a real pack,
// account fields removed).
const RESULT = `evidence: '0.1'
test: checkout-ae9bd187
status: failed
duration_ms: 100628
tags:
  - upkeep
environment:
  model: v16-alpha
  browser: Chrome
steps:
  - id: 0-1
    ordinal: 1
    status: passed
    kind: navigate
    duration_ms: 0
    action_id: a0d863aa-0728-4ecb-9dc9-dd5a7f4c6555
  - id: 1-7
    ordinal: 15
    status: passed
    kind: click
    duration_ms: 600
  - id: 1-8
    ordinal: 16
    status: failed
    kind: assert
    duration_ms: 0
`;

// A step failure record as Kane CLI 0.10.6 wrote it for the date-fns break on
// the demo shop (19 Nov 2026), shortened.
const FAILURE = `step: 1-7
status: failed
error:
  message: Order submission navigated to a blank page; confirmation text remained
    absent after waits, refresh, and returning to checkout.
page_state:
  url: http://localhost:4173/#/order/7SiC8haP
  screenshot: steps/15-1-7/screenshot.jpg
title: Order confirmation crashes on date formatting
triage:
  status: triaged
  rca:
    root_cause: The confirmation page fails while formatting the order date, so it
      cannot display the completed order.
    category: application_issue/script_error
    confidence: 0.99
  suggested_fix:
    summary: Update the confirmation date format to use \`dd/MM/yyyy\`.
`;

async function packWith(files) {
  const dir = await mkdtemp(join(tmpdir(), 'upkeep-evidence-'));
  const path = join(dir, 'run.evidence');
  await writeFile(path, makeZip(Object.fromEntries(Object.entries(files).map(([name, text]) => [name, { text }]))));
  return { path, cleanup: () => rm(dir, { recursive: true, force: true }) };
}

test('readSteps reads id, ordinal, status and kind and stops at the next key', () => {
  assert.deepEqual(readSteps(RESULT), [
    { id: '0-1', ordinal: 1, status: 'passed', kind: 'navigate' },
    { id: '1-7', ordinal: 15, status: 'passed', kind: 'click' },
    { id: '1-8', ordinal: 16, status: 'failed', kind: 'assert' },
  ]);
  assert.deepEqual(readSteps('status: passed\n'), []);
});

test('consoleErrors keeps errors and uncaught exceptions, once each', () => {
  const log = [
    JSON.stringify({ level: 'log', text: 'app started' }),
    JSON.stringify({ level: 'error', text: 'RangeError: Use `dd` instead of `DD`', url: 'http://localhost:4173/assets/index-1.js', line: 40 }),
    JSON.stringify({ level: 'error', text: 'RangeError: Use `dd` instead of `DD`', url: 'http://localhost:4173/assets/index-1.js', line: 40 }),
    JSON.stringify({ type: 'warning', message: 'Uncaught TypeError: Cookies.getJSON is not a function' }),
    'not json',
  ].join('\n');
  assert.deepEqual(consoleErrors(log), ['RangeError: Use `dd` instead of `DD` (/assets/index-1.js:40)', 'Uncaught TypeError: Cookies.getJSON is not a function']);
  // Kane logs the same error once without a location and once with it.
  const twice = [JSON.stringify({ level: 'error', text: 'Use `dd`', url: '', line: 0 }), JSON.stringify({ level: 'warning', text: 'Use `dd`', url: 'http://localhost:4173/a.js', line: 75 })].join('\n');
  assert.deepEqual(consoleErrors(twice), ['Use `dd`']);
});

test('failedRequests lists requests that failed', () => {
  const har = JSON.stringify({ log: { entries: [
    { request: { method: 'GET', url: 'http://localhost:4173/products.json' }, response: { status: 200 } },
    { request: { method: 'POST', url: 'http://localhost:4173/api/pay' }, response: { status: 500 } },
  ] } });
  assert.deepEqual(failedRequests(har), ['POST http://localhost:4173/api/pay -> 500']);
  assert.deepEqual(failedRequests('not a har'), []);
});

test('readFailure gathers everything about the failed flow from the pack', async () => {
  const { path, cleanup } = await packWith({
    'run.yaml': 'status: finalized\n',
    'failure.yaml': 'failures: []\n',
    'tests/browse-59fa8097/result.yaml': 'status: passed\nsteps:\n  - id: 0-1\n    ordinal: 1\n    status: passed\n',
    'tests/checkout-ae9bd187/result.yaml': RESULT,
    'tests/checkout-ae9bd187/test.md': '---\nurl: http://localhost:4173\n---\n\n# Check out\n\n## Place the order\nFill the form. Verify "Thanks, Ada Marsh".\n',
    // As in the real pack: Kane's failure record sits on the click that led to
    // the blank page (step 15), while result.yaml marks a later step failed.
    'tests/checkout-ae9bd187/steps/15-1-7/step.json': JSON.stringify({ kind: 'click', status: 'passed', summary: 'click: Clicking Place order button', url: 'http://localhost:4173/#/checkout' }),
    'tests/checkout-ae9bd187/steps/15-1-7/failure.yaml': FAILURE,
    'tests/checkout-ae9bd187/steps/15-1-7/screenshot.jpg': 'jpeg-bytes',
    'tests/checkout-ae9bd187/steps/16-1-8/step.json': JSON.stringify({ kind: 'assert', status: 'failed', summary: 'wait: Waiting after failed order confirmation rendering' }),
    'tests/checkout-ae9bd187/logs/1-console.ndjson': `${JSON.stringify({ level: 'error', text: 'RangeError: Use `dd` instead of `DD`' })}\n`,
    'tests/checkout-ae9bd187/logs/1-network.har': JSON.stringify({ log: { entries: [] } }),
  });
  try {
    const failure = await readFailure(path, { flow: 'checkout_test.md' });
    assert.equal(failure.flow, 'checkout_test.md');
    assert.equal(failure.definition, '# Check out\n\n## Place the order\nFill the form. Verify "Thanks, Ada Marsh".\n');
    assert.equal(failure.failedStep, 'step 15: Order confirmation crashes on date formatting');
    assert.equal(failure.pageUrl, 'http://localhost:4173/#/order/7SiC8haP');
    assert.match(failure.triage, /root_cause: The confirmation page fails while formatting the order date/);
    assert.match(failure.triage, /suggested_fix:/);
    assert.deepEqual(failure.console, ['RangeError: Use `dd` instead of `DD`']);
    assert.deepEqual(failure.network, []);
    assert.deepEqual([failure.screenshot.name, failure.screenshot.bytes.toString()], ['screenshot.jpg', 'jpeg-bytes']);
  } finally {
    await cleanup();
  }
});

test('readFailure returns null for a flow that is not in the pack', async () => {
  const { path, cleanup } = await packWith({ 'tests/browse-59fa8097/result.yaml': 'status: passed\n' });
  try {
    assert.equal(await readFailure(path, { flow: 'checkout_test.md' }), null);
  } finally {
    await cleanup();
  }
});

test('with two attempts of a flow in one pack, the failed one is read', async () => {
  const { path, cleanup } = await packWith({
    'tests/checkout-11111111/result.yaml': 'status: passed\nsteps:\n  - id: 0-1\n    ordinal: 1\n    status: passed\n',
    'tests/checkout-22222222/result.yaml': RESULT,
    'tests/checkout-22222222/steps/16-1-8/step.json': JSON.stringify({ summary: 'assert: thanks', url: 'http://localhost:4173/#/order/x' }),
  });
  try {
    const failure = await readFailure(path, { flow: 'flows/checkout_test.md' });
    assert.equal(failure.failedStep, 'step 16: assert: thanks', 'with no failure record, the step marked failed is used');
    assert.equal(failure.pageUrl, 'http://localhost:4173/#/order/x');
  } finally {
    await cleanup();
  }
});
