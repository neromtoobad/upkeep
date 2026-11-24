// One check of the app with a given set of upgrades applied:
//
//   install → build → boot → Kane CLI walks the flows
//
// The stages run cheapest first and stop at the first failure, so an upgrade
// that cannot even be installed or built costs no browser time and no Kane
// credits.

import { runCommand } from './run-command.mjs';
import { serveApp, AddressInUse } from './serve-app.mjs';
import { runKaneSuite, readCredits } from '../kane/run-suite.mjs';

/** @typedef {import('./verdict.mjs').Verdict} Verdict */

// npm failed for a reason that has nothing to do with which versions were
// asked for: the registry was unreachable or refused us, or the disk or
// permissions got in the way. Nothing can be concluded about the packages.
const NETWORK = /\b(ENOTFOUND|EAI_AGAIN|ETIMEDOUT|ECONNRESET|ECONNREFUSED|ENETUNREACH|ERR_SOCKET_TIMEOUT|E401|E403|E5\d\d|ENOSPC|EACCES|EPERM|EROFS|EMFILE)\b|network request .* failed/i;

/** The lines of an npm failure that say what is wrong. */
export function npmReason(output) {
  const lines = output.split('\n').map((line) => line.replace(/^npm (error|ERR!)\s?/, '').trim());
  const conflict = lines.findIndex((line) => /^code ERESOLVE/.test(line));
  if (conflict !== -1) {
    const peer = lines.find((line) => /^peer /.test(line) || /Could not resolve dependency/.test(line));
    const found = lines.find((line) => /^Found: /.test(line));
    return ['packages disagree about a shared dependency', found, peer].filter(Boolean).join(' · ');
  }
  const coded = lines.find((line) => /^code E[A-Z0-9_]+/.test(line));
  const first = lines.find((line) => line && !/^code /.test(line) && !/^(A complete log|For a full report)/.test(line));
  return [coded, first].filter(Boolean).join(' · ') || 'npm install failed';
}

const packageName = (spec) => /^((?:@[^/\s]+\/)?[^@\s]+)@/.exec(spec.trim())?.[1];

/**
 * The packages an npm peer conflict (ERESOLVE) is about: the one being resolved,
 * the version found, the dependency that could not be met and who asked for it.
 * The long "Found:" chain of who-depends-on-whom is left out; it names half the tree.
 * @returns {{names: Set<string>, need: string|null, found: string|null}}
 */
export function conflictPackages(output) {
  const lines = output.split('\n').map((line) => line.replace(/^npm (error|ERR!)\s?/, '').trim());
  const names = new Set();
  let need = null;
  let found = null;
  const add = (spec) => {
    const name = spec && packageName(spec);
    if (name) names.add(name);
  };
  lines.forEach((line, index) => {
    let match;
    if ((match = /^While resolving: (\S+)/.exec(line))) add(match[1]);
    if ((match = /^Found: (\S+)/.exec(line))) {
      add(match[1]);
      found ??= match[1];
    }
    if ((match = /^Conflicting peer dependency: (\S+)/.exec(line))) add(match[1]);
    if (/^Could not resolve dependency:?$/.test(line)) {
      const next = lines.slice(index + 1).find(Boolean) ?? '';
      const dependency = /^(?:(?:dev|optional|peer|peerOptional)\s+)*(\S+@"[^"]*"|\S+@\S+)\s+from\s+(.+)$/.exec(next);
      if (dependency) {
        add(dependency[1]);
        if (dependency[2] !== 'the root project') add(dependency[2]);
        need ??= next;
      }
    }
  });
  return { names, need, found };
}

/** The first line of a build failure that names an error. */
export function buildReason(output) {
  const lines = output.split('\n').map((line) => line.trim()).filter(Boolean);
  const telling = /error|is not exported|cannot find|could not resolve|failed to/i;
  // "error during build:" announces the error; the line after it is the error.
  const announcement = /^(error during build|build failed( with \d+ errors?)?|error):?$/i;
  const index = lines.findIndex((line) => telling.test(line));
  if (index === -1) return lines.at(-1) ?? 'the build failed';
  if (announcement.test(lines[index]) && lines[index + 1]) return lines[index + 1].replace(/^(RollupError|Error):\s*/, '');
  return lines[index];
}

/**
 * @param {object} input
 * @param {string} input.cwd           project folder (in the worktree)
 * @param {object} input.config        from resolveConfig()
 * @param {boolean} [input.heal]       let Kane heal a recorded step that no longer matches (default true)
 * @param {'install'|'build'|'boot'|'kane'} [input.upTo]
 *   stop after this stage. While isolating a failure at the build, a set that
 *   builds has answered the question; walking it in the browser would be waste.
 *   A check stopped early passes only that question and is never used to land anything.
 * @param {string[]} [input.changing] names of the packages this check upgrades. An npm peer
 *   conflict that names none of them was already in the project, so it says nothing about them.
 * @param {object} [input.stages]      replacements for the real stage runners, for tests
 * @param {(event: object) => void} [input.onStage]
 * @returns {Promise<Verdict>}
 */
export async function stagedCheck({ cwd, config, heal = true, upTo = 'kane', changing, stages = {}, onStage = () => {} }) {
  const started = Date.now();
  const run = stages.runCommand ?? runCommand;
  const serve = stages.serveApp ?? serveApp;
  const kane = stages.runKaneSuite ?? runKaneSuite;
  const credits = stages.readCredits ?? readCredits;
  // Tools print absolute paths into the worktree; a reader wants paths in their project.
  const local = (text) => (typeof text === 'string' ? text.replaceAll(`${cwd}/`, '').replaceAll(cwd, '.') : text);
  const finish = (verdict) => ({ ...verdict, summary: local(verdict.summary), ...(verdict.detail ? { detail: local(verdict.detail) } : {}), seconds: Math.round((Date.now() - started) / 1000) });
  const stoppedAfter = (stage) => finish({ outcome: 'pass', partial: true, summary: `got past ${stage}; not checked further` });

  onStage({ stage: 'install' });
  const install = await run(config.install, { cwd, timeoutMs: 20 * 60_000 });
  if (install.code !== 0) {
    if (install.timedOut || NETWORK.test(install.output)) {
      return finish({ outcome: 'error', stage: 'install', summary: `npm could not install for a reason unrelated to the versions (registry, disk, permissions or a timeout): ${npmReason(install.output)}`, detail: install.output });
    }
    if (changing && /code ERESOLVE/.test(install.output)) {
      const conflict = conflictPackages(install.output);
      if (conflict.names.size > 0 && !changing.some((name) => conflict.names.has(name))) {
        const what = [conflict.need, conflict.found && `found ${conflict.found}`].filter(Boolean).join('; ');
        return finish({
          outcome: 'error',
          stage: 'install',
          summary:
            `npm refuses to change this project's packages at all (${what}). None of the packages being upgraded is part of that conflict: ` +
            'it was already in the project, hidden by the lockfile. If you install this project with --legacy-peer-deps, put ' +
            '{"install": "npm install --legacy-peer-deps --no-audit --no-fund"} in upkeep.config.json, or fix the conflict first.',
          detail: install.output,
        });
      }
    }
    return finish({ outcome: 'fail', stage: 'install', summary: `install failed: ${npmReason(install.output)}`, detail: install.output });
  }

  if (upTo === 'install') return stoppedAfter('install');

  if (config.build) {
    onStage({ stage: 'build' });
    const build = await run(config.build, { cwd, timeoutMs: 20 * 60_000 });
    if (build.code !== 0) {
      return finish({ outcome: 'fail', stage: 'build', summary: `build failed: ${buildReason(build.output)}`, detail: build.output });
    }
  }

  if (upTo === 'build') return stoppedAfter('build');

  onStage({ stage: 'boot' });
  let app;
  try {
    app = await serve(config.serve, { cwd, url: config.url, env: { PORT: String(config.port) }, readyTimeoutMs: config.readyTimeoutMs });
  } catch (error) {
    if (error instanceof AddressInUse) return finish({ outcome: 'error', stage: 'boot', summary: error.message });
    throw error;
  }
  if (!app.ok) {
    const why = app.reason === 'exited' ? 'the app stopped while starting' : `the app did not answer at ${config.url} in time`;
    return finish({ outcome: 'fail', stage: 'boot', summary: `${why}: ${buildReason(app.output)}`, detail: app.output });
  }

  if (upTo === 'boot') {
    await app.stop();
    return stoppedAfter('boot');
  }

  try {
    onStage({ stage: 'kane' });
    const before = await credits();
    const suite = await kane({ cwd, flows: config.flows, parallel: config.parallel, heal });
    const after = await credits();
    const used = before !== null && after !== null ? Math.max(0, Number((before - after).toFixed(2))) : undefined;
    return finish({
      outcome: suite.outcome,
      ...(suite.outcome === 'pass' ? {} : { stage: 'kane' }),
      failing: suite.failing,
      summary: suite.summary,
      flows: suite.flows,
      packs: suite.packs,
      ...(suite.kaneVersion ? { kaneVersion: suite.kaneVersion } : {}),
      ...(used !== undefined ? { credits: used } : {}),
    });
  } finally {
    await app.stop();
  }
}
