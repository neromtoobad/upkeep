# Upkeep

Updates your outdated packages and proves in a real browser that the app still works.

Built for the KaneCLI Online Hackathon (TestMu AI), 12–26 November 2026. Work in progress:
this README lists only what exists in the repo today.

## What exists today

| Part | Where | Checked by |
|---|---|---|
| Read `npm outdated` into a list of upgrade candidates | `src/plan/outdated.mjs` | `test/outdated.test.mjs` |
| Compare versions and label an upgrade breaking or compatible | `src/plan/semver.mjs` | `test/semver.test.mjs` |

## Not built yet

- Running the app and walking it with Kane CLI after an upgrade
- Finding which package broke the app
- Handing the breaking package to a coding agent and re-verifying its fix
- The report and the pull request

## Run the tests

```bash
npm test
```

Needs Node 20 or newer. No dependencies to install.
