// Command line entry. Each command is small; the work lives in the modules.

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { makePlan, renderPlan } from './plan/make-plan.mjs';
import { upgradeRun, RunStopped } from './run/upgrade-run.mjs';
import { CheckUnavailable } from './loop/land-upgrades.mjs';
import { makeFixer } from './agent/fix-loop.mjs';
import { resolveAgent } from './agent/ask-agent.mjs';
import { handoffDir, openHandoff, makeHandoffAsk, noteProgress, writeState, waitForTurn, continueRun } from './agent/handoff.mjs';
import { readFailure } from './kane/read-evidence.mjs';
import { exportRun, renderRunHtml } from './report/export-run.mjs';
import { renderReport } from './report/write-report.mjs';
import { join } from 'node:path';

const HELP = `Upkeep updates your outdated packages and proves in a real browser that the app still works.

Usage
  upkeep plan [options]     Show which packages are behind and how they will be moved
  upkeep run [options]      Upgrade them on a new branch, keeping only what Kane CLI verifies
  upkeep wait               With --agent handoff: block until the run has a task for you, or is over
  upkeep continue           With --agent handoff: you have edited the app; have Kane walk it again
  upkeep mcp                Serve Upkeep as tools over the Model Context Protocol (stdio)
  upkeep report <run>       Print the report of a finished run again, from its ledger (--html for the page)
  upkeep export <run> --out <dir>
                            Copy a run (under .upkeep/runs/) without account details, to publish it

Options for plan and run
  --cwd <dir>               Project folder (default: current folder)
  --target latest|wanted    latest: newest release (default). wanted: stay inside the ranges in package.json
  --only <a,b>              Only these packages
  --exclude <a,b>           Never these packages

Options for plan
  --json                    Print the plan as JSON

Options for wait and continue
  --cwd <dir>               Project folder (default: current folder)
  --timeout <seconds>       wait: give up waiting after this long (default 540)
  --message <text>          continue: what you changed, for the report

Options for run
  --agent <name|command>    Coding agent that fixes an upgrade Kane says broke the app:
                            claude, codex, or your own command (the task arrives on stdin,
                            or in a file if the command contains {prompt_file}).
                            handoff: the agent you are already talking to does the fixing;
                            the run pauses, see "upkeep wait" and "upkeep continue".
                            Without it, breaking upgrades are isolated and held back.
  --rounds <n>              Most rounds between Kane and the agent per upgrade (default 3)
  --max-checks <n>          Most checks to spend isolating one failure (default 24)
  --budget <credits>        Stop starting new checks once this many Kane credits are spent
  --pr                      Push the branch and open a pull request with the report as its body
  --keep-worktree           Leave the working copy in place when the run ends

  -h, --help                Show this help
  -v, --version             Show the version
`;

/** Thrown for mistakes in how the command was typed. */
export class UsageError extends Error {}

const VALUE_FLAGS = new Set(['--cwd', '--target', '--only', '--exclude', '--max-checks', '--agent', '--rounds', '--budget', '--out', '--timeout', '--message']);
const BOOLEAN_FLAGS = new Set(['--json', '--help', '--version', '--keep-worktree', '--pr', '--html']);
const SHORT = { '-h': '--help', '-v': '--version' };

/** @param {string[]} argv arguments after the program name */
export function parseArgs(argv) {
  const flags = {};
  const positional = [];
  for (let i = 0; i < argv.length; i += 1) {
    let arg = SHORT[argv[i]] ?? argv[i];
    let value;
    if (arg.startsWith('--') && arg.includes('=')) {
      value = arg.slice(arg.indexOf('=') + 1);
      arg = arg.slice(0, arg.indexOf('='));
    }
    if (VALUE_FLAGS.has(arg)) {
      if (value === undefined) {
        i += 1;
        value = argv[i];
      }
      if (value === undefined || value.startsWith('--')) throw new UsageError(`${arg} needs a value`);
      flags[arg.slice(2)] = value;
    } else if (BOOLEAN_FLAGS.has(arg)) {
      if (value !== undefined) throw new UsageError(`${arg} takes no value`);
      flags[arg.slice(2)] = true;
    } else if (arg.startsWith('-')) {
      throw new UsageError(`unknown option ${arg}`);
    } else {
      positional.push(arg);
    }
  }
  return { command: positional[0], rest: positional.slice(1), flags };
}

const list = (text) =>
  text
    ? text
        .split(',')
        .map((name) => name.trim())
        .filter(Boolean)
    : undefined;

/**
 * @param {string[]} argv
 * @param {{out?: (text: string) => void}} [io]
 * @returns {Promise<number>} exit code
 */
export async function main(argv, io = {}) {
  const out = io.out ?? ((text) => process.stdout.write(text));
  const { command, rest, flags } = parseArgs(argv);

  if (flags.version) {
    const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
    out(`${pkg.version}\n`);
    return 0;
  }
  if (flags.help || command === undefined || command === 'help') {
    out(HELP);
    return 0;
  }
  if (command === 'mcp') {
    const { serve } = await import('./mcp/server.mjs');
    await serve({ cwd: resolve(flags.cwd ?? '.') });
    return 0;
  }

  if (command === 'wait') {
    if (rest.length > 0) throw new UsageError(`unexpected argument "${rest[0]}"`);
    const seconds = flags.timeout === undefined ? 540 : Number(flags.timeout);
    if (!Number.isFinite(seconds) || seconds < 0) throw new UsageError('--timeout needs a number of seconds');
    const turn = await waitForTurn(handoffDir(resolve(flags.cwd ?? '.')), { timeoutMs: seconds * 1000 });
    if (turn.status === 'needs-fix') {
      out(`${turn.taskText.trimEnd()}\n\n---\nEdit the app here (a worktree, not your checkout): ${turn.worktree}\nWhen you have made the change, run: upkeep continue --message "<what you changed>"\nThen run: upkeep wait\n`);
      return 10;
    }
    if (turn.status === 'finished') {
      out(`${(turn.summary ?? []).join('\n')}\n`);
      return turn.exit ?? 0;
    }
    if (turn.status === 'stopped') {
      out(`The run stopped: ${turn.message}\n`);
      return 1;
    }
    if (turn.status === 'working') {
      out(`Still working${turn.lastLine ? `: ${turn.lastLine.trim()}` : ''}. Run "upkeep wait" again.\n`);
      return 11;
    }
    if (turn.status === 'gone') {
      out('The run is no longer running and did not finish. Start it again with: upkeep run --agent handoff\n');
      return 1;
    }
    out('No Upkeep run has been started here with --agent handoff.\n');
    return 1;
  }

  if (command === 'continue') {
    if (rest.length > 0) throw new UsageError(`unexpected argument "${rest[0]}"`);
    const { turn } = await continueRun(handoffDir(resolve(flags.cwd ?? '.')), flags.message ?? '');
    out(`Continuing (task ${turn}). Upkeep checks the edit, then Kane CLI walks the app again. Run: upkeep wait\n`);
    return 0;
  }

  if (command === 'report') {
    if (rest.length !== 1) throw new UsageError('report needs a run folder, for example .upkeep/runs/20261119-150004');
    const dir = resolve(rest[0]);
    let run;
    let ledger;
    try {
      run = JSON.parse(await readFile(join(dir, 'run.json'), 'utf8'));
      ledger = (await readFile(join(dir, 'ledger.ndjson'), 'utf8')).split('\n').filter(Boolean).map((line) => JSON.parse(line));
    } catch (error) {
      throw new Error(`${dir} is not a finished Upkeep run: ${error.message}`);
    }
    out(flags.html ? await renderRunHtml(dir, { run, ledger, agentName: run.agent }) : renderReport(run, ledger, { agentName: run.agent }));
    return 0;
  }

  if (command === 'export') {
    if (rest.length !== 1 || !flags.out) throw new UsageError('export needs a run folder and --out <dir>');
    const { files } = await exportRun(resolve(rest[0]), resolve(flags.out));
    out(`Copied ${files.length} files to ${resolve(flags.out)}. Kane evidence packs were left out: they name the account that made them.\n`);
    return 0;
  }
  if (rest.length > 0) throw new UsageError(`unexpected argument "${rest[0]}"`);

  if (command === 'plan') {
    const plan = await makePlan(resolve(flags.cwd ?? '.'), {
      target: flags.target,
      only: list(flags.only),
      exclude: list(flags.exclude),
    });
    out(flags.json ? `${JSON.stringify(plan, null, 2)}\n` : renderPlan(plan));
    return 0;
  }

  if (command === 'run') {
    const count = (name) => {
      if (flags[name] === undefined) return undefined;
      const value = Number(flags[name]);
      if (!Number.isInteger(value) || value < 1) throw new UsageError(`--${name} needs a whole number above 0`);
      return value;
    };
    const maxChecks = count('max-checks');
    const rounds = count('rounds');
    const budget = count('budget');
    const projectDir = resolve(flags.cwd ?? '.');
    const handoff = flags.agent === 'handoff' ? handoffDir(projectDir) : null;
    const agent = handoff ? { id: 'handoff', name: 'the agent in your session' } : flags.agent ? resolveAgent(flags.agent) : null;
    const fix = agent ? makeFixer({ agent, maxRounds: rounds, readFailure, ...(handoff ? { ask: makeHandoffAsk({ dir: handoff }) } : {}) }) : undefined;
    const lines = [];
    const say = (line) => {
      out(`${line}\n`);
      if (handoff) {
        lines.push(line);
        noteProgress(handoff, line);
      }
    };
    if (handoff) await openHandoff(handoff);
    try {
      const result = await upgradeRun({
        projectDir,
        options: {
          target: flags.target,
          only: list(flags.only),
          exclude: list(flags.exclude),
          keepWorktree: Boolean(flags['keep-worktree']),
          maxChecksPerSearch: maxChecks,
          agentName: agent?.name,
          pullRequest: Boolean(flags.pr),
          budget,
        },
        say,
        fix,
      });
      // 0: everything behind was upgraded. 3: some were held back or not tried. Both leave a usable branch.
      const exit = result.blocked.length > 0 || result.stoppedEarly ? 3 : 0;
      if (handoff) await writeState(handoff, { status: 'finished', exit, summary: lines.slice(lines.findLastIndex((line) => line.startsWith('Done in'))) });
      return exit;
    } catch (error) {
      const stop = async (message) => {
        if (handoff) await writeState(handoff, { status: 'stopped', message });
      };
      if (error instanceof CheckUnavailable) {
        out(`\nStopped: the check could not run, so nothing can be said about the upgrades.\n  ${error.message}\n`);
        await stop(`the check could not run: ${error.message}`);
        return 4;
      }
      if (error instanceof RunStopped) {
        out(`\nStopped: ${error.message}\n`);
        await stop(error.message);
        return 1;
      }
      await stop(error.message);
      throw error;
    }
  }

  throw new UsageError(`unknown command "${command}"`);
}
