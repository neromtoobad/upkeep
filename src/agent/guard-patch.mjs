// The agent is asked to make the app work on the new version. There are two
// ways to cheat: change what "works" means (edit the Kane flows or their
// recordings), or change which version is installed (edit the versions, add an
// override). After every round Upkeep checks for both and puts things back,
// and tells the agent what it undid.
//
// This is a guard against a lazy fix, not a security boundary: the agent runs
// with your permissions in a worktree of your repository.

import { createHash } from 'node:crypto';
import { cp, readFile, readdir, rm, stat, writeFile, mkdir } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { declaredSpecs, formatLike } from '../apply/set-versions.mjs';
import { git } from '../workspace/worktree.mjs';

const PINNED_SECTIONS = ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies'];
const FORBIDDEN_SECTIONS = ['overrides', 'resolutions'];

/** The folder where Kane keeps a flow's recorded steps. */
export const recordingFolder = (flow) => join(dirname(flow), `output-${basename(flow).replace(/_test\.md$/, '')}`);

async function filesUnder(root, relative = '') {
  const here = join(root, relative);
  let info;
  try {
    info = await stat(here);
  } catch {
    return [];
  }
  if (info.isFile()) return [relative];
  const out = [];
  for (const entry of await readdir(here)) out.push(...(await filesUnder(root, join(relative, entry))));
  return out;
}

async function fingerprint(projectDir, paths) {
  const prints = new Map();
  for (const path of paths) {
    for (const file of await filesUnder(projectDir, path)) {
      prints.set(file, createHash('sha256').update(await readFile(join(projectDir, file))).digest('hex'));
    }
  }
  return prints;
}

/**
 * Remember the flows, their recordings and the manifest as they are now,
 * before the agent starts.
 * @param {{projectDir: string, flows: string[], backupDir: string}} input
 */
export async function protect({ projectDir, flows, backupDir }) {
  const paths = [...flows, ...flows.map(recordingFolder), 'upkeep.config.json'];
  await rm(backupDir, { recursive: true, force: true });
  for (const path of paths) {
    try {
      await mkdir(dirname(join(backupDir, path)), { recursive: true });
      await cp(join(projectDir, path), join(backupDir, path), { recursive: true });
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
  return {
    paths,
    backupDir,
    prints: await fingerprint(projectDir, paths),
    manifestText: await readFile(join(projectDir, 'package.json'), 'utf8'),
  };
}

/**
 * What the agent changed in package.json that it may not change.
 * @returns {{restored: Record<string, any>, undone: string[]}}
 */
export function restoreManifest(before, after) {
  const restored = structuredClone(after);
  const undone = [];

  for (const section of PINNED_SECTIONS) {
    for (const [name, spec] of Object.entries(before[section] ?? {})) {
      if (restored[section]?.[name] === spec) continue;
      undone.push(restored[section]?.[name] === undefined ? `removed ${name} from ${section}` : `changed the version of ${name}`);
      restored[section] = { ...restored[section], [name]: spec };
    }
  }
  for (const section of FORBIDDEN_SECTIONS) {
    if (JSON.stringify(before[section]) === JSON.stringify(restored[section])) continue;
    undone.push(`edited ${section}`);
    if (before[section] === undefined) delete restored[section];
    else restored[section] = before[section];
  }
  return { restored, undone };
}

/**
 * Compare with what protect() saw, undo forbidden changes, and list what the
 * agent changed in the app itself.
 * @param {{projectDir: string, guard: Awaited<ReturnType<typeof protect>>}} input
 * @returns {Promise<{changed: string[], undone: string[], addedPackages: string[]}>}
 */
export async function inspectPatch({ projectDir, guard }) {
  const undone = [];

  const now = await fingerprint(projectDir, guard.paths);
  const touched = new Set();
  for (const [file, print] of guard.prints) if (now.get(file) !== print) touched.add(file);
  for (const file of now.keys()) if (!guard.prints.has(file)) touched.add(file);
  if (touched.size > 0) {
    for (const path of guard.paths) {
      await rm(join(projectDir, path), { recursive: true, force: true });
      try {
        await cp(join(guard.backupDir, path), join(projectDir, path), { recursive: true });
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
    }
    for (const file of [...touched].sort()) undone.push(`edited ${file} (the flows and their recordings are the definition of "works")`);
  }

  const manifestNow = await readFile(join(projectDir, 'package.json'), 'utf8');
  let addedPackages = [];
  if (manifestNow !== guard.manifestText) {
    const before = JSON.parse(guard.manifestText);
    let after;
    try {
      after = JSON.parse(manifestNow);
    } catch {
      after = null;
    }
    if (!after) {
      await writeFile(join(projectDir, 'package.json'), guard.manifestText);
      undone.push('left package.json unreadable');
    } else {
      const { restored, undone: manifestUndone } = restoreManifest(before, after);
      if (manifestUndone.length > 0) {
        await writeFile(join(projectDir, 'package.json'), formatLike(guard.manifestText, restored));
        undone.push(...manifestUndone.map((what) => `${what} in package.json`));
      }
      const known = new Set(declaredSpecs(before).map((line) => line.split(' ').slice(0, 2).join(' ')));
      addedPackages = declaredSpecs(restored)
        .map((line) => line.split(' ').slice(0, 2).join(' '))
        .filter((key) => !known.has(key))
        .map((key) => key.split(' ')[1]);
    }
  }

  const tracked = await git(['diff', '--name-only', '--relative', 'HEAD', '--', '.'], projectDir);
  const untracked = await git(['ls-files', '--others', '--exclude-standard', '--', '.'], projectDir);
  const ignore = new Set(['package.json', 'package-lock.json']);
  const changed = [...new Set([...tracked.split('\n'), ...untracked.split('\n')])]
    .filter((file) => file && !ignore.has(file) && !file.startsWith('.testmuai/') && !file.startsWith('.upkeep/'))
    .sort();

  return { changed, undone, addedPackages };
}
