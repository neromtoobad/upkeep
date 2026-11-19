# Upkeep report: margin-paper-goods

**12 packages behind · 12 upgraded and verified · 4 upgrades broke the app and were fixed (7 packages)**

Branch `upkeep/2026-11-19-2222` · 29 checks · 33 min · 407.75 Kane credits. Every check is install, build, boot, then Kane CLI walking 3 flows in a real browser at http://localhost:4173.

## Upgraded as they are

| Package | From | To | Jump | Verified by |
|---|---|---|---|---|
| axios | 1.2.0 | 1.21.1 | minor | Kane CLI 3/3 flows, check 2, commit `9126fe9` |
| classnames | 2.2.6 | 2.5.1 | minor | Kane CLI 3/3 flows, check 2, commit `9126fe9` |
| prop-types | 15.7.2 | 15.8.1 | minor | Kane CLI 3/3 flows, check 2, commit `9126fe9` |
| @vitejs/plugin-react | 3.0.0 | 6.3.0 | major | Kane CLI 3/3 flows, check 26, commit `b9f537f` |
| vite | 4.0.0 | 8.3.8 | major | Kane CLI 3/3 flows, check 26, commit `b9f537f` |

## Upgraded with a fix

These upgrades broke the app. Kane CLI caught it, Claude Code changed the app, and Kane CLI passed every flow again before the upgrade was committed.

### nanoid 2.1.11 → 6.0.2

- **What broke** (check 9, at build): build failed: "default" is not exported by "node_modules/nanoid/index.browser.js", imported by "src/orders.js".
- **The fix** (1 round): `src/orders.js`
- **In the agent's words:** I changed the import in `src/orders.js:1` from `import nanoid from 'nanoid'` to `import { nanoid } from 'nanoid'`. nanoid 6 no longer has a default export and only provides `nanoid` as a named export, which is why the build failed. The call `nanoid(8)` still works the same way: it makes 8-character IDs from the same URL-safe 64-character set, so order IDs look the same as before. I haven't rebuilt the app or run the flows here, so that will happen when Upkeep re-runs them.
- **Verified:** Kane CLI 3/3 flows, check 10, commit `3026fef`

### date-fns 1.30.1 → 4.4.0

- **What broke** (check 15, at kane): 1 of 3 flows failed: checkout_test.md: The order route remains blank after multiple waits and refreshes, with no confirmation text available to verify.
- **The fix** (1 round): `src/pages/Order.jsx`
- **In the agent's words:** I changed the two date formats in `src/pages/Order.jsx` to the token names date-fns 4 uses. The placed-on date is now `'dd/MM/yyyy'` (was `'DD/MM/YYYY'`) and the arrival date is now `'EEEE d MMMM'` (was `'dddd D MMMM'`). Starting with v2, date-fns throws an error on the old `DD`/`YYYY`/`D` tokens, and that error is why the order page rendered blank. The page shows the same dates as before. I haven't run the app; Upkeep's rebuild and Kane's re-run of the checkout flow will confirm it.
- **Verified:** Kane CLI 3/3 flows, check 16, commit `bc9d28b`

### js-cookie 2.2.1 → 3.0.8

- **What broke** (check 21, at kane): 3 of 3 flows failed: browse_test.md: The root shop page remains empty after waiting and refreshing, with no products or navigation controls available.
- **The fix** (1 round): `src/cart.js`
- **In the agent's words:** I changed `src/cart.js` because js-cookie 3 no longer has `Cookies.getJSON`, and `Cookies.set` no longer turns objects into JSON on its own. The cart now saves its contents to the cookie with `JSON.stringify` and reads them back with `JSON.parse`. If the cookie is missing or can't be read, it falls back to an empty cart. Behaviour for the user stays the same, but I couldn't run the browser, so whether the three flows pass now depends on Upkeep's rebuild and Kane's next run.
- **Verified:** Kane CLI 3/3 flows, check 22, commit `d00afa9`

### react 17.0.2 → 19.3.1, react-dom 17.0.2 → 19.3.1, react-hook-form 6.15.8 → 7.92.0, react-markdown 5.0.3 → 10.1.0

- **What broke** (check 28, at kane): 3 of 3 flows failed: browse_test.md: The shop URL has an empty root after waiting and refreshing, so no home page content is available.
- **The fix** (1 round): `src/main.jsx`, `src/pages/Checkout.jsx`, `src/pages/Product.jsx`
- **In the agent's words:** I updated the app code for the new versions, but I couldn't build or run anything here, so none of it is tested yet; the Kane walk after the rebuild will be the first check. - **Blank page (the reported failure):** React 19 removed `ReactDOM.render`, which is the error in the console. `src/main.jsx` now starts the app with `createRoot` from `react-dom/client`. - **Product description:** react-markdown 10 no longer accepts the `source` prop, so in `src/pages/Product.jsx` the description is now passed as children. - **Checkout form:** react-hook-form 7 changed how inputs are registered (`{...register('name', rules)}` instead of a `ref`) and moved `errors` under `formState`. `src/pages/Checkout.jsx` now uses both, with the same validation rules and error messages as before.
- **Verified:** Kane CLI 3/3 flows, check 29, commit `aeb9966`

## Every check

| # | Applied | Result | Time | Credits |
|---|---|---|---|---|
| 1 | nothing (the app as it is) | pass: 3 of 3 flows passed. | 50s | 5.83 |
| 2 | axios, classnames, prop-types | pass: 3 of 3 flows passed. | 52s | 5.79 |
| 3 | 5 units: @vitejs/plugin-react+vite, date-fns, js-cookie, … | **fail at build**: build failed: Build failed with 1 error: | 19s |  |
| 4 | @vitejs/plugin-react+vite, date-fns | got past build; not checked further (search step, stopped after build) | 4s |  |
| 5 | js-cookie, nanoid, react+react-dom+react-hook-form+react-markdown | **fail at build**: build failed: [vite]: Rollup failed to resolve import "#minpath" from "node_modules/vfile/lib/index.js". | 3s |  |
| 6 | js-cookie | got past build; not checked further (search step, stopped after build) | 2s |  |
| 7 | nanoid, react+react-dom+react-hook-form+react-markdown | **fail at build**: build failed: [vite]: Rollup failed to resolve import "#minpath" from "node_modules/vfile/lib/index.js". | 2s |  |
| 8 | nanoid | **fail at build**: build failed: "default" is not exported by "node_modules/nanoid/index.browser.js", imported by "src/orders.js". | 1s |  |
| 9 | nanoid | **fail at build**: build failed: "default" is not exported by "node_modules/nanoid/index.browser.js", imported by "src/orders.js". | 1s |  |
| 10 | nanoid | pass: 3 of 3 flows passed. | 57s | 6.88 |
| 11 | @vitejs/plugin-react+vite, date-fns, js-cookie, react+react-dom+react-hook-form+react-markdown | **fail at kane**: 3 of 3 flows failed: browse_test.md: assertion_failed: @ step 6 | 73s | 24.96 |
| 12 | @vitejs/plugin-react+vite, date-fns | **fail at kane**: 1 of 3 flows failed: checkout_test.md: assertion_failed: @ step 11 | 113s | 17.78 |
| 13 | @vitejs/plugin-react+vite | pass: 3 of 3 flows passed. | 46s | 5.75 |
| 14 | date-fns | **fail at kane**: 1 of 3 flows failed: checkout_test.md: analyzer_failed: @ step 10 | 122s | 17.57 |
| 15 | date-fns | **fail at kane**: 1 of 3 flows failed: checkout_test.md: The order route remains blank after multiple waits and refreshes, with no confirmation text available to verify. | 333s | 50.43 |
| 16 | date-fns | pass: 3 of 3 flows passed. | 64s | 8.61 |
| 17 | @vitejs/plugin-react+vite, js-cookie, react+react-dom+react-hook-form+react-markdown | **fail at kane**: 3 of 3 flows failed: browse_test.md: assertion_failed: @ step 6 | 92s | 23 |
| 18 | @vitejs/plugin-react+vite | pass: 3 of 3 flows passed. | 46s | 5.81 |
| 19 | js-cookie, react+react-dom+react-hook-form+react-markdown | **fail at build**: build failed: [vite]: Rollup failed to resolve import "#minpath" from "node_modules/vfile/lib/index.js". | 3s |  |
| 20 | js-cookie | **fail at kane**: 3 of 3 flows failed: browse_test.md: analyzer_failed: @ step 4 | 50s | 18.97 |
| 21 | js-cookie | **fail at kane**: 3 of 3 flows failed: browse_test.md: The root shop page remains empty after waiting and refreshing, with no products or navigation controls available. | 125s | 68.05 |
| 22 | js-cookie | pass: 3 of 3 flows passed. | 57s | 6.95 |
| 23 | @vitejs/plugin-react+vite, react+react-dom+react-hook-form+react-markdown | **fail at kane**: 3 of 3 flows failed: browse_test.md: analyzer_failed: @ step 4 | 74s | 18.78 |
| 24 | @vitejs/plugin-react+vite | pass: 3 of 3 flows passed. | 56s | 7.04 |
| 25 | react+react-dom+react-hook-form+react-markdown | **fail at build**: build failed: [vite]: Rollup failed to resolve import "#minpath" from "node_modules/vfile/lib/index.js". | 3s |  |
| 26 | @vitejs/plugin-react+vite | pass: 3 of 3 flows passed. | 48s | 5.75 |
| 27 | react+react-dom+react-hook-form+react-markdown | **fail at kane**: 3 of 3 flows failed: browse_test.md: assertion_failed: @ step 6 | 66s | 19.65 |
| 28 | react+react-dom+react-hook-form+react-markdown | **fail at kane**: 3 of 3 flows failed: browse_test.md: The shop URL has an empty root after waiting and refreshing, so no home page content is available. | 229s | 83.2 |
| 29 | react+react-dom+react-hook-form+react-markdown | pass: 3 of 3 flows passed. | 59s | 6.94 |

Kane CLI evidence packs for each check are in the run folder next to this report.
