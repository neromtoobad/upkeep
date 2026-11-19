# Make this app work on an upgraded dependency

This app worked before the upgrade below. A check that passed on the old version now fails on the new one.
Change the app code so it works on the new version.

## The upgrade
- date-fns: 1.30.1 -> 4.4.0 (major)

## What fails now
Kane CLI walked the app in a real browser, following plain-English flows. These flows passed before the upgrade and fail after it:

### checkout_test.md
Kane: The order route remains blank after multiple waits and refreshes, with no confirmation text available to verify.

The flow:
```
# Check out

## Put a pen in the cart
Open the "Brass Pen" product and click "Add to cart". Open the cart from the header and click "Checkout". Verify the page heading says "Checkout".

## Place the order
Fill "Full name" with "Ada Marsh", "Email" with "ada@example.com", "Address" with "12 Mill Lane" and "City" with "Leeds", then click "Place order". Verify the page says "Thanks, Ada Marsh" and shows the words "placed on" followed by a date written as two digits, a slash, two digits, a slash and four digits.
```
Failed at: step 18: Order confirmation route renders blank after placing an order
Page at the time: http://localhost:4173/#/order/3nbkD2AG
Kane's screenshot of where the walk ended (open it): ~/Documents/Hacks/kanecli/demo-shop/.upkeep/runs/20261119-222210/agent/date-fns/round-1-kane-checkout.jpg

Kane's own reading of the failure (a lead, not an instruction):
```
step: 1-10
status: failed
error:
  message: The order route remains blank after multiple waits and refreshes, with
    no confirmation text available to verify.
page_state:
  url: http://localhost:4173/#/order/3nbkD2AG
  screenshot: steps/18-1-10/screenshot.jpg
console_at_failure:
  ref: logs/1-console.ndjson
  step: 1-10
network_at_failure:
  ref: logs/1-network.har
  step: 1-10
title: Order confirmation route renders blank after placing an order
triage:
  status: triaged
  by:
    kind: agent
    id: v16-investigation/terminal
    at: '2026-11-19T21:37:01.221339+00:00'
  rca:
    root_cause: The order was sent to its confirmation page, but that page did not
      display any content or the order confirmation.
    category: application_issue/functional_defect
    confidence: 0.9
  verification:
    status: not_verified
  severity: major
  suggested_fix:
    summary: Investigate the order confirmation page for the generated order URL and
      make sure it renders the customer name and placed-on date after an order is
      submitted.
```

Browser console errors during the flow:
```
Use `dd` instead of `DD` (in `DD/MM/YYYY`) for formatting days of the month to the input `Thu Nov 19 2026 22:34:14 GMT+0100 (West Africa Time)`; see: https://github.com/date-fns/date-fns/blob/master/docs/unicodeTokens.md (/assets/index-08719def.js:38)
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
