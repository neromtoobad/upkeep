import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderReport } from '../src/report/write-report.mjs';

const flows = (...statuses) => statuses.map((status, i) => ({ flow: ['browse_test.md', 'cart_test.md', 'checkout_test.md'][i], status }));
const candidate = (name, from, to, kind) => ({ name, from, to, kind });

// A ledger in the shape upgrade-run.mjs writes, for a run that has one of
// everything: a plain upgrade, an upgrade with a fix, and one held back.
const RUN = {
  project: 'margin-paper-goods',
  branch: 'upkeep/2026-11-19-1450',
  flows: ['flows/browse_test.md', 'flows/cart_test.md', 'flows/checkout_test.md'],
  url: 'http://localhost:4173',
  checks: 6,
  seconds: 912,
  credits: 61.4,
  plan: [candidate('axios', '1.2.0', '1.13.2', 'minor'), candidate('classnames', '2.2.6', '2.5.1', 'minor'), candidate('date-fns', '1.30.1', '4.4.0', 'major'), candidate('js-cookie', '2.2.1', '3.0.5', 'major')],
  skipped: [{ name: 'ui-kit', reason: 'spec "workspace:*" is not a plain version range' }],
};
const LEDGER = [
  { type: 'check', number: 1, units: [], outcome: 'pass', summary: '3 of 3 flows passed', seconds: 63, credits: 6.95, flows: flows('passed', 'passed', 'passed') },
  { type: 'check', number: 2, units: ['axios', 'classnames'], outcome: 'pass', summary: '3 of 3 flows passed', seconds: 64, credits: 8.3, flows: flows('passed', 'passed', 'passed') },
  { type: 'landed', units: ['axios', 'classnames'], commit: '3d6b67fabc', fixed: false },
  { type: 'check', number: 3, units: ['date-fns', 'js-cookie'], outcome: 'fail', stage: 'kane', summary: '3 of 3 flows failed: browse_test.md: the page was blank', seconds: 300, credits: 20, flows: flows('failed', 'failed', 'failed') },
  { type: 'check', number: 4, units: ['date-fns'], outcome: 'fail', stage: 'kane', summary: '1 of 3 flows failed: checkout_test.md: the page went blank | after "Place order"', seconds: 240, credits: 14, flows: flows('passed', 'passed', 'failed') },
  { type: 'agent', units: ['date-fns'], round: 1, ok: true, seconds: 41, changed: ['src/pages/Order.jsx'], undone: ['edited flows/checkout_test.md (the flows and their recordings are the definition of "works")'], reply: 'date-fns v2 renamed the format tokens.\nI changed DD/MM/YYYY to dd/MM/yyyy.' },
  { type: 'check', number: 5, units: ['date-fns'], outcome: 'pass', summary: '3 of 3 flows passed', seconds: 66, credits: 7, flows: flows('passed', 'passed', 'passed') },
  { type: 'landed', units: ['date-fns'], commit: 'a1b2c3d4e5', fixed: true, rounds: 1 },
  { type: 'check', number: 6, units: ['js-cookie'], outcome: 'fail', stage: 'kane', summary: '3 of 3 flows failed: browse_test.md: the page was blank', seconds: 250, credits: 5.15, flows: flows('failed', 'failed', 'failed') },
  { type: 'blocked', units: ['js-cookie'], reason: 'no coding agent was asked to fix it', stage: 'kane', summary: '3 of 3 flows failed: browse_test.md: the page was blank', rounds: 0 },
];

test('the headline counts packages, not units, and states the cost', () => {
  const report = renderReport(RUN, LEDGER, { agentName: 'Claude Code' });
  assert.match(report, /^# Upkeep report: margin-paper-goods\n\n\*\*4 packages behind · 3 upgraded and verified · 1 upgrade broke the app and was fixed · 1 held back\*\*/);
  assert.match(report, /Branch `upkeep\/2026-11-19-1450` · 6 checks · 15 min · 61\.4 Kane credits\./);
  assert.match(report, /Kane CLI walking 3 flows in a real browser at http:\/\/localhost:4173/);
});

test('a plain upgrade names the check that proved it and its commit', () => {
  const report = renderReport(RUN, LEDGER);
  assert.match(report, /\| axios \| 1\.2\.0 \| 1\.13\.2 \| minor \| Kane CLI 3\/3 flows, check 2, commit `3d6b67f` \|/);
  assert.match(report, /\| classnames \| 2\.2\.6 \| 2\.5\.1 \| minor \| Kane CLI 3\/3 flows, check 2, commit `3d6b67f` \|/);
});

test('an upgrade with a fix tells the whole loop: Kane’s failure, the agent’s change, Kane’s pass', () => {
  const report = renderReport(RUN, LEDGER, { agentName: 'Claude Code' });
  const section = report.slice(report.indexOf('## Upgraded with a fix'), report.indexOf('## Held back'));
  assert.match(section, /Kane CLI caught it, Claude Code changed the app, and Kane CLI passed every flow again/);
  assert.match(section, /### date-fns 1\.30\.1 → 4\.4\.0/);
  assert.match(section, /\*\*What broke\*\* \(check 4, at kane\): 1 of 3 flows failed: checkout_test\.md: the page went blank \\\| after "Place order"/);
  assert.match(section, /\*\*The fix\*\* \(1 round\): `src\/pages\/Order\.jsx`/);
  assert.match(section, /\*\*In the agent's words:\*\* date-fns v2 renamed the format tokens\. I changed DD\/MM\/YYYY to dd\/MM\/yyyy\./);
  assert.match(section, /\*\*Undone by Upkeep\*\* in round 1: the agent edited flows\/checkout_test\.md/);
  assert.match(section, /\*\*Verified:\*\* Kane CLI 3\/3 flows, check 5, commit `a1b2c3d`/);
});

test('a held-back upgrade says what breaks and why it was not fixed', () => {
  const report = renderReport(RUN, LEDGER);
  const section = report.slice(report.indexOf('## Held back'), report.indexOf('## Left alone'));
  assert.match(section, /### js-cookie 2\.2\.1 → 3\.0\.5/);
  assert.match(section, /\*\*What breaks\*\* \(at kane\): 3 of 3 flows failed: browse_test\.md: the page was blank/);
  assert.match(section, /\*\*Why it was held back:\*\* no coding agent was asked to fix it/);
});

test('every check is listed, failures marked, with time and credits', () => {
  const report = renderReport(RUN, LEDGER);
  assert.match(report, /\| 1 \| nothing \(the app as it is\) \| pass: 3 of 3 flows passed\. \| 63s \| 6\.95 \|/);
  assert.match(report, /\| 4 \| date-fns \| \*\*fail at kane\*\*: 1 of 3 flows failed.*\| 240s \| 14 \|/);
  assert.match(report, /- ui-kit: spec "workspace:\*" is not a plain version range/);
});

test('a pass where Kane healed a step says so', () => {
  const ledger = LEDGER.map((entry) => (entry.number === 2 ? { ...entry, policy: { withoutChecks: 0, healed: 1 } } : entry));
  assert.match(renderReport(RUN, ledger), /\| 2 \| axios, classnames \| pass: 3 of 3 flows passed\. Kane healed 1 flow: the page changed\. \|/);
});

test('sections with nothing in them are left out', () => {
  const run = { ...RUN, plan: RUN.plan.slice(0, 2), skipped: [], checks: 2 };
  const report = renderReport(run, LEDGER.slice(0, 3));
  assert.ok(!report.includes('## Upgraded with a fix'));
  assert.ok(!report.includes('## Held back'));
  assert.ok(!report.includes('## Left alone'));
  assert.match(report, /\*\*2 packages behind · 2 upgraded and verified\*\*/);
});
