// The Upkeep loop. Nothing is committed unless a check passed on exactly that
// combination of upgrades.
//
//   1. Apply every remaining upgrade and check the app.
//   2. Pass: land them all in one commit. Done.
//   3. Fail: search for the smallest set that fails the same way (ddmin).
//   4. Confirm that set with a full check. If it passes after all, land it.
//      (If part of the set passed on its own during the search, land that
//      part first and start again: the culprit gets smaller.)
//   5. Otherwise hand it and the failure to `fix` (the coding agent). If the
//      app checks out again, land the upgrade with the fix; if not, block it.
//   6. Take it out of the remaining set and go back to 1.
//
// Checks come in two speeds. A quick check replays the recorded steps and
// stops at the first mismatch. A full check lets Kane CLI heal a step that no
// longer matches the page before calling it a failure. A pass means the same
// at either speed. A quick failure does not: it can be a harmless change in
// the page. So steps 1 and 3 use quick checks, and step 4 is always a full
// one: nothing is blamed, handed to the agent or held back on a quick failure.
//
// This module only decides. Applying versions, running Kane CLI, calling the
// agent and committing are passed in, so the decisions can be tested alone.

import { ddmin } from '../isolate/ddmin.mjs';
import { reproduces } from '../check/verdict.mjs';

/** @typedef {import('../plan/group-lockstep.mjs').Unit} Unit */
/** @typedef {import('../check/verdict.mjs').Verdict} Verdict */

/**
 * @typedef {object} Repair
 * @property {boolean} fixed
 * @property {Verdict} [verdict] the last check the repair ran
 * @property {number} [rounds]   how many times the agent was asked
 * @property {string} [reason]   why it stopped, when not fixed
 */

/** A check could not run at all; nothing can be concluded from it. */
export class CheckUnavailable extends Error {
  /** @param {Verdict} verdict */
  constructor(verdict) {
    super(verdict.summary ?? 'the check could not run');
    this.name = 'CheckUnavailable';
    this.verdict = verdict;
  }
}

const idsOf = (units) => units.map((unit) => unit.id);

/**
 * @param {object} input
 * @param {Unit[]} input.units
 * @param {(units: Unit[], speed: 'full'|'quick', upTo?: string) => Promise<Verdict>} input.check
 *   applies exactly these units on top of what has landed and checks the app;
 *   `upTo` names a stage to stop after (only passed while isolating)
 * @param {(units: Unit[], verdict: Verdict) => Promise<Repair>} input.fix
 *   leaves the units applied together with its code changes when it returns fixed
 * @param {(units: Unit[], verdict: Verdict, repair?: Repair) => Promise<void>} input.land
 *   commits what is applied right now
 * @param {(units: Unit[]) => Promise<void>} [input.discard]
 *   throws away what is applied right now, after a repair that did not work
 * @param {number} [input.maxChecksPerSearch]
 * @param {(event: object) => void} [input.onEvent]
 * @returns {Promise<{landed: object[], blocked: object[], checks: number}>}
 */
export async function landUpgrades({ units, check, fix, land, discard, maxChecksPerSearch = 24, onEvent = () => {} }) {
  let remaining = [...units];
  const landed = [];
  const blocked = [];
  let checks = 0;

  const runCheck = async (subset, purpose, upTo) => {
    checks += 1;
    onEvent({ type: 'check_start', units: idsOf(subset), purpose });
    const verdict = await check(subset, purpose === 'confirm' ? 'full' : 'quick', upTo);
    onEvent({ type: 'check_end', units: idsOf(subset), purpose, verdict });
    if (verdict.outcome === 'error') throw new CheckUnavailable(verdict);
    if (verdict.outcome !== 'pass' && verdict.outcome !== 'fail') {
      throw new Error(`check returned outcome "${verdict.outcome}"`);
    }
    return verdict;
  };

  while (remaining.length > 0) {
    const together = await runCheck(remaining, 'together');
    if (together.outcome === 'pass') {
      if (together.partial) throw new Error('a check that was stopped early cannot land upgrades');
      await land(remaining, together);
      landed.push({ units: remaining, verdict: together, fixed: false });
      onEvent({ type: 'landed', units: idsOf(remaining), fixed: false });
      break;
    }

    // Subsets that passed every stage during the search: safe to land on their own.
    const passedAlone = [];
    const search = await ddmin(
      remaining,
      async (subset) => {
        // Only the stage that failed matters here: a set that gets past it does
        // not have this problem, whatever happens later.
        const verdict = await runCheck(subset, 'isolate', together.stage);
        if (verdict.outcome === 'pass' && !verdict.partial) passedAlone.push(subset);
        if (verdict.outcome === 'pass') return 'pass';
        // A subset that fails some other way (say, an install conflict from a
        // combination the full set did not have) is not evidence either way.
        return reproduces(together, verdict) ? 'fail' : 'unresolved';
      },
      { maxTests: maxChecksPerSearch },
    );

    // The search could not get below a set of several, but part of that set
    // passed on its own. Land that part first: the rest is then checked on top
    // of it, and what finally goes to the agent is as small as it can be.
    // (Typical case: B only builds once A is upgraded. A passes alone, B alone
    // fails earlier, so the pair looks inseparable until A has landed.)
    if (search.minimal.length > 1) {
      const inMinimal = new Set(search.minimal);
      const peel = passedAlone.filter((subset) => subset.every((unit) => inMinimal.has(unit))).sort((a, b) => b.length - a.length)[0];
      if (peel) {
        const again = await runCheck(peel, 'together');
        if (again.outcome === 'pass' && !again.partial) {
          await land(peel, again);
          landed.push({ units: peel, verdict: again, fixed: false });
          onEvent({ type: 'landed', units: idsOf(peel), fixed: false, peeled: true });
          const done = new Set(peel);
          remaining = remaining.filter((unit) => !done.has(unit));
          continue;
        }
      }
    }

    const culprit = search.minimal;
    // Everything so far was a quick check. Blame needs a full one.
    const culpritVerdict = await runCheck(culprit, 'confirm');
    if (culpritVerdict.outcome === 'pass') {
      if (culpritVerdict.partial) throw new Error('a check that was stopped early cannot land upgrades');
      await land(culprit, culpritVerdict);
      landed.push({ units: culprit, verdict: culpritVerdict, fixed: false });
      onEvent({ type: 'landed', units: idsOf(culprit), fixed: false, cleared: true });
      const cleared = new Set(culprit);
      remaining = remaining.filter((unit) => !cleared.has(unit));
      continue;
    }
    onEvent({
      type: 'culprit',
      units: idsOf(culprit),
      verdict: culpritVerdict,
      checks: search.tests,
      separated: !search.exhausted,
    });

    const repair = await fix(culprit, culpritVerdict);
    if (repair.fixed) {
      await land(culprit, repair.verdict ?? culpritVerdict, repair);
      landed.push({ units: culprit, verdict: repair.verdict ?? culpritVerdict, fixed: true, rounds: repair.rounds });
      onEvent({ type: 'landed', units: idsOf(culprit), fixed: true, rounds: repair.rounds });
    } else {
      if (discard) await discard(culprit);
      blocked.push({
        units: culprit,
        verdict: repair.verdict ?? culpritVerdict,
        rounds: repair.rounds ?? 0,
        reason: repair.reason ?? 'the app still fails with this upgrade',
        separated: !search.exhausted,
      });
      onEvent({ type: 'blocked', units: idsOf(culprit), reason: repair.reason });
    }

    const gone = new Set(culprit);
    remaining = remaining.filter((unit) => !gone.has(unit));
  }

  return { landed, blocked, checks };
}
