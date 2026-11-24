# Upkeep report: js-equality-game

**8 packages behind · 1 upgraded and verified**

Branch `upkeep/2026-11-24-1604` · 5 checks · 7 min · 59.85 Kane credits. Every check is install, build, boot, then Kane CLI walking 3 flows in a real browser at http://localhost:4317.

**Stopped early:** the check could not run: npm refuses to change this project's packages at all (peer eslint@"^5.16.0" from @slikts/eslint-config-prettier@6.0.3; found eslint@8.28.0). None of the packages being upgraded is part of that conflict: it was already in the project, hidden by the lockfile. If you install this project with --legacy-peer-deps, put {"install": "npm install --legacy-peer-deps --no-audit --no-fund"} in upkeep.config.json, or fix the conflict first.

## Upgraded as they are

| Package | From | To | Jump | Verified by |
|---|---|---|---|---|
| core-js | 3.16.0 | 3.51.0 | minor | Kane CLI 3/3 flows, check 4, commit `b4be290` |

## Every check

| # | Applied | Result | Time | Credits |
|---|---|---|---|---|
| 1 | nothing (the app as it is) | pass: 3 of 3 flows passed. | 138s | 34.83 |
| 2 | core-js, whatwg-fetch | **fail at kane**: 1 of 3 flows failed: open_test.md: assertion_failed: @ step 6 | 64s | 5.13 |
| 3 | core-js | **fail at kane**: 1 of 3 flows failed: open_test.md: assertion_failed: @ step 6 | 78s | 1.61 |
| 4 | core-js | pass: 3 of 3 flows passed. Kane healed 1 flow: the page changed. | 95s | 18.28 |
| 5 | whatwg-fetch | could not check: npm refuses to change this project's packages at all (peer eslint@"^5.16.0" from @slikts/eslint-config-prettier@6.0.3; found eslint@8.28.0). None of the packages being upgraded is part of that conflict: it was already in the project, hidden by the lockfile. If you install this project with --legacy-peer-deps, put {"install": "npm install --legacy-peer-deps --no-audit --no-fund"} in upkeep.config.json, or fix the conflict first. | 4s |  |

Kane CLI evidence packs for each check are in the run folder next to this report.

Made by Upkeep 0.1.0 (commit d62ccd5) with Kane CLI 0.10.6.
