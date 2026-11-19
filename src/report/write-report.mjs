// Turns a run's ledger into a report a reviewer can read in a minute. The same
// text is the body of the pull request. Every line comes from the ledger: what
// was applied, what Kane CLI said, what the agent changed.

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const cell = (text) => String(text ?? '').replace(/\|/g, '\\|').replace(/\s*\n\s*/g, ' ').trim();
const minutes = (seconds) => (seconds < 90 ? `${seconds}s` : `${Math.round(seconds / 60)} min`);

/**
 * @param {object} run    contents of run.json
 * @param {object[]} ledger parsed ledger.ndjson
 * @param {{agentName?: string}} [options]
 * @returns {string} markdown
 */
export function renderReport(run, ledger, options = {}) {
  const byName = new Map(run.plan.map((candidate) => [candidate.name, candidate]));
  const packagesOf = (unitIds) => unitIds.flatMap((id) => id.split('+')).map((name) => byName.get(name)).filter(Boolean);
  const checks = ledger.filter((entry) => entry.type === 'check');
  const landed = ledger.filter((entry) => entry.type === 'landed');
  const blocked = ledger.filter((entry) => entry.type === 'blocked');
  const agentRounds = ledger.filter((entry) => entry.type === 'agent');
  const agentName = options.agentName ?? 'the coding agent';
  const key = (ids) => [...ids].sort().join(',');

  // The check that proved a landed set: the last passing check on exactly that set before it landed.
  const proofOf = (entry) => {
    const index = ledger.indexOf(entry);
    for (let i = index - 1; i >= 0; i -= 1) {
      const candidate = ledger[i];
      if (candidate.type === 'check' && candidate.outcome === 'pass' && !candidate.upTo && key(candidate.units) === key(entry.units)) return candidate;
    }
    return null;
  };
  // The failing check that named a culprit: the last failing check on exactly that set.
  const failureOf = (unitIds, before) => {
    for (let i = before - 1; i >= 0; i -= 1) {
      const candidate = ledger[i];
      if (candidate.type === 'check' && candidate.outcome === 'fail' && key(candidate.units) === key(unitIds)) return candidate;
    }
    return null;
  };
  const kaneLine = (check) => {
    if (!check?.flows) return check ? `check ${check.number}` : 'checked';
    const passed = check.flows.filter((flow) => flow.status === 'passed').length;
    return `Kane CLI ${passed}/${check.flows.length} flows, check ${check.number}`;
  };

  const plain = landed.filter((entry) => !entry.fixed);
  const fixed = landed.filter((entry) => entry.fixed);
  const count = (entries) => entries.reduce((sum, entry) => sum + packagesOf(entry.units).length, 0);

  const out = [];
  out.push(`# Upkeep report: ${run.project}`);
  out.push('');
  const headline = [`${plural(run.plan.length, 'package')} behind`];
  headline.push(`${count(landed)} upgraded and verified`);
  if (fixed.length > 0) headline.push(`${count(fixed)} of those needed a fix`);
  if (blocked.length > 0) headline.push(`${count(blocked)} held back`);
  out.push(`**${headline.join(' · ')}**`);
  out.push('');
  const facts = [`Branch \`${run.branch}\``, plural(run.checks, 'check'), minutes(run.seconds)];
  if (run.credits !== null && run.credits !== undefined) facts.push(`${run.credits} Kane credits`);
  out.push(`${facts.join(' · ')}. Every check is install, build, boot, then Kane CLI walking ${plural(run.flows.length, 'flow')} in a real browser at ${run.url}.`);
  out.push('');

  if (plain.length > 0) {
    out.push('## Upgraded as they are');
    out.push('');
    out.push('| Package | From | To | Jump | Verified by |');
    out.push('|---|---|---|---|---|');
    for (const entry of plain) {
      const proof = kaneLine(proofOf(entry));
      for (const p of packagesOf(entry.units)) out.push(`| ${cell(p.name)} | ${p.from} | ${p.to} | ${p.kind} | ${proof}${entry.commit ? `, commit \`${entry.commit.slice(0, 7)}\`` : ''} |`);
    }
    out.push('');
  }

  if (fixed.length > 0) {
    out.push('## Upgraded with a fix');
    out.push('');
    out.push(`These upgrades broke the app. Kane CLI caught it, ${agentName} changed the app, and Kane CLI passed every flow again before the upgrade was committed.`);
    out.push('');
    for (const entry of fixed) {
      const index = ledger.indexOf(entry);
      const packages = packagesOf(entry.units);
      const failure = failureOf(entry.units, index);
      const rounds = agentRounds.filter((round) => key(round.units) === key(entry.units));
      const last = rounds.at(-1);
      out.push(`### ${packages.map((p) => `${p.name} ${p.from} → ${p.to}`).join(', ')}`);
      out.push('');
      if (failure) out.push(`- **What broke** (check ${failure.number}, at ${failure.stage}): ${cell(failure.summary)}`);
      out.push(`- **The fix** (${plural(entry.rounds ?? rounds.length, 'round')}): ${last?.changed?.length ? last.changed.map((file) => `\`${file}\``).join(', ') : 'see the commit'}`);
      if (last?.reply) out.push(`- **In the agent's words:** ${cell(last.reply)}`);
      for (const round of rounds) for (const undone of round.undone ?? []) out.push(`- **Undone by Upkeep** in round ${round.round}: the agent ${cell(undone)}`);
      out.push(`- **Verified:** ${kaneLine(proofOf(entry))}${entry.commit ? `, commit \`${entry.commit.slice(0, 7)}\`` : ''}`);
      out.push('');
    }
  }

  if (blocked.length > 0) {
    out.push('## Held back');
    out.push('');
    out.push('Not on the branch. The app does not pass its flows with these, and no fix was verified.');
    out.push('');
    for (const entry of blocked) {
      const packages = packagesOf(entry.units);
      out.push(`### ${packages.map((p) => `${p.name} ${p.from} → ${p.to}`).join(', ')}`);
      out.push('');
      out.push(`- **What breaks** (at ${entry.stage}): ${cell(entry.summary)}`);
      out.push(`- **Why it was held back:** ${cell(entry.reason)}${entry.rounds ? ` (${plural(entry.rounds, 'round')} with the agent)` : ''}`);
      out.push('');
    }
  }

  if (run.skipped?.length > 0) {
    out.push('## Left alone');
    out.push('');
    for (const skipped of run.skipped) out.push(`- ${skipped.name}: ${skipped.reason}`);
    out.push('');
  }

  out.push('## Every check');
  out.push('');
  out.push('| # | Applied | Result | Time | Credits |');
  out.push('|---|---|---|---|---|');
  for (const check of checks) {
    const applied = check.units.length === 0 ? 'nothing (the app as it is)' : check.units.length > 4 ? `${plural(check.units.length, 'unit')}: ${check.units.slice(0, 3).join(', ')}, …` : check.units.join(', ');
    const healed = check.outcome === 'pass' && check.policy?.healed > 0 ? ` Kane healed ${plural(check.policy.healed, 'flow')}: the page changed.` : '';
    const result = check.upTo ? `${cell(check.summary)} (search step, stopped after ${check.upTo})` : check.outcome === 'pass' ? `pass: ${cell(check.summary)}.${healed}` : check.outcome === 'fail' ? `**fail at ${check.stage}**: ${cell(check.summary)}` : `could not check: ${cell(check.summary)}`;
    out.push(`| ${check.number} | ${cell(applied)} | ${result} | ${check.seconds ?? ''}s | ${check.credits ?? ''} |`);
  }
  out.push('');
  out.push('Kane CLI evidence packs for each check are in the run folder next to this report.');
  return `${out.join('\n')}\n`;
}
