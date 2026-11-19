// Runs a set of Kane CLI flows as one suite and returns a verdict.
//
//   kane-cli testrun run <flows…> --agent --headless --parallel <n>
//
// Recorded steps replay; a step that no longer matches the page is healed by
// Kane (rewritten against the live app) before it is called a failure. Flows
// Kane could not run at all are retried once on their own, because a runner
// crash must not be mistaken for a broken app.

import { spawn } from 'node:child_process';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readSuiteStream, judgeSuite } from './read-suite-stream.mjs';
import { stopGroup, tailBuffer, track } from '../check/run-command.mjs';

const exec = promisify(execFile);

export const kaneBin = () => process.env.UPKEEP_KANE_BIN || 'kane-cli';
const kaneEnv = () => ({ ...process.env, KANE_CLI_USER_AGENT: 'upkeep' });

/** Credits left on the signed-in account, or null when Kane CLI will not say. */
export async function readCredits() {
  try {
    const { stdout } = await exec(kaneBin(), ['balance'], { env: kaneEnv(), timeout: 30_000 });
    const match = /Available credits:\s*([\d.]+)/.exec(stdout);
    return match ? Number(match[1]) : null;
  } catch {
    return null;
  }
}

/** @returns {Promise<{signedIn: boolean, detail: string}>} */
export async function kaneStatus() {
  try {
    const { stdout } = await exec(kaneBin(), ['whoami'], { env: kaneEnv(), timeout: 30_000 });
    return { signedIn: /Authenticated/.test(stdout) && !/Not logged in/.test(stdout), detail: stdout };
  } catch (error) {
    if (error.code === 'ENOENT') return { signedIn: false, detail: 'kane-cli is not installed. Run: npm install -g @testmuai/kane-cli' };
    return { signedIn: false, detail: (error.stdout || error.stderr || error.message).toString() };
  }
}

function launch(flows, { cwd, parallel, heal, timeoutMs }) {
  return new Promise((resolve) => {
    const args = ['testrun', 'run', ...flows, '--agent', '--headless', '--parallel', String(Math.max(1, Math.min(parallel, flows.length)))];
    if (!heal) args.push('--no-adaptive-heal');

    let stdout = '';
    const stderr = tailBuffer();
    // stdin is closed: with a terminal attached Kane CLI opens its interactive view and never exits.
    const child = track(spawn(kaneBin(), args, { cwd, env: kaneEnv(), stdio: ['ignore', 'pipe', 'pipe'], detached: process.platform !== 'win32' }));
    child.stdout.on('data', (chunk) => (stdout += chunk));
    child.stderr.on('data', (chunk) => stderr.push(chunk.toString()));

    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      stopGroup(child);
    }, timeoutMs);

    child.on('error', (error) => {
      clearTimeout(timer);
      resolve({ exitCode: null, stdout, stderr: error.code === 'ENOENT' ? 'kane-cli is not installed. Run: npm install -g @testmuai/kane-cli' : error.message, timedOut });
    });
    child.on('close', (exitCode) => {
      clearTimeout(timer);
      resolve({ exitCode, stdout, stderr: stderr.read(), timedOut });
    });
  });
}

/**
 * @param {object} input
 * @param {string} input.cwd      project folder; flows and their recordings are relative to it
 * @param {string[]} input.flows  paths of *_test.md files
 * @param {number} [input.parallel]
 * @param {boolean} [input.heal]  let Kane heal a replay that no longer matches (default true)
 * @param {number} [input.timeoutMs]
 * @returns {Promise<import('./read-suite-stream.mjs').SuiteVerdict & {flows: object[], packs: string[], seconds: number}>}
 */
export async function runKaneSuite({ cwd, flows, parallel = 3, heal = true, timeoutMs = 30 * 60_000 }) {
  const started = Date.now();
  const packs = [];

  const once = async (selection) => {
    const run = await launch(selection, { cwd, parallel, heal, timeoutMs });
    const suite = readSuiteStream(run.stdout);
    if (suite.pack) packs.push(suite.pack);
    const verdict = run.timedOut
      ? { outcome: 'error', failing: [], unjudged: selection, summary: `Kane CLI did not finish within ${Math.round(timeoutMs / 60_000)} minutes` }
      : judgeSuite(suite, { exitCode: run.exitCode, stderr: run.stderr });
    return { suite, verdict };
  };

  let { suite, verdict } = await once(flows);
  let results = suite.flows;

  // Retry only what Kane could not run. Flows that passed or failed keep their result.
  if (verdict.outcome === 'error' && verdict.unjudged.length > 0 && verdict.unjudged.length <= flows.length) {
    const again = flows.filter((path) => verdict.unjudged.some((flow) => path.endsWith(flow)));
    if (again.length > 0) {
      const retry = await once(again);
      const retried = new Map(retry.suite.flows.map((flow) => [flow.flow, flow]));
      results = results.map((flow) => retried.get(flow.flow) ?? flow);
      verdict = judgeSuite({ ...suite, flows: results, errors: retry.suite.errors, policy: retry.suite.policy }, {
        exitCode: results.every((flow) => flow.status === 'passed') ? 0 : 1,
      });
    }
  }

  return { ...verdict, flows: results, packs, seconds: Math.round((Date.now() - started) / 1000) };
}
