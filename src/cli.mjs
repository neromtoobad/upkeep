// Command line entry. Each command is small; the work lives in the modules.

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { makePlan, renderPlan } from './plan/make-plan.mjs';

const HELP = `Upkeep updates your outdated packages and proves in a real browser that the app still works.

Usage
  upkeep plan [options]     Show which packages are behind and how they will be moved

Options for plan
  --cwd <dir>               Project folder (default: current folder)
  --target latest|wanted    latest: newest release (default). wanted: stay inside the ranges in package.json
  --only <a,b>              Only these packages
  --exclude <a,b>           Never these packages
  --json                    Print the plan as JSON

  -h, --help                Show this help
  -v, --version             Show the version
`;

/** Thrown for mistakes in how the command was typed. */
export class UsageError extends Error {}

const VALUE_FLAGS = new Set(['--cwd', '--target', '--only', '--exclude']);
const BOOLEAN_FLAGS = new Set(['--json', '--help', '--version']);
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

  throw new UsageError(`unknown command "${command}"`);
}
