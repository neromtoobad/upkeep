# Upkeep report: js-equality-game

**8 packages behind · 8 upgraded and verified · 1 upgrade broke the app and was fixed (2 packages)**

Branch `upkeep/2026-11-24-1611` · 9 checks · 15 min · 164.28 Kane credits. Every check is install, build, boot, then Kane CLI walking 3 flows in a real browser at http://localhost:4317.

## Upgraded as they are

| Package | From | To | Jump | Verified by |
|---|---|---|---|---|
| core-js | 3.16.0 | 3.51.0 | minor | Kane CLI 3/3 flows, check 2, commit `f5c21ed` |
| whatwg-fetch | 3.6.2 | 3.6.20 | patch | Kane CLI 3/3 flows, check 2, commit `f5c21ed` |
| eslint-plugin-prettier | 3.1.4 | 5.5.7 | major | Kane CLI 3/3 flows, check 9, commit `a909e3e` |
| prettier | 1.19.1 | 3.10.1 | major | Kane CLI 3/3 flows, check 9, commit `a909e3e` |
| gh-pages | 3.2.3 | 6.3.0 | major | Kane CLI 3/3 flows, check 9, commit `a909e3e` |
| rimraf | 3.0.2 | 6.1.4 | major | Kane CLI 3/3 flows, check 9, commit `a909e3e` |

## Upgraded with a fix

These upgrades broke the app. Kane CLI caught it, Claude Code changed the app, and Kane CLI passed every flow again before the upgrade was committed.

### react 16.14.0 → 19.3.1, react-dom 16.14.0 → 19.3.1

- **What broke** (check 7, at kane): 3 of 3 flows failed: language_test.md: The page remains on Loading after waits and a refresh, with no Language dropdown available.
- **The fix** (1 round): `src/render.js`
- **In the agent's words:** I replaced the removed `ReactDOM.render(...)` call in `src/render.js` with React 19's `createRoot(...).render(<App />)` from `react-dom/client`. That call was what threw `n.render is not a function` and left the page stuck on "Loading". Nothing was built or run here, so Kane's re-walk is the first real check. I also scanned the components and the `immer-wieder` state library for other APIs React 19 removed and found none, so no other changes were needed.
- **Verified:** Kane CLI 3/3 flows, check 8, commit `2d120de`

## Every check

| # | Applied | Result | Time | Credits |
|---|---|---|---|---|
| 1 | nothing (the app as it is) | pass: 3 of 3 flows passed. | 146s | 42.63 |
| 2 | core-js, whatwg-fetch | pass: 3 of 3 flows passed. | 49s | 0 |
| 3 | eslint-plugin-prettier+prettier, gh-pages, react+react-dom, rimraf | **fail at kane**: 3 of 3 flows failed: language_test.md: action_failed: select @ step 2 | 55s | 13.6 |
| 4 | eslint-plugin-prettier+prettier, gh-pages | pass: 3 of 3 flows passed. | 39s | 0 |
| 5 | react+react-dom, rimraf | **fail at kane**: 3 of 3 flows failed: language_test.md: action_failed: select @ step 2 | 56s | 14.24 |
| 6 | react+react-dom | **fail at kane**: 3 of 3 flows failed: language_test.md: action_failed: select @ step 2 | 56s | 13.94 |
| 7 | react+react-dom | **fail at kane**: 3 of 3 flows failed: language_test.md: The page remains on Loading after waits and a refresh, with no Language dropdown available. | 344s | 79.88 |
| 8 | react+react-dom | pass: 3 of 3 flows passed. | 38s | 0 |
| 9 | eslint-plugin-prettier+prettier, gh-pages, rimraf | pass: 3 of 3 flows passed. | 36s | 0 |

Kane CLI evidence packs for each check are in the run folder next to this report.

Made by Upkeep 0.1.0 (commit d62ccd5) with Kane CLI 0.10.6.
