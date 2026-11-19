import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deflateRawSync } from 'node:zlib';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { listZip, readZipEntry } from '../src/kane/zip.mjs';

/** A minimal zip writer, only for building test archives. */
export function makeZip(files, { comment = '' } = {}) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const [name, { text, stored = false }] of Object.entries(files)) {
    const raw = Buffer.from(text);
    const data = stored ? raw : deflateRawSync(raw);
    const nameBytes = Buffer.from(name);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(stored ? 0 : 8, 8);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    locals.push(local, nameBytes, data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(stored ? 0 : 8, 10);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(raw.length, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, nameBytes);
    offset += 30 + nameBytes.length + data.length;
  }
  const directory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(files).length, 8);
  end.writeUInt16LE(Object.keys(files).length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(Buffer.byteLength(comment), 20);
  return Buffer.concat([...locals, directory, end, Buffer.from(comment)]);
}

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
