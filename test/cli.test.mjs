import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs, main, UsageError } from '../src/cli.mjs';
import { renderPlan } from '../src/plan/make-plan.mjs';
import { groupLockstep } from '../src/plan/group-lockstep.mjs';

const run = promisify(execFile);
const BIN = fileURLToPath(new URL('../bin/upkeep.mjs', import.meta.url));

test('parseArgs reads a command, value flags in both styles, and booleans', () => {
  assert.deepEqual(parseArgs(['plan', '--cwd', 'app', '--target=wanted', '--json']), {
    command: 'plan',
    rest: [],
    flags: { cwd: 'app', target: 'wanted', json: true },
  });
  assert.deepEqual(parseArgs(['-h']).flags, { help: true });
});

test('parseArgs explains mistakes', () => {
  assert.throws(() => parseArgs(['plan', '--cwd']), (e) => e instanceof UsageError && /--cwd needs a value/.test(e.message));
  assert.throws(() => parseArgs(['plan', '--cwd', '--json']), /--cwd needs a value/);
  assert.throws(() => parseArgs(['plan', '--nope']), /unknown option --nope/);
  assert.throws(() => parseArgs(['plan', '--json=yes']), /--json takes no value/);
});

test('main prints help with no command and rejects an unknown one', async () => {
  let printed = '';
  assert.equal(await main([], { out: (text) => (printed += text) }), 0);
  assert.match(printed, /upkeep plan/);
  await assert.rejects(main(['upgrade']), /unknown command "upgrade"/);
  await assert.rejects(main(['plan', 'extra']), /unexpected argument "extra"/);
});

const candidate = (name, from, to, kind, breaking, section = 'dependencies') => ({ name, from, to, kind, breaking, section });

test('renderPlan separates risky from compatible and shows what moves together', () => {
  const candidates = [
    candidate('react', '18.3.1', '19.2.0', 'major', true),
    candidate('react-dom', '18.3.1', '19.2.0', 'major', true),
    candidate('vite', '4.0.0', '4.5.14', 'minor', false, 'devDependencies'),
  ];
  const text = renderPlan({
    project: 'shop',
    target: 'latest',
    candidates,
    units: groupLockstep(candidates),
    skipped: [{ name: 'ui-kit', reason: 'spec "workspace:*" is not a plain version range' }],
  });
  assert.equal(
    text,
    [
      'Upkeep plan for shop',
      '',
      '  3 packages are behind, moved as 2 units (some must go together).',
      '',
      '  May break the app (new major, or a 0.x minor)',
      '    react      18.3.1 → 19.2.0  major · with react-dom',
      '    react-dom  18.3.1 → 19.2.0  major · with react',
      '',
      '  Should be compatible',
      '    vite       4.0.0 → 4.5.14   minor · dev',
      '',
      '  Left alone',
      '    ui-kit  spec "workspace:*" is not a plain version range',
      '',
    ].join('\n'),
  );
});

test('renderPlan says so when nothing is behind', () => {
  const text = renderPlan({ project: 'shop', target: 'latest', candidates: [], units: [], skipped: [] });
  assert.match(text, /Every direct dependency is up to date/);
});

test('the installed command works end to end on a real folder', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'upkeep-cli-'));
  try {
    await writeFile(join(dir, 'package.json'), JSON.stringify({ name: 'empty-app', version: '1.0.0', private: true }));
    const plan = await run(process.execPath, [BIN, 'plan', '--cwd', dir]);
    assert.match(plan.stdout, /Upkeep plan for empty-app/);
    assert.match(plan.stdout, /Nothing to do/);

    const json = await run(process.execPath, [BIN, 'plan', '--cwd', dir, '--json']);
    assert.deepEqual(JSON.parse(json.stdout).candidates, []);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('a typo exits 2 with a pointer to help; a missing project exits 1', async () => {
  await assert.rejects(run(process.execPath, [BIN, 'plan', '--nope']), (error) => {
    assert.equal(error.code, 2);
    assert.match(error.stderr, /unknown option --nope/);
    assert.match(error.stderr, /upkeep --help/);
    return true;
  });
  const dir = await mkdtemp(join(tmpdir(), 'upkeep-cli-'));
  try {
    await assert.rejects(run(process.execPath, [BIN, 'plan', '--cwd', dir]), (error) => {
      assert.equal(error.code, 1);
      assert.match(error.stderr, /no package.json in/);
      return true;
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
