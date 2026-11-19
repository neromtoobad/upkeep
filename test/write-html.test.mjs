import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderHtml } from '../src/report/write-html.mjs';

const flows = (...statuses) => statuses.map((status, i) => ({ flow: ['browse_test.md', 'checkout_test.md'][i], status, ...(status === 'failed' ? { message: 'The order route remains blank, so `Thanks` cannot be verified.' } : {}) }));
const RUN = {
  project: 'margin <paper> goods',
  agent: 'Claude Code',
  branch: 'upkeep/2026-11-19-1500',
  flows: ['flows/browse_test.md', 'flows/checkout_test.md'],
  url: 'http://localhost:4173',
  checks: 6,
  seconds: 660,
  credits: 91.18,
  plan: [
    { name: 'axios', from: '1.2.0', to: '1.21.1', kind: 'minor' },
    { name: 'date-fns', from: '1.30.1', to: '4.4.0', kind: 'major' },
    { name: 'nanoid', from: '2.1.11', to: '6.0.2', kind: 'major' },
    { name: 'js-cookie', from: '2.2.1', to: '3.0.8', kind: 'major' },
  ],
  skipped: [],
};
const LEDGER = [
  { type: 'check', number: 1, speed: 'full', units: [], outcome: 'pass', summary: '2 of 2 flows passed', seconds: 70, credits: 7.7, flows: flows('passed', 'passed') },
  { type: 'check', number: 2, speed: 'quick', units: ['axios'], outcome: 'pass', summary: '2 of 2 flows passed', seconds: 60, credits: 7.9, flows: flows('passed', 'passed') },
  { type: 'landed', units: ['axios'], commit: '3f29c04aaaa', fixed: false },
  { type: 'check', number: 3, speed: 'quick', upTo: 'build', units: ['date-fns'], outcome: 'pass', summary: 'got past build; not checked further', seconds: 4 },
  { type: 'check', number: 4, speed: 'full', units: ['nanoid'], outcome: 'fail', stage: 'build', summary: 'build failed: "default" is not exported by "node_modules/nanoid/index.browser.js"', seconds: 1 },
  { type: 'agent', units: ['nanoid'], round: 1, ok: true, changed: ['src/orders.js'], undone: [], reply: 'Changed the default import to `{ nanoid }`.' },
  { type: 'check', number: 5, speed: 'full', units: ['nanoid'], outcome: 'pass', summary: '2 of 2 flows passed', seconds: 60, credits: 7.9, flows: flows('passed', 'passed') },
  { type: 'landed', units: ['nanoid'], commit: '8f7299abbbb', fixed: true, rounds: 1 },
  { type: 'check', number: 6, speed: 'full', units: ['date-fns'], outcome: 'fail', stage: 'kane', summary: '1 of 2 flows failed: checkout_test.md', seconds: 299, credits: 45, flows: flows('passed', 'failed') },
  { type: 'agent', units: ['date-fns'], round: 1, ok: true, changed: ['src/pages/Order.jsx'], undone: ['edited flows/checkout_test.md'], reply: 'Renamed the tokens.' },
  { type: 'check', number: 7, speed: 'full', units: ['date-fns'], outcome: 'pass', summary: '2 of 2 flows passed', seconds: 136, credits: 21, flows: flows('passed', 'passed') },
  { type: 'landed', units: ['date-fns'], commit: '9e4a06fcccc', fixed: true, rounds: 1 },
  { type: 'check', number: 8, speed: 'full', units: ['js-cookie'], outcome: 'fail', stage: 'kane', summary: '2 of 2 flows failed', seconds: 250, credits: 40, flows: flows('failed', 'failed') },
  { type: 'blocked', units: ['js-cookie'], reason: 'still failing after 3 rounds with the agent', stage: 'kane', summary: '2 of 2 flows failed', rounds: 3 },
];
const SHOTS = new Map([
  ['check-6-checkout', Buffer.from('blank page')],
  ['check-7-checkout', Buffer.from('thanks page')],
]);

const html = renderHtml(RUN, LEDGER, { screenshots: SHOTS });

test('one self-contained document: nothing fetched, nothing run', () => {
  assert.match(html, /^<!doctype html>/);
  assert.ok(!/<script|<link|src="http|url\(/.test(html));
  assert.match(html, /<meta name="viewport"/);
});

test('text from the run is escaped', () => {
  assert.match(html, /<h1>margin &lt;paper&gt; goods<\/h1>/);
  assert.ok(!html.includes('<paper>'));
});

test('the opening sentence counts packages and names the agent', () => {
  assert.match(html, /<b>4 packages<\/b> were behind\./);
  assert.match(html, /<b>3<\/b> are upgraded, each one after Kane CLI walked the app in a real browser and it passed\./);
  assert.match(html, /<b>2 upgrades<\/b> broke the app first and were fixed by Claude Code\./);
  assert.match(html, /<b>1<\/b> is held back\./);
});

test('a fix shows Kane’s words, the change, the proof, and before and after screenshots', () => {
  const section = html.slice(html.indexOf('date-fns <span'), html.indexOf('<h2>Held back</h2>'));
  assert.match(section, /The order route remains blank, so <code>Thanks<\/code> cannot be verified\./);
  assert.match(section, /checkout_test\.md · check 6/);
  assert.match(section, /<code>src\/pages\/Order\.jsx<\/code>/);
  assert.match(section, /Kane CLI passed 2 of 2 flows .*check 7 · commit 9e4a06f/);
  assert.match(section, /In round 1 the agent edited flows\/checkout_test\.md\./);
  assert.ok(section.includes(`data:image/jpeg;base64,${Buffer.from('blank page').toString('base64')}`));
  assert.ok(section.includes(`data:image/jpeg;base64,${Buffer.from('thanks page').toString('base64')}`));
});

test('a build failure is shown as a build failure, with no screenshot', () => {
  const section = html.slice(html.indexOf('nanoid <span'), html.indexOf('date-fns <span'));
  assert.match(section, /The build failed: <span class="mono">&quot;default&quot; is not exported by/);
  assert.ok(!section.includes('<figure>'));
});

test('a held-back upgrade says why', () => {
  const section = html.slice(html.indexOf('<h2>Held back</h2>'), html.indexOf('<h2>Upgraded as they are</h2>'));
  assert.match(section, /js-cookie/);
  assert.match(section, /still failing after 3 rounds with the agent/);
  assert.match(section, /class="verdict stamp held">held back/);
});

test('every check is in the log, with search steps marked', () => {
  assert.equal((html.match(/<td class="num">/g) ?? []).length, 8);
  assert.match(html, /<tr class="search"><td class="num">3<\/td>/);
  assert.match(html, /<span class="stamp fail">fail at build<\/span>/);
  assert.equal((html.match(/<i class="pass"/g) ?? []).length, 4);
  assert.equal((html.match(/<i class="fail"/g) ?? []).length, 3);
});
