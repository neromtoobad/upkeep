// Reads the NDJSON that `kane-cli testrun run --agent` prints and decides what
// it means for an upgrade.
//
// The important distinction is between a flow that FAILED (the app did not do
// what the flow says) and a flow that is BROKEN or never finished (Kane CLI
// itself could not run it: runner crash, no browser, sign-in). Kane exits 1
// for both. Only the first one says anything about the upgrade.

import { basename } from 'node:path';

/**
 * @typedef {object} FlowResult
 * @property {string} flow     file name, e.g. "checkout_test.md"
 * @property {string} path     path as Kane reported it
 * @property {'passed'|'failed'|'broken'|'interrupted'|'missing'} status
 * @property {boolean} authored true when Kane wrote the steps in this run (no recording yet)
 * @property {number} [seconds]
 * @property {string} [message] Kane's own sentence about why it did not pass
 * @property {number} [stepIndex]
 * @property {string} [logPath] this flow's own event log
 * @property {string} [testId]
 */

/**
 * @param {string} stdout everything kane-cli printed on stdout
 * @returns {{started: boolean, cliVersion?: string, planValid: boolean|null,
 *   planFailures: {path: string, failure: string}[], flows: FlowResult[],
 *   overall?: string, pack?: string, errors: {code?: string, message: string}[],
 *   policy?: {result: string, failed: string[]}}}
 */
export function readSuiteStream(stdout) {
  const result = { started: false, planValid: null, planFailures: [], flows: [], errors: [] };
  const byFlow = new Map();

  for (const line of stdout.split('\n')) {
    if (!line.trim().startsWith('{')) continue; // the contract allows non-JSON lines
    let event;
    try {
      event = JSON.parse(line);
    } catch {
      continue;
    }

    switch (event.type) {
      case 'stream_start':
        result.started = true;
        result.cliVersion = event.cli_version;
        break;

      case 'testrun_plan':
        result.planValid = event.valid === true;
        for (const member of event.members ?? []) {
          const flow = basename(member.path);
          byFlow.set(flow, { flow, path: member.path, status: 'missing', authored: false });
          if (member.failure) {
            result.planFailures.push({
              path: member.path,
              failure: typeof member.failure === 'string' ? member.failure : (member.failure.message ?? JSON.stringify(member.failure)),
            });
          }
        }
        break;

      case 'testrun_member_end':
      case 'testrun_authored_member_end': {
        // Kane reports absolute paths in the plan and relative ones here, so
        // flows are matched by file name.
        const flow = basename(event.path ?? '');
        const entry = byFlow.get(flow) ?? { flow, path: event.path, authored: false };
        entry.status = event.status;
        entry.authored = entry.authored || event.type === 'testrun_authored_member_end';
        entry.seconds = event.duration_s;
        if (event.failure?.message) entry.message = event.failure.message;
        if (event.failure?.step_index !== undefined) entry.stepIndex = event.failure.step_index;
        if (event.log_path) entry.logPath = event.log_path;
        if (event.test_id) entry.testId = event.test_id;
        byFlow.set(flow, entry);
        break;
      }

      case 'coverage':
        if (event.pack) result.pack = event.pack;
        break;

      case 'verdict':
        result.policy = {
          result: event.result,
          failed: (event.policies ?? []).flatMap((policy) => policy.failed_gate_ids ?? []),
        };
        break;

      case 'error':
        result.errors.push({ ...(event.code ? { code: event.code } : {}), message: event.message ?? 'unknown error' });
        break;

      case 'testrun_done':
        result.overall = event.overall_status;
        break;

      default:
        break; // new event types can appear in any release
    }
  }

  result.flows = [...byFlow.values()];
  return result;
}

/**
 * @typedef {object} SuiteVerdict
 * @property {'pass'|'fail'|'error'} outcome
 * @property {string[]} failing   flows the app failed
 * @property {string[]} unjudged  flows Kane could not run to a result
 * @property {string} summary     one plain sentence
 */

/**
 * @param {ReturnType<typeof readSuiteStream>} suite
 * @param {{exitCode: number|null, stderr?: string}} process
 * @returns {SuiteVerdict}
 */
export function judgeSuite(suite, { exitCode, stderr = '' }) {
  const lastLine = (text) => text.trim().split('\n').filter(Boolean).pop() ?? '';

  if (!suite.started) {
    return unavailable(`Kane CLI did not start a run (exit ${exitCode}). ${lastLine(stderr)}`.trim());
  }
  if (suite.planValid === false) {
    const why = suite.planFailures.map((f) => `${basename(f.path)}: ${f.failure}`).join('; ');
    return unavailable(`Kane CLI refused the flows before running them. ${why}`.trim());
  }
  if (suite.flows.length === 0) {
    const why = suite.errors.map((e) => e.message).join('; ') || lastLine(stderr);
    return unavailable(`Kane CLI ran no flows (exit ${exitCode}). ${why}`.trim());
  }

  const failing = suite.flows.filter((f) => f.status === 'failed').map((f) => f.flow);
  const unjudged = suite.flows.filter((f) => f.status !== 'failed' && f.status !== 'passed');

  // A flow Kane could not run leaves the question open, whatever the others did.
  if (unjudged.length > 0) {
    const first = unjudged[0];
    return {
      outcome: 'error',
      failing,
      unjudged: unjudged.map((f) => f.flow),
      summary: `Kane CLI could not run ${unjudged.map((f) => f.flow).join(', ')}: ${first.message ?? first.status}`,
    };
  }

  if (failing.length > 0) {
    const first = suite.flows.find((f) => f.status === 'failed');
    return {
      outcome: 'fail',
      failing,
      unjudged: [],
      summary: `${failing.length} of ${suite.flows.length} flows failed: ${first.flow}${first.message ? `: ${first.message}` : ''}`,
    };
  }

  if (exitCode !== 0) {
    // Every flow passed but the process disagrees: a policy verdict, or an error after the run.
    if (suite.policy && suite.policy.result !== 'pass') {
      return { outcome: 'fail', failing: [], unjudged: [], summary: `all flows passed but the policy did not: ${suite.policy.failed.join(', ')}` };
    }
    return unavailable(`every flow passed but Kane CLI exited ${exitCode}. ${suite.errors.map((e) => e.message).join('; ') || lastLine(stderr)}`.trim());
  }

  return { outcome: 'pass', failing: [], unjudged: [], summary: `${suite.flows.length} of ${suite.flows.length} flows passed` };
}

const unavailable = (summary) => ({ outcome: 'error', failing: [], unjudged: [], summary });
