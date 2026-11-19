// `upkeep run`: plan the upgrades, open a worktree, prove the app works today,
// then land upgrades through the loop and leave a branch and a report.

import { cp, mkdir, readFile, writeFile, appendFile, access, copyFile, rm } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { makePlan } from '../plan/make-plan.mjs';
import { resolveConfig } from '../config/resolve-config.mjs';
import { openWorktree, commitAll, discardChanges, git, gitRaw } from '../workspace/worktree.mjs';
import { writeVersions } from '../apply/set-versions.mjs';
import { stagedCheck } from '../check/staged-check.mjs';
import { landUpgrades, CheckUnavailable } from '../loop/land-upgrades.mjs';
import { kaneStatus, readCredits } from '../kane/run-suite.mjs';
import { judgePack, writePolicy } from '../kane/judge-pack.mjs';
import { runCommand } from '../check/run-command.mjs';
import { renderReport } from '../report/write-report.mjs';
import { renderRunHtml } from '../report/export-run.mjs';
import { openPullRequest, PullRequestFailed } from '../report/open-pull-request.mjs';

const exists = (path) => access(path).then(() => true, () => false);
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** Thrown when the run cannot start or must stop; the message is for the person. */
export class RunStopped extends Error {}

/** The run spent what it was allowed to. What has landed stays; the rest is left for another run. */
class BudgetReached extends Error {}

function runStamp(now = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
}

/** Copy installed packages into the worktree so the first install is quick. Clones on APFS. */
async function seedNodeModules(from, to) {
  if (!(await exists(join(from, 'node_modules')))) return false;
  const flags = process.platform === 'darwin' ? '-cR' : '-R --reflink=auto';
  const result = await runCommand(`cp ${flags} node_modules "${join(to, 'node_modules')}"`, { cwd: from, timeoutMs: 5 * 60_000 });
  return result.code === 0;
}

/** Kane keeps a flow's recorded steps in output-<name>/ beside it. Bring along the ones git does not track. */
async function seedRecordings(from, to, flows) {
  let copied = 0;
  for (const flow of flows) {
    const folder = join(dirname(flow), `output-${basename(flow).replace(/_test\.md$/, '')}`);
    if (!(await exists(join(from, folder))) || (await exists(join(to, folder)))) continue;
    await cp(join(from, folder), join(to, folder), { recursive: true });
    copied += 1;
  }
  return copied;
}

const recordingsOf = (flows) => flows.map((flow) => join(dirname(flow), `output-${basename(flow).replace(/_test\.md$/, '')}`));

/**
 * Recordings only move forward on a pass. When a check fails, Kane's heal
 * attempts can leave the recorded steps rewritten against the broken app; the
 * next check would then replay those, or pay to write them again. So the
 * recordings are copied before each check and put back after any check that
 * does not pass.
 */
export async function keepRecordings(projectDir, flows, backupDir) {
  await rm(backupDir, { recursive: true, force: true });
  const kept = [];
  for (const folder of recordingsOf(flows)) {
    if (!(await exists(join(projectDir, folder)))) continue;
    await cp(join(projectDir, folder), join(backupDir, folder), { recursive: true });
    kept.push(folder);
  }
  return {
    restore: async () => {
      for (const folder of recordingsOf(flows)) {
        await rm(join(projectDir, folder), { recursive: true, force: true });
        if (kept.includes(folder)) await cp(join(backupDir, folder), join(projectDir, folder), { recursive: true });
      }
    },
  };
}

function commitMessage(units, verdict, repair) {
  const packages = units.flatMap((unit) => unit.packages);
  const passed = verdict.flows?.filter((flow) => flow.status === 'passed').length;
  const proof = passed !== undefined ? `Kane CLI: ${passed}/${verdict.flows.length} flows passed` : 'checked';
  const lines = packages.map((p) => `- ${p.name} ${p.from} -> ${p.to}`);
  const title = repair
    ? `Bump ${packages.map((p) => p.name).join(', ')} and migrate the app`
    : packages.length === 1
      ? `Bump ${packages[0].name} ${packages[0].from} -> ${packages[0].to}`
      : `Bump ${packages.length} packages`;
  const body = [...lines, '', `Verified by Upkeep. ${proof}.`];
  if (repair) body.push(`The upgrade broke the app; the fix was found in ${plural(repair.rounds ?? 1, 'round')} and re-verified.`);
  return `${title}\n\n${body.join('\n')}`;
}

/**
 * @param {object} input
 * @param {string} input.projectDir
 * @param {{target?: string, only?: string[], exclude?: string[], keepWorktree?: boolean, maxChecksPerSearch?: number}} [input.options]
 * @param {(line: string) => void} [input.say]
 * @param {(units: object[], verdict: object, context: object) => Promise<object>} [input.fix]
 * @param {object} [input.parts] replacements for resolveConfig, makePlan, stagedCheck, kaneStatus, readCredits (tests)
 */
export async function upgradeRun({ projectDir, options = {}, say = (line) => process.stdout.write(`${line}\n`), fix, parts = {} }) {
  const started = Date.now();
  // The outside world, replaceable so the orchestration can be tested without npm, a browser or Kane.
  const world = { resolveConfig, makePlan, stagedCheck, kaneStatus, readCredits, judgePack, ...parts };
  const { stagedCheck: runStagedCheck, kaneStatus: readKaneStatus, readCredits: creditsLeft } = world;

  const config = await world.resolveConfig(projectDir);
  const plan = await world.makePlan(projectDir, options);
  say(`Upkeep · ${plan.project}`);

  if (plan.units.length === 0) {
    say('  Every direct dependency is up to date. Nothing to do.');
    return { landed: [], blocked: [], checks: 0, branch: null };
  }

  const kane = await readKaneStatus();
  if (!kane.signedIn) {
    throw new RunStopped(/not installed/.test(kane.detail) ? kane.detail : 'Kane CLI is not signed in. Run: kane-cli login --oauth');
  }
  const creditsBefore = await creditsLeft();

  const work = await openWorktree(projectDir);
  const runDir = join(projectDir, '.upkeep', 'runs', runStamp());
  await mkdir(join(runDir, 'evidence'), { recursive: true });
  // Keep Upkeep's own notes out of `git status` without editing a tracked file.
  const exclude = join(await git(['rev-parse', '--git-common-dir'], projectDir).then((dir) => (dir.startsWith('/') ? dir : join(projectDir, dir))), 'info', 'exclude');
  const excluded = (await exists(exclude)) ? await readFile(exclude, 'utf8') : '';
  if (!/^\.upkeep\/$/m.test(excluded)) {
    await mkdir(dirname(exclude), { recursive: true });
    await appendFile(exclude, `${excluded.endsWith('\n') || excluded === '' ? '' : '\n'}.upkeep/\n`);
  }

  const ledger = [];
  const record = async (entry) => {
    ledger.push(entry);
    await appendFile(join(runDir, 'ledger.ndjson'), `${JSON.stringify(entry)}\n`);
  };
  const keepPacks = async (verdict) => {
    const kept = [];
    for (const pack of verdict.packs ?? []) {
      if (!(await exists(pack))) continue;
      const target = join(runDir, 'evidence', basename(pack));
      await copyFile(pack, target);
      kept.push(target);
    }
    return kept;
  };

  say(`  branch  ${work.branch}  (your checkout is not touched)`);
  say(`  flows   ${config.flows.length} at ${config.url}: ${config.flows.join(', ')}`);
  say(`  behind  ${plural(plan.candidates.length, 'package')} in ${plural(plan.units.length, 'unit')}`);
  if (work.dirty) say('  note    you have uncommitted changes; Upkeep works from your last commit');
  say('');

  const seeded = await seedNodeModules(projectDir, work.projectDir);
  await seedRecordings(projectDir, work.projectDir, config.flows);
  const manifestPath = (await git(['rev-parse', '--show-prefix'], work.projectDir)) + 'package.json';
  const lockTracked = (await git(['ls-files', 'package-lock.json'], work.projectDir)) !== '';

  let checkNumber = 0;
  let spent = 0;
  let policyPath = null;
  const check = async (units, { keepManifest = false, label, speed = 'full', upTo = 'kane' } = {}) => {
    if (options.budget !== undefined && spent >= options.budget) {
      throw new BudgetReached(`the budget of ${options.budget} Kane credits is used up (${Number(spent.toFixed(2))} spent)`);
    }
    checkNumber += 1;
    const number = checkNumber;
    if (!keepManifest) {
      const baseText = await gitRaw(['show', `HEAD:${manifestPath}`], work.projectDir);
      if (lockTracked) await git(['checkout', 'HEAD', '--', 'package-lock.json'], work.projectDir);
      await writeVersions(work.projectDir, baseText, units);
    }
    const stagesSeen = [];
    const recordings = await keepRecordings(work.projectDir, config.flows, join(runDir, 'recordings-before-check'));
    const verdict = await runStagedCheck({ cwd: work.projectDir, config, heal: speed === 'full', upTo, onStage: ({ stage }) => stagesSeen.push(stage) });
    if (verdict.outcome !== 'pass' || verdict.partial) await recordings.restore();
    const packs = await keepPacks(verdict);
    spent += verdict.credits ?? 0;
    // Kane's policy engine on the pack: flows that verify nothing, and steps Kane healed.
    let policy = null;
    if (!verdict.partial && packs.length > 0) {
      policyPath ??= await writePolicy(runDir);
      policy = await world.judgePack(packs.at(-1), policyPath).catch(() => null);
    }
    await record({ type: 'check', number, label, speed, ...(verdict.partial ? { upTo } : {}), units: units.map((unit) => unit.id), outcome: verdict.outcome, stage: verdict.stage, failing: verdict.failing, summary: verdict.summary, seconds: verdict.seconds, credits: verdict.credits, flows: verdict.flows, packs: packs.map((p) => basename(p)), ...(policy ? { policy } : {}), at: new Date().toISOString() });

    const mark = verdict.partial ? '·' : verdict.outcome === 'pass' ? '✓' : verdict.outcome === 'fail' ? '✗' : '!';
    const what = units.length === 0 ? 'the app as it is' : units.length <= 3 ? units.map((unit) => unit.id).join(', ') : plural(units.length, 'unit');
    const cost = [`${verdict.seconds}s`, verdict.credits !== undefined ? `${verdict.credits} credits` : null].filter(Boolean).join(' · ');
    say(`  ${mark} check ${number}  ${what}${speed === 'quick' ? '  (quick)' : ''}`);
    say(`      ${stagesSeen.join(' → ')}  ${verdict.outcome === 'pass' ? verdict.summary : `failed at ${verdict.stage}: ${verdict.summary}`}  (${cost})`);
    if (verdict.outcome === 'pass' && policy?.healed > 0) {
      say(`      Kane healed ${plural(policy.healed, 'flow')}: the page changed and the flow still passed`);
    }
    return { ...verdict, packs, policy };
  };

  // Put exactly these units in place (versions and installed packages) without checking the app.
  const apply = async (units) => {
    const baseText = await gitRaw(['show', `HEAD:${manifestPath}`], work.projectDir);
    if (lockTracked) await git(['checkout', 'HEAD', '--', 'package-lock.json'], work.projectDir);
    await writeVersions(work.projectDir, baseText, units);
    return runCommand(config.install, { cwd: work.projectDir, timeoutMs: 20 * 60_000 });
  };

  const result = { landed: [], blocked: [], checks: 0, branch: work.branch, runDir };
  try {
    say('The app today, before any upgrade');
    const baseline = await check([], { label: 'baseline' });
    if (baseline.outcome === 'error') throw new CheckUnavailable(baseline);
    if (baseline.outcome === 'fail') {
      throw new RunStopped(`the app does not pass its own flows before any upgrade (${baseline.summary}). Fix that first; Upkeep needs a working starting point.`);
    }
    if (baseline.policy?.withoutChecks > 0) {
      throw new RunStopped(
        `${plural(baseline.policy.withoutChecks, 'flow')} of ${config.flows.length} ${baseline.policy.withoutChecks === 1 ? 'verifies' : 'verify'} nothing (Kane CLI: tests without checks). ` +
          'A flow with no "verify" step passes whatever the app does, so it cannot catch a broken upgrade. End each flow with what should be on the page.',
      );
    }
    if (!seeded) say('      (first install in the worktree; later checks are faster)');
    // Recordings Kane wrote for the first time belong with the flows when the repo tracks them.
    // Only the recordings: whatever else the first install touched is reset before the next check anyway.
    const recorded = await commitAll(
      work.projectDir,
      'Record the Kane flows on the current versions\n\nSteps recorded by Kane CLI before any upgrade, so later runs replay them.',
      recordingsOf(config.flows),
    );
    if (recorded) say(`      recorded the flows: ${recorded.slice(0, 7)}`);
    say('');

    const fixer = fix
      ? (units, verdict) => fix(units, verdict, { work, config, check, apply, say, record, runDir })
      : async () => ({ fixed: false, rounds: 0, reason: 'no coding agent was asked to fix it' });

    const phases = [
      ['Updates that should be compatible', plan.units.filter((unit) => !unit.breaking)],
      ['Updates that may break the app', plan.units.filter((unit) => unit.breaking)],
    ];
    for (const [title, units] of phases) {
      if (units.length === 0) continue;
      say(`${title} (${units.length})`);
      const phase = await landUpgrades({
        units,
        check: (subset, speed, upTo) => check(subset, { label: title, speed, upTo }),
        fix: fixer,
        land: async (landedUnits, verdict, repair) => {
          const sha = await commitAll(work.projectDir, commitMessage(landedUnits, verdict, repair));
          await record({ type: 'landed', units: landedUnits.map((unit) => unit.id), commit: sha, fixed: Boolean(repair), rounds: repair?.rounds });
          say(`      landed ${sha ? sha.slice(0, 7) : '(no change)'}: ${landedUnits.map((unit) => unit.id).join(', ')}${repair ? '  (with a fix)' : ''}`);
        },
        discard: async () => discardChanges(work.projectDir),
        maxChecksPerSearch: options.maxChecksPerSearch,
        onEvent: (event) => {
          if (event.type === 'culprit') say(`      culprit: ${event.units.join(' + ')}${event.separated ? '' : '  (search budget ran out; not fully separated)'}`);
          if (event.type === 'landed' && event.cleared) say('      a quick check failed on these, the full check passed: Kane healed a changed page, the app works');
          if (event.type === 'blocked') say(`      blocked: ${event.units.join(' + ')}: ${event.reason}`);
        },
      });
      for (const entry of phase.blocked) await record({ type: 'blocked', units: entry.units.map((unit) => unit.id), reason: entry.reason, stage: entry.verdict.stage, summary: entry.verdict.summary, failing: entry.verdict.failing, rounds: entry.rounds });
      result.landed.push(...phase.landed);
      result.blocked.push(...phase.blocked);
      say('');
    }
  } catch (error) {
    if (!(error instanceof BudgetReached)) throw error;
    // Whatever was being tried is not verified: put the worktree back to the last commit.
    await discardChanges(work.projectDir);
    result.stoppedEarly = error.message;
    await record({ type: 'stopped', reason: error.message });
    say(`  stopped: ${error.message}`);
    say('');
  } finally {
    result.checks = checkNumber;
    const creditsAfter = await creditsLeft();
    result.credits = creditsBefore !== null && creditsAfter !== null ? Number((creditsBefore - creditsAfter).toFixed(2)) : null;
    result.seconds = Math.round((Date.now() - started) / 1000);
    const runRecord = { project: plan.project, ...(options.agentName ? { agent: options.agentName } : {}), branch: work.branch, base: work.base, flows: config.flows, url: config.url, plan: plan.candidates, skipped: plan.skipped, checks: result.checks, credits: result.credits, seconds: result.seconds, landed: result.landed.map((entry) => ({ units: entry.units.map((unit) => unit.id), fixed: entry.fixed, rounds: entry.rounds })), blocked: result.blocked.map((entry) => ({ units: entry.units.map((unit) => unit.id), reason: entry.reason, stage: entry.verdict.stage, summary: entry.verdict.summary })) };
    await writeFile(join(runDir, 'run.json'), `${JSON.stringify(runRecord, null, 2)}\n`);
    await writeFile(join(runDir, 'report.md'), renderReport(runRecord, ledger, { agentName: options.agentName }));
    await writeFile(join(runDir, 'report.html'), await renderRunHtml(runDir, { run: runRecord, ledger, agentName: options.agentName }));
    if (!options.keepWorktree) await work.remove();
  }

  const landedCount = result.landed.reduce((sum, entry) => sum + entry.units.reduce((n, unit) => n + unit.packages.length, 0), 0);
  const blockedCount = result.blocked.reduce((sum, entry) => sum + entry.units.reduce((n, unit) => n + unit.packages.length, 0), 0);
  say(`Done in ${Math.round(result.seconds / 60)} min, ${plural(result.checks, 'check')}${result.credits !== null ? `, ${result.credits} Kane credits` : ''}.`);
  say(`  ${plural(landedCount, 'package')} upgraded and verified on branch ${work.branch}`);
  if (blockedCount > 0) say(`  ${plural(blockedCount, 'package')} held back: ${result.blocked.map((entry) => entry.units.map((unit) => unit.id).join(' + ')).join(', ')}`);
  const untried = plan.candidates.length - landedCount - blockedCount;
  if (result.stoppedEarly && untried > 0) say(`  ${plural(untried, 'package')} not tried: the budget ran out. Run again to continue from the branch.`);
  say(`  report: ${join(runDir, 'report.html')}  (also report.md)`);
  say(`  Kane evidence for every check: ${join(runDir, 'evidence')}`);
  if (landedCount > 0 && options.pullRequest) {
    try {
      result.pullRequest = await openPullRequest({
        repoRoot: work.repoRoot,
        branch: work.branch,
        title: `Upkeep: upgrade ${plural(landedCount, 'package')}, verified by Kane CLI`,
        bodyFile: join(runDir, 'report.md'),
      });
      say(`  pull request: ${result.pullRequest}`);
    } catch (error) {
      if (!(error instanceof PullRequestFailed)) throw error;
      say(`  no pull request: ${error.message}`);
    }
  } else if (landedCount > 0) {
    say(`  to take the upgrades: git merge ${work.branch}`);
  }
  return result;
}
