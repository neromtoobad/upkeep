# Upkeep report: margin-paper-goods

**12 packages behind · 12 upgraded and verified · 4 upgrades broke the app and were fixed (9 packages)**

Branch `upkeep/2026-11-19-2110` · 27 checks · 34 min · 557.28 Kane credits. Every check is install, build, boot, then Kane CLI walking 3 flows in a real browser at http://localhost:4173.

## Upgraded as they are

| Package | From | To | Jump | Verified by |
|---|---|---|---|---|
| axios | 1.2.0 | 1.21.1 | minor | Kane CLI 3/3 flows, check 2, commit `3f29c04` |
| classnames | 2.2.6 | 2.5.1 | minor | Kane CLI 3/3 flows, check 2, commit `3f29c04` |
| prop-types | 15.7.2 | 15.8.1 | minor | Kane CLI 3/3 flows, check 2, commit `3f29c04` |

## Upgraded with a fix

These upgrades broke the app. Kane CLI caught it, Claude Code changed the app, and Kane CLI passed every flow again before the upgrade was committed.

### nanoid 2.1.11 → 6.0.2

- **What broke** (check 9, at build): build failed: "default" is not exported by "node_modules/nanoid/index.browser.js", imported by "src/orders.js".
- **The fix** (1 round): `src/orders.js`
- **In the agent's words:** nanoid 6.x dropped the default export and only provides the named `nanoid` export, so `src/orders.js` now imports `{ nanoid }` instead of a default import. The call site (`nanoid(8)`) is unchanged since the function signature stayed the same.
- **Verified:** Kane CLI 3/3 flows, check 10, commit `8f7299a`

### date-fns 1.30.1 → 4.4.0

- **What broke** (check 15, at kane): 1 of 3 flows failed: checkout_test.md: Final verification failed: "the page says "Thanks, Ada Marsh" and shows the words "placed on" followed by a date written as two digits, a slash, two digits, a slash and four digits"
- **The fix** (1 round): `src/pages/Order.jsx`
- **In the agent's words:** I replaced the v1-style format tokens with date-fns v4's Unicode tokens: `DD/MM/YYYY` → `dd/MM/yyyy` (lowercase `dd`/`yyyy` for calendar day/year — the uppercase versions are ISO week-numbering tokens that date-fns v4 rejects), and `dddd D MMMM` → `EEEE d MMMM` (weekday is now `EEEE`, day-of-month is lowercase `d` since uppercase `D` now means day-of-year). This matches the console error and keeps the displayed date format identical for users.
- **Verified:** Kane CLI 3/3 flows, check 16, commit `4ed468c`

### js-cookie 2.2.1 → 3.0.8

- **What broke** (check 21, at kane): 3 of 3 flows failed: browse_test.md: The current home URL remains blank after waiting and refreshing; the root contains no shop content or product listings.
- **The fix** (1 round): `src/cart.js`
- **In the agent's words:** js-cookie 3.x dropped `Cookies.getJSON`, which caused the `ip.getJSON is not a function` crash on startup. I replaced it with `Cookies.get` + `JSON.parse` for reading the cart cookie, and paired it with `JSON.stringify` on write (`Cookies.set`), since v3 no longer handles plain object/array values implicitly either.
- **Verified:** Kane CLI 3/3 flows, check 22, commit `ca74973`

### @vitejs/plugin-react 3.0.0 → 6.3.0, vite 4.0.0 → 8.3.8, react 17.0.2 → 19.3.1, react-dom 17.0.2 → 19.3.1, react-hook-form 6.15.8 → 7.92.0, react-markdown 5.0.3 → 10.1.0

- **What broke** (check 26, at kane): 3 of 3 flows failed: browse_test.md: The localhost root remains blank after waiting and refreshing; no shop content or navigation is available.
- **The fix** (1 round): `src/main.jsx`, `src/pages/Checkout.jsx`, `src/pages/Product.jsx`
- **In the agent's words:** I'll skip running the build myself since it needs approval I don't have in this session — the changes are straightforward API migrations, and Upkeep will rebuild and re-run Kane CLI to verify. I made three targeted fixes for the React 19 / react-dom 19 / react-hook-form 7 / react-markdown 10 upgrades: 1. **`src/main.jsx`** — `ReactDOM.render` was removed from `react-dom` in React 19 (it only exists via `react-dom/client`'s `createRoot`), which caused the `oi.default.render is not a function` error and blanked every page. Switched to `createRoot(...).render(...)`. 2. **`src/pages/Checkout.jsx`** — react-hook-form v7 changed `register` from a ref-callback factory to a function returning spreadable props, and moved `errors` under `formState`. Updated `useForm()` destructuring and all four `register(...)` calls accordingly. 3. **`src/pages/Product.jsx`** — react-markdown v10 dropped the `source` prop in favor of passing markdown as `children`. Updated `<ReactMarkdown source={...} />` to `<ReactMarkdown>{...}</ReactMarkdown>`.
- **Verified:** Kane CLI 3/3 flows, check 27, commit `7cad74d`

## Every check

| # | Applied | Result | Time | Credits |
|---|---|---|---|---|
| 1 | nothing (the app as it is) | pass: 3 of 3 flows passed. | 52s | 7.64 |
| 2 | axios, classnames, prop-types | pass: 3 of 3 flows passed. | 60s | 7.87 |
| 3 | 5 units: @vitejs/plugin-react+vite, date-fns, js-cookie, … | **fail at build**: build failed: error during build: | 26s |  |
| 4 | @vitejs/plugin-react+vite, date-fns | got past build; not checked further (search step, stopped after build) | 4s |  |
| 5 | js-cookie, nanoid, react+react-dom+react-hook-form+react-markdown | **fail at build**: build failed: [vite]: Rollup failed to resolve import "#minpath" from "~/.cache/upkeep/demo-shop-7205f14b/work/node_modules/vfile/lib/index.js". | 3s |  |
| 6 | js-cookie | got past build; not checked further (search step, stopped after build) | 2s |  |
| 7 | nanoid, react+react-dom+react-hook-form+react-markdown | **fail at build**: build failed: [vite]: Rollup failed to resolve import "#minpath" from "~/.cache/upkeep/demo-shop-7205f14b/work/node_modules/vfile/lib/index.js". | 2s |  |
| 8 | nanoid | **fail at build**: build failed: "default" is not exported by "node_modules/nanoid/index.browser.js", imported by "src/orders.js". | 2s |  |
| 9 | nanoid | **fail at build**: build failed: "default" is not exported by "node_modules/nanoid/index.browser.js", imported by "src/orders.js". | 1s |  |
| 10 | nanoid | pass: 3 of 3 flows passed. | 60s | 7.87 |
| 11 | @vitejs/plugin-react+vite, date-fns, js-cookie, react+react-dom+react-hook-form+react-markdown | **fail at kane**: 3 of 3 flows failed: browse_test.md: assertion_failed: @ step 6 | 82s | 25.1 |
| 12 | @vitejs/plugin-react+vite, date-fns | **fail at kane**: 1 of 3 flows failed: checkout_test.md: analyzer_failed: @ step 9 | 99s | 11.12 |
| 13 | @vitejs/plugin-react+vite | pass: 3 of 3 flows passed. | 61s | 5.89 |
| 14 | date-fns | **fail at kane**: 1 of 3 flows failed: checkout_test.md: analyzer_failed: @ step 9 | 106s | 10.74 |
| 15 | date-fns | **fail at kane**: 1 of 3 flows failed: checkout_test.md: Final verification failed: "the page says "Thanks, Ada Marsh" and shows the words "placed on" followed by a date written as two digits, a slash, two digits, a slash and four digits" | 262s | 58.24 |
| 16 | date-fns | pass: 3 of 3 flows passed. | 98s | 23.55 |
| 17 | @vitejs/plugin-react+vite, js-cookie, react+react-dom+react-hook-form+react-markdown | **fail at kane**: 3 of 3 flows failed: browse_test.md: assertion_failed: @ step 6 | 85s | 22.75 |
| 18 | @vitejs/plugin-react+vite | pass: 3 of 3 flows passed. | 54s | 7.66 |
| 19 | js-cookie, react+react-dom+react-hook-form+react-markdown | **fail at build**: build failed: [vite]: Rollup failed to resolve import "#minpath" from "~/.cache/upkeep/demo-shop-7205f14b/work/node_modules/vfile/lib/index.js". | 6s |  |
| 20 | js-cookie | **fail at kane**: 3 of 3 flows failed: browse_test.md: analyzer_failed: @ step 5 | 73s | 25.28 |
| 21 | js-cookie | **fail at kane**: 3 of 3 flows failed: browse_test.md: The current home URL remains blank after waiting and refreshing; the root contains no shop content or product listings. | 157s | 84.5 |
| 22 | js-cookie | pass: 3 of 3 flows passed. | 147s | 90.91 |
| 23 | @vitejs/plugin-react+vite, react+react-dom+react-hook-form+react-markdown | **fail at kane**: 3 of 3 flows failed: browse_test.md: analyzer_failed: @ step 3 | 60s | 12.28 |
| 24 | @vitejs/plugin-react+vite | pass: 3 of 3 flows passed. | 57s | 6.98 |
| 25 | react+react-dom+react-hook-form+react-markdown | **fail at build**: build failed: [vite]: Rollup failed to resolve import "#minpath" from "~/.cache/upkeep/demo-shop-7205f14b/work/node_modules/vfile/lib/index.js". | 3s |  |
| 26 | @vitejs/plugin-react+vite, react+react-dom+react-hook-form+react-markdown | **fail at kane**: 3 of 3 flows failed: browse_test.md: The localhost root remains blank after waiting and refreshing; no shop content or navigation is available. | 160s | 64.64 |
| 27 | @vitejs/plugin-react+vite, react+react-dom+react-hook-form+react-markdown | pass: 3 of 3 flows passed. | 152s | 84.25 |

Kane CLI evidence packs for each check are in the run folder next to this report.
