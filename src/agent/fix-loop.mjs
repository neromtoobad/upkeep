// The closed loop between Kane CLI and the coding agent for one culprit:
//
//   Kane's failure → agent edits the app → guard → Kane walks it again → …
//
// It ends when Kane passes every flow (the upgrade lands with the fix), when
// the agent stops changing anything, or when the rounds run out (the upgrade
// is held back and the worktree is reset).

import { join } from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import { askAgent } from './ask-agent.mjs';
import { buildPacket, findImporters, findNotes } from './failure-packet.mjs';
import { protect, inspectPatch } from './guard-patch.mjs';
import { CheckUnavailable } from '../loop/land-upgrades.mjs';

/**
 * @param {object} options
 * @param {ReturnType<import('./ask-agent.mjs').resolveAgent>} options.agent
 * @param {number} [options.maxRounds]
 * @param {(pack: string, flow: object) => Promise<object|null>} [options.readFailure]
 *   pulls the failing step, console and Kane's triage out of an evidence pack
 * @param {typeof askAgent} [options.ask] replacement for the real agent call, for tests
 * @returns the `fix` function for the landing loop
 */
export function makeFixer({ agent, maxRounds = 3, readFailure, ask = askAgent }) {
  return async function fix(units, firstVerdict, { work, config, check, apply, say, record, runDir }) {
    const packages = units.flatMap((unit) => unit.packages.map((p) => p.name));
    const label = units.map((unit) => unit.id).join(' + ');
    const taskDir = join(runDir, 'agent', label.replace(/[^a-z0-9@._+-]+/gi, '_'));
    await mkdir(taskDir, { recursive: true });

    // Packages that cannot be installed together are not something app code can fix.
    if (firstVerdict.stage === 'install') {
      return { fixed: false, rounds: 0, verdict: firstVerdict, reason: firstVerdict.summary ?? 'the new versions cannot be installed' };
    }

    // The worktree may hold some other subset from the search; put exactly the culprit in place.
    await apply(units);

    let verdict = firstVerdict;
    const history = [];

    for (let round = 1; round <= maxRounds; round += 1) {
      const evidence = [];
      if (readFailure && verdict.stage === 'kane') {
        for (const flow of (verdict.flows ?? []).filter((f) => f.status === 'failed')) {
          for (const pack of verdict.packs ?? []) {
            const detail = await readFailure(pack, flow).catch(() => null);
            if (detail) {
              evidence.push(detail);
              break;
            }
          }
        }
      }

      const prompt = buildPacket({
        units,
        verdict,
        evidence,
        importers: await findImporters(work.projectDir, packages),
        notes: await findNotes(work.projectDir, packages),
        flows: config.flows,
        round,
        history,
      });
      await writeFile(join(taskDir, `round-${round}-task.md`), prompt);

      const guard = await protect({ projectDir: work.projectDir, flows: config.flows, backupDir: join(taskDir, 'protected') });
      say(`      round ${round}: asking ${agent.name} to make the app work on ${label}`);
      const answer = await ask({ agent, prompt, cwd: work.projectDir });
      await writeFile(join(taskDir, `round-${round}-reply.md`), `${answer.text || '(no reply)'}\n`);

      if (!answer.ok && !answer.text) {
        await record({ type: 'agent', units: units.map((u) => u.id), round, ok: false, problem: answer.problem, seconds: answer.seconds });
        return { fixed: false, rounds: round, verdict, reason: answer.problem ?? 'the agent did not answer' };
      }

      const patch = await inspectPatch({ projectDir: work.projectDir, guard });
      await record({ type: 'agent', units: units.map((u) => u.id), round, ok: answer.ok, seconds: answer.seconds, costUsd: answer.costUsd, changed: patch.changed, undone: patch.undone, addedPackages: patch.addedPackages, reply: answer.text.slice(0, 1200) });
      for (const undone of patch.undone) say(`      undone: the agent ${undone}`);

      if (patch.changed.length === 0 && patch.addedPackages.length === 0) {
        const why = patch.undone.length > 0 ? 'the agent only changed things it may not change' : 'the agent changed nothing';
        return { fixed: false, rounds: round, verdict, reason: why };
      }
      say(`      changed: ${patch.changed.join(', ') || '(package.json only)'}  (${answer.seconds}s)`);

      // Same versions, the agent's edits in place: does the app work now?
      verdict = await check(units, { keepManifest: true, label: `after fix round ${round}` });
      if (verdict.outcome === 'error') throw new CheckUnavailable(verdict);
      if (verdict.outcome === 'pass') return { fixed: true, rounds: round, verdict, changed: patch.changed, reply: answer.text };

      history.push({ changed: patch.changed, undone: patch.undone, summary: verdict.summary ?? 'still failing' });
    }

    return { fixed: false, rounds: maxRounds, verdict, reason: `still failing after ${maxRounds} round${maxRounds === 1 ? '' : 's'} with the agent` };
  };
}
