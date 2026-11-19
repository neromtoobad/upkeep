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

const exists = (path) => access(path).then(() => true, () => false);

/** Remove what should not leave the machine from a piece of text. */
export function scrub(text, home = homedir()) {
  return text
    .replaceAll(home, '~')
    .replace(/\/(?:Users|home)\/[^/\s"']+/g, '~')
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g, (match) => (match.endsWith('@example.com') || /@(\d|v\d)/.test(match) ? match : '<email>'));
}

/**
 * The screenshot that best shows how a flow ended in a pack: the step with
 * Kane's failure record when there is one, otherwise the last step.
 * @returns {{bytes: Buffer, failed: boolean} | null}
 */
export function flowScreenshot(zip, entries, stem) {
  const prefix = `tests/${stem}-`;
  const shots = entries.filter((e) => e.name.startsWith(prefix) && /\/steps\/\d+-[^/]+\/screenshot\.(jpg|png)$/.test(e.name));
  if (shots.length === 0) return null;
  const record = entries.find((e) => e.name.startsWith(prefix) && /\/steps\/\d+-[^/]+\/failure\.yaml$/.test(e.name));
  if (record) {
    const folder = record.name.slice(0, -'failure.yaml'.length);
    const shot = shots.find((e) => e.name.startsWith(folder));
    if (shot) return { bytes: readZipEntry(zip, shot), failed: true };
  }
  const ordinal = (e) => Number(/\/steps\/(\d+)-/.exec(e.name)[1]);
  // A pack can hold more than one attempt of a flow; the top-level one is the final attempt.
  const depth = (e) => e.name.split('/').length;
  const shallowest = Math.min(...shots.map(depth));
  const last = shots.filter((e) => depth(e) === shallowest).sort((a, b) => ordinal(b) - ordinal(a))[0];
  return { bytes: readZipEntry(zip, last), failed: false };
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

  // One screenshot per flow per check, named by check number.
  if (await exists(join(runDir, 'ledger.ndjson'))) {
    const ledger = (await readFile(join(runDir, 'ledger.ndjson'), 'utf8')).split('\n').filter(Boolean).map((line) => JSON.parse(line));
    for (const check of ledger.filter((entry) => entry.type === 'check')) {
      for (const packName of check.packs ?? []) {
        const packPath = join(runDir, 'evidence', basename(packName));
        if (!(await exists(packPath))) continue;
        const zip = await readFile(packPath);
        const entries = listZip(zip);
        for (const flow of check.flows ?? []) {
          const stem = flow.flow.replace(/_test\.md$/, '');
          const shot = flowScreenshot(zip, entries, stem);
          if (!shot) continue;
          const name = join('screenshots', `check-${String(check.number).padStart(2, '0')}-${stem}-${flow.status}.jpg`);
          if (!files.includes(name)) await put(name, shot.bytes);
        }
      }
    }
  }

  return { files };
}
