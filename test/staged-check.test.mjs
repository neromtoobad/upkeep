import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stagedCheck, npmReason, buildReason } from '../src/check/staged-check.mjs';
import { AddressInUse } from '../src/check/serve-app.mjs';

const CONFIG = { install: 'npm install', build: 'npm run build', serve: 'npx vite preview', url: 'http://localhost:4173', port: 4173, flows: ['flows/a_test.md'], parallel: 1, readyTimeoutMs: 1000 };

// Stand-ins for the real stage runners (npm, the app server, Kane CLI). Each
// test says what each stage answers and records which stages were reached.
function stages({ install = { code: 0, output: '' }, build = { code: 0, output: '' }, serve = 'ok', kane = { outcome: 'pass', failing: [], summary: '1 of 1 flows passed', flows: [], packs: ['p.evidence'] }, credits = [100, 92] } = {}) {
  const reached = [];
  const kaneInputs = [];
  let stopped = false;
  let creditCall = 0;
  return {
    reached,
    kaneInputs,
    wasStopped: () => stopped,
    runCommand: async (command) => {
      reached.push(command);
      return command === 'npm install' ? install : build;
    },
    serveApp: async () => {
      reached.push('serve');
      if (serve === 'in-use') throw new AddressInUse('http://localhost:4173');
      if (serve !== 'ok') return { ok: false, reason: serve, output: 'Error: Cannot find module "vite"' };
      return { ok: true, stop: async () => { stopped = true; }, output: () => '' };
    },
    runKaneSuite: async (input) => {
      reached.push('kane');
      kaneInputs.push(input);
      if (kane instanceof Error) throw kane;
      return kane;
    },
    readCredits: async () => credits[creditCall++] ?? null,
  };
}

test('all stages pass: a pass, with the credits Kane used and the app stopped', async () => {
  const s = stages();
  const seen = [];
  const verdict = await stagedCheck({ cwd: '/app', config: CONFIG, stages: s, onStage: (e) => seen.push(e.stage) });
  assert.equal(verdict.outcome, 'pass');
  assert.equal(verdict.stage, undefined);
  assert.equal(verdict.credits, 8);
  assert.deepEqual(verdict.packs, ['p.evidence']);
  assert.deepEqual(seen, ['install', 'build', 'boot', 'kane']);
  assert.equal(s.wasStopped(), true);
});

test('a quick check tells Kane not to heal; a full check lets it', async () => {
  const quick = stages();
  await stagedCheck({ cwd: '/app', config: CONFIG, heal: false, stages: quick });
  assert.equal(quick.kaneInputs[0].heal, false);
  const full = stages();
  await stagedCheck({ cwd: '/app', config: CONFIG, stages: full });
  assert.equal(full.kaneInputs[0].heal, true);
  assert.deepEqual(full.kaneInputs[0].flows, ['flows/a_test.md']);
});

test('stopping after the build answers "does it build" without booting or spending credits', async () => {
  const s = stages();
  const verdict = await stagedCheck({ cwd: '/app', config: CONFIG, upTo: 'build', stages: s });
  assert.deepEqual([verdict.outcome, verdict.partial, verdict.summary], ['pass', true, 'got past build; not checked further']);
  assert.deepEqual(s.reached, ['npm install', 'npm run build']);
  assert.equal(verdict.credits, undefined);

  const failing = stages({ build: { code: 1, output: 'error during build' } });
  const failed = await stagedCheck({ cwd: '/app', config: CONFIG, upTo: 'build', stages: failing });
  assert.deepEqual([failed.outcome, failed.stage, failed.partial], ['fail', 'build', undefined]);

  const afterInstall = stages();
  await stagedCheck({ cwd: '/app', config: CONFIG, upTo: 'install', stages: afterInstall });
  assert.deepEqual(afterInstall.reached, ['npm install']);

  const afterBoot = stages();
  const booted = await stagedCheck({ cwd: '/app', config: CONFIG, upTo: 'boot', stages: afterBoot });
  assert.equal(booted.partial, true);
  assert.equal(afterBoot.wasStopped(), true, 'the app is stopped again');
  assert.ok(!afterBoot.reached.includes('kane'));
});

test('an install conflict fails at install and never reaches the browser', async () => {
  const output = 'npm error code ERESOLVE\nnpm error ERESOLVE could not resolve\nnpm error Found: react@17.0.2\nnpm error peer react@">=18" from react-markdown@10.1.0';
  const s = stages({ install: { code: 1, output } });
  const verdict = await stagedCheck({ cwd: '/app', config: CONFIG, stages: s });
  assert.equal(verdict.outcome, 'fail');
  assert.equal(verdict.stage, 'install');
  assert.match(verdict.summary, /packages disagree about a shared dependency · Found: react@17\.0\.2 · peer react@">=18" from react-markdown@10\.1\.0/);
  assert.deepEqual(s.reached, ['npm install']);
});

test('the registry being unreachable is "could not check", not a failed upgrade', async () => {
  const s = stages({ install: { code: 1, output: 'npm error code ENOTFOUND\nnpm error network request to https://registry.npmjs.org/react failed' } });
  const verdict = await stagedCheck({ cwd: '/app', config: CONFIG, stages: s });
  assert.equal(verdict.outcome, 'error');
  assert.equal(verdict.stage, 'install');
});

test('a build error fails at build and costs no Kane credits', async () => {
  const output = 'vite v4.0.0 building for production...\nerror during build:\nRollupError: "default" is not exported by "node_modules/nanoid/index.browser.js", imported by "src/orders.js".';
  const s = stages({ build: { code: 1, output } });
  const verdict = await stagedCheck({ cwd: '/app', config: CONFIG, stages: s });
  assert.equal(verdict.outcome, 'fail');
  assert.equal(verdict.stage, 'build');
  assert.equal(verdict.summary, 'build failed: "default" is not exported by "node_modules/nanoid/index.browser.js", imported by "src/orders.js".');
  assert.match(verdict.detail, /"default" is not exported by/);
  assert.ok(!s.reached.includes('kane'));
  assert.equal(verdict.credits, undefined);
});

test('no build command means the build stage is skipped', async () => {
  const s = stages();
  await stagedCheck({ cwd: '/app', config: { ...CONFIG, build: null }, stages: s });
  assert.deepEqual(s.reached, ['npm install', 'serve', 'kane']);
});

test('an app that will not start fails at boot', async () => {
  for (const [serve, message] of [['exited', /the app stopped while starting/], ['timeout', /did not answer at http:\/\/localhost:4173 in time/]]) {
    const verdict = await stagedCheck({ cwd: '/app', config: CONFIG, stages: stages({ serve }) });
    assert.equal(verdict.outcome, 'fail');
    assert.equal(verdict.stage, 'boot');
    assert.match(verdict.summary, message);
  }
});

test('a port that is already taken is "could not check"', async () => {
  const verdict = await stagedCheck({ cwd: '/app', config: CONFIG, stages: stages({ serve: 'in-use' }) });
  assert.equal(verdict.outcome, 'error');
  assert.match(verdict.summary, /already answering at http:\/\/localhost:4173/);
});

test('a Kane failure is a failure at the kane stage and names the flows', async () => {
  const kane = { outcome: 'fail', failing: ['a_test.md'], summary: '1 of 1 flows failed: a_test.md: blank page', flows: [{ flow: 'a_test.md', status: 'failed' }], packs: ['p.evidence'] };
  const s = stages({ kane });
  const verdict = await stagedCheck({ cwd: '/app', config: CONFIG, stages: s });
  assert.equal(verdict.outcome, 'fail');
  assert.equal(verdict.stage, 'kane');
  assert.deepEqual(verdict.failing, ['a_test.md']);
  assert.equal(s.wasStopped(), true);
});

test('the app is stopped even when Kane throws', async () => {
  const s = stages({ kane: new Error('spawn failed') });
  await assert.rejects(stagedCheck({ cwd: '/app', config: CONFIG, stages: s }), /spawn failed/);
  assert.equal(s.wasStopped(), true);
});

test('npmReason and buildReason pull out the line that matters', () => {
  assert.equal(npmReason('npm error code ETARGET\nnpm error notarget No matching version found for left-pad@9.9.9.'), 'code ETARGET · notarget No matching version found for left-pad@9.9.9.');
  assert.equal(npmReason(''), 'npm install failed');
  assert.equal(buildReason('transforming...\n✓ 12 modules\nsrc/App.jsx:3:9: ERROR: No matching export in "x" for import "Switch"\n'), 'src/App.jsx:3:9: ERROR: No matching export in "x" for import "Switch"');
  // As Vite 4 printed it on the real run: the announcement, then the error.
  assert.equal(buildReason('vite v4.0.0 building for production...\nerror during build:\n[vite]: Rollup failed to resolve import "#minpath" from "node_modules/vfile/lib/index.js".'), '[vite]: Rollup failed to resolve import "#minpath" from "node_modules/vfile/lib/index.js".');
  assert.equal(buildReason(''), 'the build failed');
});
