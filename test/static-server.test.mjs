import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, writeFile, rm, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { serveStatic, fileFor } from '../src/check/static-server.mjs';
import { detectCommands } from '../src/config/resolve-config.mjs';
import { answers } from '../src/check/serve-app.mjs';

const BIN = fileURLToPath(new URL('../bin/upkeep.mjs', import.meta.url));

async function built() {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'upkeep-static-')));
  await mkdir(join(dir, 'build/static/js'), { recursive: true });
  await writeFile(join(dir, 'build/index.html'), '<!doctype html><div id="root"></div>');
  await writeFile(join(dir, 'build/static/js/main.js'), 'console.log(1)');
  await writeFile(join(dir, 'secret.txt'), 'outside the build');
  return { dir, root: join(dir, 'build'), cleanup: () => rm(dir, { recursive: true, force: true }) };
}

async function freePort() {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  await new Promise((resolve) => server.close(resolve));
  return port;
}

test('fileFor: files, folders, app routes, and nothing outside the root', async () => {
  const { root, cleanup } = await built();
  try {
    assert.equal(await fileFor(root, '/'), join(root, 'index.html'));
    assert.equal(await fileFor(root, '/static/js/main.js?v=2'), join(root, 'static/js/main.js'));
    assert.equal(await fileFor(root, '/orders/42'), join(root, 'index.html'), 'a client-side route gets the app');
    assert.equal(await fileFor(root, '/static/js/missing.js'), null, 'a missing asset is a 404, not the app');
    assert.equal(await fileFor(root, '/../secret.txt'), null);
    assert.equal(await fileFor(root, '/%2e%2e/secret.txt'), null);
    assert.equal(await fileFor(root, '/%E0%A4%A'), null, 'a path that cannot be decoded');
  } finally {
    await cleanup();
  }
});

test('serveStatic answers on localhost with the right types, and only for the built folder', async () => {
  const { root, cleanup } = await built();
  const port = await freePort();
  const server = await serveStatic(root, port);
  try {
    assert.ok(server.addresses.includes('127.0.0.1'));
    const page = await fetch(`http://127.0.0.1:${port}/checkout`);
    assert.equal(page.status, 200);
    assert.match(page.headers.get('content-type'), /text\/html/);
    assert.match(await page.text(), /id="root"/);
    const script = await fetch(`http://127.0.0.1:${port}/static/js/main.js`);
    assert.match(script.headers.get('content-type'), /text\/javascript/);
    assert.equal((await fetch(`http://127.0.0.1:${port}/static/js/nope.js`)).status, 404);
    assert.equal((await fetch(`http://127.0.0.1:${port}/`, { method: 'POST' })).status, 404);
  } finally {
    await server.close();
    await cleanup();
  }
  assert.equal(await answers(`http://127.0.0.1:${port}/`), false, 'closed means closed');
});

test('serveStatic says so when the folder is missing or the port is taken', async () => {
  await assert.rejects(serveStatic(join(tmpdir(), 'upkeep-no-build-here'), 1), /is not a folder\. Has the app been built\?/);
  const { root, cleanup } = await built();
  const blocker = createServer();
  await new Promise((resolve) => blocker.listen(0, '127.0.0.1', resolve));
  try {
    await assert.rejects(serveStatic(root, blocker.address().port), /already in use/);
  } finally {
    await new Promise((resolve) => blocker.close(resolve));
    await cleanup();
  }
});

test('the static command serves until stopped', async () => {
  const { dir, cleanup } = await built();
  const port = await freePort();
  const child = spawn(process.execPath, [BIN, 'static', 'build', '--port', String(port), '--cwd', dir], { stdio: ['ignore', 'pipe', 'inherit'] });
  try {
    await new Promise((resolve) => child.stdout.once('data', resolve));
    assert.equal((await fetch(`http://localhost:${port}/`)).status, 200, 'reachable as localhost, however that resolves');
  } finally {
    child.kill();
    await new Promise((resolve) => child.on('close', resolve));
    await cleanup();
  }
});

test('a Create React App project is built and served from build/ with no config', () => {
  const commands = detectCommands({ scripts: { build: 'react-scripts build', start: 'react-scripts start' }, dependencies: { 'react-scripts': '5.0.1' } }, 4317);
  assert.equal(commands.build, 'npm run build');
  assert.match(commands.serve, /upkeep\.mjs" static build --port 4317$/);
});
