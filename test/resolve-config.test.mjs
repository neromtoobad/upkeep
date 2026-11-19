import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveConfig, flowUrl, detectCommands, findFlows } from '../src/config/resolve-config.mjs';

async function project(files) {
  const dir = await mkdtemp(join(tmpdir(), 'upkeep-config-'));
  for (const [path, text] of Object.entries(files)) {
    await mkdir(join(dir, path, '..'), { recursive: true });
    await writeFile(join(dir, path), typeof text === 'string' ? text : JSON.stringify(text));
  }
  return { dir, cleanup: () => rm(dir, { recursive: true, force: true }) };
}

const flow = (url) => `---\nurl: ${url}\ntags: [upkeep]\n---\n\n# A flow\n\n## Step\nOpen the page. Verify it loads.\n`;
const VITE = { name: 'shop', scripts: { build: 'vite build', dev: 'vite' }, devDependencies: { vite: '^4.0.0' } };

test('flowUrl reads the url from a flow header only', () => {
  assert.equal(flowUrl(flow('http://localhost:4173')), 'http://localhost:4173');
  assert.equal(flowUrl('---\nurl: "localhost:3000/app"\n---\n'), 'https://localhost:3000/app');
  assert.equal(flowUrl('# no header\nurl: http://localhost:1\n'), null);
  assert.equal(flowUrl('---\nmode: testing\n---\nurl: http://localhost:1\n'), null);
});

test('detectCommands serves a production build when it can', () => {
  assert.deepEqual(detectCommands(VITE, 4173), { build: 'npm run build', serve: 'npx vite preview --port 4173 --strictPort' });
  assert.deepEqual(detectCommands({ scripts: { build: 'next build' }, dependencies: { next: '15.0.0' } }, 3000), { build: 'npm run build', serve: 'npx next start -p 3000' });
  assert.deepEqual(detectCommands({ scripts: { start: 'node server.js' } }, 3000), { build: null, serve: 'npm start' });
  assert.deepEqual(detectCommands({ scripts: {} }, 3000), { build: null, serve: null });
});

test('zero config: flows are found, and the app is served where they point', async () => {
  const { dir, cleanup } = await project({
    'package.json': VITE,
    'flows/browse_test.md': flow('http://localhost:4173'),
    'flows/checkout_test.md': flow('http://localhost:4173/'),
    'flows/output-browse/Result.md': 'a recording, not a flow',
    'flows/helpers/login.md': 'a helper, not a flow',
    'node_modules/pkg/x_test.md': flow('http://localhost:1'),
  });
  try {
    const config = await resolveConfig(dir);
    assert.deepEqual(config.flows, ['flows/browse_test.md', 'flows/checkout_test.md']);
    assert.equal(config.url, 'http://localhost:4173');
    assert.equal(config.port, 4173);
    assert.equal(config.build, 'npm run build');
    assert.equal(config.serve, 'npx vite preview --port 4173 --strictPort');
    assert.equal(config.install, 'npm install --no-audit --no-fund');
    assert.deepEqual(config.source, { flows: 'found in the project', url: 'the flows', serve: 'detected' });
  } finally {
    await cleanup();
  }
});

test('upkeep.config.json overrides what was detected', async () => {
  const { dir, cleanup } = await project({
    'package.json': VITE,
    'checks/home_test.md': flow('http://localhost:4173'),
    'upkeep.config.json': { flows: ['checks/home_test.md'], url: 'http://localhost:8080', serve: 'node server.js', build: null, parallel: 1, readyTimeoutSeconds: 10 },
  });
  try {
    const config = await resolveConfig(dir);
    assert.deepEqual(config.flows, ['checks/home_test.md']);
    assert.equal(config.url, 'http://localhost:8080');
    assert.equal(config.serve, 'node server.js');
    assert.equal(config.build, null);
    assert.equal(config.parallel, 1);
    assert.equal(config.readyTimeoutMs, 10_000);
  } finally {
    await cleanup();
  }
});

test('each thing that cannot be worked out has an error that says what to do', async () => {
  const cases = [
    [{ 'package.json': VITE }, /no Kane flows found\. Add at least one \*_test\.md under flows\//],
    [{ 'package.json': VITE, 'flows/a_test.md': '# no header\n\n## Step\nDo it.\n' }, /have no `url:` in their header/],
    [{ 'package.json': VITE, 'flows/a_test.md': flow('http://localhost:4173'), 'flows/b_test.md': flow('http://localhost:3000') }, /point at different addresses/],
    [{ 'package.json': VITE, 'flows/a_test.md': flow('https://shop.example.com') }, /is not this machine/],
    [{ 'package.json': { name: 'x' }, 'flows/a_test.md': flow('http://localhost:3000') }, /could not tell how to serve this app/],
    [{ 'flows/a_test.md': flow('http://localhost:3000') }, /no package\.json in/],
  ];
  for (const [files, message] of cases) {
    const { dir, cleanup } = await project(files);
    try {
      await assert.rejects(resolveConfig(dir), message);
    } finally {
      await cleanup();
    }
  }
});

test('findFlows returns nothing for a folder that does not exist', async () => {
  assert.deepEqual(await findFlows(join(tmpdir(), 'upkeep-does-not-exist')), []);
});
