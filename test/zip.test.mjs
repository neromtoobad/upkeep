import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { listZip, readZipEntry } from '../src/kane/zip.mjs';
import { makeZip } from './stubs/make-zip.mjs';

test('lists entries and reads deflated and stored ones', () => {
  const zip = makeZip({
    'run.yaml': { text: 'status: finalized\n' },
    'tests/checkout-ae9bd187/result.yaml': { text: 'status: failed\n'.repeat(50) },
    'tests/checkout-ae9bd187/steps/1-0-1/screenshot.jpg': { text: 'not really a jpeg', stored: true },
  });
  const entries = listZip(zip);
  assert.deepEqual(entries.map((e) => e.name), ['run.yaml', 'tests/checkout-ae9bd187/result.yaml', 'tests/checkout-ae9bd187/steps/1-0-1/screenshot.jpg']);
  assert.equal(readZipEntry(zip, entries[0]).toString(), 'status: finalized\n');
  assert.equal(readZipEntry(zip, entries[1]).toString(), 'status: failed\n'.repeat(50));
  assert.equal(readZipEntry(zip, entries[2]).toString(), 'not really a jpeg');
});

test('finds the end record behind a trailing comment', () => {
  const zip = makeZip({ 'a.txt': { text: 'hello' } }, { comment: 'sealed by kane-cli' });
  assert.deepEqual(listZip(zip).map((e) => e.name), ['a.txt']);
});

test('reads an archive written by the system zip tool', { skip: process.platform === 'win32' }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'upkeep-zip-'));
  try {
    mkdirSync(join(dir, 'tests/browse'), { recursive: true });
    writeFileSync(join(dir, 'tests/browse/result.yaml'), 'status: passed\nsteps:\n  - id: 0-1\n');
    writeFileSync(join(dir, 'run.yaml'), 'evidence: "0.1"\n');
    execFileSync('zip', ['-q', '-r', 'pack.evidence', 'run.yaml', 'tests'], { cwd: dir });
    const zip = readFileSync(join(dir, 'pack.evidence'));
    const entries = listZip(zip);
    const result = entries.find((e) => e.name === 'tests/browse/result.yaml');
    assert.ok(result);
    assert.equal(readZipEntry(zip, result).toString(), 'status: passed\nsteps:\n  - id: 0-1\n');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a truncated pack is reported as such', () => {
  const zip = makeZip({ 'a.txt': { text: 'hello' } });
  assert.throws(() => listZip(zip.subarray(0, zip.length - 30)), /not a zip file: no end record \(the pack may be truncated\)/);
  assert.throws(() => listZip(Buffer.from('plain text')), /not a zip file/);
});
