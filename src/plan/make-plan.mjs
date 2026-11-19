// Builds the upgrade plan for a project on disk and renders it for a person.

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { planFromOutdated, readOutdated } from './outdated.mjs';
import { groupLockstep } from './group-lockstep.mjs';

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
  const { candidates, skipped } = planFromOutdated(outdated, pkg, options);
  const units = groupLockstep(candidates);
  return {
    project: pkg.name ?? '(unnamed)',
    target: options.target ?? 'latest',
    candidates,
    units,
    skipped,
  };
}

/** @param {Awaited<ReturnType<typeof makePlan>>} plan */
export function renderPlan(plan) {
  const lines = [`Upkeep plan for ${plan.project}`, ''];
  const count = plan.candidates.length;

  if (count === 0) {
    lines.push('  Every direct dependency is up to date. Nothing to do.');
  } else {
    const together = plan.units.length === count ? '' : `, moved as ${plan.units.length} units (some must go together)`;
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

  if (plan.skipped.length > 0) {
    const width = Math.max(...plan.skipped.map((s) => s.name.length));
    lines.push('  Left alone', ...plan.skipped.map((s) => `    ${s.name.padEnd(width)}  ${s.reason}`), '');
  }

  return `${lines.join('\n').trimEnd()}\n`;
}
