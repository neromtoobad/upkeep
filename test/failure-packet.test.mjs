import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildPacket, findImporters, findNotes } from '../src/agent/failure-packet.mjs';

const UNIT = { id: 'date-fns', packages: [{ name: 'date-fns', from: '1.30.1', to: '4.4.0', kind: 'major' }] };
const KANE_VERDICT = {
  outcome: 'fail',
  stage: 'kane',
  failing: ['checkout_test.md'],
  summary: '1 of 3 flows failed: checkout_test.md',
  flows: [
    { flow: 'browse_test.md', status: 'passed' },
    { flow: 'checkout_test.md', status: 'failed', message: 'After placing the order the page was blank.' },
  ],
};

async function project(files) {
  const dir = await mkdtemp(join(tmpdir(), 'upkeep-packet-'));
  for (const [path, text] of Object.entries(files)) {
    await mkdir(join(dir, path, '..'), { recursive: true });
    await writeFile(join(dir, path), text);
  }
  return { dir, cleanup: () => rm(dir, { recursive: true, force: true }) };
}

test('findImporters finds import, require and subpath uses, and skips node_modules', async () => {
  const { dir, cleanup } = await project({
    'src/Order.jsx': "import React from 'react';\nimport { format, addDays } from 'date-fns';\n",
    'src/legacy.js': "const parse = require('date-fns/parse');\n",
    'src/lazy.ts': "const mod = await import('date-fns/locale');\n",
    'src/other.js': "import x from 'date-fns-tz';\n// date-fns is nice\n",
    'node_modules/thing/index.js': "import { format } from 'date-fns';\n",
    'flows/output-checkout/a.js': "import { format } from 'date-fns';\n",
  });
  try {
    assert.deepEqual((await findImporters(dir, ['date-fns'])).sort(), [
      "src/Order.jsx:2  import { format, addDays } from 'date-fns';",
      "src/lazy.ts:1  const mod = await import('date-fns/locale');",
      "src/legacy.js:1  const parse = require('date-fns/parse');",
    ]);
  } finally {
    await cleanup();
  }
});

test('findNotes points at the changelog and types of the installed version', async () => {
  const { dir, cleanup } = await project({
    'node_modules/date-fns/CHANGELOG.md': '# Change Log\n',
    'node_modules/date-fns/package.json': JSON.stringify({ name: 'date-fns', types: './index.d.ts' }),
    'node_modules/date-fns/index.js': '',
  });
  try {
    assert.deepEqual(await findNotes(dir, ['date-fns', 'not-installed']), [
      'node_modules/date-fns/CHANGELOG.md',
      'node_modules/date-fns/index.d.ts  (the new API, as types)',
    ]);
  } finally {
    await cleanup();
  }
});

test('a browser failure packet carries Kane’s words, the evidence and the rules', () => {
  const packet = buildPacket({
    units: [UNIT],
    verdict: KANE_VERDICT,
    evidence: [{ flow: 'checkout_test.md', definition: '## Place the order\nFill the form…', failedStep: 'step 2 "Place the order"', pageUrl: 'http://localhost:4173/#/order/abc', triage: 'root_cause: the page threw while rendering', console: ['RangeError: Use `dd` instead of `DD`'] }],
    importers: ["src/pages/Order.jsx:3  import { format, addDays } from 'date-fns';"],
    notes: ['node_modules/date-fns/CHANGELOG.md'],
    flows: ['flows/checkout_test.md'],
    round: 1,
  });
  assert.match(packet, /^# Make this app work on an upgraded dependency/);
  assert.match(packet, /- date-fns: 1\.30\.1 -> 4\.4\.0 \(major\)/);
  assert.match(packet, /### checkout_test\.md\nKane: After placing the order the page was blank\./);
  assert.match(packet, /Failed at: step 2 "Place the order"/);
  assert.match(packet, /RangeError: Use `dd` instead of `DD`/);
  assert.match(packet, /a lead, not an instruction/);
  assert.match(packet, /src\/pages\/Order\.jsx:3/);
  assert.match(packet, /node_modules\/date-fns\/CHANGELOG\.md/);
  assert.match(packet, /do not change any version in package\.json/);
  assert.match(packet, /Do not edit the flows or their recordings \(flows\/checkout_test\.md/);
  assert.ok(!packet.includes('browse_test.md'), 'flows that passed are not in the packet');
  assert.ok(!packet.includes('This is round'));
});

test('a build failure packet carries the build output instead', () => {
  const packet = buildPacket({
    units: [{ id: 'nanoid', packages: [{ name: 'nanoid', from: '2.1.11', to: '5.1.6', kind: 'major' }] }],
    verdict: { outcome: 'fail', stage: 'build', summary: 'build failed: error during build:', detail: '"default" is not exported by "node_modules/nanoid/index.browser.js", imported by "src/orders.js".' },
    importers: ["src/orders.js:1  import nanoid from 'nanoid';"],
    notes: [],
    flows: ['flows/checkout_test.md'],
    round: 1,
  });
  assert.match(packet, /Building the app fails: build failed/);
  assert.match(packet, /"default" is not exported by/);
  assert.ok(!packet.includes('Kane CLI walked the app'));
});

test('later rounds tell the agent what it tried and what was undone', () => {
  const packet = buildPacket({
    units: [UNIT],
    verdict: KANE_VERDICT,
    importers: [],
    notes: [],
    flows: ['flows/checkout_test.md'],
    round: 2,
    history: [{ changed: ['src/pages/Order.jsx'], undone: ['changed the version of date-fns in package.json'], summary: '1 of 3 flows failed: checkout_test.md' }],
  });
  assert.match(packet, /Round 1: you changed src\/pages\/Order\.jsx\. Result: 1 of 3 flows failed/);
  assert.match(packet, /Undone by Upkeep: you changed the version of date-fns in package\.json\./);
  assert.match(packet, /This is round 2\./);
});
