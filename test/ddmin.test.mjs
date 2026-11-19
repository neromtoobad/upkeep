import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ddmin, split } from '../src/isolate/ddmin.mjs';

const range = (n) => Array.from({ length: n }, (_, i) => `p${i}`);

// A stand-in for the real check: fails when every member of any guilty group
// is present. The real check boots the app and runs Kane CLI.
const failsWith = (...groups) => {
  const calls = [];
  const check = async (subset) => {
    calls.push(subset);
    return groups.some((group) => group.every((name) => subset.includes(name))) ? 'fail' : 'pass';
  };
  return { check, calls };
};

test('split keeps order and balances chunk sizes', () => {
  assert.deepEqual(split([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4, 5]]);
  assert.deepEqual(split([1, 2, 3, 4, 5], 5), [[1], [2], [3], [4], [5]]);
  assert.deepEqual(split([1, 2, 3], 3), [[1], [2], [3]]);
});

test('finds a single guilty package among 20 in about 2·log2(n) checks', async () => {
  const { check, calls } = failsWith(['p13']);
  const result = await ddmin(range(20), check);
  assert.deepEqual(result.minimal, ['p13']);
  assert.equal(result.exhausted, false);
  assert.ok(calls.length <= 10, `took ${calls.length} checks`);
  assert.equal(result.tests, calls.length);
});

test('finds the guilty package wherever it sits', async () => {
  for (const guilty of ['p0', 'p7', 'p15']) {
    const { check } = failsWith([guilty]);
    assert.deepEqual((await ddmin(range(16), check)).minimal, [guilty]);
  }
});

test('finds a pair that only breaks together, which one-at-a-time bumps would miss', async () => {
  const { check } = failsWith(['p2', 'p11']);
  const result = await ddmin(range(12), check);
  assert.deepEqual(result.minimal, ['p2', 'p11']);
});

test('with two independent culprits it returns one; the caller removes it and searches again', async () => {
  const { check } = failsWith(['p3'], ['p9']);
  const first = await ddmin(range(12), check);
  assert.equal(first.minimal.length, 1);
  assert.ok(['p3', 'p9'].includes(first.minimal[0]));
});

test('the result is 1-minimal: dropping any member makes the failure go away', async () => {
  const { check } = failsWith(['p1', 'p4', 'p6']);
  const { minimal } = await ddmin(range(8), check);
  assert.deepEqual(minimal, ['p1', 'p4', 'p6']);
  for (const dropped of minimal) {
    assert.equal(await check(minimal.filter((name) => name !== dropped)), 'pass');
  }
});

test('never repeats a check for the same subset', async () => {
  const { check, calls } = failsWith(['p2', 'p11']);
  await ddmin(range(12), check);
  const seen = new Set(calls.map((subset) => subset.join(',')));
  assert.equal(seen.size, calls.length);
});

test('never re-checks the full set or the empty set', async () => {
  const { check, calls } = failsWith(['p5']);
  await ddmin(range(8), check);
  assert.ok(calls.every((subset) => subset.length > 0 && subset.length < 8));
});

test('unresolved subsets are neither blamed nor cleared', async () => {
  // p0 and p1 cannot be installed apart (think react without react-dom), and p5 is guilty.
  const check = async (subset) => {
    if (subset.includes('p0') !== subset.includes('p1')) return 'unresolved';
    return subset.includes('p5') ? 'fail' : 'pass';
  };
  const { minimal } = await ddmin(range(8), check);
  assert.deepEqual(minimal, ['p5']);
});

test('stops at the budget and says so', async () => {
  const { check, calls } = failsWith(['p2', 'p11']);
  const result = await ddmin(range(12), check, { maxTests: 3 });
  assert.equal(calls.length, 3);
  assert.equal(result.exhausted, true);
  assert.ok(result.minimal.includes('p2') && result.minimal.includes('p11'), 'still contains the real culprits');
});

test('works on objects with an id, and records a trace', async () => {
  const units = range(6).map((id) => ({ id }));
  const result = await ddmin(units, async (subset) => (subset.some((u) => u.id === 'p4') ? 'fail' : 'pass'));
  assert.deepEqual(result.minimal, [{ id: 'p4' }]);
  assert.equal(result.trace.length, result.tests);
  assert.deepEqual(Object.keys(result.trace[0]), ['subset', 'outcome']);
});

test('a single failing item is already minimal and costs no checks', async () => {
  const result = await ddmin(['only'], async () => assert.fail('should not be called'));
  assert.deepEqual(result.minimal, ['only']);
  assert.equal(result.tests, 0);
});

test('rejects a check that answers with something else', async () => {
  await assert.rejects(ddmin(range(4), async () => true), /expected pass, fail or unresolved/);
});
