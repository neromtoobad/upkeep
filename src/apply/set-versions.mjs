// Rewrites package.json so that exactly one set of upgrade units is applied on
// top of the base file. Every check starts from the base text, so what was
// tried in the previous check never leaks into the next one.

import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

/** @typedef {import('../plan/group-lockstep.mjs').Unit} Unit */

/**
 * @param {Record<string, any>} pkg parsed base package.json
 * @param {Unit[]} units
 * @returns {Record<string, any>} a copy with the units' versions set
 */
export function withVersions(pkg, units) {
  const next = structuredClone(pkg);
  for (const unit of units) {
    for (const candidate of unit.packages) {
      const section = next[candidate.section];
      if (!section || section[candidate.name] === undefined) {
        throw new Error(`${candidate.name} is not in ${candidate.section} of package.json any more`);
      }
      section[candidate.name] = candidate.nextSpec;
    }
  }
  return next;
}

/** Re-serialise the way the file was written: same indent, same final newline. */
export function formatLike(originalText, value) {
  const indent = /\n([ \t]+)"/.exec(originalText)?.[1] ?? '  ';
  const text = JSON.stringify(value, null, indent);
  return originalText.endsWith('\n') ? `${text}\n` : text;
}

/**
 * @param {string} projectDir
 * @param {string} baseText package.json as it is at the last landed commit
 * @param {Unit[]} units
 */
export async function writeVersions(projectDir, baseText, units) {
  const next = withVersions(JSON.parse(baseText), units);
  await writeFile(join(projectDir, 'package.json'), formatLike(baseText, next));
}

/**
 * The dependency specs a patch must not touch, as "section name spec" lines.
 * Used to notice an agent that "fixes" an upgrade by changing versions.
 */
export function declaredSpecs(pkg) {
  const lines = [];
  for (const section of ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies', 'overrides', 'resolutions']) {
    const entries = pkg?.[section];
    if (!entries || typeof entries !== 'object') continue;
    for (const name of Object.keys(entries).sort()) {
      lines.push(`${section} ${name} ${JSON.stringify(entries[name])}`);
    }
  }
  return lines;
}

export async function readPackageText(projectDir) {
  return readFile(join(projectDir, 'package.json'), 'utf8');
}
