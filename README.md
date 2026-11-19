# Upkeep

Updates your outdated packages and proves in a real browser that the app still works.

Dependabot and Renovate open the pull request and trust your CI. But the upgrades that hurt
build fine and pass type checks: a form library whose API changed and now submits empty
values, a date library whose format tokens changed. Upkeep bumps everything, has
[Kane CLI](https://github.com/LambdaTest/kane-cli) walk the app like a person, finds the exact
package that broke it, gives that to your coding agent to migrate, and commits only what Kane
verifies again.

Built for the KaneCLI Online Hackathon (TestMu AI), 12–26 November 2026. **Work in progress.**
The tables below list what is in the repo today and what is not.

## What exists today

| Part | Where | Checked by |
|---|---|---|
| `upkeep plan`: which packages are behind, which may break, which must move together | `src/cli.mjs`, `src/plan/make-plan.mjs` | `test/cli.test.mjs` |
| Read `npm outdated` into upgrade candidates, keeping each range style | `src/plan/outdated.mjs` | `test/outdated.test.mjs` |
| Label a jump breaking or compatible by the caret rule | `src/plan/semver.mjs` | `test/semver.test.mjs` |
| Group packages that must be upgraded together (react + react-dom, a library + its `@types`) | `src/plan/group-lockstep.mjs` | `test/group-lockstep.test.mjs` |
| Delta debugging: find the smallest set of upgrades that breaks the app | `src/isolate/ddmin.mjs` | `test/ddmin.test.mjs` |
| The loop: land what passes together, isolate what fails, land a fix only after a passing check, block the rest | `src/loop/land-upgrades.mjs` | `test/land-upgrades.test.mjs` |

The loop is tested against stand-ins for the check and the agent (`test/land-upgrades.test.mjs`
says so at the top). It has not yet run against Kane CLI.

## Not built yet

- Applying a set of upgrades in a git worktree and installing them
- The check itself: install, build, boot the app, run the Kane CLI flows, read the verdict
- The packet for the coding agent (failing step, console, changelog) and re-verifying its patch
- `upkeep run`, the report, the pull request
- A demo repository and runs on real open-source apps

## Try what exists

```bash
git clone https://github.com/neromtoobad/upkeep && cd upkeep
node bin/upkeep.mjs plan --cwd /path/to/your/app
npm test
```

Needs Node 20 or newer. No dependencies to install.

## License

MIT
