// Just enough semver to plan upgrades: parse, compare, and say whether moving
// from one version to another may break callers under the caret rule.

const VERSION = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/;

/** @returns {{major:number, minor:number, patch:number, pre:string[]} | null} */
export function parseVersion(text) {
  const match = VERSION.exec(String(text ?? '').trim());
  if (!match) return null;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    pre: match[4] ? match[4].split('.') : [],
  };
}

function comparePre(a, b) {
  // A version without a prerelease tag is newer than the same version with one.
  if (a.length === 0 && b.length === 0) return 0;
  if (a.length === 0) return 1;
  if (b.length === 0) return -1;
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    if (a[i] === undefined) return -1;
    if (b[i] === undefined) return 1;
    const aNum = /^\d+$/.test(a[i]);
    const bNum = /^\d+$/.test(b[i]);
    if (aNum && bNum) {
      if (Number(a[i]) !== Number(b[i])) return Number(a[i]) < Number(b[i]) ? -1 : 1;
    } else if (aNum !== bNum) {
      return aNum ? -1 : 1;
    } else if (a[i] !== b[i]) {
      return a[i] < b[i] ? -1 : 1;
    }
  }
  return 0;
}

/** -1 when a is older than b, 1 when newer, 0 when equal. Throws on input that is not a version. */
export function compareVersions(a, b) {
  const left = parseVersion(a);
  const right = parseVersion(b);
  if (!left || !right) throw new Error(`not a version: ${!left ? a : b}`);
  for (const part of ['major', 'minor', 'patch']) {
    if (left[part] !== right[part]) return left[part] < right[part] ? -1 : 1;
  }
  return comparePre(left.pre, right.pre);
}

/**
 * How big the jump is. `breaking` follows the caret rule that npm itself uses:
 * a new major may break, and below 1.0.0 a new minor may break too (below
 * 0.1.0, any change may).
 * @returns {{kind: 'major'|'minor'|'patch'|'prerelease'|'none', breaking: boolean}}
 */
export function describeJump(from, to) {
  const a = parseVersion(from);
  const b = parseVersion(to);
  if (!a || !b) throw new Error(`not a version: ${!a ? from : to}`);
  if (compareVersions(from, to) === 0) return { kind: 'none', breaking: false };
  if (a.major !== b.major) return { kind: 'major', breaking: true };
  if (a.minor !== b.minor) return { kind: 'minor', breaking: a.major === 0 };
  if (a.patch !== b.patch) return { kind: 'patch', breaking: a.major === 0 && a.minor === 0 };
  return { kind: 'prerelease', breaking: false };
}

const SIMPLE_RANGE = /^(\^|~|>=|=)?\s*v?(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)$/;

/**
 * Split a package.json spec like "^1.2.3" into its prefix and version. Returns
 * null for specs Upkeep must not rewrite: git URLs, tags, `workspace:`, `*`,
 * `1.x`, unions and so on.
 * @returns {{prefix: string, version: string} | null}
 */
export function splitSpec(spec) {
  const match = SIMPLE_RANGE.exec(String(spec ?? '').trim());
  if (!match) return null;
  return { prefix: match[1] ?? '', version: match[2] };
}
