import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { readSuiteStream, judgeSuite } from '../src/kane/read-suite-stream.mjs';

const fixture = (name) => readFile(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');

// Real capture: `kane-cli testrun run … --agent --headless --parallel 3` on the
// demo shop, 19 Nov 2026, Kane CLI 0.10.6. Two flows were authored and passed;
// the third never ran because Kane's runner crashed on start (SIGBUS). Only the
// home folder in the paths was shortened.
test('real run: two flows pass, one is broken by a runner crash', async () => {
  const suite = readSuiteStream(await fixture('kane-suite-authored-one-broken.ndjson'));

  assert.equal(suite.started, true);
  assert.equal(suite.cliVersion, '0.10.6');
  assert.equal(suite.planValid, true);
  assert.equal(suite.overall, 'failed');
  assert.equal(suite.pack, '/work/demo-shop/.testmuai/evidence/963540aa-cb5f-498b-81e9-168d76e83ae9.evidence');
  assert.deepEqual(
    suite.flows.map((f) => [f.flow, f.status, f.authored]),
    [
      ['browse_test.md', 'passed', true],
      ['cart_test.md', 'passed', true],
      ['checkout_test.md', 'broken', true],
    ],
  );
  assert.equal(suite.flows[0].seconds, 94);
  assert.equal(suite.flows[0].testId, 'browse-59fa8097');
  assert.match(suite.flows[2].message, /v16-runner exited before ready/);
});

test('real run: a runner crash is "could not check", never "the upgrade broke the app"', async () => {
  const suite = readSuiteStream(await fixture('kane-suite-authored-one-broken.ndjson'));
  // Kane exited 1 for this run, the same code it uses for a real failure.
  const verdict = judgeSuite(suite, { exitCode: 1 });
  assert.equal(verdict.outcome, 'error');
  assert.deepEqual(verdict.failing, []);
  assert.deepEqual(verdict.unjudged, ['checkout_test.md']);
  assert.match(verdict.summary, /could not run checkout_test.md: v16-runner exited before ready/);
});

// The streams below are written by hand from the event shapes in Kane CLI's
// skill reference (references/testrun.md) to cover cases the capture does not.
const stream = (...events) => events.map((event) => JSON.stringify(event)).join('\n');
const START = { type: 'stream_start', cli_version: '0.10.6', surface: 'testrun' };
const plan = (...flows) => ({ type: 'testrun_plan', valid: true, members: flows.map((f) => ({ path: `/app/flows/${f}` })) });
const end = (flow, status, extra = {}) => ({ type: 'testrun_member_end', path: `flows/${flow}`, status, duration_s: 12, ...extra });

test('all flows pass', () => {
  const suite = readSuiteStream(stream(START, plan('a_test.md', 'b_test.md'), end('a_test.md', 'passed'), end('b_test.md', 'passed'), { type: 'testrun_done', overall_status: 'passed' }));
  assert.deepEqual(judgeSuite(suite, { exitCode: 0 }), { outcome: 'pass', failing: [], unjudged: [], summary: '2 of 2 flows passed' });
});

test('a failed flow is a real failure and carries Kane’s reason', () => {
  const suite = readSuiteStream(
    stream(
      START,
      plan('a_test.md', 'checkout_test.md'),
      end('a_test.md', 'passed'),
      end('checkout_test.md', 'failed', { failure: { message: 'The page did not say "Thanks, Ada Marsh"', step_index: 2 } }),
      { type: 'testrun_done', overall_status: 'failed' },
    ),
  );
  const verdict = judgeSuite(suite, { exitCode: 1 });
  assert.equal(verdict.outcome, 'fail');
  assert.deepEqual(verdict.failing, ['checkout_test.md']);
  assert.equal(verdict.summary, '1 of 2 flows failed: checkout_test.md: The page did not say "Thanks, Ada Marsh"');
  assert.equal(suite.flows[1].stepIndex, 2);
});

test('a failed flow next to a broken one is still "could not check"', () => {
  const suite = readSuiteStream(stream(START, plan('a_test.md', 'b_test.md'), end('a_test.md', 'failed'), end('b_test.md', 'broken', { failure: { message: 'Chrome did not start' } })));
  const verdict = judgeSuite(suite, { exitCode: 1 });
  assert.equal(verdict.outcome, 'error');
  assert.deepEqual(verdict.failing, ['a_test.md']);
  assert.deepEqual(verdict.unjudged, ['b_test.md']);
});

test('a planned flow that never reported an end is unjudged', () => {
  const suite = readSuiteStream(stream(START, plan('a_test.md', 'b_test.md'), end('a_test.md', 'passed')));
  const verdict = judgeSuite(suite, { exitCode: 3 });
  assert.equal(verdict.outcome, 'error');
  assert.deepEqual(verdict.unjudged, ['b_test.md']);
});

test('nothing on stdout (not signed in, bad flag) is "could not check"', () => {
  const verdict = judgeSuite(readSuiteStream(''), { exitCode: 2, stderr: 'warning: x\nerror: not logged in — run kane-cli login\n' });
  assert.equal(verdict.outcome, 'error');
  assert.match(verdict.summary, /did not start a run \(exit 2\)\. error: not logged in/);
});

test('an invalid plan names the flow and the reason', () => {
  const suite = readSuiteStream(stream(START, { type: 'testrun_plan', valid: false, members: [{ path: '/app/flows/a_test.md', failure: 'org_mismatch' }] }));
  const verdict = judgeSuite(suite, { exitCode: 2 });
  assert.equal(verdict.outcome, 'error');
  assert.match(verdict.summary, /refused the flows before running them\. a_test.md: org_mismatch/);
});

test('flows pass but a policy gate fails: a failure with no failing flow', () => {
  const suite = readSuiteStream(
    stream(START, plan('a_test.md'), end('a_test.md', 'passed'), { type: 'verdict', result: 'fail', policies: [{ id: 'gate', failed_gate_ids: ['no-heals'] }] }, { type: 'testrun_done', overall_status: 'passed' }),
  );
  const verdict = judgeSuite(suite, { exitCode: 1 });
  assert.equal(verdict.outcome, 'fail');
  assert.match(verdict.summary, /policy did not: no-heals/);
});

test('lines that are not JSON and unknown event types are ignored', () => {
  const text = ['Skill update available', JSON.stringify(START), '{broken json', JSON.stringify({ type: 'something_new', x: 1 }), JSON.stringify(plan('a_test.md')), JSON.stringify(end('a_test.md', 'passed'))].join('\n');
  assert.equal(judgeSuite(readSuiteStream(text), { exitCode: 0 }).outcome, 'pass');
});
