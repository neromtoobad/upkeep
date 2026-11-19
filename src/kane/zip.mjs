// A Kane evidence pack is a plain zip. This reads one with nothing but Node,
// so Upkeep has no dependencies and does not shell out to `unzip`.
// Covers what packs use: stored and deflated entries, no zip64, no encryption.

import { inflateRawSync } from 'node:zlib';

const END_OF_CENTRAL_DIRECTORY = 0x06054b50;
const CENTRAL_ENTRY = 0x02014b50;
const LOCAL_ENTRY = 0x04034b50;

/**
 * @param {Buffer} buffer the whole zip file
 * @returns {{name: string, method: number, compressedSize: number, size: number, offset: number}[]}
 */
export function listZip(buffer) {
  // The end record sits at the tail, after an optional comment of up to 64 KB.
  let end = -1;
  for (let i = buffer.length - 22; i >= Math.max(0, buffer.length - 22 - 0xffff); i -= 1) {
    if (buffer.readUInt32LE(i) === END_OF_CENTRAL_DIRECTORY) {
      end = i;
      break;
    }
  }
  if (end === -1) throw new Error('not a zip file: no end record (the pack may be truncated)');

  const count = buffer.readUInt16LE(end + 10);
  let position = buffer.readUInt32LE(end + 16);
  if (count === 0xffff || position === 0xffffffff) throw new Error('zip64 archives are not supported');

  const entries = [];
  for (let i = 0; i < count; i += 1) {
    if (buffer.readUInt32LE(position) !== CENTRAL_ENTRY) throw new Error('corrupt zip: bad central directory entry');
    const nameLength = buffer.readUInt16LE(position + 28);
    const extraLength = buffer.readUInt16LE(position + 30);
    const commentLength = buffer.readUInt16LE(position + 32);
    entries.push({
      name: buffer.toString('utf8', position + 46, position + 46 + nameLength),
      method: buffer.readUInt16LE(position + 10),
      compressedSize: buffer.readUInt32LE(position + 20),
      size: buffer.readUInt32LE(position + 24),
      offset: buffer.readUInt32LE(position + 42),
    });
    position += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

/** @returns {Buffer} the entry's bytes */
export function readZipEntry(buffer, entry) {
  if (buffer.readUInt32LE(entry.offset) !== LOCAL_ENTRY) throw new Error(`corrupt zip: bad local header for ${entry.name}`);
  const nameLength = buffer.readUInt16LE(entry.offset + 26);
  const extraLength = buffer.readUInt16LE(entry.offset + 28);
  const start = entry.offset + 30 + nameLength + extraLength;
  const data = buffer.subarray(start, start + entry.compressedSize);
  if (entry.method === 0) return Buffer.from(data);
  if (entry.method === 8) return inflateRawSync(data);
  throw new Error(`unsupported zip compression method ${entry.method} for ${entry.name}`);
}
