import { test } from 'node:test';
import assert from 'node:assert/strict';
import { landUpgrades, CheckUnavailable } from '../src/loop/land-upgrades.mjs';

const unitsNamed = (...ids) => ids.map((id) => ({ id, packages: [], breaking: false }));
const ids = (units) => units.map((unit) => unit.id);

/**
 * Test double for the real world. `breaks` maps a unit id (or "a+b" pair that
 * only breaks together) to the stage it breaks at. `fixable` lists what the
 * stand-in agent can repair. The real check installs, builds, boots the app
 * and runs Kane CLI; none of that happens here.
 */
function world({ breaks = {}, fixable = [], unavailableAfter = Infinity } = {}) {
  const log = [];
  const repaired = new Set();
  let checks = 0;

  const failureIn = (units) => {
    const present = new Set(ids(units));
    for (const [key, stage] of Object.entries(breaks)) {
      if (repaired.has(key)) continue;
      if (key.split('&').every((id) => present.has(id))) return { key, stage };
    }
    return null;
  };

  return {
    log,
    check: async (units) => {
      checks += 1;
      if (checks > unavailableAfter) return { outcome: 'error', summary: 'Kane CLI is not signed in' };
      const failure = failureIn(units);
      log.push(['check', ids(units).join(','), failure ? 'fail' : 'pass']);
      return failure
        ? {
            outcome: 'fail',
            stage: failure.stage,
            cause: failure.key,
            // In the browser a failure names the flows that failed, as Kane CLI does.
            ...(failure.stage === 'kane' ? { failing: [`${failure.key}_test.md`] } : {}),
            summary: `${failure.key} broke ${failure.stage}`,
          }
        : { outcome: 'pass' };
    },
    fix: async (units, verdict) => {
      const key = verdict.cause;
      log.push(['fix', ids(units).join(',')]);
      if (!fixable.includes(key)) return { fixed: false, rounds: 3, verdict, reason: 'still failing after 3 rounds' };
      repaired.add(key);
      return { fixed: true, rounds: 1, verdict: { outcome: 'pass' } };
    },
    land: async (units, verdict, repair) => {
      assert.equal(verdict.outcome, 'pass', 'only a passing check may land');
      log.push(['land', ids(units).join(','), repair ? 'with fix' : 'as is']);
    },
    discard: async (units) => {
      log.push(['discard', ids(units).join(',')]);
    },
  };
}

test('when everything passes together it lands in one check and one commit', async () => {
  const w = world();
  const result = await landUpgrades({ units: unitsNamed('a', 'b', 'c', 'd'), ...w });
  assert.equal(result.checks, 1);
  assert.deepEqual(w.log, [
    ['check', 'a,b,c,d', 'pass'],
    ['land', 'a,b,c,d', 'as is'],
  ]);
  assert.deepEqual(result.blocked, []);
});

test('one breaking upgrade is isolated, fixed, landed with its fix, and the rest land after', async () => {
  const w = world({ breaks: { f: 'kane' }, fixable: ['f'] });
  const result = await landUpgrades({ units: unitsNamed('a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'), ...w });

  assert.deepEqual(result.landed.map((entry) => [ids(entry.units).join(','), entry.fixed]), [
    ['f', true],
    ['a,b,c,d,e,g,h', false],
  ]);
  assert.deepEqual(result.blocked, []);
  assert.deepEqual(w.log.filter(([what]) => what !== 'check'), [
    ['fix', 'f'],
    ['land', 'f', 'with fix'],
    ['land', 'a,b,c,d,e,g,h', 'as is'],
  ]);
  // 1 together, 5 to isolate one among 8 (abcd, efgh, ef, e, f), 1 for the rest
  assert.equal(result.checks, 7);
  assert.deepEqual(
    w.log.filter(([what]) => what === 'check').map(([, which, outcome]) => `${which}:${outcome}`),
    ['a,b,c,d,e,f,g,h:fail', 'a,b,c,d:pass', 'e,f,g,h:fail', 'e,f:fail', 'e:pass', 'f:fail', 'a,b,c,d,e,g,h:pass'],
  );
});

test('an upgrade the agent cannot fix is blocked and discarded, never landed', async () => {
  const w = world({ breaks: { c: 'kane' } });
  const result = await landUpgrades({ units: unitsNamed('a', 'b', 'c', 'd'), ...w });

  assert.deepEqual(result.landed.map((entry) => ids(entry.units).join(',')), ['a,b,d']);
  assert.equal(result.blocked.length, 1);
  assert.deepEqual(ids(result.blocked[0].units), ['c']);
  assert.equal(result.blocked[0].reason, 'still failing after 3 rounds');
  assert.equal(result.blocked[0].rounds, 3);
  assert.ok(w.log.some(([what, which]) => what === 'discard' && which === 'c'));
  assert.ok(!w.log.some(([what, which]) => what === 'land' && which.split(',').includes('c')));
});

test('two independent culprits are found one after the other', async () => {
  const w = world({ breaks: { b: 'kane', g: 'build' }, fixable: ['b'] });
  const result = await landUpgrades({ units: unitsNamed('a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'), ...w });

  assert.deepEqual(result.landed.map((entry) => [ids(entry.units).join(','), entry.fixed]), [
    ['b', true],
    ['a,c,d,e,f,h', false],
  ]);
  assert.deepEqual(result.blocked.map((entry) => [ids(entry.units).join(','), entry.verdict.stage]), [['g', 'build']]);
});

test('a pair that only breaks together is handed to the agent as a pair', async () => {
  const w = world({ breaks: { 'b&e': 'kane' }, fixable: ['b&e'] });
  const result = await landUpgrades({ units: unitsNamed('a', 'b', 'c', 'd', 'e', 'f'), ...w });
  assert.deepEqual(w.log.find(([what]) => what === 'fix'), ['fix', 'b,e']);
  assert.deepEqual(result.landed.map((entry) => ids(entry.units).join(',')), ['b,e', 'a,c,d,f']);
});

test('a subset that fails a different way is not blamed for the first failure', async () => {
  // Together the app fails in the browser because of d. Separately, a alone
  // cannot be installed without b (a different failure), which must not make
  // "a" look like the culprit for the browser failure.
  const calls = [];
  const check = async (units) => {
    const present = new Set(ids(units));
    calls.push(ids(units).join(','));
    if (present.has('a') !== present.has('b')) return { outcome: 'fail', stage: 'install' };
    if (present.has('d')) return { outcome: 'fail', stage: 'kane', failing: ['checkout_test.md'] };
    return { outcome: 'pass' };
  };
  const fixed = [];
  const result = await landUpgrades({
    units: unitsNamed('a', 'b', 'c', 'd'),
    check,
    fix: async (units) => {
      fixed.push(ids(units).join(','));
      return { fixed: false };
    },
    land: async () => {},
  });
  assert.deepEqual(fixed, ['d']);
  assert.deepEqual(result.landed.map((entry) => ids(entry.units).join(',')), ['a,b,c']);
});

test('two packages that break two different flows are separated, not handed over as a pair', async () => {
  const fixed = [];
  const check = async (units) => {
    const present = new Set(ids(units));
    const failing = [];
    if (present.has('b')) failing.push('cart_test.md');
    if (present.has('e')) failing.push('checkout_test.md');
    return failing.length > 0 ? { outcome: 'fail', stage: 'kane', failing } : { outcome: 'pass' };
  };
  const result = await landUpgrades({
    units: unitsNamed('a', 'b', 'c', 'd', 'e', 'f'),
    check,
    fix: async (units, verdict) => {
      fixed.push([ids(units).join(','), verdict.failing.join(',')]);
      return { fixed: false };
    },
    land: async () => {},
  });
  assert.deepEqual(fixed, [
    ['b', 'cart_test.md'],
    ['e', 'checkout_test.md'],
  ]);
  assert.deepEqual(result.landed.map((entry) => ids(entry.units).join(',')), ['a,c,d,f']);
});

test('a check that cannot run stops everything instead of blaming an upgrade', async () => {
  const w = world({ breaks: { c: 'kane' }, unavailableAfter: 2 });
  await assert.rejects(
    landUpgrades({ units: unitsNamed('a', 'b', 'c', 'd'), ...w }),
    (error) => error instanceof CheckUnavailable && /not signed in/.test(error.message),
  );
  assert.ok(!w.log.some(([what]) => what === 'land' || what === 'fix'));
});

test('when the search budget runs out, the unseparated set is reported as such', async () => {
  const w = world({ breaks: { 'b&k': 'kane' } });
  const result = await landUpgrades({
    units: unitsNamed('a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'l'),
    ...w,
    maxChecksPerSearch: 2,
  });
  assert.equal(result.blocked[0].separated, false);
  assert.ok(ids(result.blocked[0].units).includes('b') && ids(result.blocked[0].units).includes('k'));
});

test('reports progress as events', async () => {
  const events = [];
  const w = world({ breaks: { b: 'kane' }, fixable: ['b'] });
  await landUpgrades({ units: unitsNamed('a', 'b'), ...w, onEvent: (event) => events.push(event) });
  assert.deepEqual(
    events.map((event) => event.type),
    ['check_start', 'check_end', 'check_start', 'check_end', 'check_start', 'check_end', 'culprit', 'landed', 'check_start', 'check_end', 'landed'],
  );
  const culprit = events.find((event) => event.type === 'culprit');
  assert.deepEqual(culprit.units, ['b']);
  assert.equal(culprit.verdict.cause, 'b');
  assert.equal(culprit.separated, true);
});

test('nothing to upgrade means nothing to check', async () => {
  const result = await landUpgrades({
    units: [],
    check: async () => assert.fail('no check expected'),
    fix: async () => assert.fail('no fix expected'),
    land: async () => assert.fail('no commit expected'),
  });
  assert.deepEqual(result, { landed: [], blocked: [], checks: 0 });
});
