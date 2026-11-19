# Make this app work on an upgraded dependency

This app worked before the upgrade below. A check that passed on the old version now fails on the new one.
Change the app code so it works on the new version.

## The upgrade
- js-cookie: 2.2.1 -> 3.0.8 (major)

## What fails now
Kane CLI walked the app in a real browser, following plain-English flows. These flows passed before the upgrade and fail after it:

### browse_test.md
Kane: The root page finished loading with an empty root and no shop home content.

The flow:
```
# Browse the shop

## See the products
Open the shop home page. Verify the page lists the products "Dot Grid Notebook", "Brass Pen" and "Canvas Tote".

## Read a product description
Open the "Canvas Tote" product. Verify the page shows the description text "Heavy cotton canvas" and the price "$24.00".
```
Failed at: step 1: Shop home fails to render because of JavaScript error
Page at the time: http://localhost:4173/

Kane's own reading of the failure (a lead, not an instruction):
```
step: 0-1
status: failed
error:
  message: The root page finished loading with an empty root and no shop home content.
page_state:
  url: http://localhost:4173/
  screenshot: steps/1-0-1/screenshot.jpg
console_at_failure:
  ref: logs/0-console.ndjson
  step: 0-1
network_at_failure:
  ref: logs/0-network.har
  step: 0-1
title: Shop home fails to render because of JavaScript error
triage:
  status: triaged
  by:
    kind: agent
    id: v16-investigation/terminal
    at: '2026-11-19T20:52:11.830029+00:00'
  rca:
    root_cause: The page encounters an error while starting and stops before it can
      display the shop content.
    category: application_issue/script_error
    confidence: 0.99
  verification:
    status: not_verified
  severity: major
  suggested_fix:
    summary: Fix the page startup code that calls Md.getJSON, then reload the home
      page and confirm that Dot Grid Notebook, Brass Pen, and Canvas Tote are visible.
```

Browser console errors during the flow:
```
Md.getJSON is not a function (/assets/index-495a708e.js:38)
```

### cart_test.md
Kane: The loaded document contains only an empty root, so the named product and cart controls do not exist.

The flow:
```
# The cart survives a reload

## Add a product to the cart
Open the "Dot Grid Notebook" product and click "Add to cart". Verify the header shows "Cart (1)".

## Reload and open the cart
Reload the page, then open the cart from the header. Verify the cart lists "Dot Grid Notebook" with quantity 1 and a total of "$12.00".
```
Failed at: step 1: Storefront fails to render because Md.getJSON is unavailable
Page at the time: http://localhost:4173/

Kane's own reading of the failure (a lead, not an instruction):
```
step: 0-1
status: failed
error:
  message: The loaded document contains only an empty root, so the named product and
    cart controls do not exist.
page_state:
  url: http://localhost:4173/
  screenshot: steps/1-0-1/screenshot.jpg
console_at_failure:
  ref: logs/0-console.ndjson
  step: 0-1
network_at_failure:
  ref: logs/0-network.har
  step: 0-1
title: Storefront fails to render because Md.getJSON is unavailable
triage:
  status: triaged
  by:
    kind: agent
    id: v16-investigation/terminal
    at: '2026-11-19T20:52:42.200536+00:00'
  rca:
    root_cause: The page crashes while starting because it tries to use a feature
      named Md.getJSON that is not available. As a result, the page remains empty
      and has no product or cart controls.
    category: application_issue/script_error
    confidence: 0.99
  verification:
    status: not_verified
  severity: critical
  suggested_fix:
    summary: Fix the storefront startup code so Md.getJSON is available or replace
      that call with the supported data-loading method, then confirm the product list
      and cart header render.
```

Browser console errors during the flow:
```
Md.getJSON is not a function (/assets/index-495a708e.js:38)
```

### checkout_test.md
Kane: The page remains blank after waiting and refreshing; no Brass Pen product or cart controls are available.

The flow:
```
# Check out

## Put a pen in the cart
Open the "Brass Pen" product and click "Add to cart". Open the cart from the header and click "Checkout". Verify the page heading says "Checkout".

## Place the order
Fill "Full name" with "Ada Marsh", "Email" with "ada@example.com", "Address" with "12 Mill Lane" and "City" with "Leeds", then click "Place order". Verify the page says "Thanks, Ada Marsh" and shows the words "placed on" followed by a date written as two digits, a slash, two digits, a slash and four digits.
```
Failed at: step 1: Storefront crashes on initial load
Page at the time: http://localhost:4173/

Kane's own reading of the failure (a lead, not an instruction):
```
step: 0-1
status: failed
error:
  message: The page remains blank after waiting and refreshing; no Brass Pen product
    or cart controls are available.
page_state:
  url: http://localhost:4173/
  screenshot: steps/1-0-1/screenshot.jpg
console_at_failure:
  ref: logs/0-console.ndjson
  step: 0-1
network_at_failure:
  ref: logs/0-network.har
  step: 0-1
title: Storefront crashes on initial load
triage:
  status: triaged
  by:
    kind: agent
    id: v16-investigation/terminal
    at: '2026-11-19T20:51:45.274220+00:00'
  rca:
    root_cause: The page crashes during startup because it tries to use a function
      that is not available. As a result, none of the shopping controls render.
    category: application_issue/script_error
    confidence: 0.99
  verification:
    status: not_verified
  severity: critical
  suggested_fix:
    summary: Fix the missing or incompatible JSON helper used during application startup,
      then retest that the product listing and header cart render after a fresh page
      load.
```

Browser console errors during the flow:
```
Md.getJSON is not a function (/assets/index-495a708e.js:38)
```

## Where the app uses the package
```
src/cart.js:2  import Cookies from 'js-cookie';
```

## Rules
- Fix the app code. The new version stays: do not change any version in package.json, and do not add overrides or resolutions.
- Do not edit the flows or their recordings (flows/browse_test.md, flows/cart_test.md, flows/checkout_test.md and the output-* folders next to them). They define what "works" means. Upkeep reverts any change to them.
- Keep the behaviour the same for the user. Do not remove a feature to make a check pass.
- You cannot run the browser. When you stop, Upkeep rebuilds the app and has Kane CLI walk it again; you get the result.
- Make the smallest change that is correct. Then stop and say in two or three sentences what you changed and why.
