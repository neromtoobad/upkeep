# Upkeep report: margin-paper-goods

**1 package behind · 1 upgraded and verified · 1 of those needed a fix**

Branch `upkeep/2026-11-19-1500` · 4 checks · 11 min · 91.18 Kane credits. Every check is install, build, boot, then Kane CLI walking 3 flows in a real browser at http://localhost:4173.

## Upgraded with a fix

These upgrades broke the app. Kane CLI caught it, the coding agent changed the app, and Kane CLI passed every flow again before the upgrade was committed.

### date-fns 1.30.1 → 4.4.0

- **What broke** (check 3, at kane): 1 of 3 flows failed: checkout_test.md: The order route remains blank after waiting and refreshing, so the required confirmation text cannot be verified.
- **The fix** (1 round): `src/pages/Order.jsx`
- **In the agent's words:** I fixed the two date-fns v4 format strings in `src/pages/Order.jsx:17,20`: `DD/MM/YYYY` → `dd/MM/yyyy` (v4 removed the old `DD`/`YYYY` ISO-week tokens, which threw on render) and `dddd D MMMM` → `EEEE d MMMM` (day-of-week and day-of-month tokens were renamed). This keeps the same displayed format while using v4's supported Unicode tokens.
- **Verified:** Kane CLI 3/3 flows, check 4, commit `9e4a06f`

## Every check

| # | Applied | Result | Time | Credits |
|---|---|---|---|---|
| 1 | nothing (the app as it is) | pass: 3 of 3 flows passed | 70s | 7.71 |
| 2 | date-fns | **fail at kane**: 1 of 3 flows failed: checkout_test.md: assertion_failed: @ step 11 | 138s | 17.07 |
| 3 | date-fns | **fail at kane**: 1 of 3 flows failed: checkout_test.md: The order route remains blank after waiting and refreshing, so the required confirmation text cannot be verified. | 299s | 45.11 |
| 4 | date-fns | pass: 3 of 3 flows passed | 136s | 21.29 |

Kane CLI evidence packs for each check are in the run folder next to this report.
