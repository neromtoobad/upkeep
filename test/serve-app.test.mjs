import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { serveApp, answers, AddressInUse } from '../src/check/serve-app.mjs';
import { runCommand } from '../src/check/run-command.mjs';

async function freePort() {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  await new Promise((resolve) => server.close(resolve));
  return port;
}

async function tinyApp() {
  const dir = await mkdtemp(join(tmpdir(), 'upkeep-serve-'));
  await writeFile(
    join(dir, 'server.mjs'),
    `import { createServer } from 'node:http';
     createServer((req, res) => res.end('hello')).listen(Number(process.env.PORT), '127.0.0.1', () => console.log('listening'));`,
  );
  return dir;
}

test('runCommand returns the exit code and the end of the output', async () => {
  const ok = await runCommand('echo building && echo done', { cwd: tmpdir() });
  assert.equal(ok.code, 0);
  assert.equal(ok.output, 'building\ndone');

  const bad = await runCommand('echo "ERESOLVE could not resolve" >&2; exit 3', { cwd: tmpdir() });
  assert.equal(bad.code, 3);
  assert.match(bad.output, /ERESOLVE/);
});

test('runCommand stops a command that runs past its timeout, children included', async () => {
  const started = Date.now();
  const result = await runCommand('sleep 30 & sleep 30', { cwd: tmpdir(), timeoutMs: 300 });
  assert.equal(result.timedOut, true);
  assert.ok(Date.now() - started < 5000);
});

test('serveApp boots a server, reports ready, and stop really frees the address', async () => {
  const dir = await tinyApp();
  const port = await freePort();
  const url = `http://127.0.0.1:${port}/`;
  try {
    const app = await serveApp('node server.mjs', { cwd: dir, url, env: { PORT: String(port) } });
    assert.equal(app.ok, true);
    assert.equal(await (await fetch(url)).text(), 'hello');
    assert.match(app.output(), /listening/);
    await app.stop();
    assert.equal(await answers(url), false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('serveApp reports a server that dies on boot, with its output', async () => {
  const port = await freePort();
  const result = await serveApp('echo "Error: Cannot find module vite" >&2; exit 1', {
    cwd: tmpdir(),
    url: `http://127.0.0.1:${port}/`,
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'exited');
  assert.match(result.output, /Cannot find module vite/);
});

test('serveApp gives up on a server that never answers and stops it', async () => {
  const port = await freePort();
  const result = await serveApp('sleep 30', { cwd: tmpdir(), url: `http://127.0.0.1:${port}/`, readyTimeoutMs: 600 });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'timeout');
});

test('serveApp refuses to start when something already answers there', async () => {
  const server = createServer((req, res) => res.end('someone else'));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}/`;
  try {
    await assert.rejects(serveApp('sleep 30', { cwd: tmpdir(), url }), (error) => error instanceof AddressInUse);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
