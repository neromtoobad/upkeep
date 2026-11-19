# Make this app work on an upgraded dependency

This app worked before the upgrade below. A check that passed on the old version now fails on the new one.
Change the app code so it works on the new version.

## The upgrade
- js-cookie: 2.2.1 -> 3.0.8 (major)

## What fails now
Kane CLI walked the app in a real browser, following plain-English flows. These flows passed before the upgrade and fail after it:

### browse_test.md
Kane: The root shop page remains empty after waiting and refreshing, with no products or navigation controls available.

The flow:
```
# Browse the shop

## See the products
Open the shop home page. Verify the page lists the products "Dot Grid Notebook", "Brass Pen" and "Canvas Tote".

## Read a product description
Open the "Canvas Tote" product. Verify the page shows the description text "Heavy cotton canvas" and the price "$24.00".
```
Failed at: step 1: Shop home page crashes during startup
Page at the time: http://localhost:4173/
Kane's screenshot of where the walk ended (open it): ~/Documents/Hacks/kanecli/demo-shop/.upkeep/runs/20261119-222210/agent/js-cookie/round-1-kane-browse.jpg

Kane's own reading of the failure (a lead, not an instruction):
```
step: 0-1
status: failed
error:
  message: The root shop page remains empty after waiting and refreshing, with no
    products or navigation controls available.
page_state:
  url: http://localhost:4173/
  screenshot: steps/1-0-1/screenshot.jpg
console_at_failure:
  ref: logs/0-console.ndjson
  step: 0-1
network_at_failure:
  ref: logs/0-network.har
  step: 0-1
title: Shop home page crashes during startup
triage:
  status: triaged
  by:
    kind: agent
    id: v16-investigation/terminal
    at: '2026-11-19T21:43:04.205244+00:00'
  rca:
    root_cause: The page tries to use a function that is not available, so it stops
      loading the shop interface.
    category: application_issue/script_error
    confidence: 0.99
  verification:
    status: not_verified
  severity: major
  suggested_fix:
    summary: Fix the startup code that calls ip.getJSON, or load the library that
      provides it, then verify the home page renders the product list and navigation.
```

Browser console errors during the flow:
```
ip.getJSON is not a function (/assets/index-dcb38b64.js:38)
```

### cart_test.md
Kane: The root is empty after waiting and refreshing, so the named product and cart controls are unavailable.

The flow:
```
# The cart survives a reload

## Add a product to the cart
Open the "Dot Grid Notebook" product and click "Add to cart". Verify the header shows "Cart (1)".

## Reload and open the cart
Reload the page, then open the cart from the header. Verify the cart lists "Dot Grid Notebook" with quantity 1 and a total of "$12.00".
```
Failed at: step 1: Storefront crashes because ip.getJSON is unavailable
Page at the time: http://localhost:4173/
Kane's screenshot of where the walk ended (open it): ~/Documents/Hacks/kanecli/demo-shop/.upkeep/runs/20261119-222210/agent/js-cookie/round-1-kane-cart.jpg

Kane's own reading of the failure (a lead, not an instruction):
```
step: 0-1
status: failed
error:
  message: The root is empty after waiting and refreshing, so the named product and
    cart controls are unavailable.
page_state:
  url: http://localhost:4173/
  screenshot: steps/1-0-1/screenshot.jpg
console_at_failure:
  ref: logs/0-console.ndjson
  step: 0-1
network_at_failure:
  ref: logs/0-network.har
  step: 0-1
title: Storefront crashes because ip.getJSON is unavailable
triage:
  status: triaged
  by:
    kind: agent
    id: v16-investigation/terminal
    at: '2026-11-19T21:43:03.288765+00:00'
  rca:
    root_cause: The page fails while it is starting, so it never shows the notebook
      or cart controls.
    category: application_issue/script_error
    confidence: 0.99
  verification:
    status: not_verified
  severity: major
  suggested_fix:
    summary: Fix the storefront startup code so it does not call ip.getJSON unless
      that function has been loaded and is available; then verify the product list
      and cart header render after a fresh page load.
```

Browser console errors during the flow:
```
ip.getJSON is not a function (/assets/index-dcb38b64.js:38)
```

### checkout_test.md
Kane: The root stays blank after two waits and a refresh; no product, cart, or checkout controls exist.

The flow:
```
# Check out

## Put a pen in the cart
Open the "Brass Pen" product and click "Add to cart". Open the cart from the header and click "Checkout". Verify the page heading says "Checkout".

## Place the order
Fill "Full name" with "Ada Marsh", "Email" with "ada@example.com", "Address" with "12 Mill Lane" and "City" with "Leeds", then click "Place order". Verify the page says "Thanks, Ada Marsh" and shows the words "placed on" followed by a date written as two digits, a slash, two digits, a slash and four digits.
```
Failed at: step 1: Storefront crashes on startup because ip.getJSON is unavailable
Page at the time: http://localhost:4173/
Kane's screenshot of where the walk ended (open it): ~/Documents/Hacks/kanecli/demo-shop/.upkeep/runs/20261119-222210/agent/js-cookie/round-1-kane-checkout.jpg

Kane's own reading of the failure (a lead, not an instruction):
```
step: 0-1
status: failed
error:
  message: The root stays blank after two waits and a refresh; no product, cart, or
    checkout controls exist.
page_state:
  url: http://localhost:4173/
  screenshot: steps/1-0-1/screenshot.jpg
console_at_failure:
  ref: logs/0-console.ndjson
  step: 0-1
network_at_failure:
  ref: logs/0-network.har
  step: 0-1
title: Storefront crashes on startup because ip.getJSON is unavailable
triage:
  status: triaged
  by:
    kind: agent
    id: v16-investigation/terminal
    at: '2026-11-19T21:43:46.247046+00:00'
  rca:
    root_cause: The page runs code at startup that calls a missing function, stopping
      the storefront before it can display any products or controls.
    category: application_issue/script_error
    confidence: 0.98
  verification:
    status: not_verified
  severity: major
  suggested_fix:
    summary: Fix the startup code to load and call the correct IP lookup function,
      then verify that the storefront renders even if that optional lookup is unavailable.
```

Browser console errors during the flow:
```
ip.getJSON is not a function (/assets/index-dcb38b64.js:38)
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
