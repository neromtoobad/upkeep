# Upkeep report: margin-paper-goods

**4 packages behind · 3 upgraded and verified · 1 held back**

Branch `upkeep/2026-11-19-1450` · 3 checks · 7 min · 59.42 Kane credits. Every check is install, build, boot, then Kane CLI walking 3 flows in a real browser at http://localhost:4173.

## Upgraded as they are

| Package | From | To | Jump | Verified by |
|---|---|---|---|---|
| axios | 1.2.0 | 1.21.1 | minor | Kane CLI 3/3 flows, check 2, commit `3d6b67f` |
| classnames | 2.2.6 | 2.5.1 | minor | Kane CLI 3/3 flows, check 2, commit `3d6b67f` |
| prop-types | 15.7.2 | 15.8.1 | minor | Kane CLI 3/3 flows, check 2, commit `3d6b67f` |

## Held back

Not on the branch. The app does not pass its flows with these, and no fix was verified.

### date-fns 1.30.1 → 4.4.0

- **What breaks** (at kane): 1 of 3 flows failed: checkout_test.md: Order submission navigated to a blank page; confirmation text remained absent after waits, refresh, and returning to checkout.
- **Why it was held back:** no coding agent was asked to fix it

## Every check

| # | Applied | Result | Time | Credits |
|---|---|---|---|---|
| 1 | nothing (the app as it is) | pass: 3 of 3 flows passed | 63s | 6.95 |
| 2 | axios, classnames, prop-types | pass: 3 of 3 flows passed | 64s | 8.3 |
| 3 | date-fns | **fail at kane**: 1 of 3 flows failed: checkout_test.md: Order submission navigated to a blank page; confirmation text remained absent after waits, refresh, and returning to checkout. | 292s | 44.17 |

Kane CLI evidence packs for each check are in the run folder next to this report.
