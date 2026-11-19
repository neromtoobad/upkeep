// Makes a copy of a run that is safe to publish.
//
// A run folder holds Kane evidence packs, and packs name the account that made
// them (email, user name, a share link). So the packs themselves are never
// copied. What is copied: the report, the ledger, the tasks and replies between
// Upkeep and the agent, and one screenshot per flow per check, taken from the
// packs. Home folder paths and anything shaped like an email are removed.

import { mkdir, readFile, readdir, writeFile, access } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, join } from 'node:path';
import { listZip, readZipEntry } from '../kane/zip.mjs';
import { renderHtml } from './write-html.mjs';

const exists = (path) => access(path).then(() => true, () => false);

/** Remove what should not leave the machine from a piece of text. */
export function scrub(text, home = homedir()) {
  return text
    .replaceAll(home, '~')
    .replace(/\/(?:Users|home)\/[^/\s"']+/g, '~')
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g, (match) => (match.endsWith('@example.com') || /@(\d|v\d)/.test(match) ? match : '<email>'));
}

/**
 * The screenshot that shows how a flow ended in a pack: the last step of its
 * final attempt. For a failed flow that is the state Kane gave up on (the
 * step holding Kane's failure record is often the click before it, taken while
 * the page still looked fine).
 * @returns {{bytes: Buffer, failed: boolean} | null}
 */
export function flowScreenshot(zip, entries, stem) {
  const prefix = `tests/${stem}-`;
  const shots = entries.filter((e) => e.name.startsWith(prefix) && /\/steps\/\d+-[^/]+\/screenshot\.(jpg|png)$/.test(e.name));
  if (shots.length === 0) return null;
  const failed = entries.some((e) => e.name.startsWith(prefix) && /\/steps\/\d+-[^/]+\/failure\.yaml$/.test(e.name));
  const ordinal = (e) => Number(/\/steps\/(\d+)-/.exec(e.name)[1]);
  // A pack can hold more than one attempt of a flow; the top-level one is the final attempt.
  const depth = (e) => e.name.split('/').length;
  const shallowest = Math.min(...shots.map(depth));
  const last = shots.filter((e) => depth(e) === shallowest).sort((a, b) => ordinal(b) - ordinal(a))[0];
  return { bytes: readZipEntry(zip, last), failed };
}

/**
 * Kane's screenshot for each flow of each check, from the packs kept in a run folder.
 * @param {string} runDir
 * @param {object[]} ledger
 * @returns {Promise<Map<string, {bytes: Buffer, status: string}>>} keyed "check-<number>-<flow stem>"
 */
export async function readScreenshots(runDir, ledger) {
  const shots = new Map();
  for (const check of ledger.filter((entry) => entry.type === 'check')) {
    for (const packName of check.packs ?? []) {
      const packPath = join(runDir, 'evidence', basename(packName));
      if (!(await exists(packPath))) continue;
      // A pack that is truncated or not a pack costs its screenshots, never the report.
      let zip;
      let entries;
      try {
        zip = await readFile(packPath);
        entries = listZip(zip);
      } catch {
        continue;
      }
      for (const flow of check.flows ?? []) {
        const stem = flow.flow.replace(/_test\.md$/, '');
        const id = `check-${check.number}-${stem}`;
        if (shots.has(id)) continue;
        let shot = null;
        try {
          shot = flowScreenshot(zip, entries, stem);
        } catch {
          shot = null;
        }
        if (shot) shots.set(id, { bytes: shot.bytes, status: flow.status });
      }
    }
  }
  return shots;
}

/** The HTML report for a run folder, with Kane's screenshots embedded. */
export async function renderRunHtml(runDir, { run, ledger, agentName } = {}) {
  const runRecord = run ?? JSON.parse(await readFile(join(runDir, 'run.json'), 'utf8'));
  const entries = ledger ?? (await readFile(join(runDir, 'ledger.ndjson'), 'utf8')).split('\n').filter(Boolean).map((line) => JSON.parse(line));
  const shots = await readScreenshots(runDir, entries);
  return renderHtml(runRecord, entries, { agentName, screenshots: new Map([...shots].map(([id, shot]) => [id, shot.bytes])) });
}

/**
 * @param {string} runDir a folder under .upkeep/runs/
 * @param {string} outDir where the publishable copy goes
 * @returns {Promise<{files: string[]}>}
 */
export async function exportRun(runDir, outDir) {
  const files = [];
  await mkdir(outDir, { recursive: true });
  const put = async (name, content) => {
    await mkdir(join(outDir, name, '..'), { recursive: true });
    await writeFile(join(outDir, name), content);
    files.push(name);
  };

  for (const name of ['report.md', 'run.json', 'ledger.ndjson']) {
    if (await exists(join(runDir, name))) await put(name, scrub(await readFile(join(runDir, name), 'utf8')));
  }

  // What Upkeep asked the agent and what it answered, per culprit and round.
  const agentDir = join(runDir, 'agent');
  if (await exists(agentDir)) {
    for (const culprit of await readdir(agentDir)) {
      for (const file of await readdir(join(agentDir, culprit))) {
        if (/^round-\d+-(task|reply)\.md$/.test(file)) await put(join('agent', culprit, file), scrub(await readFile(join(agentDir, culprit, file), 'utf8')));
      }
    }
  }

  // One screenshot per flow per check, named by check number, and the HTML
  // report rebuilt from the scrubbed text so it carries no local paths.
  if (await exists(join(runDir, 'ledger.ndjson'))) {
    const ledger = scrub(await readFile(join(runDir, 'ledger.ndjson'), 'utf8')).split('\n').filter(Boolean).map((line) => JSON.parse(line));
    const shots = await readScreenshots(runDir, ledger);
    for (const [id, shot] of shots) {
      const [, number, ...rest] = id.split('-');
      await put(join('screenshots', `check-${number.padStart(2, '0')}-${rest.join('-')}-${shot.status}.jpg`), shot.bytes);
    }
    if (await exists(join(runDir, 'run.json'))) {
      const run = JSON.parse(scrub(await readFile(join(runDir, 'run.json'), 'utf8')));
      await put('report.html', renderHtml(run, ledger, { screenshots: new Map([...shots].map(([id, shot]) => [id, shot.bytes])) }));
    }
  }

  return { files };
}
