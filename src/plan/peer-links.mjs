// Finds upgrades that need each other because of peer dependencies, so they
// are moved as one unit instead of failing to install apart.
//
//   react-markdown 10 declares peer react ">=18": with react at 17 it only
//   installs if react moves too.
//   react-hook-form 6 declares peer react "^16.8.0 || ^17": react cannot move
//   to 19 unless react-hook-form moves to a version that accepts it.
//
// Both directions come from data, not from a list of known packages: the peer
// ranges of what is installed now, and of the versions being moved to.

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { satisfies } from './semver-range.mjs';

const exec = promisify(execFile);

/** @typedef {import('./outdated.mjs').Candidate} Candidate */
/** @typedef {Map<string, Record<string, string>>} PeerMap package name → {peer name: range} */

/**
 * @param {Candidate[]} candidates
 * @param {{current: PeerMap, next: PeerMap}} peers
 * @returns {{pairs: [string, string][], reasons: string[]}}
 */
export function peerLinks(candidates, peers) {
  const byName = new Map(candidates.map((c) => [c.name, c]));
  const pairs = [];
  const reasons = [];
  const seen = new Set();
  const link = (a, b, reason) => {
    const key = [a, b].sort().join('\u0000');
    if (seen.has(key)) return;
    seen.add(key);
    pairs.push([a, b]);
    reasons.push(reason);
  };

  for (const candidate of candidates) {
    // The new version of this package needs a newer version of a peer.
    for (const [peerName, range] of Object.entries(peers.next.get(candidate.name) ?? {})) {
      const peer = byName.get(peerName);
      if (!peer) continue;
      if (satisfies(peer.from, range) === false && satisfies(peer.to, range) === true) {
        link(candidate.name, peerName, `${candidate.name} ${candidate.to} needs ${peerName} ${range}; ${peerName} is at ${peer.from}`);
      }
    }
    // The installed version of this package will not accept the new version of a peer.
    for (const [peerName, range] of Object.entries(peers.current.get(candidate.name) ?? {})) {
      const peer = byName.get(peerName);
      if (!peer || satisfies(peer.to, range) !== false) continue;
      const nextRange = peers.next.get(candidate.name)?.[peerName];
      if (nextRange === undefined || satisfies(peer.to, nextRange) !== false) {
        link(candidate.name, peerName, `${candidate.name} ${candidate.from} only accepts ${peerName} ${range}; ${peerName} is moving to ${peer.to}`);
      }
    }
  }
  return { pairs, reasons };
}

/** Peer ranges of the versions installed now, read from node_modules. */
export async function readCurrentPeers(projectDir, names) {
  const map = new Map();
  for (const name of names) {
    try {
      const pkg = JSON.parse(await readFile(join(projectDir, 'node_modules', name, 'package.json'), 'utf8'));
      if (pkg.peerDependencies) map.set(name, pkg.peerDependencies);
    } catch {
      // not installed: nothing known about it
    }
  }
  return map;
}

/** Peer ranges of the versions being moved to, asked from the registry (a few at a time). */
export async function readNextPeers(candidates, { cwd, concurrency = 6 } = {}) {
  const map = new Map();
  const queue = [...candidates];
  const worker = async () => {
    for (let candidate = queue.shift(); candidate; candidate = queue.shift()) {
      try {
        const { stdout } = await exec('npm', ['view', `${candidate.name}@${candidate.to}`, 'peerDependencies', '--json'], { cwd, timeout: 60_000 });
        const parsed = stdout.trim() ? JSON.parse(stdout) : null;
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) map.set(candidate.name, parsed);
      } catch {
        // The registry did not answer for this one. The check will still catch a
        // conflict at install; the plan just cannot predict it.
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, candidates.length) }, worker));
  return map;
}
