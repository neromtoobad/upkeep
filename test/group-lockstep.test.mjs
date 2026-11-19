import { test } from 'node:test';
import assert from 'node:assert/strict';
import { groupLockstep, typedPackage } from '../src/plan/group-lockstep.mjs';

const candidate = (name, to, breaking = false) => ({ name, from: '1.0.0', to, breaking });
const ids = (units) => units.map((unit) => unit.id);

test('unrelated packages stay one unit each', () => {
  const units = groupLockstep([candidate('zod', '4.0.0'), candidate('date-fns', '4.4.0'), candidate('vite', '8.3.8')]);
  assert.deepEqual(ids(units), ['date-fns', 'vite', 'zod']);
});

test('react and react-dom move together when they target the same version', () => {
  const units = groupLockstep([candidate('react-dom', '19.2.0'), candidate('react', '19.2.0'), candidate('zod', '4.0.0')]);
  assert.deepEqual(ids(units), ['react+react-dom', 'zod']);
});

test('family members on different versions are not forced together', () => {
  const units = groupLockstep([candidate('react', '19.2.0'), candidate('react-is', '18.3.1')]);
  assert.deepEqual(ids(units), ['react', 'react-is']);
});

test('a scope on one version is one release train', () => {
  const units = groupLockstep([
    candidate('@mui/material', '7.3.0'),
    candidate('@mui/icons-material', '7.3.0'),
    candidate('@mui/x-date-pickers', '8.1.0'),
  ]);
  assert.deepEqual(ids(units), ['@mui/icons-material+@mui/material', '@mui/x-date-pickers']);
});

test('types follow the package they describe, including scoped ones', () => {
  const units = groupLockstep([
    candidate('react', '19.2.0'),
    candidate('react-dom', '19.2.0'),
    candidate('@types/react', '19.2.2'),
    candidate('@types/react-dom', '19.2.1'),
    candidate('@babel/core', '8.0.0'),
    candidate('@types/babel__core', '7.20.5'),
    candidate('@types/node', '24.1.0'),
  ]);
  assert.deepEqual(ids(units), [
    '@babel/core+@types/babel__core',
    '@types/node',
    '@types/react+@types/react-dom+react+react-dom',
  ]);
});

test('@types packages are not lumped together just for sharing the @types scope', () => {
  const units = groupLockstep([candidate('@types/node', '24.1.0'), candidate('@types/lodash', '24.1.0')]);
  assert.deepEqual(ids(units), ['@types/lodash', '@types/node']);
});

test('a unit is breaking when any member is', () => {
  const [unit] = groupLockstep([candidate('react', '19.2.0', true), candidate('react-dom', '19.2.0', false)]);
  assert.equal(unit.breaking, true);
  assert.deepEqual(unit.packages.map((p) => p.name), ['react', 'react-dom']);
});

test('typedPackage maps a types package to what it describes', () => {
  assert.equal(typedPackage('@types/react'), 'react');
  assert.equal(typedPackage('@types/babel__core'), '@babel/core');
  assert.equal(typedPackage('react'), null);
});

test('no candidates, no units', () => {
  assert.deepEqual(groupLockstep([]), []);
});
