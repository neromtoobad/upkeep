import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readVerdict, POLICY } from '../src/kane/judge-pack.mjs';

// The shape `kane-cli evidence verdict --json` printed for real packs on
// 19 Nov 2026 (Kane CLI 0.10.6), reduced to the fields read here.
const verdict = (gates) => JSON.stringify({ result: 'pass', exit_code: 0, verdicts: [{ gates }] });

test('reads Kane’s two numbers from a verdict', () => {
  const json = verdict([
    { id: 'every-flow-checks-something', status: 'pass', actual: 0 },
    { id: 'no-heal', status: 'warn', actual: 2 },
  ]);
  assert.deepEqual(readVerdict(json), { withoutChecks: 0, healed: 2 });
});

test('a flow without checks is reported even though the verdict failed', () => {
  const json = verdict([
    { id: 'every-flow-checks-something', status: 'fail', actual: 1 },
    { id: 'no-heal', status: 'pass', actual: 0 },
  ]);
  assert.deepEqual(readVerdict(json), { withoutChecks: 1, healed: 0 });
});

test('a gate Kane could not evaluate gives null for that number, not zero', () => {
  const json = verdict([
    { id: 'every-flow-checks-something', status: 'pass', actual: 0 },
    { id: 'no-heal', status: 'errored', actual: null, error: { message: 'no value for the metric' } },
  ]);
  assert.deepEqual(readVerdict(json), { withoutChecks: 0, healed: null });
});

test('output that is not a verdict gives null: the step is advisory', () => {
  assert.equal(readVerdict('error: pack not found'), null);
  assert.equal(readVerdict(JSON.stringify({ result: 'errored', verdicts: [] })), null);
});

test('the policy names Kane’s own metrics', () => {
  assert.match(POLICY, /metric: metrics\.tests_without_checks, equals: 0, severity: blocking/);
  assert.match(POLICY, /metric: metrics\.heal\.healed_tests, max: 0, severity: warning/);
});
