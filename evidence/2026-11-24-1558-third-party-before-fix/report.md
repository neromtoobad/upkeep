# Upkeep report: js-equality-game

**8 packages behind · 2 upgraded and verified · 6 held back**

Branch `upkeep/2026-11-24-1558` · 14 checks · 3 min · 56.83 Kane credits. Every check is install, build, boot, then Kane CLI walking 3 flows in a real browser at http://localhost:4317.

## Upgraded as they are

| Package | From | To | Jump | Verified by |
|---|---|---|---|---|
| core-js | 3.16.0 | 3.51.0 | minor | Kane CLI 3/3 flows, check 2, commit `5ed8988` |
| whatwg-fetch | 3.6.2 | 3.6.20 | patch | Kane CLI 3/3 flows, check 2, commit `5ed8988` |

## Held back

Not on the branch. The app does not pass its flows with these, and no fix was verified.

### eslint-plugin-prettier 3.1.4 → 5.5.7, prettier 1.19.1 → 3.10.1

- **What breaks** (at install): install failed: packages disagree about a shared dependency · Found: eslint-plugin-prettier@3.1.4 · peer eslint-plugin-prettier@"^3.1.0" from @slikts/eslint-config-prettier@6.0.3
- **Why it was held back:** install failed: packages disagree about a shared dependency · Found: eslint-plugin-prettier@3.1.4 · peer eslint-plugin-prettier@"^3.1.0" from @slikts/eslint-config-prettier@6.0.3

### gh-pages 3.2.3 → 6.3.0

- **What breaks** (at install): install failed: packages disagree about a shared dependency · Found: eslint@8.28.0 · peer eslint@"^7.5.0 \|\| ^8.0.0" from @babel/eslint-parser@7.19.1
- **Why it was held back:** install failed: packages disagree about a shared dependency · Found: eslint@8.28.0 · peer eslint@"^7.5.0 \|\| ^8.0.0" from @babel/eslint-parser@7.19.1

### react 16.14.0 → 19.3.1, react-dom 16.14.0 → 19.3.1

- **What breaks** (at install): install failed: packages disagree about a shared dependency · Found: eslint@8.28.0 · npm warn Could not resolve dependency:
- **Why it was held back:** install failed: packages disagree about a shared dependency · Found: eslint@8.28.0 · npm warn Could not resolve dependency:

### rimraf 3.0.2 → 6.1.4

- **What breaks** (at install): install failed: packages disagree about a shared dependency · Found: eslint@8.28.0 · peer eslint@"^7.5.0 \|\| ^8.0.0" from @babel/eslint-parser@7.19.1
- **Why it was held back:** install failed: packages disagree about a shared dependency · Found: eslint@8.28.0 · peer eslint@"^7.5.0 \|\| ^8.0.0" from @babel/eslint-parser@7.19.1

## Every check

| # | Applied | Result | Time | Credits |
|---|---|---|---|---|
| 1 | nothing (the app as it is) | pass: 3 of 3 flows passed. | 94s | 56.83 |
| 2 | core-js, whatwg-fetch | pass: 3 of 3 flows passed. | 41s | 0 |
| 3 | eslint-plugin-prettier+prettier, gh-pages, react+react-dom, rimraf | **fail at install**: install failed: packages disagree about a shared dependency · Found: eslint-plugin-prettier@3.1.4 · peer eslint-plugin-prettier@"^3.1.0" from @slikts/eslint-config-prettier@6.0.3 | 1s |  |
| 4 | eslint-plugin-prettier+prettier, gh-pages | **fail at install**: install failed: packages disagree about a shared dependency · Found: eslint-plugin-prettier@3.1.4 · peer eslint-plugin-prettier@"^3.1.0" from @slikts/eslint-config-prettier@6.0.3 | 1s |  |
| 5 | eslint-plugin-prettier+prettier | **fail at install**: install failed: packages disagree about a shared dependency · Found: eslint-plugin-prettier@3.1.4 · peer eslint-plugin-prettier@"^3.1.0" from @slikts/eslint-config-prettier@6.0.3 | 1s |  |
| 6 | eslint-plugin-prettier+prettier | **fail at install**: install failed: packages disagree about a shared dependency · Found: eslint-plugin-prettier@3.1.4 · peer eslint-plugin-prettier@"^3.1.0" from @slikts/eslint-config-prettier@6.0.3 | 1s |  |
| 7 | gh-pages, react+react-dom, rimraf | **fail at install**: install failed: packages disagree about a shared dependency · Found: eslint@8.28.0 · npm warn Could not resolve dependency: | 2s |  |
| 8 | gh-pages | **fail at install**: install failed: packages disagree about a shared dependency · Found: eslint@8.28.0 · peer eslint@"^7.5.0 \|\| ^8.0.0" from @babel/eslint-parser@7.19.1 | 1s |  |
| 9 | gh-pages | **fail at install**: install failed: packages disagree about a shared dependency · Found: eslint@8.28.0 · peer eslint@"^7.5.0 \|\| ^8.0.0" from @babel/eslint-parser@7.19.1 | 1s |  |
| 10 | react+react-dom, rimraf | **fail at install**: install failed: packages disagree about a shared dependency · Found: eslint@8.28.0 · npm warn Could not resolve dependency: | 1s |  |
| 11 | react+react-dom | **fail at install**: install failed: packages disagree about a shared dependency · Found: eslint@8.28.0 · npm warn Could not resolve dependency: | 1s |  |
| 12 | react+react-dom | **fail at install**: install failed: packages disagree about a shared dependency · Found: eslint@8.28.0 · npm warn Could not resolve dependency: | 1s |  |
| 13 | rimraf | **fail at install**: install failed: packages disagree about a shared dependency · Found: eslint@8.28.0 · peer eslint@"^7.5.0 \|\| ^8.0.0" from @babel/eslint-parser@7.19.1 | 1s |  |
| 14 | rimraf | **fail at install**: install failed: packages disagree about a shared dependency · Found: eslint@8.28.0 · peer eslint@"^7.5.0 \|\| ^8.0.0" from @babel/eslint-parser@7.19.1 | 1s |  |

Kane CLI evidence packs for each check are in the run folder next to this report.

Made by Upkeep 0.1.0 (commit 8801fa6) with Kane CLI 0.10.6.
