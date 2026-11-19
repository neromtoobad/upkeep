import { test } from 'node:test';
import assert from 'node:assert/strict';
import { satisfies } from '../src/plan/semver-range.mjs';

const yes = (version, range) => assert.equal(satisfies(version, range), true, `${version} should satisfy ${range}`);
const no = (version, range) => assert.equal(satisfies(version, range), false, `${version} should not satisfy ${range}`);

test('real peer ranges that decide the demo shop upgrade', () => {
  // react-hook-form 6 will not accept React 19; react-hook-form 7 will.
  no('19.2.0', '^16.8.0 || ^17');
  yes('17.0.2', '^16.8.0 || ^17');
  yes('19.2.0', '^16.8.0 || ^17 || ^18 || ^19');
  // react-markdown 10 needs React 18 or newer.
  no('17.0.2', '>=18');
  yes('19.2.0', '>=18');
  // @vitejs/plugin-react 3 only accepts Vite 4.
  no('8.3.8', '^4.0.0');
  yes('4.5.14', '^4.0.0');
});

test('caret', () => {
  yes('1.9.9', '^1.2.3');
  no('2.0.0', '^1.2.3');
  no('1.2.2', '^1.2.3');
  yes('0.2.9', '^0.2.3');
  no('0.3.0', '^0.2.3');
  yes('0.0.3', '^0.0.3');
  no('0.0.4', '^0.0.3');
  yes('18.3.1', '^18');
  yes('0.9.0', '^0');
});

test('tilde', () => {
  yes('4.2.9', '~4.2.0');
  no('4.3.0', '~4.2.0');
  yes('4.9.0', '~4');
  no('5.0.0', '~4');
});

test('comparators, alone and combined', () => {
  yes('5.9.9', '>=4.0.0 <6');
  no('6.0.0', '>=4.0.0 <6');
  no('3.9.9', '>=4.0.0 <6');
  yes('18.0.0', '>17');
  no('17.9.9', '>17');
  yes('17.0.3', '>17.0.2');
  no('17.0.2', '>17.0.2');
  yes('17.9.9', '<=17');
  no('18.0.0', '<=17');
  yes('2.0.0', '<= 2.0.0');
  no('2.0.1', '<= 2.0.0');
  yes('1.2.3', '=1.2.3');
});

test('x-ranges, bare versions and star', () => {
  yes('18.2.0', '18.x');
  no('19.0.0', '18.x');
  yes('18.2.7', '18.2');
  no('18.3.0', '18.2');
  yes('18.2.0', '18');
  yes('1.2.3', '1.2.3');
  no('1.2.4', '1.2.3');
  yes('99.0.0', '*');
  yes('99.0.0', '');
  yes('3.0.0', 'x');
});

test('hyphen ranges and alternatives', () => {
  yes('1.5.0', '1.2.3 - 2.0.0');
  yes('2.0.0', '1.2.3 - 2.0.0');
  no('2.0.1', '1.2.3 - 2.0.0');
  yes('3.1.0', '^1 || ^3');
  no('2.1.0', '^1 || ^3');
});

test('prerelease tags are ignored on both sides', () => {
  yes('19.0.0-rc.1', '>=18');
  yes('18.3.1', '^18.0.0-0');
});

test('a range it cannot read gives null, never a guess', () => {
  assert.equal(satisfies('1.0.0', 'workspace:*'), null);
  assert.equal(satisfies('1.0.0', 'github:user/repo'), null);
  assert.equal(satisfies('1.0.0', 'latest'), null);
  assert.equal(satisfies('not-a-version', '^1'), null);
  // …but an alternative it can read and that matches still counts.
  assert.equal(satisfies('1.0.0', 'latest || ^1'), true);
});
