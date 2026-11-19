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
  const speeds = [];
  const repaired = new Set();
  let checks = 0;

  const landedIds = new Set();
  const failureIn = (units) => {
    // What a real check sees: everything already landed, plus what is applied now.
    const present = new Set([...landedIds, ...ids(units)]);
    for (const [key, stage] of Object.entries(breaks)) {
      if (repaired.has(key)) continue;
      if (key.split('&').every((id) => present.has(id))) return { key, stage };
    }
    return null;
  };

  return {
    log,
    speeds,
    check: async (units, speed) => {
      checks += 1;
      if (checks > unavailableAfter) return { outcome: 'error', summary: 'Kane CLI is not signed in' };
      const failure = failureIn(units);
      speeds.push(speed);
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
      for (const id of ids(units)) landedIds.add(id);
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
  // 1 together, 5 quick ones to isolate one among 8 (abcd, efgh, ef, e, f),
  // 1 full one to confirm f, 1 for the rest
  assert.equal(result.checks, 8);
  assert.deepEqual(
    w.log.filter(([what]) => what === 'check').map(([, which, outcome]) => `${which}:${outcome}`),
    ['a,b,c,d,e,f,g,h:fail', 'a,b,c,d:pass', 'e,f,g,h:fail', 'e,f:fail', 'e:pass', 'f:fail', 'f:fail', 'a,b,c,d,e,g,h:pass'],
  );
  assert.deepEqual(w.speeds, ['quick', 'quick', 'quick', 'quick', 'quick', 'quick', 'full', 'quick'], 'only the confirming check is a full one');
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

test('two upgrades that only break together: one lands on its own, the other is the culprit', async () => {
  // b and e are each fine alone and break the app together. One-at-a-time
  // bumping would land the first and then be surprised by the second. Here the
  // search finds the pair, lands the half that passes alone, and hands the
  // agent exactly one package to deal with.
  const w = world({ breaks: { 'b&e': 'kane' }, fixable: ['b&e'] });
  const result = await landUpgrades({ units: unitsNamed('a', 'b', 'c', 'd', 'e', 'f'), ...w });
  const fixes = w.log.filter(([what]) => what === 'fix');
  assert.equal(fixes.length, 1);
  assert.ok(['b', 'e'].includes(fixes[0][1]), `one of the pair went to the agent, got ${fixes[0][1]}`);
  const other = fixes[0][1] === 'b' ? 'e' : 'b';
  const lands = w.log.filter(([what]) => what === 'land').map(([, which, how]) => `${which} ${how}`);
  assert.equal(lands[0], `${other} as is`, 'the half that passes alone landed first');
  assert.ok(lands.includes(`${fixes[0][1]} with fix`));
  assert.deepEqual(result.landed.flatMap((entry) => ids(entry.units)).sort(), ['a', 'b', 'c', 'd', 'e', 'f']);
  assert.deepEqual(result.blocked, []);
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

test('a quick failure that a full check clears is landed, not blamed', async () => {
  // Upgrading "d" changes the page enough that a recorded step no longer
  // matches (a quick check fails), but the app works: Kane heals the step and
  // a full check passes. "f" is the upgrade that really breaks the app.
  const fixed = [];
  const check = async (units, speed) => {
    const present = new Set(ids(units));
    if (present.has('f')) return { outcome: 'fail', stage: 'kane', failing: ['checkout_test.md'] };
    if (present.has('d') && speed === 'quick') return { outcome: 'fail', stage: 'kane', failing: ['checkout_test.md'] };
    return { outcome: 'pass' };
  };
  const landedSets = [];
  const result = await landUpgrades({
    units: unitsNamed('a', 'b', 'c', 'd', 'e', 'f'),
    check,
    fix: async (units) => {
      fixed.push(ids(units).join(','));
      return { fixed: false };
    },
    land: async (units, verdict) => {
      assert.equal(verdict.outcome, 'pass');
      landedSets.push(ids(units).join(','));
    },
  });
  assert.ok(!fixed.includes('d'), 'd was never handed to the agent');
  assert.deepEqual(fixed, ['f']);
  assert.ok(landedSets.includes('d'), 'd landed on its own after the full check cleared it');
  assert.deepEqual(result.blocked.map((entry) => ids(entry.units).join(',')), ['f']);
});

test('while isolating a build failure, checks stop after the build', async () => {
  const seen = [];
  const check = async (units, speed, upTo) => {
    seen.push([ids(units).join(','), speed, upTo ?? 'all']);
    const present = new Set(ids(units));
    if (present.has('c')) return { outcome: 'fail', stage: 'build' };
    return upTo === 'build' ? { outcome: 'pass', partial: true } : { outcome: 'pass' };
  };
  const landedSets = [];
  await landUpgrades({
    units: unitsNamed('a', 'b', 'c', 'd'),
    check,
    fix: async () => ({ fixed: false }),
    land: async (units, verdict) => {
      assert.ok(!verdict.partial, 'a check stopped early never lands anything');
      landedSets.push(ids(units).join(','));
    },
  });
  assert.deepEqual(seen, [
    ['a,b,c,d', 'quick', 'all'],
    ['a,b', 'quick', 'build'],
    ['c,d', 'quick', 'build'],
    ['c', 'quick', 'build'],
    ['c', 'full', 'all'],
    ['a,b,d', 'quick', 'all'],
  ]);
  assert.deepEqual(landedSets, ['a,b,d']);
});

test('when B only builds after A is upgraded, A lands first and only B goes to the agent', async () => {
  // The real case from the demo shop: the React group does not build on the old
  // Vite, so alone it fails at the build; with the Vite upgrade it builds and
  // then fails in the browser. Vite alone is fine.
  const landedNow = new Set();
  const log = [];
  const check = async (units, speed, upTo) => {
    const present = new Set([...landedNow, ...ids(units)]);
    log.push(`${ids(units).join(',')}:${speed}`);
    if (present.has('react') && !present.has('vite')) return { outcome: 'fail', stage: 'build' };
    if (present.has('react')) return { outcome: 'fail', stage: 'kane', failing: ['browse_test.md'] };
    return upTo && upTo !== 'kane' ? { outcome: 'pass', partial: true } : { outcome: 'pass' };
  };
  const fixed = [];
  const result = await landUpgrades({
    units: unitsNamed('react', 'vite'),
    check,
    fix: async (units) => {
      fixed.push(ids(units).join(','));
      return { fixed: false };
    },
    land: async (units) => {
      for (const id of ids(units)) landedNow.add(id);
    },
  });
  assert.deepEqual(fixed, ['react'], 'the agent is handed React alone, not the pair');
  assert.deepEqual(result.landed.map((entry) => ids(entry.units).join(',')), ['vite']);
  assert.deepEqual(result.blocked.map((entry) => ids(entry.units).join(',')), ['react']);
  assert.deepEqual(log, [
    'react,vite:quick', // together: fails in the browser
    'react:quick', // alone: fails at the build, a different problem, so not blamed
    'vite:quick', // alone: passes
    'vite:quick', // put in place again and landed
    'react:quick', // now on top of the new Vite: fails in the browser
    'react:full', // confirmed
  ]);
});

test('a fixer that says "fixed" without a passing check to show for it does not land', async () => {
  const landedSets = [];
  const result = await landUpgrades({
    units: unitsNamed('a', 'b'),
    check: async (units) => (ids(units).includes('b') ? { outcome: 'fail', stage: 'kane', failing: ['x_test.md'] } : { outcome: 'pass' }),
    fix: async () => ({ fixed: true, rounds: 1 }), // no verdict at all
    land: async (units, verdict) => {
      assert.equal(verdict.outcome, 'pass');
      landedSets.push(ids(units).join(','));
    },
  });
  assert.deepEqual(landedSets, ['a']);
  assert.equal(result.blocked[0].reason, 'the fixer reported a fix without a passing check');
  assert.equal(result.blocked[0].verdict.outcome, 'fail', 'the report shows the real failure');
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
  // With two checks per search it cannot get down to one package. What passed
  // on the way (the half with b) is landed, and the set it could not split
  // further is held back and marked as not separated.
  assert.equal(result.blocked.length, 1);
  assert.equal(result.blocked[0].separated, false);
  assert.ok(ids(result.blocked[0].units).includes('k'));
  assert.ok(ids(result.blocked[0].units).length > 1);
  assert.ok(result.landed.flatMap((entry) => ids(entry.units)).includes('b'));
});

test('reports progress as events', async () => {
  const events = [];
  const w = world({ breaks: { b: 'kane' }, fixable: ['b'] });
  await landUpgrades({ units: unitsNamed('a', 'b'), ...w, onEvent: (event) => events.push(event) });
  assert.deepEqual(
    events.map((event) => event.type),
    // together, isolate a, isolate b, confirm b, culprit, landed, the rest, landed
    ['check_start', 'check_end', 'check_start', 'check_end', 'check_start', 'check_end', 'check_start', 'check_end', 'culprit', 'landed', 'check_start', 'check_end', 'landed'],
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
