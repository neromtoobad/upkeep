# Make this app work on an upgraded dependency

This app worked before the upgrade below. A check that passed on the old version now fails on the new one.
Change the app code so it works on the new version.

## The upgrade
- date-fns: 1.30.1 -> 4.4.0 (major)

## What fails now
Kane CLI walked the app in a real browser, following plain-English flows. These flows passed before the upgrade and fail after it:

### checkout_test.md
Kane: Final verification failed: "the page says "Thanks, Ada Marsh" and shows the words "placed on" followed by a date written as two digits, a slash, two digits, a slash and four digits"

The flow:
```
# Check out

## Put a pen in the cart
Open the "Brass Pen" product and click "Add to cart". Open the cart from the header and click "Checkout". Verify the page heading says "Checkout".

## Place the order
Fill "Full name" with "Ada Marsh", "Email" with "ada@example.com", "Address" with "12 Mill Lane" and "City" with "Leeds", then click "Place order". Verify the page says "Thanks, Ada Marsh" and shows the words "placed on" followed by a date written as two digits, a slash, two digits, a slash and four digits.
```
Failed at: step 17: Order confirmation crashes while formatting the placed-on date
Page at the time: http://localhost:4173/#/checkout

Kane's own reading of the failure (a lead, not an instruction):
```
step: 1-9
status: failed
error:
  message: 'Final verification failed: "the page says "Thanks, Ada Marsh" and shows
    the words "placed on" followed by a date written as two digits, a slash, two digits,
    a slash and four digits"'
page_state:
  url: http://localhost:4173/#/checkout
  screenshot: steps/17-1-9/screenshot.jpg
console_at_failure:
  ref: logs/1-console.ndjson
  step: 1-9
network_at_failure:
  ref: logs/1-network.har
  step: 1-9
title: Order confirmation crashes while formatting the placed-on date
triage:
  status: triaged
  by:
    kind: agent
    id: v16-investigation/terminal
    at: '2026-11-19T20:24:52.003260+00:00'
  rca:
    root_cause: The confirmation page uses an invalid date pattern for the day, so
      it stops when trying to display the order date.
    category: application_issue/script_error
    confidence: 0.98
    evidence:
    - steps/17-1-9/annotated.png
  verification:
    status: not_verified
  severity: major
  suggested_fix:
    summary: Change the confirmation date format from `DD/MM/YYYY` to `dd/MM/yyyy`,
      then retest that the order page shows “Thanks, Ada Marsh” and a date such as
      19/11/2026.
```

Browser console errors during the flow:
```
Use `dd` instead of `DD` (in `DD/MM/YYYY`) for formatting days of the month to the input `Thu Nov 19 2026 21:23:15 GMT+0100 (West Africa Time)`; see: https://github.com/date-fns/date-fns/blob/master/docs/unicodeTokens.md (/assets/index-08719def.js:38)
```

## Where the app uses the package
```
src/pages/Order.jsx:3  import { format, addDays } from 'date-fns';
```

## What changed in the package
The new version is installed. Read these before guessing:
- node_modules/date-fns/CHANGELOG.md

## Rules
- Fix the app code. The new version stays: do not change any version in package.json, and do not add overrides or resolutions.
- Do not edit the flows or their recordings (flows/browse_test.md, flows/cart_test.md, flows/checkout_test.md and the output-* folders next to them). They define what "works" means. Upkeep reverts any change to them.
- Keep the behaviour the same for the user. Do not remove a feature to make a check pass.
- You cannot run the browser. When you stop, Upkeep rebuilds the app and has Kane CLI walk it again; you get the result.
- Make the smallest change that is correct. Then stop and say in two or three sentences what you changed and why.
