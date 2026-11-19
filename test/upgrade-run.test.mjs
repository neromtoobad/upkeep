import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, realpath, access, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { upgradeRun, RunStopped } from '../src/run/upgrade-run.mjs';
import { CheckUnavailable } from '../src/loop/land-upgrades.mjs';
import { git } from '../src/workspace/worktree.mjs';

// The run is driven for real here: a real git repository, a real worktree,
// real commits, a real ledger and report on disk. Only the outside world is
// replaced: the plan (no registry), the check (no npm, no browser, no Kane)
// and the Kane account. The stand-in check reads the package.json Upkeep
// wrote, so it judges exactly what a real check would be given.

const exists = (path) => access(path).then(() => true, () => false);
const candidate = (name, from, to, breaking) => ({ name, from, to, section: 'dependencies', spec: `^${from}`, nextSpec: `^${to}`, kind: breaking ? 'major' : 'minor', breaking });
const unit = (c) => ({ id: c.name, packages: [c], breaking: c.breaking });

const AXIOS = candidate('axios', '1.2.0', '1.21.1', false);
const CLSX = candidate('clsx', '1.1.0', '1.2.1', false);
const DATES = candidate('date-fns', '1.30.1', '4.4.0', true);
const COOKIE = candidate('js-cookie', '2.2.1', '3.0.8', true);

async function shop() {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'upkeep-run-')));
  const cache = await realpath(await mkdtemp(join(tmpdir(), 'upkeep-run-cache-')));
  process.env.UPKEEP_CACHE_DIR = cache;
  const write = async (path, text) => {
    await mkdir(join(dir, path, '..'), { recursive: true });
    await writeFile(join(dir, path), text);
  };
  await write('package.json', `${JSON.stringify({ name: 'shop', dependencies: { axios: '^1.2.0', clsx: '^1.1.0', 'date-fns': '^1.30.1', 'js-cookie': '^2.2.1' } }, null, 2)}\n`);
  await write('src/Order.jsx', "format(date, 'DD/MM/YYYY')\n");
  await write('flows/checkout_test.md', '---\nurl: http://localhost:4173\n---\n\n# Check out\n\n## Pay\nVerify "Thanks".\n');
  await git(['init', '-q', '-b', 'main'], dir);
  await git(['config', 'user.name', 'test'], dir);
  await git(['config', 'user.email', 'test@example.com'], dir);
  await git(['add', '-A'], dir);
  await git(['commit', '-q', '-m', 'app'], dir);
  return { dir, cleanup: () => Promise.all([rm(dir, { recursive: true, force: true }), rm(cache, { recursive: true, force: true })]) };
}

/**
 * The outside world. `breaksWith` maps a package to the major version that
 * breaks the checkout flow unless the app was fixed (src/Order.jsx no longer
 * holds the old token).
 */
function world({ candidates = [AXIOS, CLSX, DATES, COOKIE], creditsPerCheck = 8, signedIn = true, baselineFails = false, unavailable = false } = {}) {
  let credits = 1000;
  const checks = [];
  return {
    checks,
    parts: {
      resolveConfig: async () => ({ install: 'true', build: null, serve: 'true', url: 'http://localhost:4173', port: 4173, flows: ['flows/checkout_test.md'], parallel: 1, readyTimeoutMs: 1000 }),
      makePlan: async () => ({ project: 'shop', target: 'latest', candidates, units: candidates.map(unit), skipped: [], together: [] }),
      kaneStatus: async () => ({ signedIn, detail: signedIn ? 'Authenticated' : 'Not logged in' }),
      readCredits: async () => credits,
      stagedCheck: async ({ cwd, heal, upTo }) => {
        const pkg = JSON.parse(await readFile(join(cwd, 'package.json'), 'utf8'));
        const source = await readFile(join(cwd, 'src/Order.jsx'), 'utf8');
        checks.push({ deps: pkg.dependencies, heal, upTo });
        if (unavailable) return { outcome: 'error', summary: 'Kane CLI is out of credits', seconds: 1 };
        credits -= creditsPerCheck;
        const failed = (message) => ({ outcome: 'fail', stage: 'kane', failing: ['checkout_test.md'], summary: `1 of 1 flows failed: checkout_test.md: ${message}`, flows: [{ flow: 'checkout_test.md', status: 'failed', message }], packs: [], seconds: 2, credits: creditsPerCheck });
        if (baselineFails) return failed('the shop does not load');
        if (pkg.dependencies['js-cookie'].startsWith('^3')) return failed('the page is blank');
        if (pkg.dependencies['date-fns'].startsWith('^4') && source.includes('DD/MM/YYYY')) return failed('the order page is blank');
        return { outcome: 'pass', failing: [], summary: '1 of 1 flows passed', flows: [{ flow: 'checkout_test.md', status: 'passed' }], packs: [], seconds: 1, credits: creditsPerCheck };
      },
    },
  };
}

const quiet = () => {};
const readLedger = async (runDir) => (await readFile(join(runDir, 'ledger.ndjson'), 'utf8')).split('\n').filter(Boolean).map((line) => JSON.parse(line));

test('a whole run: safe upgrades land, a breaking one is fixed and lands, another is held back', async () => {
  const { dir, cleanup } = await shop();
  const w = world();
  try {
    // A stand-in agent that knows how to fix date-fns and nothing else.
    const fix = async (units, verdict, { work, check, apply }) => {
      await apply(units);
      if (units[0].id !== 'date-fns') return { fixed: false, rounds: 1, verdict, reason: 'still failing after 1 round with the agent' };
      await writeFile(join(work.projectDir, 'src/Order.jsx'), "format(date, 'dd/MM/yyyy')\n");
      const after = await check(units, { keepManifest: true, label: 'after fix round 1' });
      return { fixed: after.outcome === 'pass', rounds: 1, verdict: after };
    };
    const said = [];
    const result = await upgradeRun({ projectDir: dir, options: { agentName: 'Test Agent' }, say: (line) => said.push(line), fix, parts: w.parts });

    // The branch: one commit for the safe set, one for date-fns with its fix. js-cookie is not on it.
    const log = (await git(['log', '--format=%s', `main..${result.branch}`], dir)).split('\n');
    assert.deepEqual(log, ['Bump date-fns and migrate the app', 'Bump 2 packages']);
    const landedPkg = JSON.parse(await git(['show', `${result.branch}:package.json`], dir));
    assert.deepEqual(landedPkg.dependencies, { axios: '^1.21.1', clsx: '^1.2.1', 'date-fns': '^4.4.0', 'js-cookie': '^2.2.1' });
    assert.equal(await git(['show', `${result.branch}:src/Order.jsx`], dir), "format(date, 'dd/MM/yyyy')");
    assert.match(await git(['log', '-1', '--format=%b', `${result.branch}~1`], dir), /- axios 1\.2\.0 -> 1\.21\.1\n- clsx 1\.1\.0 -> 1\.2\.1\n\nVerified by Upkeep\. Kane CLI: 1\/1 flows passed\./);

    // The checkout was never touched, and the worktree is gone.
    assert.equal(await git(['status', '--porcelain'], dir), '');
    assert.equal(await git(['rev-parse', '--abbrev-ref', 'HEAD'], dir), 'main');
    assert.equal(JSON.parse(await readFile(join(dir, 'package.json'), 'utf8')).dependencies.axios, '^1.2.0');
    assert.equal(await git(['worktree', 'list'], dir).then((text) => text.split('\n').length), 1);

    // What the run reports.
    assert.deepEqual(result.landed.map((entry) => [entry.units.map((u) => u.id).join(','), entry.fixed]), [['axios,clsx', false], ['date-fns', true]]);
    assert.deepEqual(result.blocked.map((entry) => entry.units.map((u) => u.id).join(',')), ['js-cookie']);
    assert.ok(said.some((line) => /2 packages? upgraded|3 packages upgraded and verified/.test(line)));
    assert.ok(said.some((line) => /1 package held back: js-cookie/.test(line)));

    // The ledger on disk obeys the rules the README states.
    const ledger = await readLedger(result.runDir);
    assert.deepEqual([ledger[0].type, ledger[0].units, ledger[0].outcome], ['check', [], 'pass'], 'starts from the app as it is');
    for (const landed of ledger.filter((entry) => entry.type === 'landed')) {
      const before = ledger.slice(0, ledger.indexOf(landed));
      const proof = before.findLast((entry) => entry.type === 'check' && entry.units.join() === landed.units.join());
      assert.equal(proof.outcome, 'pass', `${landed.units} landed on a passing check`);
      assert.match(landed.commit, /^[0-9a-f]{40}$/);
    }
    const blocked = ledger.find((entry) => entry.type === 'blocked');
    const blame = ledger.slice(0, ledger.indexOf(blocked)).findLast((entry) => entry.type === 'check' && entry.units.join() === 'js-cookie' && entry.speed === 'full');
    assert.equal(blame.outcome, 'fail', 'js-cookie was held back on a full failing check');

    // The report and run record are written, and .upkeep is kept out of git status without touching .gitignore.
    const report = await readFile(join(result.runDir, 'report.md'), 'utf8');
    assert.match(report, /\*\*4 packages behind · 3 upgraded and verified · 1 of those needed a fix · 1 held back\*\*/);
    assert.match(report, /Kane CLI caught it, Test Agent changed the app/);
    assert.equal(JSON.parse(await readFile(join(result.runDir, 'run.json'), 'utf8')).agent, 'Test Agent');
    assert.equal(await exists(join(dir, '.gitignore')), false);
  } finally {
    await cleanup();
  }
});

test('each check starts from the last commit: one attempt never leaks into the next', async () => {
  const { dir, cleanup } = await shop();
  const w = world();
  try {
    await upgradeRun({ projectDir: dir, say: quiet, parts: w.parts });
    // After the breaking set failed, js-cookie alone must be tried with date-fns back at ^1.
    const alone = w.checks.find((check) => check.deps['js-cookie'] === '^3.0.8' && check.deps['date-fns'] === '^1.30.1');
    assert.ok(alone, 'js-cookie was checked without date-fns');
    assert.equal(w.checks[0].deps.axios, '^1.2.0', 'the baseline is the app as committed');
  } finally {
    await cleanup();
  }
});

test('without an agent, breaking upgrades are isolated and held back with the reason', async () => {
  const { dir, cleanup } = await shop();
  const w = world();
  try {
    const result = await upgradeRun({ projectDir: dir, say: quiet, parts: w.parts });
    assert.deepEqual(result.blocked.map((entry) => [entry.units[0].id, entry.reason]).sort(), [
      ['date-fns', 'no coding agent was asked to fix it'],
      ['js-cookie', 'no coding agent was asked to fix it'],
    ]);
    assert.deepEqual((await git(['log', '--format=%s', `main..${result.branch}`], dir)).split('\n'), ['Bump 2 packages']);
  } finally {
    await cleanup();
  }
});

test('an app that fails its flows before any upgrade stops the run and leaves nothing behind', async () => {
  const { dir, cleanup } = await shop();
  try {
    await assert.rejects(upgradeRun({ projectDir: dir, say: quiet, parts: world({ baselineFails: true }).parts }), (error) => {
      assert.ok(error instanceof RunStopped);
      assert.match(error.message, /does not pass its own flows before any upgrade \(1 of 1 flows failed: checkout_test\.md: the shop does not load\)/);
      return true;
    });
    assert.equal(await git(['worktree', 'list'], dir).then((text) => text.split('\n').length), 1, 'worktree removed');
    const branch = (await git(['branch', '--list', 'upkeep/*'], dir)).trim();
    assert.equal(await git(['rev-list', '--count', `main..${branch}`], dir), '0', 'no commits were made');
  } finally {
    await cleanup();
  }
});

test('when Kane cannot check, the run stops and blames nothing', async () => {
  const { dir, cleanup } = await shop();
  try {
    await assert.rejects(upgradeRun({ projectDir: dir, say: quiet, parts: world({ unavailable: true }).parts }), (error) => error instanceof CheckUnavailable && /out of credits/.test(error.message));
  } finally {
    await cleanup();
  }
});

test('not signed in to Kane: stops before a worktree is made', async () => {
  const { dir, cleanup } = await shop();
  try {
    await assert.rejects(upgradeRun({ projectDir: dir, say: quiet, parts: world({ signedIn: false }).parts }), /Kane CLI is not signed in\. Run: kane-cli login --oauth/);
    assert.equal((await git(['branch', '--list', 'upkeep/*'], dir)).trim(), '');
  } finally {
    await cleanup();
  }
});

test('the credit budget stops new checks; what landed stays, the rest is reported as not tried', async () => {
  const { dir, cleanup } = await shop();
  const w = world({ creditsPerCheck: 8 });
  try {
    const said = [];
    // Baseline (8) and the safe set (8) fit in 16; the next check may not start.
    const result = await upgradeRun({ projectDir: dir, options: { budget: 16 }, say: (line) => said.push(line), parts: w.parts });
    assert.equal(w.checks.length, 2);
    assert.match(result.stoppedEarly, /the budget of 16 Kane credits is used up \(16 spent\)/);
    assert.deepEqual((await git(['log', '--format=%s', `main..${result.branch}`], dir)).split('\n'), ['Bump 2 packages']);
    assert.ok(said.some((line) => /2 packages not tried: the budget ran out/.test(line)));
    assert.equal(result.credits, 16);
    assert.equal((await readLedger(result.runDir)).at(-1).type, 'stopped');
  } finally {
    await cleanup();
  }
});

test('flows that verify nothing stop the run: they could not catch a broken upgrade', async () => {
  const { dir, cleanup } = await shop();
  const w = world();
  const parts = {
    ...w.parts,
    stagedCheck: async (input) => ({ ...(await w.parts.stagedCheck(input)), packs: [join(dir, 'package.json')] }),
    judgePack: async () => ({ withoutChecks: 1, healed: 0 }),
  };
  try {
    await assert.rejects(upgradeRun({ projectDir: dir, say: quiet, parts }), (error) => {
      assert.ok(error instanceof RunStopped);
      assert.match(error.message, /1 flow of 1 verifies nothing \(Kane CLI: tests without checks\)/);
      return true;
    });
  } finally {
    await cleanup();
  }
});

test('a pass where Kane healed a step is recorded and said', async () => {
  const { dir, cleanup } = await shop();
  const w = world({ candidates: [AXIOS] });
  let judged = 0;
  const parts = {
    ...w.parts,
    stagedCheck: async (input) => ({ ...(await w.parts.stagedCheck(input)), packs: [join(dir, 'package.json')] }),
    judgePack: async () => ({ withoutChecks: 0, healed: (judged += 1) === 2 ? 1 : 0 }),
  };
  try {
    const said = [];
    const result = await upgradeRun({ projectDir: dir, say: (line) => said.push(line), parts });
    assert.ok(said.some((line) => /Kane healed 1 flow: the page changed and the flow still passed/.test(line)));
    const ledger = await readLedger(result.runDir);
    assert.deepEqual(ledger.filter((entry) => entry.type === 'check').map((entry) => entry.policy), [{ withoutChecks: 0, healed: 0 }, { withoutChecks: 0, healed: 1 }]);
    assert.match(await readFile(join(result.runDir, 'report.md'), 'utf8'), /Kane healed 1 flow: the page changed\./);
  } finally {
    await cleanup();
  }
});

test('recordings only move forward on a pass: a failing check cannot leave them rewritten', async () => {
  const { dir, cleanup } = await shop();
  const w = world({ candidates: [AXIOS, COOKIE] });
  const seenByCheck = [];
  const parts = {
    ...w.parts,
    // Like Kane CLI: every check rewrites the recording (a heal attempt), pass or fail.
    stagedCheck: async (input) => {
      const file = join(input.cwd, 'flows/output-checkout/steps.json');
      seenByCheck.push(await readFile(file, 'utf8'));
      const verdict = await w.parts.stagedCheck(input);
      await writeFile(file, `rewritten during a check that ended in ${verdict.outcome}\n`);
      return verdict;
    },
  };
  try {
    await writeFile(join(dir, '.git/info/exclude'), 'flows/output-*/\n');
    await mkdir(join(dir, 'flows/output-checkout'), { recursive: true });
    await writeFile(join(dir, 'flows/output-checkout/steps.json'), 'recorded on the working app\n');
    await upgradeRun({ projectDir: dir, say: quiet, parts });
    // baseline (pass), axios (pass), js-cookie quick (fail), js-cookie full (fail)
    assert.deepEqual(seenByCheck, [
      'recorded on the working app\n',
      'rewritten during a check that ended in pass\n',
      'rewritten during a check that ended in pass\n',
      'rewritten during a check that ended in pass\n',
    ], 'after a failing check the next one starts from the last passing recording');
    const runs = join(dir, '.upkeep/runs');
    const ledger = await readLedger(join(runs, (await readdir(runs))[0]));
    assert.deepEqual(ledger.filter((entry) => entry.type === 'check').map((entry) => entry.recordingsRestored ?? false), [false, false, true, true], 'the ledger says when recordings were put back');
  } finally {
    await cleanup();
  }
});

test('nothing behind: says so and makes no branch', async () => {
  const { dir, cleanup } = await shop();
  try {
    const said = [];
    const result = await upgradeRun({ projectDir: dir, say: (line) => said.push(line), parts: world({ candidates: [] }).parts });
    assert.deepEqual(result, { landed: [], blocked: [], checks: 0, branch: null });
    assert.ok(said.some((line) => /Nothing to do/.test(line)));
    assert.equal(await exists(join(dir, '.upkeep')), false);
  } finally {
    await cleanup();
  }
});

test('recordings git does not track are brought into the worktree, so flows replay instead of being authored again', async () => {
  const { dir, cleanup } = await shop();
  const w = world({ candidates: [AXIOS] });
  let seen = null;
  const parts = {
    ...w.parts,
    stagedCheck: async (input) => {
      seen ??= await readdir(join(input.cwd, 'flows'));
      return w.parts.stagedCheck(input);
    },
  };
  try {
    await writeFile(join(dir, '.git/info/exclude'), 'flows/output-*/\n');
    await mkdir(join(dir, 'flows/output-checkout/.internal'), { recursive: true });
    await writeFile(join(dir, 'flows/output-checkout/.internal/meta.json'), '{}');
    const result = await upgradeRun({ projectDir: dir, say: quiet, parts });
    assert.deepEqual(seen.sort(), ['checkout_test.md', 'output-checkout']);
    assert.deepEqual((await git(['show', '--name-only', '--format=', result.branch], dir)).split('\n'), ['package.json'], 'ignored recordings are not committed');
  } finally {
    await cleanup();
  }
});
