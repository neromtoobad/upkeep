// Builds the upgrade plan for a project on disk and renders it for a person.

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { planFromOutdated, readOutdated } from './outdated.mjs';
import { groupLockstep } from './group-lockstep.mjs';
import { peerLinks, readCurrentPeers, readNextPeers } from './peer-links.mjs';

/**
 * @param {string} cwd project folder holding package.json
 * @param {{target?: 'latest'|'wanted', only?: string[], exclude?: string[]}} [options]
 */
export async function makePlan(cwd, options = {}) {
  let pkg;
  try {
    pkg = JSON.parse(await readFile(join(cwd, 'package.json'), 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') throw new Error(`no package.json in ${cwd}`);
    throw new Error(`could not read package.json in ${cwd}: ${error.message}`);
  }
  const outdated = await readOutdated(cwd);
  // Plan everything first and narrow afterwards: --only and --exclude choose
  // whole units, because half of a unit cannot be installed.
  const everything = planFromOutdated(outdated, pkg, { target: options.target });
  // Which upgrades need each other? One registry question per package.
  let links = { pairs: [], reasons: [] };
  if (everything.candidates.length > 1 && options.peers !== false) {
    links = peerLinks(everything.candidates, {
      current: await readCurrentPeers(cwd, everything.candidates.map((c) => c.name)),
      next: await readNextPeers(everything.candidates, { cwd }),
    });
  }
  const narrowed = narrowUnits(groupLockstep(everything.candidates, links.pairs), options);
  const kept = new Set(narrowed.units.flatMap((unit) => unit.packages.map((p) => p.name)));
  return {
    project: pkg.name ?? '(unnamed)',
    target: options.target ?? 'latest',
    candidates: everything.candidates.filter((c) => kept.has(c.name)),
    units: narrowed.units,
    skipped: [...everything.skipped, ...narrowed.skipped].sort((a, b) => (a.name < b.name ? -1 : 1)),
    together: links.reasons.filter((reason) => [...kept].some((name) => reason.startsWith(`${name} `))),
    notes: narrowed.notes,
  };
}

/**
 * Apply --only and --exclude to units.
 * - only: a unit is taken when any of its packages was asked for; its partners come along, and that is said.
 * - exclude: a unit is left alone when any of its packages is excluded; its partners stay behind, and that is said.
 * @param {import('./group-lockstep.mjs').Unit[]} units
 * @param {{only?: string[], exclude?: string[]}} options
 */
export function narrowUnits(units, options = {}) {
  const only = options.only?.length ? new Set(options.only) : null;
  const exclude = new Set(options.exclude ?? []);
  const notes = [];
  const skipped = [];
  const names = (unit) => unit.packages.map((p) => p.name);

  if (only) {
    const behind = new Set(units.flatMap(names));
    const unknown = [...only].filter((name) => !behind.has(name));
    if (unknown.length > 0) throw new Error(`--only names ${unknown.join(', ')}, which ${unknown.length === 1 ? 'is' : 'are'} not behind (or not a direct dependency with a plain version). Run "upkeep plan" to see what is.`);
  }

  const taken = [];
  for (const unit of units) {
    const members = names(unit);
    if (only && !members.some((name) => only.has(name))) continue;
    const excluded = members.filter((name) => exclude.has(name));
    if (excluded.length > 0) {
      for (const name of members) skipped.push({ name, reason: exclude.has(name) ? 'excluded by you' : `must move together with ${excluded.join(', ')}, which you excluded` });
      continue;
    }
    if (only) {
      const partners = members.filter((name) => !only.has(name));
      if (partners.length > 0) notes.push(`${partners.join(', ')} ${partners.length === 1 ? 'comes' : 'come'} along: ${members.filter((name) => only.has(name)).join(', ')} cannot be upgraded without ${partners.length === 1 ? 'it' : 'them'}`);
    }
    taken.push(unit);
  }
  return { units: taken, skipped, notes };
}

/** @param {Awaited<ReturnType<typeof makePlan>>} plan */
export function renderPlan(plan) {
  const lines = [`Upkeep plan for ${plan.project}`, ''];
  const count = plan.candidates.length;

  if (count === 0) {
    lines.push('  Every direct dependency is up to date. Nothing to do.');
  } else {
    const together = plan.units.length === count ? '' : `, moved as ${plan.units.length} unit${plan.units.length === 1 ? '' : 's'} (some must go together)`;
    lines.push(`  ${count} package${count === 1 ? ' is' : 's are'} behind${together}.`, '');

    const width = Math.max(...plan.candidates.map((c) => c.name.length));
    const versions = Math.max(...plan.candidates.map((c) => `${c.from} → ${c.to}`.length));
    const partner = new Map();
    for (const unit of plan.units) {
      if (unit.packages.length < 2) continue;
      for (const member of unit.packages) {
        partner.set(member.name, unit.packages.filter((p) => p !== member).map((p) => p.name));
      }
    }
    const row = (c) => {
      const notes = [c.kind];
      if (c.section === 'devDependencies') notes.push('dev');
      if (partner.has(c.name)) notes.push(`with ${partner.get(c.name).join(', ')}`);
      return `    ${c.name.padEnd(width)}  ${`${c.from} → ${c.to}`.padEnd(versions)}  ${notes.join(' · ')}`;
    };

    const risky = plan.candidates.filter((c) => c.breaking);
    const safe = plan.candidates.filter((c) => !c.breaking);
    if (risky.length > 0) lines.push('  May break the app (new major, or a 0.x minor)', ...risky.map(row), '');
    if (safe.length > 0) lines.push('  Should be compatible', ...safe.map(row), '');
  }

  if (plan.notes?.length > 0) {
    lines.push('  Note', ...plan.notes.map((note) => `    ${note}`), '');
  }

  if (plan.together?.length > 0) {
    lines.push('  Why some move together', ...plan.together.map((reason) => `    ${reason}`), '');
  }

  if (plan.skipped.length > 0) {
    const width = Math.max(...plan.skipped.map((s) => s.name.length));
    lines.push('  Left alone', ...plan.skipped.map((s) => `    ${s.name.padEnd(width)}  ${s.reason}`), '');
  }

  return `${lines.join('\n').trimEnd()}\n`;
}
