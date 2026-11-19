// Serves a built app (a folder of static files) on this machine only, for
// projects that have a build but no preview command of their own, such as
// Create React App. Unknown paths without a file extension get index.html, so
// client-side routes work.

import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve, sep } from 'node:path';

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.wasm': 'application/wasm',
  '.webmanifest': 'application/manifest+json',
};

/** Which file answers a request path, or null for "not found". Never leaves the root. */
export async function fileFor(root, urlPath) {
  let decoded;
  try {
    decoded = decodeURIComponent(urlPath.split('?')[0].split('#')[0]);
  } catch {
    return null;
  }
  const full = resolve(root, `.${normalize(`/${decoded}`)}`);
  if (full !== root && !full.startsWith(root + sep)) return null;

  const isFile = async (path) => {
    try {
      return (await stat(path)).isFile();
    } catch {
      return false;
    }
  };
  if (await isFile(full)) return full;
  if (await isFile(join(full, 'index.html'))) return join(full, 'index.html');
  // A route of the single-page app, not a missing asset.
  if (extname(decoded) === '' && (await isFile(join(root, 'index.html')))) return join(root, 'index.html');
  return null;
}

/**
 * @param {string} dir the built folder
 * @param {number} port
 * @returns {Promise<{close: () => Promise<void>, addresses: string[]}>}
 */
export async function serveStatic(dir, port) {
  const root = resolve(dir);
  if (!(await stat(root).then((s) => s.isDirectory(), () => false))) throw new Error(`${root} is not a folder. Has the app been built?`);

  const handle = async (request, response) => {
    const file = request.method === 'GET' || request.method === 'HEAD' ? await fileFor(root, request.url ?? '/') : null;
    if (!file) {
      response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      response.end('Not found\n');
      return;
    }
    const body = await readFile(file);
    response.writeHead(200, { 'content-type': TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream', 'content-length': body.length, 'cache-control': 'no-store' });
    response.end(request.method === 'HEAD' ? undefined : body);
  };

  // Loopback only, on both families, so "localhost" works whichever way it resolves
  // and the build is not offered to the rest of the network.
  const servers = [];
  const addresses = [];
  for (const host of ['127.0.0.1', '::1']) {
    const server = createServer((request, response) => {
      handle(request, response).catch(() => {
        if (!response.headersSent) response.writeHead(500);
        response.end();
      });
    });
    try {
      await new Promise((ready, failed) => {
        server.once('error', failed);
        server.listen(port, host, ready);
      });
      servers.push(server);
      addresses.push(host);
    } catch (error) {
      // No IPv6 on this machine is fine; anything else on IPv4 is not.
      if (host === '127.0.0.1') throw new Error(error.code === 'EADDRINUSE' ? `port ${port} is already in use` : error.message);
    }
  }
  return {
    addresses,
    close: () => Promise.all(servers.map((server) => new Promise((done) => server.close(done)))).then(() => {}),
  };
}
