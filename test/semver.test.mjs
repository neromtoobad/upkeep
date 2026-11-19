import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseVersion, compareVersions, describeJump, splitSpec } from '../src/plan/semver.mjs';

test('parseVersion reads plain, prefixed and prerelease versions', () => {
  assert.deepEqual(parseVersion('1.2.3'), { major: 1, minor: 2, patch: 3, pre: [] });
  assert.deepEqual(parseVersion('v10.0.1'), { major: 10, minor: 0, patch: 1, pre: [] });
  assert.deepEqual(parseVersion('7.0.0-rc.2+build.9'), { major: 7, minor: 0, patch: 0, pre: ['rc', '2'] });
});

test('parseVersion rejects things that are not exact versions', () => {
  for (const bad of ['', 'latest', '1.2', '^1.2.3', '1.x', 'github:user/repo', null, undefined]) {
    assert.equal(parseVersion(bad), null, String(bad));
  }
});

test('compareVersions orders by major, minor, patch', () => {
  assert.equal(compareVersions('1.2.3', '1.2.3'), 0);
  assert.equal(compareVersions('1.2.3', '1.2.4'), -1);
  assert.equal(compareVersions('1.10.0', '1.9.9'), 1);
  assert.equal(compareVersions('2.0.0', '10.0.0'), -1);
});

test('compareVersions puts a prerelease before its release', () => {
  assert.equal(compareVersions('2.0.0-rc.1', '2.0.0'), -1);
  assert.equal(compareVersions('2.0.0-rc.2', '2.0.0-rc.10'), -1);
  assert.equal(compareVersions('2.0.0-alpha', '2.0.0-beta'), -1);
  assert.equal(compareVersions('2.0.0-rc.1', '2.0.0-rc.1.1'), -1);
});

test('compareVersions throws on input that is not a version', () => {
  assert.throws(() => compareVersions('latest', '1.0.0'), /not a version: latest/);
});

test('describeJump labels the size of the jump', () => {
  assert.deepEqual(describeJump('6.15.8', '7.92.0'), { kind: 'major', breaking: true });
  assert.deepEqual(describeJump('4.0.0', '4.5.1'), { kind: 'minor', breaking: false });
  assert.deepEqual(describeJump('4.5.0', '4.5.1'), { kind: 'patch', breaking: false });
  assert.deepEqual(describeJump('4.5.1', '4.5.1'), { kind: 'none', breaking: false });
});

test('describeJump treats 0.x minors and 0.0.x patches as breaking, like the caret rule', () => {
  assert.deepEqual(describeJump('0.21.4', '0.27.0'), { kind: 'minor', breaking: true });
  assert.deepEqual(describeJump('0.21.4', '0.21.9'), { kind: 'patch', breaking: false });
  assert.deepEqual(describeJump('0.0.3', '0.0.4'), { kind: 'patch', breaking: true });
});

test('splitSpec keeps the range prefix so a bump preserves the style in package.json', () => {
  assert.deepEqual(splitSpec('^1.2.3'), { prefix: '^', version: '1.2.3' });
  assert.deepEqual(splitSpec('~1.2.3'), { prefix: '~', version: '1.2.3' });
  assert.deepEqual(splitSpec('1.2.3'), { prefix: '', version: '1.2.3' });
  assert.deepEqual(splitSpec('>=1.2.3'), { prefix: '>=', version: '1.2.3' });
});

test('splitSpec refuses specs Upkeep must leave alone', () => {
  for (const spec of ['*', 'latest', '1.x', '^1.2', 'workspace:*', 'github:a/b', 'npm:other@1.0.0', '>=1.0.0 <2.0.0', 'file:../x']) {
    assert.equal(splitSpec(spec), null, spec);
  }
});
