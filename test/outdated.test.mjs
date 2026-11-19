import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { planFromOutdated, readOutdated } from '../src/plan/outdated.mjs';

// The shape below is what npm 11 printed for a real project on 19 Nov 2026
// (`npm outdated --json --long`), trimmed to the fields Upkeep reads.
const OUTDATED = {
  'date-fns': { current: '1.30.1', wanted: '1.30.1', latest: '4.4.0', type: 'dependencies' },
  'react-hook-form': {
    current: '6.15.8',
    wanted: '6.15.8',
    latest: '7.92.0',
    type: 'dependencies',
    homepage: 'https://react-hook-form.com',
  },
  vite: { current: '4.0.0', wanted: '4.5.14', latest: '8.3.8', type: 'devDependencies', homepage: 'https://vite.dev' },
};

const PKG = {
  dependencies: { 'date-fns': '1.30.1', 'react-hook-form': '~6.15.8' },
  devDependencies: { vite: '^4.0.0' },
};

test('plans one candidate per outdated direct dependency, sorted by name', () => {
  const { candidates, skipped } = planFromOutdated(OUTDATED, PKG);
  assert.deepEqual(skipped, []);
  assert.deepEqual(
    candidates.map((c) => [c.name, c.from, c.to, c.kind, c.breaking]),
    [
      ['date-fns', '1.30.1', '4.4.0', 'major', true],
      ['react-hook-form', '6.15.8', '7.92.0', 'major', true],
      ['vite', '4.0.0', '8.3.8', 'major', true],
    ],
  );
});

test('a bump keeps the range style already used in package.json', () => {
  const { candidates } = planFromOutdated(OUTDATED, PKG);
  const byName = Object.fromEntries(candidates.map((c) => [c.name, c]));
  assert.equal(byName['date-fns'].nextSpec, '4.4.0');
  assert.equal(byName['react-hook-form'].nextSpec, '~7.92.0');
  assert.equal(byName.vite.nextSpec, '^8.3.8');
  assert.equal(byName.vite.section, 'devDependencies');
  assert.equal(byName.vite.homepage, 'https://vite.dev');
});

test('target "wanted" stays inside the range and drops packages with nothing to gain', () => {
  const { candidates } = planFromOutdated(OUTDATED, PKG, { target: 'wanted' });
  assert.deepEqual(
    candidates.map((c) => [c.name, c.to, c.kind, c.breaking]),
    [['vite', '4.5.14', 'minor', false]],
  );
});

test('only and exclude narrow the plan, and an exclusion is reported', () => {
  const only = planFromOutdated(OUTDATED, PKG, { only: ['vite'] });
  assert.deepEqual(only.candidates.map((c) => c.name), ['vite']);
  assert.deepEqual(only.skipped, []);

  const without = planFromOutdated(OUTDATED, PKG, { exclude: ['vite'] });
  assert.deepEqual(without.candidates.map((c) => c.name), ['date-fns', 'react-hook-form']);
  assert.deepEqual(without.skipped, [{ name: 'vite', reason: 'excluded by you' }]);
});

test('packages Upkeep cannot safely rewrite are skipped with a reason', () => {
  const outdated = {
    transitive: { current: '1.0.0', wanted: '1.0.0', latest: '2.0.0', type: 'dependencies' },
    linked: { current: '1.0.0', wanted: '1.0.0', latest: '2.0.0', type: 'dependencies' },
    tagged: { current: '1.0.0', wanted: '1.0.0', latest: 'next', type: 'dependencies' },
  };
  const pkg = { dependencies: { linked: 'github:someone/linked', tagged: '^1.0.0' } };
  const { candidates, skipped } = planFromOutdated(outdated, pkg);
  assert.deepEqual(candidates, []);
  assert.deepEqual(skipped, [
    { name: 'linked', reason: 'spec "github:someone/linked" is not a plain version range' },
    { name: 'tagged', reason: 'npm reported no usable latest version' },
    { name: 'transitive', reason: 'not a direct dependency in package.json' },
  ]);
});

test('peerDependencies are never bumped', () => {
  const outdated = { react: { current: '18.3.1', wanted: '18.3.1', latest: '19.2.0', type: 'peerDependencies' } };
  const { candidates, skipped } = planFromOutdated(outdated, { peerDependencies: { react: '^18.0.0' } });
  assert.deepEqual(candidates, []);
  assert.equal(skipped[0].reason, 'not a direct dependency in package.json');
});

test('falls back to the package.json version when nothing is installed yet', () => {
  const outdated = { vite: { wanted: '4.5.14', latest: '8.3.8', type: 'devDependencies' } };
  const { candidates } = planFromOutdated(outdated, PKG);
  assert.equal(candidates[0].from, '4.0.0');
});

test('a workspace row list picks the row for the section in the root package.json', () => {
  const outdated = {
    vite: [
      { current: '5.0.0', wanted: '5.0.0', latest: '8.3.8', type: 'dependencies', dependent: 'docs' },
      { current: '4.0.0', wanted: '4.5.14', latest: '8.3.8', type: 'devDependencies', dependent: 'root' },
    ],
  };
  const { candidates } = planFromOutdated(outdated, PKG);
  assert.equal(candidates[0].from, '4.0.0');
});

test('an already current or newer install is not a candidate', () => {
  const outdated = { vite: { current: '8.3.8', wanted: '8.3.8', latest: '8.3.8', type: 'devDependencies' } };
  assert.deepEqual(planFromOutdated(outdated, PKG).candidates, []);
});

test('rejects an unknown target', () => {
  assert.throws(() => planFromOutdated(OUTDATED, PKG, { target: 'minor' }), /unknown target "minor"/);
});

test('readOutdated returns {} for a project with no dependencies', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'upkeep-outdated-'));
  try {
    await writeFile(join(dir, 'package.json'), JSON.stringify({ name: 'empty', version: '1.0.0', private: true }));
    assert.deepEqual(await readOutdated(dir), {});
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
