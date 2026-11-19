// What one check of the app concluded, and how to compare two of them.

/**
 * @typedef {object} Verdict
 * @property {'pass'|'fail'|'error'} outcome
 *   'error' means the check itself could not run (Kane CLI not signed in, a
 *   runner crash, the registry unreachable, the port taken). It says nothing
 *   about the upgrade and stops the run.
 * @property {'install'|'build'|'boot'|'kane'} [stage] where it failed
 * @property {string[]} [failing] flows that failed, when the stage is kane
 * @property {string} [summary]   one plain sentence
 * @property {string} [detail]    the end of the tool's own output
 * @property {object[]} [flows]   per-flow results from Kane CLI
 * @property {string[]} [packs]   Kane evidence packs written by this check
 * @property {number} [seconds]
 * @property {number} [credits]   Kane credits this check used
 * @property {boolean} [partial]  the check was stopped after an early stage on purpose;
 *   it answers "does it get past that stage" and nothing more
 */

/**
 * Does `verdict` show the failure in `target` again, or part of it?
 *
 * Isolating a culprit means asking of each smaller set: does it still fail
 * THE SAME WAY? A smaller set that fails at an earlier stage (an install
 * conflict the full set did not have) is a different problem and must not be
 * blamed for this one. In the browser, failing a subset of the flows that
 * failed before counts: with two guilty packages breaking two different flows,
 * each one alone reproduces its own part.
 *
 * @param {Verdict} target the failure being isolated
 * @param {Verdict} verdict
 */
export function reproduces(target, verdict) {
  if (verdict.outcome !== 'fail' || target.outcome !== 'fail') return false;
  if (verdict.stage !== target.stage) return false;
  if (target.stage !== 'kane') return true;
  const expected = new Set(target.failing ?? []);
  const seen = verdict.failing ?? [];
  return seen.length > 0 && seen.every((flow) => expected.has(flow));
}
