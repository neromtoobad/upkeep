# Notes for the Kane CLI team

Things found while building Upkeep on Kane CLI 0.10.6 (macOS 27.2, Apple Silicon, Node 24,
npm 11), 19 November 2026 onward. Each one is something Upkeep had to handle; the file that
handles it is named.

## What worked better than expected

- **The triage is right, and specific.** For the `date-fns` 1 → 4 break on the demo shop, the
  failure record said: root cause "The confirmation page fails while formatting the order date",
  suggested fix "Update the confirmation date format to use `dd/MM/yyyy`", confidence 0.99. It
  also kept the console error with the library's own message. Upkeep passes this to the coding
  agent as written (`src/agent/failure-packet.mjs`).
- **Replays are cheap enough to use as an oracle.** Three flows replay in about 65 seconds for
  7 to 8 credits. That is what makes a search over sets of upgrades affordable.
- **The NDJSON contract is stable and documented.** `references/parsing.md` and
  `references/testrun.md` matched what the CLI printed.

## Things that cost time

1. **First parallel launch can crash a runner.** The first `testrun run --parallel 3` after
   install ended one member with `v16-runner exited before ready (code=null, signal=SIGBUS)`
   while the other two ran fine. The runner unpacks itself to `~/.cache/v16-runner/<version>/`
   on first use; three starting at once looks like a race on that. Every later run was fine.
   Upkeep retries members that come back `broken` once, alone (`src/kane/run-suite.mjs`).

2. **Exit code 1 means both "a flow failed" and "a flow could not run".** The crash above exits
   1 with `overall_status: "failed"`, the same as a real failure. A tool that reads only the
   exit code blames the app. Upkeep reads each member's status and treats `broken` and
   `interrupted` as "could not check" (`src/kane/read-suite-stream.mjs`). A distinct exit code
   for "some members did not run" would make this hard to get wrong.

3. **`testrun run` cannot be pointed at another address.** `testmd run` takes `--url`;
   `testrun run` does not, and has no `--variables`. To check two builds side by side a suite
   would need a different port per build. Upkeep serves every candidate on the address in the
   flows' header, one at a time (`src/config/resolve-config.mjs`).

4. **A failing replay with heal on is slow to say no.** On the `date-fns` break: 292 seconds and
   44 credits with heal, 138 seconds and 17 credits with `--no-adaptive-heal`. Both are correct
   behaviour. Upkeep searches with heal off and confirms with heal on
   (`src/loop/land-upgrades.mjs`). A flag between the two ("heal once, then stop") would help
   tools that call Kane many times.

5. **The failure record is not on the step marked failed.** In the same run `result.yaml` marks
   step 20 failed, while `failure.yaml` sits in `steps/17-1-9/`. Reading "the first step whose
   status is failed" misses the record. Upkeep looks for the `failure.yaml` itself
   (`src/kane/read-evidence.mjs`).

6. **Screenshots are `.jpg`.** The skill reference (`references/evidence.md`,
   `references/debug.md`) says `screenshot.png`; packs hold `screenshot.jpg` (and
   `annotated.png`).

7. **Paths differ between events.** `testrun_plan.members[].path` is absolute;
   `testrun_authored_member_end.path` is relative. The reference says to match by file name,
   which works, but one form everywhere would be simpler.

8. **Evidence packs carry the account's email.** `tests/<id>/result.yaml` has `user_email`,
   `user_name` and a share link. A pack cannot go into a public repository as it is. An
   `evidence export --redact` would let projects publish their proof. Upkeep never commits
   packs (`src/workspace/worktree.mjs`).

9. **Recordings carry account ids.** `output-<name>/.internal/meta.json` has `org_id`,
   `project_id` and the test case id, so committed recordings only replay for that account.
   The demo shop ignores them for that reason; Upkeep copies untracked recordings into its
   worktree (`src/run/upgrade-run.mjs`).

10. **A failing check changes the recordings, with or without heal.** After a full check that
    failed, the next passing check on the same flows cost about 91 credits and 147 seconds for
    three flows, against 7 to 8 credits for a normal replay. Upkeep now hashes `output-<name>/`
    before and after each check: in `evidence/2026-11-19-2147-handoff-and-guard/ledger.ndjson`
    both failing checks (one with `--no-adaptive-heal`, one with heal) are marked
    `recordingsRestored: true`, so the recorded steps were rewritten while the flow failed.
    Upkeep copies the recordings before each check and puts them back after any check that does
    not pass (`keepRecordings` in `src/run/upgrade-run.mjs`). With that, the same verifying check
    cost 7.8 credits and 66 seconds. An option to leave recordings untouched unless the run
    passes would remove the need.

11. **`metrics.tests_without_checks` also counts flows that failed before reaching a check.** On
    a passing run it is 0 for flows that verify something, which is what Upkeep uses it for (the
    baseline). On a failing run where the app is blank it read 2 and 3 for three flows that all
    have checks. The name suggests a property of the test; it behaves as a property of the run.
