// The Upkeep loop. Nothing is committed unless a check passed on exactly that
// combination of upgrades.
//
//   1. Apply every remaining upgrade and check the app.
//   2. Pass: land them all in one commit. Done.
//   3. Fail: search for the smallest set that fails the same way (ddmin).
//   4. Hand that set and the failure to `fix` (the coding agent). If the app
//      checks out again, land the upgrade with the fix; if not, block it.
//   5. Take it out of the remaining set and go back to 1.
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
 * @param {(units: Unit[]) => Promise<Verdict>} input.check
 *   applies exactly these units on top of what has landed and checks the app
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

  const runCheck = async (subset, purpose) => {
    checks += 1;
    onEvent({ type: 'check_start', units: idsOf(subset), purpose });
    const verdict = await check(subset);
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
      await land(remaining, together);
      landed.push({ units: remaining, verdict: together, fixed: false });
      onEvent({ type: 'landed', units: idsOf(remaining), fixed: false });
      break;
    }

    // Keep each subset's own verdict: the culprit's is what the agent reads.
    const verdicts = new Map();
    const search = await ddmin(
      remaining,
      async (subset) => {
        const verdict = await runCheck(subset, 'isolate');
        verdicts.set(idsOf(subset).join('\u0000'), verdict);
        if (verdict.outcome === 'pass') return 'pass';
        // A subset that fails some other way (say, an install conflict from a
        // combination the full set did not have) is not evidence either way.
        return reproduces(together, verdict) ? 'fail' : 'unresolved';
      },
      { maxTests: maxChecksPerSearch },
    );

    const culprit = search.minimal;
    const culpritVerdict = verdicts.get(idsOf(culprit).join('\u0000')) ?? together;
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
