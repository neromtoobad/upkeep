import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { exportRun, scrub, flowScreenshot } from '../src/report/export-run.mjs';
import { listZip } from '../src/kane/zip.mjs';
import { makeZip } from './stubs/make-zip.mjs';

test('scrub removes home folders and email addresses, and keeps test data', () => {
  assert.equal(scrub('log at /Users/ada/.testmuai/sessions/x and /home/ci/work', '/Users/ada'), 'log at ~/.testmuai/sessions/x and ~/work');
  assert.equal(scrub('user_email: someone@gmail.com', '/Users/x'), 'user_email: <email>');
  assert.equal(scrub('Fill "Email" with "ada@example.com"', '/Users/x'), 'Fill "Email" with "ada@example.com"');
  assert.equal(scrub('bump react@19.2.0 and date-fns@4.4.0', '/Users/x'), 'bump react@19.2.0 and date-fns@4.4.0');
});

const pack = (files) => makeZip(Object.fromEntries(Object.entries(files).map(([name, text]) => [name, { text }])));

test('flowScreenshot prefers the step with Kane’s failure record', () => {
  const zip = pack({
    'tests/checkout-ae9bd187/steps/16-1-8/screenshot.jpg': 'filled form',
    'tests/checkout-ae9bd187/steps/17-1-9/screenshot.jpg': 'blank page',
    'tests/checkout-ae9bd187/steps/17-1-9/failure.yaml': 'title: Order confirmation crashes',
    'tests/checkout-ae9bd187/steps/20-1-12/screenshot.jpg': 'still blank, later',
  });
  const shot = flowScreenshot(zip, listZip(zip), 'checkout');
  assert.deepEqual([shot.bytes.toString(), shot.failed], ['blank page', true]);
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

test('exportRun copies the report, ledger, agent exchange and screenshots, never the packs', async () => {
  const run = await mkdtemp(join(tmpdir(), 'upkeep-export-'));
  const out = await mkdtemp(join(tmpdir(), 'upkeep-export-out-'));
  try {
    await mkdir(join(run, 'evidence'), { recursive: true });
    await mkdir(join(run, 'agent/date-fns/protected/flows'), { recursive: true });
    await writeFile(join(run, 'report.md'), '# Upkeep report\nlog: /Users/someone/.testmuai/x\n');
    await writeFile(join(run, 'run.json'), '{"project":"shop"}\n');
    await writeFile(
      join(run, 'ledger.ndjson'),
      `${JSON.stringify({ type: 'check', number: 3, outcome: 'fail', packs: ['p1.evidence'], flows: [{ flow: 'checkout_test.md', status: 'failed', logPath: '/Users/someone/.testmuai/kaneai/sessions/s/events.ndjson' }, { flow: 'browse_test.md', status: 'passed' }] })}\n${JSON.stringify({ type: 'blocked', units: ['date-fns'] })}\n`,
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
      'report.md',
      'run.json',
      'screenshots/check-03-browse-passed.jpg',
      'screenshots/check-03-checkout-failed.jpg',
    ]);
    assert.equal(await readFile(join(out, 'screenshots/check-03-checkout-failed.jpg'), 'utf8'), 'blank page');
    assert.match(await readFile(join(out, 'report.md'), 'utf8'), /log: ~\/\.testmuai\/x/);
    assert.match(await readFile(join(out, 'ledger.ndjson'), 'utf8'), /"logPath":"~\/\.testmuai\/kaneai/);
    assert.deepEqual((await readdir(out)).sort(), ['agent', 'ledger.ndjson', 'report.md', 'run.json', 'screenshots']);
    const everything = (await Promise.all(files.map((file) => readFile(join(out, file), 'utf8')))).join('\n');
    assert.ok(!everything.includes('someone@gmail.com') && !everything.includes('/Users/someone'));
  } finally {
    await Promise.all([rm(run, { recursive: true, force: true }), rm(out, { recursive: true, force: true })]);
  }
});
