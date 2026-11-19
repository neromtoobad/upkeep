// Command line entry. Each command is small; the work lives in the modules.

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { makePlan, renderPlan } from './plan/make-plan.mjs';
import { upgradeRun, RunStopped } from './run/upgrade-run.mjs';
import { CheckUnavailable } from './loop/land-upgrades.mjs';
import { makeFixer } from './agent/fix-loop.mjs';
import { resolveAgent } from './agent/ask-agent.mjs';
import { readFailure } from './kane/read-evidence.mjs';

const HELP = `Upkeep updates your outdated packages and proves in a real browser that the app still works.

Usage
  upkeep plan [options]     Show which packages are behind and how they will be moved
  upkeep run [options]      Upgrade them on a new branch, keeping only what Kane CLI verifies

Options for plan and run
  --cwd <dir>               Project folder (default: current folder)
  --target latest|wanted    latest: newest release (default). wanted: stay inside the ranges in package.json
  --only <a,b>              Only these packages
  --exclude <a,b>           Never these packages

Options for plan
  --json                    Print the plan as JSON

Options for run
  --agent <name|command>    Coding agent that fixes an upgrade Kane says broke the app:
                            claude, codex, or your own command (the task arrives on stdin,
                            or in a file if the command contains {prompt_file}).
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

const VALUE_FLAGS = new Set(['--cwd', '--target', '--only', '--exclude', '--max-checks', '--agent', '--rounds', '--budget']);
const BOOLEAN_FLAGS = new Set(['--json', '--help', '--version', '--keep-worktree', '--pr']);
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
    const agent = flags.agent ? resolveAgent(flags.agent) : null;
    const fix = agent ? makeFixer({ agent, maxRounds: rounds, readFailure }) : undefined;
    try {
      const result = await upgradeRun({
        projectDir: resolve(flags.cwd ?? '.'),
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
        say: (line) => out(`${line}\n`),
        fix,
      });
      // 0: everything behind was upgraded. 3: some were held back or not tried. Both leave a usable branch.
      return result.blocked.length > 0 || result.stoppedEarly ? 3 : 0;
    } catch (error) {
      if (error instanceof CheckUnavailable) {
        out(`\nStopped: the check could not run, so nothing can be said about the upgrades.\n  ${error.message}\n`);
        return 4;
      }
      if (error instanceof RunStopped) {
        out(`\nStopped: ${error.message}\n`);
        return 1;
      }
      throw error;
    }
  }

  throw new UsageError(`unknown command "${command}"`);
}
