import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { exportRun, scrub } from '../src/report/export-run.mjs';
import { flowScreenshot } from '../src/kane/read-evidence.mjs';
import { listZip } from '../src/kane/zip.mjs';
import { makeZip } from './stubs/make-zip.mjs';

test('scrub removes home folders and email addresses, and keeps test data', () => {
  assert.equal(scrub('log at /Users/ada/.testmuai/sessions/x and /home/ci/work', '/Users/ada'), 'log at ~/.testmuai/sessions/x and ~/work');
  assert.equal(scrub('user_email: someone@gmail.com', '/Users/x'), 'user_email: <email>');
  assert.equal(scrub('Fill "Email" with "ada@example.com"', '/Users/x'), 'Fill "Email" with "ada@example.com"');
  assert.equal(scrub('bump react@19.2.0 and date-fns@4.4.0', '/Users/x'), 'bump react@19.2.0 and date-fns@4.4.0');
});

const pack = (files) => makeZip(Object.fromEntries(Object.entries(files).map(([name, text]) => [name, { text }])));

test('flowScreenshot shows where a failed flow ended, not the step before it went wrong', () => {
  const zip = pack({
    'tests/checkout-ae9bd187/steps/16-1-8/screenshot.jpg': 'filled form',
    'tests/checkout-ae9bd187/steps/17-1-9/screenshot.jpg': 'the form, just before the click',
    'tests/checkout-ae9bd187/steps/17-1-9/failure.yaml': 'title: Order confirmation crashes',
    'tests/checkout-ae9bd187/steps/20-1-12/screenshot.jpg': 'still blank, later',
  });
  const shot = flowScreenshot(zip, listZip(zip), 'checkout');
  assert.deepEqual([shot.bytes.toString(), shot.failed], ['still blank, later', true]);
});

test('flowScreenshot takes the last step of the final attempt when the flow passed', () => {
  const zip = pack({
    'tests/checkout-ae9bd187/1/steps/30-1-9/screenshot.jpg': 'an earlier attempt',
    'tests/checkout-ae9bd187/steps/2-0-2/screenshot.jpg': 'product page',
    'tests/checkout-ae9bd187/steps/18-1-10/screenshot.jpg': 'thanks page',
    'tests/browse-59fa8097/steps/99-1-1/screenshot.jpg': 'another flow',
  });
  const shot = flowScreenshot(zip, listZip(zip), 'checkout');
  assert.deepEqual([shot.bytes.toString(), shot.failed], ['thanks page', false]);
  assert.equal(flowScreenshot(zip, listZip(zip), 'cart'), null);
});

test('a truncated pack costs its screenshots, not the report', async () => {
  const run = await mkdtemp(join(tmpdir(), 'upkeep-export-'));
  try {
    await mkdir(join(run, 'evidence'), { recursive: true });
    await writeFile(join(run, 'evidence/broken.evidence'), 'not a zip');
    const ledger = [{ type: 'check', number: 1, units: [], outcome: 'pass', packs: ['broken.evidence'], flows: [{ flow: 'checkout_test.md', status: 'passed' }] }];
    const { readScreenshots } = await import('../src/report/export-run.mjs');
    assert.equal((await readScreenshots(run, ledger)).size, 0);
  } finally {
    await rm(run, { recursive: true, force: true });
  }
});

test('exportRun copies the report, ledger, agent exchange and screenshots, never the packs', async () => {
  const run = await mkdtemp(join(tmpdir(), 'upkeep-export-'));
  const out = await mkdtemp(join(tmpdir(), 'upkeep-export-out-'));
  try {
    await mkdir(join(run, 'evidence'), { recursive: true });
    await mkdir(join(run, 'agent/date-fns/protected/flows'), { recursive: true });
    await writeFile(join(run, 'report.md'), '# Upkeep report\nlog: /Users/someone/.testmuai/x\n');
    await writeFile(join(run, 'run.json'), `${JSON.stringify({ project: 'shop', branch: 'upkeep/x', checks: 1, seconds: 60, credits: 8, flows: ['flows/checkout_test.md'], url: 'http://localhost:4173', plan: [{ name: 'date-fns', from: '1.30.1', to: '4.4.0', kind: 'major' }], skipped: [] })}\n`);
    await writeFile(
      join(run, 'ledger.ndjson'),
      `${JSON.stringify({ type: 'check', number: 3, units: ['date-fns'], speed: 'full', outcome: 'fail', stage: 'kane', summary: '1 of 2 flows failed', packs: ['p1.evidence'], flows: [{ flow: 'checkout_test.md', status: 'failed', logPath: '/Users/someone/.testmuai/kaneai/sessions/s/events.ndjson' }, { flow: 'browse_test.md', status: 'passed' }] })}\n${JSON.stringify({ type: 'blocked', units: ['date-fns'], reason: 'no coding agent was asked to fix it', stage: 'kane', summary: '1 of 2 flows failed' })}\n`,
    );
    await writeFile(join(run, 'agent/date-fns/round-1-task.md'), '# Make this app work\n');
    await writeFile(join(run, 'agent/date-fns/round-1-reply.md'), 'Changed the tokens.\n');
    await writeFile(join(run, 'agent/date-fns/protected/flows/checkout_test.md'), 'a backup copy, not for publishing\n');
    await writeFile(
      join(run, 'evidence/p1.evidence'),
      pack({
        'tests/checkout-ae9bd187/result.yaml': 'user_email: someone@gmail.com\n',
        'tests/checkout-ae9bd187/steps/17-1-9/screenshot.jpg': 'blank page',
        'tests/checkout-ae9bd187/steps/17-1-9/failure.yaml': 'title: crash',
        'tests/browse-59fa8097/steps/8-1-4/screenshot.jpg': 'tote page',
      }),
    );

    const { files } = await exportRun(run, out);
    assert.deepEqual(files.sort(), [
      'agent/date-fns/round-1-reply.md',
      'agent/date-fns/round-1-task.md',
      'ledger.ndjson',
      'report.html',
      'report.md',
      'run.json',
      'screenshots/check-03-browse-passed.jpg',
      'screenshots/check-03-checkout-failed.jpg',
    ]);
    assert.equal(await readFile(join(out, 'screenshots/check-03-checkout-failed.jpg'), 'utf8'), 'blank page');
    assert.match(await readFile(join(out, 'report.md'), 'utf8'), /log: ~\/\.testmuai\/x/);
    assert.match(await readFile(join(out, 'ledger.ndjson'), 'utf8'), /"logPath":"~\/\.testmuai\/kaneai/);
    assert.deepEqual((await readdir(out)).sort(), ['agent', 'ledger.ndjson', 'report.html', 'report.md', 'run.json', 'screenshots']);
    const html = await readFile(join(out, 'report.html'), 'utf8');
    assert.match(html, /<title>Upkeep report: shop<\/title>/);
    assert.match(html, /src="data:image\/jpeg;base64,/, 'screenshots are embedded, so the page opens offline');
    assert.ok(!/src="https?:|<script|<link/.test(html), 'nothing is fetched and nothing runs');
    const everything = (await Promise.all(files.map((file) => readFile(join(out, file), 'utf8')))).join('\n');
    assert.ok(!everything.includes('someone@gmail.com') && !everything.includes('/Users/someone'));
  } finally {
    await Promise.all([rm(run, { recursive: true, force: true }), rm(out, { recursive: true, force: true })]);
  }
});
