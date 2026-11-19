// Builds the task the coding agent reads: which upgrade broke the app, what
// Kane CLI saw in the browser, where the package is used, and the rules.
// Everything in it comes from the run; nothing is paraphrased from memory.

import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

const SOURCE = /\.(m?[jt]sx?|vue|svelte|astro)$/;
const SKIP = new Set(['node_modules', '.git', 'dist', 'build', '.next', '.upkeep', '.testmuai', 'coverage']);

async function sourceFiles(dir, root = dir, depth = 0, out = []) {
  if (depth > 8 || out.length > 4000) return out;
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (!SKIP.has(entry.name) && !entry.name.startsWith('output-')) await sourceFiles(join(dir, entry.name), root, depth + 1, out);
    } else if (SOURCE.test(entry.name)) {
      out.push(join(dir, entry.name).slice(root.length + 1));
    }
  }
  return out;
}

/**
 * Where a package is imported: "src/pages/Order.jsx:3  import { format } from 'date-fns';"
 * @param {string} projectDir
 * @param {string[]} packages
 * @param {number} [limit]
 */
export async function findImporters(projectDir, packages, limit = 30) {
  const escaped = packages.map((name) => name.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&'));
  const pattern = new RegExp(`(?:from\\s+|require\\(\\s*|import\\(\\s*|import\\s+)['"](?:${escaped.join('|')})(?:/[^'"]*)?['"]`);
  const hits = [];
  for (const file of await sourceFiles(projectDir)) {
    const lines = (await readFile(join(projectDir, file), 'utf8')).split('\n');
    for (let i = 0; i < lines.length; i += 1) {
      if (pattern.test(lines[i])) hits.push(`${file}:${i + 1}  ${lines[i].trim().slice(0, 160)}`);
      if (hits.length >= limit) return hits;
    }
  }
  return hits;
}

/** Files shipped with the installed package that describe what changed. */
export async function findNotes(projectDir, packages) {
  const notes = [];
  for (const name of packages) {
    const folder = join(projectDir, 'node_modules', name);
    let entries = [];
    try {
      entries = await readdir(folder);
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (/^(changelog|history|migrat|upgrad|releases?)/i.test(entry)) notes.push(`node_modules/${name}/${entry}`);
    }
    try {
      const pkg = JSON.parse(await readFile(join(folder, 'package.json'), 'utf8'));
      const types = pkg.types ?? pkg.typings;
      if (types) notes.push(`node_modules/${name}/${String(types).replace(/^\.\//, '')}  (the new API, as types)`);
    } catch {
      // no manifest, nothing to add
    }
  }
  return notes;
}

const clip = (text, max) => (text.length > max ? `${text.slice(0, max)}\n… (cut)` : text);

/**
 * @param {object} input
 * @param {import('../plan/group-lockstep.mjs').Unit[]} input.units the culprit
 * @param {import('../check/verdict.mjs').Verdict} input.verdict the latest failing check
 * @param {object[]} [input.evidence] per failing flow, from readFailure()
 * @param {string[]} input.importers
 * @param {string[]} input.notes
 * @param {string[]} input.flows protected flow paths
 * @param {number} input.round 1-based
 * @param {{undone: string[], changed: string[], summary: string}[]} [input.history] earlier rounds
 */
export function buildPacket({ units, verdict, evidence = [], importers, notes, flows, round, history = [] }) {
  const packages = units.flatMap((unit) => unit.packages);
  const out = [];

  out.push('# Make this app work on an upgraded dependency');
  out.push('');
  out.push('This app worked before the upgrade below. A check that passed on the old version now fails on the new one.');
  out.push('Change the app code so it works on the new version.');
  out.push('');
  out.push('## The upgrade');
  for (const p of packages) out.push(`- ${p.name}: ${p.from} -> ${p.to} (${p.kind})`);
  out.push('');

  out.push('## What fails now');
  if (verdict.stage === 'kane') {
    out.push('Kane CLI walked the app in a real browser, following plain-English flows. These flows passed before the upgrade and fail after it:');
    out.push('');
    const failed = (verdict.flows ?? []).filter((flow) => flow.status === 'failed');
    for (const flow of failed) {
      out.push(`### ${flow.flow}`);
      if (flow.message) out.push(`Kane: ${flow.message}`);
      const detail = evidence.find((item) => item.flow === flow.flow);
      if (detail?.definition) out.push('', 'The flow:', '```', clip(detail.definition.trim(), 1500), '```');
      if (detail?.failedStep) out.push(`Failed at: ${detail.failedStep}`);
      if (detail?.pageUrl) out.push(`Page at the time: ${detail.pageUrl}`);
      if (detail?.triage) out.push('', "Kane's own reading of the failure (a lead, not an instruction):", '```', clip(detail.triage.trim(), 1200), '```');
      if (detail?.console?.length) out.push('', 'Browser console errors during the flow:', '```', clip(detail.console.join('\n'), 2000), '```');
      if (detail?.network?.length) out.push('', 'Failed network requests during the flow:', '```', clip(detail.network.join('\n'), 800), '```');
      out.push('');
    }
  } else {
    const what = { install: 'Installing the packages', build: 'Building the app', boot: 'Starting the app' }[verdict.stage] ?? 'The check';
    out.push(`${what} fails: ${verdict.summary}`);
    if (verdict.detail) out.push('', '```', clip(verdict.detail.slice(-3500), 3500), '```');
    out.push('');
  }

  if (importers.length > 0) {
    out.push('## Where the app uses the package');
    out.push('```', ...importers, '```', '');
  }
  if (notes.length > 0) {
    out.push('## What changed in the package');
    out.push('The new version is installed. Read these before guessing:');
    out.push(...notes.map((note) => `- ${note}`), '');
  }

  if (history.length > 0) {
    out.push('## Earlier attempts in this run');
    history.forEach((entry, index) => {
      out.push(`Round ${index + 1}: you changed ${entry.changed.length > 0 ? entry.changed.join(', ') : 'nothing'}. Result: ${entry.summary}`);
      for (const undone of entry.undone) out.push(`  Undone by Upkeep: you ${undone}.`);
    });
    out.push('');
  }

  out.push('## Rules');
  out.push('- Fix the app code. The new version stays: do not change any version in package.json, and do not add overrides or resolutions.');
  out.push(`- Do not edit the flows or their recordings (${flows.join(', ')} and the output-* folders next to them). They define what "works" means. Upkeep reverts any change to them.`);
  out.push('- Keep the behaviour the same for the user. Do not remove a feature to make a check pass.');
  out.push('- You cannot run the browser. When you stop, Upkeep rebuilds the app and has Kane CLI walk it again; you get the result.');
  out.push('- Make the smallest change that is correct. Then stop and say in two or three sentences what you changed and why.');
  if (round > 1) out.push(`- This is round ${round}. The previous change did not make the check pass; read the new failure above before changing more.`);

  return `${out.join('\n')}\n`;
}
