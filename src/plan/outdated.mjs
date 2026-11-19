// Turns `npm outdated --json` plus the project's package.json into the list of
// upgrades Upkeep will attempt. Pure functions here; the npm call lives in
// readOutdated() at the bottom.

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { compareVersions, describeJump, parseVersion, splitSpec } from './semver.mjs';

const run = promisify(execFile);

// peerDependencies are a promise to the host app, not something we install, so
// they are never bumped.
const SECTIONS = ['dependencies', 'devDependencies', 'optionalDependencies'];

/**
 * @typedef {object} Candidate
 * @property {string} name
 * @property {string} from     version installed now
 * @property {string} to       version Upkeep will try
 * @property {string} section  dependencies | devDependencies | optionalDependencies
 * @property {string} spec     the spec in package.json today, e.g. "^6.15.8"
 * @property {string} nextSpec the spec after the bump, same prefix style
 * @property {'major'|'minor'|'patch'|'prerelease'} kind
 * @property {boolean} breaking may break callers under the caret rule
 * @property {string} [homepage]
 */

/**
 * @typedef {object} Skipped
 * @property {string} name
 * @property {string} reason plain words, shown in the plan and the report
 */

/**
 * @param {Record<string, any>} outdated parsed `npm outdated --json`
 * @param {Record<string, any>} pkg parsed package.json
 * @param {{target?: 'latest'|'wanted', only?: string[], exclude?: string[]}} [options]
 * @returns {{candidates: Candidate[], skipped: Skipped[]}}
 */
export function planFromOutdated(outdated, pkg, options = {}) {
  const target = options.target ?? 'latest';
  if (target !== 'latest' && target !== 'wanted') {
    throw new Error(`unknown target "${target}": use "latest" or "wanted"`);
  }
  const only = options.only?.length ? new Set(options.only) : null;
  const exclude = new Set(options.exclude ?? []);

  const candidates = [];
  const skipped = [];

  for (const name of Object.keys(outdated ?? {}).sort()) {
    if (only && !only.has(name)) continue;
    if (exclude.has(name)) {
      skipped.push({ name, reason: 'excluded by you' });
      continue;
    }

    // In a workspace npm reports one row per place the package is used; the
    // row whose section is in the root package.json is the one we can edit.
    const rows = Array.isArray(outdated[name]) ? outdated[name] : [outdated[name]];
    const section = SECTIONS.find((key) => pkg?.[key]?.[name] !== undefined);
    if (!section) {
      skipped.push({ name, reason: 'not a direct dependency in package.json' });
      continue;
    }
    const row = rows.find((entry) => entry?.type === section) ?? rows[0];

    const spec = pkg[section][name];
    const split = splitSpec(spec);
    if (!split) {
      skipped.push({ name, reason: `spec "${spec}" is not a plain version range` });
      continue;
    }

    const to = row?.[target];
    if (!parseVersion(to)) {
      skipped.push({ name, reason: `npm reported no usable ${target} version` });
      continue;
    }

    // `current` is missing when node_modules was never installed; the version
    // in package.json is then the best statement of where we are.
    const from = parseVersion(row?.current) ? row.current : split.version;
    if (compareVersions(to, from) <= 0) continue;

    const jump = describeJump(from, to);
    candidates.push({
      name,
      from,
      to,
      section,
      spec,
      nextSpec: `${split.prefix}${to}`,
      kind: jump.kind,
      breaking: jump.breaking,
      ...(row?.homepage ? { homepage: row.homepage } : {}),
    });
  }

  return { candidates, skipped };
}

/**
 * Runs `npm outdated --json` in a project. npm exits 1 when anything is
 * outdated, which is the normal case here, so only unparseable output is an
 * error.
 * @param {string} cwd
 * @returns {Promise<Record<string, any>>}
 */
export async function readOutdated(cwd) {
  let stdout;
  try {
    ({ stdout } = await run('npm', ['outdated', '--json', '--long'], { cwd, maxBuffer: 32 * 1024 * 1024 }));
  } catch (error) {
    if (typeof error.stdout !== 'string' || error.stdout.trim() === '') {
      throw new Error(`npm outdated failed: ${error.stderr?.trim() || error.message}`);
    }
    stdout = error.stdout;
  }
  const text = stdout.trim();
  if (text === '') return {};
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(`npm outdated printed something that is not JSON: ${text.slice(0, 200)}`);
  }
  if (parsed?.error) {
    throw new Error(`npm outdated failed: ${parsed.error.summary ?? parsed.error.code ?? 'unknown error'}`);
  }
  return parsed;
}
