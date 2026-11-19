import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withVersions, formatLike, declaredSpecs } from '../src/apply/set-versions.mjs';

const PKG = {
  name: 'shop',
  dependencies: { react: '^17.0.2', 'react-dom': '^17.0.2', 'date-fns': '^1.30.1' },
  devDependencies: { vite: '^4.0.0' },
};

const unit = (...packages) => ({ id: packages.map((p) => p[0]).join('+'), packages: packages.map(([name, section, nextSpec]) => ({ name, section, nextSpec })) });

test('sets only the versions of the given units and leaves the input untouched', () => {
  const next = withVersions(PKG, [unit(['react', 'dependencies', '^19.2.0'], ['react-dom', 'dependencies', '^19.2.0'])]);
  assert.deepEqual(next.dependencies, { react: '^19.2.0', 'react-dom': '^19.2.0', 'date-fns': '^1.30.1' });
  assert.deepEqual(next.devDependencies, { vite: '^4.0.0' });
  assert.equal(PKG.dependencies.react, '^17.0.2');
});

test('applying no units gives back the base', () => {
  assert.deepEqual(withVersions(PKG, []), PKG);
});

test('refuses a package that has left package.json since the plan was made', () => {
  assert.throws(() => withVersions(PKG, [unit(['zod', 'dependencies', '^4.0.0'])]), /zod is not in dependencies/);
});

test('formatLike keeps the indent and the final newline of the original file', () => {
  const tabs = '{\n\t"name": "shop"\n}\n';
  assert.equal(formatLike(tabs, { name: 'shop' }), '{\n\t"name": "shop"\n}\n');
  const four = '{\n    "name": "shop"\n}';
  assert.equal(formatLike(four, { name: 'shop' }), '{\n    "name": "shop"\n}');
});

test('declaredSpecs lists every spec a patch must not change, including overrides', () => {
  assert.deepEqual(declaredSpecs({ ...PKG, overrides: { glob: '10.0.0' } }), [
    'dependencies date-fns "^1.30.1"',
    'dependencies react "^17.0.2"',
    'dependencies react-dom "^17.0.2"',
    'devDependencies vite "^4.0.0"',
    'overrides glob "10.0.0"',
  ]);
});
