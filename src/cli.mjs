// Command line entry. Each command is small; the work lives in the modules.

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { makePlan, renderPlan } from './plan/make-plan.mjs';
import { upgradeRun, RunStopped } from './run/upgrade-run.mjs';
import { CheckUnavailable } from './loop/land-upgrades.mjs';

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
  --max-checks <n>          Most checks to spend isolating one failure (default 24)
  --keep-worktree           Leave the working copy in place when the run ends

  -h, --help                Show this help
  -v, --version             Show the version
`;

/** Thrown for mistakes in how the command was typed. */
export class UsageError extends Error {}

const VALUE_FLAGS = new Set(['--cwd', '--target', '--only', '--exclude', '--max-checks']);
const BOOLEAN_FLAGS = new Set(['--json', '--help', '--version', '--keep-worktree']);
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
    const maxChecks = flags['max-checks'] === undefined ? undefined : Number(flags['max-checks']);
    if (maxChecks !== undefined && (!Number.isInteger(maxChecks) || maxChecks < 1)) throw new UsageError('--max-checks needs a whole number above 0');
    try {
      const result = await upgradeRun({
        projectDir: resolve(flags.cwd ?? '.'),
        options: {
          target: flags.target,
          only: list(flags.only),
          exclude: list(flags.exclude),
          keepWorktree: Boolean(flags['keep-worktree']),
          maxChecksPerSearch: maxChecks,
        },
        say: (line) => out(`${line}\n`),
      });
      // 0: everything behind was upgraded. 3: some were held back. Both leave a usable branch.
      return result.blocked.length > 0 ? 3 : 0;
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
