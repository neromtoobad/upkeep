// Asks Kane CLI's own policy engine two questions about a sealed evidence
// pack, offline, after a check:
//
//   1. Does every flow verify something? A flow with no check passes whatever
//      the app does, so it cannot catch a broken upgrade. Upkeep refuses to
//      start from such flows.
//   2. Did Kane have to heal a step? Then the page changed and the flow still
//      passed. Worth telling the reviewer; not a failure.
//
//   kane-cli evidence verdict <pack> --policy upkeep.policy.yaml --json
//
// The metrics are Kane's (metrics.tests_without_checks, metrics.heal.healed_tests),
// so Upkeep does not re-derive them from logs. Note that tests_without_checks
// describes the run, not the test: a flow that fails before reaching its first
// check is counted too. Upkeep therefore reads it only on the baseline, which
// has passed. This step is advisory: if the
// verdict cannot be made, the check's own result stands.

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { kaneBin } from './run-suite.mjs';

const exec = promisify(execFile);

export const POLICY = `policy: upkeep
requires:
  catalog: kane-cli
  version: ">=1"
gates:
  - { id: every-flow-checks-something, metric: metrics.tests_without_checks, equals: 0, severity: blocking, message: A flow that verifies nothing cannot catch a broken upgrade }
  - { id: no-heal, metric: metrics.heal.healed_tests, max: 0, severity: warning, message: Kane healed a step. The page changed and the flow still passed }
`;

export async function writePolicy(dir) {
  const path = join(dir, 'upkeep.policy.yaml');
  await writeFile(path, POLICY);
  return path;
}

/** Turn `evidence verdict --json` output into the two numbers Upkeep uses. */
export function readVerdict(json) {
  let parsed;
  try {
    parsed = JSON.parse(json);
  } catch {
    return null;
  }
  const gates = (parsed.verdicts ?? []).flatMap((verdict) => verdict.gates ?? []);
  const actual = (id) => {
    const gate = gates.find((g) => g.id === id);
    return gate && typeof gate.actual === 'number' && gate.status !== 'errored' ? gate.actual : null;
  };
  const withoutChecks = actual('every-flow-checks-something');
  const healed = actual('no-heal');
  if (withoutChecks === null && healed === null) return null;
  return { withoutChecks, healed };
}

/**
 * @param {string} packPath a sealed .evidence file
 * @param {string} policyPath from writePolicy()
 * @returns {Promise<{withoutChecks: number|null, healed: number|null} | null>} null when Kane could not judge the pack
 */
export async function judgePack(packPath, policyPath) {
  const args = ['evidence', 'verdict', packPath, '--policy', policyPath, '--json'];
  const options = { env: { ...process.env, KANE_CLI_USER_AGENT: 'upkeep' }, timeout: 60_000, maxBuffer: 16 * 1024 * 1024 };
  try {
    const { stdout } = await exec(kaneBin(), args, options);
    return readVerdict(stdout);
  } catch (error) {
    // Exit 1 is a failing verdict, and still carries the JSON we want.
    return typeof error.stdout === 'string' && error.stdout.trim() ? readVerdict(error.stdout) : null;
  }
}
