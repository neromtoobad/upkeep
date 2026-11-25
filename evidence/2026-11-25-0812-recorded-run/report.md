# Upkeep report: margin-paper-goods

**12 packages behind · 12 upgraded and verified · 4 upgrades broke the app and were fixed (7 packages)**

Branch `upkeep/2026-11-25-0812` · 29 checks · 33 min · 386.57 Kane credits. Every check is install, build, boot, then Kane CLI walking 3 flows in a real browser at http://localhost:4173.

## Upgraded as they are

| Package | From | To | Jump | Verified by |
|---|---|---|---|---|
| axios | 1.2.0 | 1.21.1 | minor | Kane CLI 3/3 flows, check 2, commit `47a85c2` |
| classnames | 2.2.6 | 2.5.1 | minor | Kane CLI 3/3 flows, check 2, commit `47a85c2` |
| prop-types | 15.7.2 | 15.8.1 | minor | Kane CLI 3/3 flows, check 2, commit `47a85c2` |
| @vitejs/plugin-react | 3.0.0 | 6.3.0 | major | Kane CLI 3/3 flows, check 26, commit `6d9d2d1` |
| vite | 4.0.0 | 8.3.8 | major | Kane CLI 3/3 flows, check 26, commit `6d9d2d1` |

## Upgraded with a fix

These upgrades broke the app. Kane CLI caught it, Claude Code changed the app, and Kane CLI passed every flow again before the upgrade was committed.

### nanoid 2.1.11 → 6.0.2

- **What broke** (check 9, at build): build failed: [31m"default" is not exported by "node_modules/nanoid/index.browser.js", imported by "src/orders.js".[39m
- **The fix** (1 round): `src/orders.js`
- **In the agent's words:** I changed the import in `src/orders.js:1` from the default import to the named one (`import { nanoid } from 'nanoid'`), because nanoid 6 no longer has a default export. The call `nanoid(8)` is unchanged and still produces an 8-character URL-safe order ID, so behaviour is the same for the user. I have not run the build or the flows; that happens on the Upkeep rebuild.
- **Verified:** Kane CLI 3/3 flows, check 10, commit `788683e`

### date-fns 1.30.1 → 4.4.0

- **What broke** (check 15, at kane): 1 of 3 flows failed: checkout_test.md: Order URL remains blank after waits and refresh; confirmation text and date are absent.
- **The fix** (1 round): `src/pages/Order.jsx`
- **In the agent's words:** I changed the two date format strings in `src/pages/Order.jsx`: `'DD/MM/YYYY'` is now `'dd/MM/yyyy'`, and `'dddd D MMMM'` is now `'EEEE d MMMM'`. Not run here; Kane's re-walk is the check. date-fns 2 and later use Unicode tokens and throw on the old `DD`, `YYYY` and `D`, which is what crashed the confirmation page. The second string (the "arrive by" date) was not in Kane's error, but it would have thrown next on the same page, so I fixed it in the same edit. The page should show the same text as before, e.g. `25/11/2026` and `Monday 30 November`.
- **Verified:** Kane CLI 3/3 flows, check 16, commit `fe6d4e8`

### js-cookie 2.2.1 → 3.0.8

- **What broke** (check 21, at kane): 3 of 3 flows failed: browse_test.md: The root page remained blank after waiting; no shop content or navigation controls are present.
- **The fix** (1 round): `src/cart.js`
- **In the agent's words:** I changed `src/cart.js` so the cart cookie is read with `Cookies.get` plus `JSON.parse` and written with `JSON.stringify`. js-cookie 3 removed `getJSON`, which crashed the app at startup, and its `set` no longer serialises objects, which would have broken the cart surviving a reload. A missing or unreadable cookie falls back to an empty cart. Nothing has been run yet; Kane's re-walk is the check.
- **Verified:** Kane CLI 3/3 flows, check 22, commit `6f35831`

### react 17.0.2 → 19.3.1, react-dom 17.0.2 → 19.3.1, react-hook-form 6.15.8 → 7.92.0, react-markdown 5.0.3 → 10.1.0

- **What broke** (check 28, at kane): 3 of 3 flows failed: browse_test.md: The root shop page and refresh both remain blank with no catalog content to verify.
- **The fix** (1 round): `src/main.jsx`, `src/pages/Checkout.jsx`, `src/pages/Product.jsx`
- **In the agent's words:** I migrated the three call sites that the new majors broke; nothing has been built or run here, so Kane's re-walk is the first real check. - **`src/main.jsx`**: React 19 removed `ReactDOM.render`, which was the blank-page crash in all three flows. It now uses `createRoot` from `react-dom/client`. - **`src/pages/Product.jsx`**: react-markdown 10 no longer accepts the `source` prop, so the description is passed as children. - **`src/pages/Checkout.jsx`**: react-hook-form 7 changed `register` and moved `errors`. The inputs now use `{...register('name', rules)}` and `errors` is read from `formState`.
- **Verified:** Kane CLI 3/3 flows, check 29, commit `30eb07c`

## Every check

| # | Applied | Result | Time | Credits |
|---|---|---|---|---|
| 1 | nothing (the app as it is) | pass: 3 of 3 flows passed. | 71s | 6.96 |
| 2 | axios, classnames, prop-types | pass: 3 of 3 flows passed. | 68s | 5.89 |
| 3 | 5 units: @vitejs/plugin-react+vite, date-fns, js-cookie, … | **fail at build**: build failed: [31merror during build: | 20s |  |
| 4 | @vitejs/plugin-react+vite, date-fns | got past build; not checked further (search step, stopped after build) | 4s |  |
| 5 | js-cookie, nanoid, react+react-dom+react-hook-form+react-markdown | **fail at build**: build failed: [31m[vite]: Rollup failed to resolve import "#minpath" from "node_modules/vfile/lib/index.js". | 3s |  |
| 6 | js-cookie | got past build; not checked further (search step, stopped after build) | 2s |  |
| 7 | nanoid, react+react-dom+react-hook-form+react-markdown | **fail at build**: build failed: [31m[vite]: Rollup failed to resolve import "#minpath" from "node_modules/vfile/lib/index.js". | 2s |  |
| 8 | nanoid | **fail at build**: build failed: [31m"default" is not exported by "node_modules/nanoid/index.browser.js", imported by "src/orders.js".[39m | 2s |  |
| 9 | nanoid | **fail at build**: build failed: [31m"default" is not exported by "node_modules/nanoid/index.browser.js", imported by "src/orders.js".[39m | 2s |  |
| 10 | nanoid | pass: 3 of 3 flows passed. | 44s | 5.96 |
| 11 | @vitejs/plugin-react+vite, date-fns, js-cookie, react+react-dom+react-hook-form+react-markdown | **fail at kane**: 3 of 3 flows failed: browse_test.md: assertion_failed: @ step 6 | 70s | 23.42 |
| 12 | @vitejs/plugin-react+vite, date-fns | **fail at kane**: 1 of 3 flows failed: checkout_test.md: analyzer_failed: @ step 9 | 93s | 10.63 |
| 13 | @vitejs/plugin-react+vite | pass: 3 of 3 flows passed. | 52s | 7.19 |
| 14 | date-fns | **fail at kane**: 1 of 3 flows failed: checkout_test.md: analyzer_failed: @ step 10 | 112s | 16.26 |
| 15 | date-fns | **fail at kane**: 1 of 3 flows failed: checkout_test.md: Order URL remains blank after waits and refresh; confirmation text and date are absent. | 287s | 48.52 |
| 16 | date-fns | pass: 3 of 3 flows passed. | 49s | 5.99 |
| 17 | @vitejs/plugin-react+vite, js-cookie, react+react-dom+react-hook-form+react-markdown | **fail at kane**: 3 of 3 flows failed: browse_test.md: assertion_failed: @ step 6 | 90s | 23.11 |
| 18 | @vitejs/plugin-react+vite | pass: 3 of 3 flows passed. | 58s | 8.04 |
| 19 | js-cookie, react+react-dom+react-hook-form+react-markdown | **fail at build**: build failed: [31m[vite]: Rollup failed to resolve import "#minpath" from "node_modules/vfile/lib/index.js". | 4s |  |
| 20 | js-cookie | **fail at kane**: 3 of 3 flows failed: browse_test.md: assertion_failed: @ step 6 | 74s | 24.44 |
| 21 | js-cookie | **fail at kane**: 3 of 3 flows failed: browse_test.md: The root page remained blank after waiting; no shop content or navigation controls are present. | 116s | 68.96 |
| 22 | js-cookie | pass: 3 of 3 flows passed. | 62s | 5.85 |
| 23 | @vitejs/plugin-react+vite, react+react-dom+react-hook-form+react-markdown | **fail at kane**: 3 of 3 flows failed: browse_test.md: analyzer_failed: @ step 4 | 86s | 19.27 |
| 24 | @vitejs/plugin-react+vite | pass: 3 of 3 flows passed. | 66s | 8.23 |
| 25 | react+react-dom+react-hook-form+react-markdown | **fail at build**: build failed: [31m[vite]: Rollup failed to resolve import "#minpath" from "node_modules/vfile/lib/index.js". | 4s |  |
| 26 | @vitejs/plugin-react+vite | pass: 3 of 3 flows passed. | 61s | 8.17 |
| 27 | react+react-dom+react-hook-form+react-markdown | **fail at kane**: 3 of 3 flows failed: browse_test.md: analyzer_failed: @ step 5 | 71s | 21.99 |
| 28 | react+react-dom+react-hook-form+react-markdown | **fail at kane**: 3 of 3 flows failed: browse_test.md: The root shop page and refresh both remain blank with no catalog content to verify. | 225s | 60.71 |
| 29 | react+react-dom+react-hook-form+react-markdown | pass: 3 of 3 flows passed. | 62s | 6.99 |

Kane CLI evidence packs for each check are in the run folder next to this report.

Made by Upkeep 0.1.0 (commit 47a6256) with Kane CLI 0.10.6.
