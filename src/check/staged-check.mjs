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
 * @param {object} [input.stages]      replacements for the real stage runners, for tests
 * @param {(event: object) => void} [input.onStage]
 * @returns {Promise<Verdict>}
 */
export async function stagedCheck({ cwd, config, heal = true, upTo = 'kane', stages = {}, onStage = () => {} }) {
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
