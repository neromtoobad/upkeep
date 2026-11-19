import { test } from 'node:test';
import assert from 'node:assert/strict';
import { narrowUnits } from '../src/plan/make-plan.mjs';

const unit = (...names) => ({ id: names.join('+'), packages: names.map((name) => ({ name })), breaking: true });
const UNITS = [unit('date-fns'), unit('react', 'react-dom', 'react-hook-form'), unit('vite', '@vitejs/plugin-react')];
const ids = (units) => units.map((u) => u.id);

test('with no filter every unit is taken', () => {
  assert.deepEqual(narrowUnits(UNITS), { units: UNITS, skipped: [], notes: [] });
});

test('--only takes the whole unit and says who comes along', () => {
  const { units, notes } = narrowUnits(UNITS, { only: ['react'] });
  assert.deepEqual(ids(units), ['react+react-dom+react-hook-form']);
  assert.deepEqual(notes, ['react-dom, react-hook-form come along: react cannot be upgraded without them']);
});

test('--only with a package that stands alone adds no note', () => {
  const { units, notes } = narrowUnits(UNITS, { only: ['date-fns'] });
  assert.deepEqual(ids(units), ['date-fns']);
  assert.deepEqual(notes, []);
});

test('--only refuses a name that is not behind', () => {
  assert.throws(() => narrowUnits(UNITS, { only: ['react', 'lodash'] }), /--only names lodash, which is not behind/);
});

test('--exclude leaves the whole unit alone and says why its partners stay', () => {
  const { units, skipped } = narrowUnits(UNITS, { exclude: ['react-dom'] });
  assert.deepEqual(ids(units), ['date-fns', 'vite+@vitejs/plugin-react']);
  assert.deepEqual(skipped, [
    { name: 'react', reason: 'must move together with react-dom, which you excluded' },
    { name: 'react-dom', reason: 'excluded by you' },
    { name: 'react-hook-form', reason: 'must move together with react-dom, which you excluded' },
  ]);
});

test('--only and --exclude together: exclude wins for the unit it touches', () => {
  const { units } = narrowUnits(UNITS, { only: ['react', 'date-fns'], exclude: ['react-hook-form'] });
  assert.deepEqual(ids(units), ['date-fns']);
});
