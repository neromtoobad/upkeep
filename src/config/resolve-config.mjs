// Works out how to install, build and serve a project, and which Kane flows
// to walk, with no configuration for the common cases. An optional
// upkeep.config.json overrides any of it.
//
// The address comes from the flows themselves: Kane flows carry `url:` in
// their header, so Upkeep serves the app where the flows already point.

import { readFile, readdir } from 'node:fs/promises';
import { join, relative } from 'node:path';

const FLOW_FOLDERS = ['flows', 'tests', 'e2e', 'test', '.testmuai/tests'];
const SKIP = new Set(['node_modules', '.git', 'dist', 'build', '.next', '.upkeep', 'coverage']);

const readJson = async (path) => {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw new Error(`could not read ${path}: ${error.message}`);
  }
};

/** Every *_test.md under a folder, skipping Kane's recordings and build output. */
export async function findFlows(dir, root = dir, depth = 0) {
  if (depth > 6) return [];
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const found = [];
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (SKIP.has(entry.name) || entry.name.startsWith('output-')) continue;
      found.push(...(await findFlows(join(dir, entry.name), root, depth + 1)));
    } else if (entry.name.endsWith('_test.md')) {
      found.push(relative(root, join(dir, entry.name)));
    }
  }
  return found.sort();
}

/** The `url:` in a flow's header, or null. */
export function flowUrl(text) {
  const header = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text)?.[1];
  const match = header ? /^url:\s*["']?([^\s"']+)["']?\s*$/m.exec(header) : null;
  if (!match) return null;
  return /^https?:\/\//.test(match[1]) ? match[1] : `https://${match[1]}`;
}

/** How to build and serve, from what the project depends on. */
export function detectCommands(pkg, port) {
  const scripts = pkg.scripts ?? {};
  const deps = { ...pkg.dependencies, ...pkg.devDependencies };
  const build = scripts.build ? 'npm run build' : null;

  if (deps.vite && build) return { build, serve: `npx vite preview --port ${port} --strictPort` };
  if (deps.next && build) return { build, serve: `npx next start -p ${port}` };
  if (deps.astro && build) return { build, serve: `npx astro preview --port ${port}` };
  if (deps.vite) return { build: null, serve: `npx vite --port ${port} --strictPort` };
  // Anything else: the project's own start or dev script, told the port the usual way.
  if (scripts.start) return { build, serve: 'npm start' };
  if (scripts.dev) return { build: null, serve: 'npm run dev' };
  return { build, serve: null };
}

/**
 * @param {string} projectDir
 * @returns {Promise<{install: string, build: string|null, serve: string, url: string, port: number,
 *   flows: string[], parallel: number, readyTimeoutMs: number, source: Record<string, string>}>}
 */
export async function resolveConfig(projectDir) {
  const pkg = await readJson(join(projectDir, 'package.json'));
  if (!pkg) throw new Error(`no package.json in ${projectDir}`);
  const file = (await readJson(join(projectDir, 'upkeep.config.json'))) ?? {};
  const source = {};

  let flows = file.flows;
  if (flows) {
    source.flows = 'upkeep.config.json';
  } else {
    for (const folder of FLOW_FOLDERS) {
      flows = (await findFlows(join(projectDir, folder), projectDir));
      if (flows.length > 0) break;
    }
    source.flows = 'found in the project';
  }
  if (!flows || flows.length === 0) {
    throw new Error(
      'no Kane flows found. Add at least one *_test.md under flows/ that walks something your users do, ' +
        'with `url: http://localhost:<port>` in its header. See https://github.com/LambdaTest/kane-cli#readme',
    );
  }

  let url = file.url;
  if (url) {
    source.url = 'upkeep.config.json';
  } else {
    const urls = new Set();
    for (const flow of flows) {
      const found = flowUrl(await readFile(join(projectDir, flow), 'utf8'));
      if (found) urls.add(new URL(found).origin);
    }
    if (urls.size > 1) throw new Error(`the flows point at different addresses (${[...urls].join(', ')}). Upkeep serves one app; set "url" in upkeep.config.json.`);
    if (urls.size === 0) throw new Error('the flows have no `url:` in their header, so Upkeep cannot tell where to serve the app. Add one, or set "url" in upkeep.config.json.');
    [url] = urls;
    source.url = 'the flows';
  }

  const parsed = new URL(url);
  if (!['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname)) {
    throw new Error(`the flows point at ${parsed.origin}, which is not this machine. Upkeep checks the upgraded code it serves locally.`);
  }
  const port = Number(parsed.port || (parsed.protocol === 'https:' ? 443 : 80));

  const detected = detectCommands(pkg, port);
  const serve = file.serve ?? detected.serve;
  source.serve = file.serve ? 'upkeep.config.json' : 'detected';
  if (!serve) throw new Error('could not tell how to serve this app. Set "serve" in upkeep.config.json to the command that starts it.');

  return {
    install: file.install ?? 'npm install --no-audit --no-fund',
    build: file.build === undefined ? detected.build : file.build,
    serve,
    url: parsed.origin,
    port,
    flows,
    parallel: file.parallel ?? 3,
    readyTimeoutMs: (file.readyTimeoutSeconds ?? 90) * 1000,
    source,
  };
}
