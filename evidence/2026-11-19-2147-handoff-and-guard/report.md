# Upkeep report: margin-paper-goods

**1 package behind · 1 upgraded and verified · 1 upgrade broke the app and was fixed**

Branch `upkeep/2026-11-19-2147` · 4 checks · 7 min · 90.11 Kane credits. Every check is install, build, boot, then Kane CLI walking 3 flows in a real browser at http://localhost:4173.

## Upgraded with a fix

These upgrades broke the app. Kane CLI caught it, the agent in your session changed the app, and Kane CLI passed every flow again before the upgrade was committed.

### js-cookie 2.2.1 → 3.0.8

- **What broke** (check 3, at kane): 3 of 3 flows failed: browse_test.md: The root page finished loading with an empty root and no shop home content.
- **The fix** (1 round): `src/cart.js`
- **In the agent's words:** js-cookie 3 removed getJSON and stopped serialising objects, so src/cart.js now reads the cart with Cookies.get + JSON.parse and writes it with JSON.stringify. (This run also weakened flows/checkout_test.md on purpose, to exercise Upkeep's guard.)
- **Undone by Upkeep** in round 1: the agent edited flows/checkout_test.md (the flows and their recordings are the definition of "works")
- **Verified:** Kane CLI 3/3 flows, check 4, commit `bb75e38`

## Every check

| # | Applied | Result | Time | Credits |
|---|---|---|---|---|
| 1 | nothing (the app as it is) | pass: 3 of 3 flows passed. | 69s | 7.82 |
| 2 | js-cookie | **fail at kane**: 3 of 3 flows failed: browse_test.md: assertion_failed: @ step 6 | 75s | 23.13 |
| 3 | js-cookie | **fail at kane**: 3 of 3 flows failed: browse_test.md: The root page finished loading with an empty root and no shop home content. | 179s | 51.36 |
| 4 | js-cookie | pass: 3 of 3 flows passed. | 66s | 7.8 |

Kane CLI evidence packs for each check are in the run folder next to this report.
