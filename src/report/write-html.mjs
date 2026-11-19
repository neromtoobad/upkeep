// The same report as report.md, as one HTML file that opens offline: no
// scripts, no fonts or images fetched, screenshots embedded. Laid out as a
// service record: a ruled log of checks, and for every upgrade that broke the
// app, what Kane saw before and after.

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const esc = (text) => String(text ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
/** Escaped, with `backticked` words set as code (agents and Kane both write them). */
const prose = (text) => esc(text).replace(/`([^`\n]+)`/g, '<code>$1</code>');
const sentenceCase = (text) => text.charAt(0).toUpperCase() + text.slice(1);
const minutes = (seconds) => (seconds < 90 ? `${seconds} s` : `${Math.round(seconds / 60)} min`);
const key = (ids) => [...ids].sort().join(',');
const stem = (flow) => flow.replace(/_test\.md$/, '');

const STYLE = `
:root { --page:#faf9f6; --ink:#16150f; --soft:#6b6860; --line:rgba(22,21,15,.12); --pass:#1d6b43; --fail:#a5371f; --held:#8a6410; --step:#9a978d; }
* { box-sizing: border-box; }
body { margin:0; background:var(--page); color:var(--ink); font:15px/1.6 ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif; -webkit-font-smoothing:antialiased; }
main { max-width:920px; margin:0 auto; padding:56px 24px 96px; }
.label { font:11px/1.4 ui-monospace,"SF Mono",Menlo,Consolas,monospace; letter-spacing:.06em; text-transform:uppercase; color:var(--soft); }
h1 { font-size:34px; line-height:1.1; letter-spacing:-.02em; font-weight:600; margin:10px 0 18px; }
h2 { font-size:20px; letter-spacing:-.01em; font-weight:600; margin:64px 0 6px; }
h3 { font-size:16px; font-weight:600; margin:0 0 2px; }
p { margin:0 0 12px; }
.lede { font-size:19px; line-height:1.45; max-width:34em; }
.lede b { font-weight:600; }
.soft { color:var(--soft); }
code, .mono { font:13px/1.5 ui-monospace,"SF Mono",Menlo,Consolas,monospace; }
.facts { display:flex; flex-wrap:wrap; gap:10px 36px; margin:28px 0 0; padding:18px 0; border-top:1px solid var(--line); border-bottom:1px solid var(--line); }
.facts div b { display:block; font-weight:500; font-size:15px; }
.strip { display:flex; flex-wrap:wrap; gap:3px; margin:18px 0 6px; }
.strip i { width:14px; height:26px; border-radius:2px; background:var(--step); opacity:.45; }
.strip i.pass { background:var(--pass); opacity:1; } .strip i.fail { background:var(--fail); opacity:1; } .strip i.error { background:var(--held); opacity:1; }
.case { border-top:1px solid var(--line); padding:26px 0 8px; }
.case .verdict { float:right; }
.stamp { display:inline-block; font:11px/1 ui-monospace,"SF Mono",Menlo,Consolas,monospace; letter-spacing:.06em; text-transform:uppercase; padding:5px 7px 4px; border:1px solid currentColor; border-radius:3px; }
.stamp.pass { color:var(--pass); } .stamp.fail { color:var(--fail); } .stamp.held { color:var(--held); } .stamp.step { color:var(--step); }
dl { display:grid; grid-template-columns:150px 1fr; gap:8px 20px; margin:14px 0 18px; }
dt { color:var(--soft); } dd { margin:0; }
blockquote { margin:0; padding-left:14px; border-left:2px solid var(--line); }
.shots { display:grid; grid-template-columns:1fr 1fr; gap:16px; margin:6px 0 22px; }
.shots.one { grid-template-columns:1fr; max-width:55%; }
figure { margin:0; }
/* Kane's screenshots are 1920 wide with the app in the middle: show the middle half at twice the size. */
.frame { overflow:hidden; aspect-ratio:16/10; border:1px solid var(--line); border-radius:3px; background:#fff; }
.frame img { display:block; width:200%; max-width:none; margin-left:-50%; }
figcaption { margin-top:8px; font-size:13.5px; color:var(--soft); }
figcaption b { color:var(--ink); font-weight:500; }
table { width:100%; border-collapse:collapse; margin:12px 0 0; font-size:14px; }
th { text-align:left; font:11px/1.4 ui-monospace,"SF Mono",Menlo,Consolas,monospace; letter-spacing:.06em; text-transform:uppercase; color:var(--soft); font-weight:400; padding:8px 12px 8px 0; border-bottom:1px solid var(--line); }
td { padding:9px 12px 9px 0; border-bottom:1px solid var(--line); vertical-align:top; }
td.n, th.n { text-align:right; padding-right:0; font-variant-numeric:tabular-nums; white-space:nowrap; }
td.num, th.num { width:34px; color:var(--soft); font-variant-numeric:tabular-nums; }
td.n + td.n, th.n + th.n { padding-left:18px; }
tr.search td { color:var(--soft); }
footer { margin-top:72px; padding-top:18px; border-top:1px solid var(--line); font-size:13.5px; color:var(--soft); }
@media (max-width:640px) { main { padding:32px 16px 64px; } h1 { font-size:27px; } .lede { font-size:17px; } .shots, .shots.one { grid-template-columns:1fr; max-width:none; } dl { grid-template-columns:1fr; gap:2px 0; } dd { margin-bottom:10px; } .case .verdict { float:none; display:block; margin-bottom:10px; } table { font-size:13px; } }
`;

/**
 * @param {object} run    contents of run.json
 * @param {object[]} ledger parsed ledger.ndjson
 * @param {{agentName?: string, screenshots?: Map<string, Buffer>}} [options]
 *   screenshots are keyed "check-<number>-<flow stem>", as jpeg bytes
 * @returns {string} a complete HTML document
 */
export function renderHtml(run, ledger, options = {}) {
  const shots = options.screenshots ?? new Map();
  const agentName = options.agentName ?? run.agent ?? 'the coding agent';
  const byName = new Map(run.plan.map((candidate) => [candidate.name, candidate]));
  const packagesOf = (unitIds) => unitIds.flatMap((id) => id.split('+')).map((name) => byName.get(name)).filter(Boolean);
  const checks = ledger.filter((entry) => entry.type === 'check');
  const landed = ledger.filter((entry) => entry.type === 'landed');
  const blocked = ledger.filter((entry) => entry.type === 'blocked');
  const rounds = ledger.filter((entry) => entry.type === 'agent');
  const count = (entries) => entries.reduce((sum, entry) => sum + packagesOf(entry.units).length, 0);
  const before = (entry) => ledger.slice(0, ledger.indexOf(entry));
  const proofOf = (entry) => before(entry).findLast((e) => e.type === 'check' && e.outcome === 'pass' && !e.upTo && key(e.units) === key(entry.units));
  const blameOf = (entry) => before(entry).findLast((e) => e.type === 'check' && e.outcome === 'fail' && (e.speed ?? 'full') === 'full' && key(e.units) === key(entry.units));
  const img = (check, flow) => {
    const bytes = check ? shots.get(`check-${check.number}-${stem(flow)}`) : null;
    return bytes ? `data:image/jpeg;base64,${bytes.toString('base64')}` : null;
  };
  const kaneWords = (check, flow) => check?.flows?.find((f) => f.flow === flow)?.message;
  const title = (packages) => packages.map((p) => `${esc(p.name)} <span class="soft">${esc(p.from)} → ${esc(p.to)}</span>`).join(', ');

  const fixed = landed.filter((entry) => entry.fixed);
  const plain = landed.filter((entry) => !entry.fixed);

  const sentence = [`<b>${plural(run.plan.length, 'package')}</b> ${run.plan.length === 1 ? 'was' : 'were'} behind.`];
  sentence.push(`<b>${count(landed)}</b> ${count(landed) === 1 ? 'is' : 'are'} upgraded, each one after Kane CLI walked the app in a real browser and it passed.`);
  if (fixed.length > 0) sentence.push(`<b>${count(fixed)}</b> of those broke the app first and ${count(fixed) === 1 ? 'was' : 'were'} fixed by ${esc(agentName)}.`);
  if (blocked.length > 0) sentence.push(`<b>${count(blocked)}</b> ${count(blocked) === 1 ? 'is' : 'are'} held back.`);

  const out = [];
  out.push(`<p class="label">Upkeep report</p>`);
  out.push(`<h1>${esc(run.project)}</h1>`);
  out.push(`<p class="lede">${sentence.join(' ')}</p>`);
  out.push('<div class="facts">');
  out.push(`<div><span class="label">Branch</span><b class="mono">${esc(run.branch)}</b></div>`);
  out.push(`<div><span class="label">Checks</span><b>${run.checks}</b></div>`);
  out.push(`<div><span class="label">Time</span><b>${minutes(run.seconds)}</b></div>`);
  if (run.credits !== null && run.credits !== undefined) out.push(`<div><span class="label">Kane credits</span><b>${run.credits}</b></div>`);
  out.push(`<div><span class="label">Flows walked</span><b>${run.flows.length} at ${esc(run.url)}</b></div>`);
  out.push('</div>');
  out.push(`<div class="strip" aria-hidden="true">${checks.map((c) => `<i class="${c.upTo ? '' : c.outcome}" title="check ${c.number}"></i>`).join('')}</div>`);
  out.push(`<p class="soft" style="font-size:13.5px">One mark per check, in order. Green passed, red failed, grey is a step of the search that stopped early on purpose.</p>`);

  const caseBlock = (entry, kind) => {
    const packages = packagesOf(entry.units);
    const blame = blameOf(entry);
    const proof = kind === 'fixed' ? proofOf(entry) : null;
    const mine = rounds.filter((round) => key(round.units) === key(entry.units));
    const last = mine.at(-1);
    const flows = blame?.stage === 'kane' ? (blame.flows ?? []).filter((flow) => flow.status === 'failed').map((flow) => flow.flow) : [];
    const block = ['<section class="case">'];
    block.push(`<span class="verdict stamp ${kind === 'fixed' ? 'pass' : 'held'}">${kind === 'fixed' ? 'fixed and verified' : 'held back'}</span>`);
    block.push(`<h3>${title(packages)}</h3>`);
    block.push('<dl>');
    if (blame) {
      const where = { install: 'Installing the packages failed', build: 'The build failed', boot: 'The app did not start', kane: 'Kane CLI, in the browser' }[blame.stage] ?? 'The check failed';
      const words = blame.stage === 'kane' ? flows.map((flow) => `<blockquote>${prose(kaneWords(blame, flow) ?? blame.summary)}<br><span class="soft mono">${esc(flow)} · check ${blame.number}</span></blockquote>`).join('') : `<span class="mono">${esc(String(blame.summary).replace(/^(build|install) failed: /, ''))}</span> <span class="soft mono">· check ${blame.number}</span>`;
      block.push(`<dt>What broke</dt><dd>${blame.stage === 'kane' ? '' : `${where}: `}${words}</dd>`);
    }
    if (kind === 'fixed') {
      block.push(`<dt>The fix</dt><dd>${last?.changed?.length ? last.changed.map((file) => `<code>${esc(file)}</code>`).join(', ') : 'see the commit'} <span class="soft">· ${plural(entry.rounds ?? mine.length, 'round')} with ${esc(agentName)}</span></dd>`);
      if (last?.reply) block.push(`<dt>In its words</dt><dd><blockquote>${prose(last.reply)}</blockquote></dd>`);
      if (proof) block.push(`<dt>Verified</dt><dd>Kane CLI passed ${proof.flows?.filter((f) => f.status === 'passed').length ?? ''} of ${proof.flows?.length ?? ''} flows <span class="soft mono">· check ${proof.number}${entry.commit ? ` · commit ${esc(entry.commit.slice(0, 7))}` : ''}</span></dd>`);
    } else {
      block.push(`<dt>Why held back</dt><dd>${esc(entry.reason)}${entry.rounds ? ` <span class="soft">· ${plural(entry.rounds, 'round')} with ${esc(agentName)}</span>` : ''}</dd>`);
    }
    for (const round of mine) for (const undone of round.undone ?? []) block.push(`<dt>Undone by Upkeep</dt><dd>In round ${round.round} the agent ${esc(undone)}.</dd>`);
    block.push('</dl>');

    // Kane's own screenshots: one flow is enough to show it.
    const flow = flows.find((f) => img(blame, f));
    if (flow) {
      const after = proof ? img(proof, flow) : null;
      block.push(`<div class="shots${after ? '' : ' one'}">`);
      block.push(`<figure><div class="frame"><img alt="What Kane CLI saw after the upgrade" src="${img(blame, flow)}"></div><figcaption><b>After the upgrade.</b> Where Kane's walk of ${esc(flow)} ended.</figcaption></figure>`);
      if (after) block.push(`<figure><div class="frame"><img alt="What Kane CLI saw after the fix" src="${after}"></div><figcaption><b>After the fix.</b> The same flow, at its last step.</figcaption></figure>`);
      block.push('</div>');
    }
    block.push('</section>');
    return block.join('\n');
  };

  if (fixed.length > 0) {
    out.push('<h2>Broke the app, fixed, verified</h2>');
    out.push(`<p class="soft">Kane CLI caught each of these. ${esc(sentenceCase(agentName))} changed the app. Kane walked it again and every flow passed before anything was committed.</p>`);
    out.push(...fixed.map((entry) => caseBlock(entry, 'fixed')));
  }
  if (blocked.length > 0) {
    out.push('<h2>Held back</h2>');
    out.push('<p class="soft">Not on the branch. The app does not pass its flows with these, and no fix was verified.</p>');
    out.push(...blocked.map((entry) => caseBlock(entry, 'held')));
  }
  if (plain.length > 0) {
    out.push('<h2>Upgraded as they are</h2>');
    out.push('<table><thead><tr><th>Package</th><th>From</th><th>To</th><th>Jump</th><th>Verified by</th></tr></thead><tbody>');
    for (const entry of plain) {
      const proof = proofOf(entry);
      const by = proof ? `Kane CLI ${proof.flows?.filter((f) => f.status === 'passed').length ?? ''}/${proof.flows?.length ?? ''} flows, check ${proof.number}` : 'checked';
      for (const p of packagesOf(entry.units)) out.push(`<tr><td class="mono">${esc(p.name)}</td><td class="mono">${esc(p.from)}</td><td class="mono">${esc(p.to)}</td><td>${esc(p.kind)}</td><td>${esc(by)}${entry.commit ? ` <span class="soft mono">· ${esc(entry.commit.slice(0, 7))}</span>` : ''}</td></tr>`);
    }
    out.push('</tbody></table>');
  }

  out.push('<h2>Every check</h2>');
  out.push('<p class="soft">Each one installs, builds and boots the app, then Kane CLI walks the flows. It stops at the first stage that fails.</p>');
  out.push('<table><thead><tr><th class="num">#</th><th>Applied</th><th>Result</th><th class="n">Time</th><th class="n">Credits</th></tr></thead><tbody>');
  for (const check of checks) {
    const applied = check.units.length === 0 ? 'nothing: the app as it is' : check.units.join(', ');
    let result;
    if (check.upTo) result = `<span class="stamp step">search step</span> ${esc(check.summary)}`;
    else if (check.outcome === 'pass') result = `<span class="stamp pass">pass</span> ${esc(check.summary)}`;
    else if (check.outcome === 'fail') result = `<span class="stamp fail">fail at ${esc(check.stage)}</span> ${esc(String(check.summary).replace(/\/(?:Users|home)\/\S*?\/work\//g, ''))}`;
    else result = `<span class="stamp held">could not check</span> ${esc(check.summary)}`;
    out.push(`<tr${check.upTo ? ' class="search"' : ''}><td class="num">${check.number}</td><td class="mono">${esc(applied)}${check.speed === 'quick' && !check.upTo ? ' <span class="soft">(quick)</span>' : ''}</td><td>${result}</td><td class="n">${check.seconds ?? ''} s</td><td class="n">${check.credits ?? '–'}</td></tr>`);
  }
  out.push('</tbody></table>');

  if (run.skipped?.length > 0) {
    out.push('<h2>Left alone</h2>');
    out.push(`<table><tbody>${run.skipped.map((s) => `<tr><td class="mono">${esc(s.name)}</td><td>${esc(s.reason)}</td></tr>`).join('')}</tbody></table>`);
  }

  out.push(`<footer>Written by Upkeep from the run's ledger. Screenshots are Kane CLI's own, taken from its evidence packs. A quick check replays recorded steps and stops at the first mismatch; nothing is blamed or held back without a full check, in which Kane first tries to heal the step.</footer>`);

  return `<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n<title>Upkeep report: ${esc(run.project)}</title>\n<style>${STYLE}</style>\n</head>\n<body>\n<main>\n${out.join('\n')}\n</main>\n</body>\n</html>\n`;
}
