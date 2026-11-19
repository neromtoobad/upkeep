# Upkeep

**Updates your outdated packages and proves in a real browser that the app still works.**

Built at the KaneCLI Online Hackathon (TestMu AI), 12–26 November 2026. Coding agent: Claude Code.
Verifier: [Kane CLI](https://github.com/LambdaTest/kane-cli).

**Proof.** On a shop app pinned to 2021-era packages, Upkeep moved `date-fns` from 1.30.1 to
4.4.0. The build passed. Kane CLI walked the checkout in a real browser and found the order page
blank. Upkeep handed Kane's failure to Claude Code, which changed two format strings; Kane walked
the shop again, all three flows passed, and only then was the upgrade committed. The whole
exchange is in [`evidence/2026-11-19-1500-fixed-by-agent/`](evidence/2026-11-19-1500-fixed-by-agent/report.md).

| After the upgrade: what Kane saw | After the agent's fix: what Kane saw |
|---|---|
| ![A blank page where the order confirmation should be](evidence/2026-11-19-1500-fixed-by-agent/screenshots/check-03-checkout-failed.jpg) | ![The order confirmation with the date 19/11/2026](evidence/2026-11-19-1500-fixed-by-agent/screenshots/check-04-checkout-passed.jpg) |
| `npm run build` passed. The order page is blank. | "Thanks, Ada Marsh. Order placed on 19/11/2026." |

Both screenshots are Kane CLI's own, taken from its evidence packs.

## The problem

Dependabot and Renovate open the pull request and trust your CI. But the upgrades that hurt build
fine and pass type checks. `date-fns` 2 renamed its format tokens, so `format(date, 'DD/MM/YYYY')`
still compiles and throws when the page renders. Nothing in a normal pipeline opens the order
page. So upgrade pull requests pile up unmerged, or get merged on faith.

Coding agents make this worse in a new way: an agent will happily bump twelve packages and say
"done", having opened nothing.

## What Upkeep does

```
npm outdated ──► plan ──► worktree on a new branch
                              │
              ┌───────────────▼────────────────┐
              │ apply a set of upgrades         │
              │ install → build → boot → Kane   │◄─────────────┐
              └───────┬───────────────┬─────────┘              │
                   pass             fail                       │
                      │               │                        │
                 commit it     search for the smallest         │
                               set that fails the same way     │
                                      │                        │
                               confirm with a full Kane check  │
                                      │                        │
                               Kane's failure ──► coding agent edits the app
                                                  (flows and versions are off limits)
```

1. **Plan** (`src/plan/`). Reads `npm outdated`, labels each jump as compatible or may-break, and
   groups upgrades that need each other. `react-markdown` 10 needs React 18, so it travels with
   React. The reasons are printed.
2. **Work somewhere else** (`src/workspace/worktree.mjs`). A git worktree on a new branch,
   outside the repository. Your checkout is not touched.
3. **Check** (`src/check/staged-check.mjs`). Install, build, boot the app, then Kane CLI walks
   your plain-English flows. Cheapest first: an upgrade that does not build costs no credits.
4. **Land what passes.** One commit per verified set, with the Kane result in the message.
5. **Isolate what fails** (`src/isolate/ddmin.mjs`). Delta debugging over the upgrades: about
   2·log₂(n) checks to find one culprit among n, and it finds pairs that only break together.
6. **Fix it with the agent** (`src/agent/`). The agent gets Kane's own words: the failing step,
   the console error, Kane's root cause. It edits the app. Kane walks the app again. A new failure
   opens the next round; a pass lands the upgrade with the fix.
7. **Report** (`src/report/`). What landed, what needed a fix, what was held back and why, and
   every check with its time and credits. `--pr` opens it as a pull request.

## For judges: verify in two minutes

Nothing below needs a Kane account or an install. Node 20 or newer.

| Do this | You see |
|---|---|
| Open [`evidence/2026-11-19-1500-fixed-by-agent/report.md`](evidence/2026-11-19-1500-fixed-by-agent/report.md) | The loop on a real run: Kane's failure, the agent's change, Kane's pass, every check with time and credits |
| Open [`agent/date-fns/round-1-task.md`](evidence/2026-11-19-1500-fixed-by-agent/agent/date-fns/round-1-task.md) in the same folder | Exactly what Kane's result looked like when it reached the agent |
| `node tools/check-claims.mjs` | PASS or FAIL for every claim in the table below, and for the rules in the published ledgers |
| `npm test` | Every test passes, with no install step |
| `node bin/upkeep.mjs plan --cwd /path/to/any/npm/project` | The plan for your own project: what is behind, what may break, what moves together and why |

With a Kane account (`kane-cli login --oauth`) and Claude Code installed, see [Run it](#run-it).

## The three bars

| Bar (quoted from the event page) | Where |
|---|---|
| "It works end to end." | Two real runs in [`evidence/`](evidence/): plan → worktree → install → build → boot → Kane → commit on a branch. |
| "Kane CLI caught or proved something." | Caught: `date-fns` 4 blanks the order page while the build passes. Proved: three other upgrades and the agent's fix, 3 of 3 flows each. |
| "Your agent and Kane CLI talked to each other." | Kane's failure record is the agent's task ([`round-1-task.md`](evidence/2026-11-19-1500-fixed-by-agent/agent/date-fns/round-1-task.md)); the agent's edit is judged by Kane's next walk (`src/agent/fix-loop.mjs`). No person in between. |

## Judging criteria

| Criterion (quoted) | Where Upkeep meets it |
|---|---|
| **Ships.** "A real flow that runs end to end. Not slides." | `upkeep run` produced the branches and commits recorded in `evidence/*/ledger.ndjson`. |
| **Verified.** "Kane CLI caught or confirmed something meaningful." | A break from a real upstream release, not a planted bug: the shop is ordinary code written against old versions. Build and bundler said yes; Kane said no. |
| **Closed loop.** "Kane's result feeds back to the agent. Tighter is better." | Kane's verdict decides three things with no person involved: which set of upgrades to try next (the search), what the agent is told, and whether the result is committed or thrown away. |
| **Craft.** "Would a developer want to install this tonight?" | No dependencies, no config for Vite, Next and Astro, a credit budget, quick checks while searching, a guard against an agent that edits the tests, a report you can paste into a pull request. |

## What Kane CLI does here

Kane is the only judge. Upkeep never looks at the page itself.

- **`kane-cli testrun run … --agent --headless`** runs the flows as one suite (`src/kane/run-suite.mjs`).
  Recorded steps replay, which is what makes a search affordable: three flows in about 65 seconds
  for 7 to 8 credits.
- **Heal, on and off.** A full check lets Kane heal a step that no longer matches the page before
  calling it a failure. A quick check (`--no-adaptive-heal`) stops at the first mismatch. Upkeep
  searches with quick checks and confirms with a full one, so a harmless change in the page is
  never blamed (`src/loop/land-upgrades.mjs`).
- **The NDJSON stream** is read per flow, because Kane exits 1 both when a flow fails and when a
  flow could not run. Only the first says anything about an upgrade (`src/kane/read-suite-stream.mjs`).
- **Evidence packs** are opened for the failing step, Kane's triage (root cause, suggested fix),
  the browser console and the screenshot (`src/kane/read-evidence.mjs`). These go to the agent
  and into the report.
- **Policies and verdicts.** After each check the pack is judged with
  `kane-cli evidence verdict --policy` on two of Kane's own metrics. `metrics.tests_without_checks`:
  a flow that verifies nothing passes whatever the app does, so Upkeep refuses to start from one.
  `metrics.heal.healed_tests`: Kane healed a step, so the page changed and the flow still passed;
  the report says so (`src/kane/judge-pack.mjs`).
- **`kane-cli balance`** before and after each check gives the credits it used, for the report
  and the `--budget` cap.

Nine things found in Kane CLI while building this are written up for its team in
[`FEEDBACK.md`](FEEDBACK.md).

## Claims

Every claim made here, the line of code behind it, and how it is checked.
`node tools/check-claims.mjs` verifies this table against the repository.

<!-- claims:start -->
| Claim | Where in code | Checked by |
|---|---|---|
| Plans upgrades from `npm outdated`, keeps each range style, labels a jump breaking by the caret rule | `src/plan/outdated.mjs:40` | `test/outdated.test.mjs` |
| Moves upgrades that need each other as one unit, from the peer ranges of installed and target versions | `src/plan/peer-links.mjs:28` | `test/peer-links.test.mjs`; `upkeep plan` prints each reason |
| Finds the smallest set of upgrades that breaks the app by delta debugging, including pairs that only break together | `src/isolate/ddmin.mjs:20` | `test/ddmin.test.mjs` |
| Every check is install, then build, then boot, then Kane CLI; it stops at the first failure so a broken build costs no credits | `src/check/staged-check.mjs:57` | `test/staged-check.test.mjs` |
| Runs the flows with `kane-cli testrun run --agent --headless` | `src/kane/run-suite.mjs:45` | `test/run-suite.test.mjs`; every check in `evidence/*/ledger.ndjson` |
| A flow Kane could not run (runner crash, no browser) is never read as a broken app, even though Kane exits 1 for both | `src/kane/read-suite-stream.mjs:122` | `test/read-suite-stream.test.mjs`, against a real capture of a runner crash |
| Refuses to start from flows that verify nothing, and reports steps Kane healed, using Kane's own policy engine (`kane-cli evidence verdict --policy`) | `src/kane/judge-pack.mjs:63` | `test/judge-pack.test.mjs`, `test/upgrade-run.test.mjs` |
| The search uses quick checks (no heal); nothing is blamed, handed to the agent or held back without a full check | `src/loop/land-upgrades.mjs:108` | `test/land-upgrades.test.mjs`; `node tools/check-claims.mjs` checks it in the published ledgers |
| Nothing is committed unless a check passed on exactly that set of upgrades | `src/loop/land-upgrades.mjs:86` | `node tools/check-claims.mjs` checks every landed set in `evidence/*/ledger.ndjson` |
| Kane's failure goes to the agent as Kane wrote it: its message, the failing step, console errors, its own root cause | `src/agent/failure-packet.mjs:87` | `evidence/2026-11-19-1500-fixed-by-agent/agent/date-fns/round-1-task.md` |
| Reads the failing step, Kane's triage, the console and the screenshot out of the evidence pack | `src/kane/read-evidence.mjs:87` | `test/read-evidence.test.mjs` |
| After the agent edits the app, Kane walks it again; a new failure opens the next round | `src/agent/fix-loop.mjs:90` | `test/fix-loop.test.mjs`; `evidence/2026-11-19-1500-fixed-by-agent/report.md` |
| An agent already in a session can be the fixer: the run pauses with Kane's failure, `upkeep wait` prints it, `upkeep continue` sends the edit back to Kane | `src/agent/handoff.mjs:54` | `test/handoff.test.mjs` |
| An agent that edits the flows, the recordings or the versions instead of the app has that undone | `src/agent/guard-patch.mjs:100` | `test/guard-patch.test.mjs` |
| Works in a git worktree outside the repository; the checkout is not touched | `src/workspace/worktree.mjs:62` | `test/worktree.test.mjs` |
| Needs no configuration for Vite, Next and Astro projects: the address comes from the flows | `src/config/resolve-config.mjs:73` | `test/resolve-config.test.mjs` |
| Published evidence carries no account details: packs are left out, emails and home paths removed | `src/report/export-run.mjs:96` | `test/export-run.test.mjs`; `node tools/check-claims.mjs` scans `evidence/` |
| No dependencies | `package.json:30` | `package.json` has no `dependencies`; `node tools/check-claims.mjs` |
| `--budget` stops new checks once the credits are spent; what landed stays on the branch | `src/run/upgrade-run.mjs:140` | `test/upgrade-run.test.mjs` |
<!-- claims:end -->

## What is real, and what is a stand-in

| Part | Status | Where to look |
|---|---|---|
| Kane verdicts in `evidence/` | Real runs, Kane CLI 0.10.6, 19 November 2026 | `evidence/*/ledger.ndjson` has each check's flows, seconds and credits |
| The agent's fix | Real: Claude Code, headless, one round | `evidence/2026-11-19-1500-fixed-by-agent/agent/` |
| The app being upgraded | A demo shop written for this project against 2021-era packages. Nothing in it is a planted bug; what breaks is what the new releases changed | `evidence/*/run.json` lists the packages and versions |
| Unit tests of the loop, the fix loop and the check | Use stand-ins for Kane and for the agent, and say so at the top of each file | `test/land-upgrades.test.mjs`, `test/fix-loop.test.mjs`, `test/staged-check.test.mjs` |
| Tests of `upkeep run` as a whole | A real git repository, worktree, commits, ledger and report. The plan, the check and the Kane account are stand-ins | `test/upgrade-run.test.mjs` |
| Tests of the Kane runner | Go through a real child process against a stub binary | `test/stubs/kane-cli-stub.mjs` |
| The stream reader | Tested against a real capture, including a runner crash | `test/fixtures/kane-suite-authored-one-broken.ndjson` |
| The "flow verifies nothing" stop | Tested with a stand-in for Kane's verdict. Real packs so far all had checks, so it has **not fired on a real run** | `test/upgrade-run.test.mjs` |
| Handoff mode (`--agent handoff`, `upkeep wait`, `upkeep continue`) | Tested through the real commands with a stand-in for the run. **Not yet used on a real run** | `test/handoff.test.mjs` |
| The Codex CLI preset (`--agent codex`) | Written from the Codex documentation. **Not run by us**: Codex is not installed here | `src/agent/ask-agent.mjs` |

## Not built yet

- A run on someone else's open-source app. Both published runs are on the demo shop.
- Package managers other than npm. pnpm, Yarn and Bun projects are not supported.
- Monorepo workspaces as a whole. A single package in a subfolder works; upgrading across
  workspaces does not.
- Resuming a run that was interrupted. A new run starts again from your last commit.
- Mobile flows. Kane CLI can drive simulators; Upkeep only serves web apps.

## Trust model and limits

- **The flows are the definition of "works".** Upkeep proves the app still passes your flows. It
  says nothing about behaviour no flow covers. Three flows covering sign-in, the main journey and
  payment catch far more than none, and far less than everything.
- **The agent runs with your permissions**, in a worktree of your repository. Claude Code is
  started with file tools only and no shell. The guard (`src/agent/guard-patch.mjs`) undoes edits
  to the flows, their recordings and the versions. It is a guard against a lazy fix, not a
  security boundary.
- **Nothing is pushed** unless you pass `--pr`. Upkeep holds no token; it uses your `git` and `gh`.
- **Kane credits are spent.** About 8 per passing check and up to 45 for a failing one that Kane
  tries to heal. `--budget` caps a run.
- **Evidence packs stay on your machine.** They name the Kane account that made them, so Upkeep
  never commits them, and `upkeep export` leaves them out.

## Run it

```bash
npm install -g @testmuai/kane-cli && kane-cli login --oauth
git clone https://github.com/neromtoobad/upkeep
cd /path/to/your/app
node /path/to/upkeep/bin/upkeep.mjs plan
node /path/to/upkeep/bin/upkeep.mjs run --agent claude
```

Your app needs at least one Kane flow: a `flows/<name>_test.md` with `url: http://localhost:<port>`
in its header and the journey in plain English. Upkeep serves the app at that address itself, so
stop your own dev server first.

| Option | What it does |
|---|---|
| `--agent claude` | Have Claude Code fix upgrades that break the app. Any other headless agent: pass its command. Without `--agent`, breaking upgrades are isolated and held back |
| `--agent handoff` | The agent you are already talking to (Cursor, Windsurf, Kiro, Claude Code) does the fixing. The run pauses with Kane's failure; `upkeep wait` prints the task, `upkeep continue` sends the edit back to Kane |
| `--only a,b` / `--exclude a,b` | Narrow the set |
| `--target wanted` | Stay inside the version ranges already in `package.json` |
| `--budget 500` | Stop starting checks after this many Kane credits |
| `--rounds 3` | Most rounds between Kane and the agent per upgrade |
| `--pr` | Push the branch and open a pull request with the report |

Exit codes: `0` everything behind was upgraded, `3` some upgrades were held back (the branch is
still good), `4` the check could not run, `1` the app did not pass its flows before any upgrade.

An agent skill that teaches a coding agent to use Upkeep is in [`skills/upkeep/`](skills/upkeep/SKILL.md).

## Built at the event

First commit 19 November 2026. Everything in this repository was written during the event.
There is no code from earlier projects and no template.

**AI use.** Written with Claude Code, which is also the agent Upkeep calls in the published
runs. The runs in `evidence/` are real and unedited apart from the removal of account details
described above.

## License

MIT
