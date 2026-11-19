// Does a version satisfy a range like the ones packages put in
// peerDependencies: "^16.8.0 || ^17 || ^18", ">=18", "18.x", "~4.2.0",
// ">=4.0.0 <6", "1.2.3 - 2.0.0", "*"? Enough of npm's range grammar to decide
// which upgrades need each other. Prerelease tags are ignored on both sides.

import { parseVersion } from './semver.mjs';

/** "18", "18.2", "18.x", "18.2.1" → [major, minor, patch] with null for a missing or wildcard part. */
function parts(text) {
  const cleaned = text.trim().replace(/^v/, '').split(/[-+]/)[0];
  if (cleaned === '' || cleaned === '*' || /^x$/i.test(cleaned)) return [null, null, null];
  const pieces = cleaned.split('.');
  if (pieces.length > 3) return null;
  const out = [null, null, null];
  for (let i = 0; i < pieces.length; i += 1) {
    if (/^(x|\*)$/i.test(pieces[i])) break;
    if (!/^\d+$/.test(pieces[i])) return null;
    out[i] = Number(pieces[i]);
  }
  return out;
}

const cmp = (a, b) => {
  for (let i = 0; i < 3; i += 1) if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1;
  return 0;
};
const floor = (p) => p.map((n) => n ?? 0);
/** The first version above everything a partial version covers: 18 → 19.0.0, 18.2 → 18.3.0. */
const ceiling = (p) => {
  if (p[0] === null) return null; // "*" has no upper bound
  if (p[1] === null) return [p[0] + 1, 0, 0];
  if (p[2] === null) return [p[0], p[1] + 1, 0];
  return null; // a full version covers only itself
};

/** One comparator → {min (inclusive), max (exclusive)}, either may be null. */
function bounds(comparator) {
  const match = /^(\^|~|>=|<=|>|<|=)?\s*(.*)$/.exec(comparator.trim());
  const op = match[1] ?? '';
  const p = parts(match[2]);
  if (!p) return undefined;
  const lo = floor(p);
  const full = p[2] !== null;

  switch (op) {
    case '^': {
      if (p[0] === null) return { min: null, max: null };
      let max;
      if (p[0] > 0 || p[1] === null) max = [p[0] + 1, 0, 0];
      else if (p[1] > 0 || p[2] === null) max = [0, p[1] + 1, 0];
      else max = [0, 0, p[2] + 1];
      return { min: lo, max };
    }
    case '~':
      if (p[0] === null) return { min: null, max: null };
      return { min: lo, max: p[1] === null ? [p[0] + 1, 0, 0] : [p[0], p[1] + 1, 0] };
    case '>=':
      return { min: lo, max: null };
    case '>':
      return { min: full ? [lo[0], lo[1], lo[2] + 1] : (ceiling(p) ?? lo), max: null };
    case '<':
      return { min: null, max: lo };
    case '<=':
      return { min: null, max: full ? [lo[0], lo[1], lo[2] + 1] : ceiling(p) };
    default:
      // "18", "18.x", "*" or an exact version
      return { min: p[0] === null ? null : lo, max: full ? [lo[0], lo[1], lo[2] + 1] : ceiling(p) };
  }
}

/**
 * @param {string} version an exact version
 * @param {string} range
 * @returns {boolean|null} null when the range is one this does not understand
 *   (a URL, a tag, `workspace:`): the caller should then assume nothing.
 */
export function satisfies(version, range) {
  const v = parseVersion(version);
  if (!v) return null;
  const point = [v.major, v.minor, v.patch];
  let understood = true;

  const anyOf = String(range ?? '').split('||').map((alternative) => {
    const text = alternative.trim();
    const hyphen = /^(\S+)\s+-\s+(\S+)$/.exec(text);
    const comparators = hyphen ? [`>=${hyphen[1]}`, `<=${hyphen[2]}`] : text === '' ? ['*'] : text.replace(/(>=|<=|>|<|=|\^|~)\s+/g, '$1').split(/\s+/);
    return comparators.every((comparator) => {
      const limit = bounds(comparator);
      if (limit === undefined) {
        understood = false;
        return false;
      }
      return (limit.min === null || cmp(point, limit.min) >= 0) && (limit.max === null || cmp(point, limit.max) < 0);
    });
  });

  if (anyOf.some(Boolean)) return true;
  return understood ? false : null;
}
