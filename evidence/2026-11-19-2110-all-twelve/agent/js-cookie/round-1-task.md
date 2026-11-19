# Make this app work on an upgraded dependency

This app worked before the upgrade below. A check that passed on the old version now fails on the new one.
Change the app code so it works on the new version.

## The upgrade
- js-cookie: 2.2.1 -> 3.0.8 (major)

## What fails now
Kane CLI walked the app in a real browser, following plain-English flows. These flows passed before the upgrade and fail after it:

### browse_test.md
Kane: The current home URL remains blank after waiting and refreshing; the root contains no shop content or product listings.

The flow:
```
# Browse the shop

## See the products
Open the shop home page. Verify the page lists the products "Dot Grid Notebook", "Brass Pen" and "Canvas Tote".

## Read a product description
Open the "Canvas Tote" product. Verify the page shows the description text "Heavy cotton canvas" and the price "$24.00".
```
Failed at: step 1: Home page crashes on startup due to undefined getJSON call
Page at the time: http://localhost:4173/

Kane's own reading of the failure (a lead, not an instruction):
```
step: 0-1
status: failed
error:
  message: The current home URL remains blank after waiting and refreshing; the root
    contains no shop content or product listings.
page_state:
  url: http://localhost:4173/
  screenshot: steps/1-0-1/screenshot.jpg
console_at_failure:
  ref: logs/0-console.ndjson
  step: 0-1
network_at_failure:
  ref: logs/0-network.har
  step: 0-1
title: Home page crashes on startup due to undefined getJSON call
triage:
  status: triaged
  by:
    kind: agent
    id: v16-investigation/terminal
    at: '2026-11-19T20:33:12.985055+00:00'
  rca:
    root_cause: The page tries to use a function that is not available, so the shop
      cannot finish loading.
    category: application_issue/script_error
    confidence: 0.99
  verification:
    status: not_verified
  severity: major
  suggested_fix:
    summary: Restore or replace the missing startup function, then reload the home
      page and confirm that Dot Grid Notebook, Brass Pen, and Canvas Tote are displayed.
```

Browser console errors during the flow:
```
ip.getJSON is not a function (/assets/index-dcb38b64.js:38)
```

### cart_test.md
Kane: The loaded document has an empty root with no product catalog or cart controls.

The flow:
```
# The cart survives a reload

## Add a product to the cart
Open the "Dot Grid Notebook" product and click "Add to cart". Verify the header shows "Cart (1)".

## Reload and open the cart
Reload the page, then open the cart from the header. Verify the cart lists "Dot Grid Notebook" with quantity 1 and a total of "$12.00".
```
Failed at: step 1: Storefront fails to render after startup script error
Page at the time: http://localhost:4173/

Kane's own reading of the failure (a lead, not an instruction):
```
step: 0-1
status: failed
error:
  message: The loaded document has an empty root with no product catalog or cart controls.
page_state:
  url: http://localhost:4173/
  screenshot: steps/1-0-1/screenshot.jpg
console_at_failure:
  ref: logs/0-console.ndjson
  step: 0-1
network_at_failure:
  ref: logs/0-network.har
  step: 0-1
title: Storefront fails to render after startup script error
triage:
  status: triaged
  by:
    kind: agent
    id: v16-investigation/terminal
    at: '2026-11-19T20:32:45.752321+00:00'
  rca:
    root_cause: The page’s startup code failed while loading. As a result, it left
      the page blank instead of showing the product catalog and cart.
    category: application_issue/script_error
    confidence: 0.98
  verification:
    status: not_verified
  severity: major
  suggested_fix:
    summary: Fix the startup code that calls ip.getJSON, then reload the storefront
      and confirm that the product catalog and cart header render before running the
      add-to-cart check.
```

Browser console errors during the flow:
```
ip.getJSON is not a function (/assets/index-dcb38b64.js:38)
```

### checkout_test.md
Kane: The refreshed storefront remains blank, with only an empty root and no product or cart controls.

The flow:
```
# Check out

## Put a pen in the cart
Open the "Brass Pen" product and click "Add to cart". Open the cart from the header and click "Checkout". Verify the page heading says "Checkout".

## Place the order
Fill "Full name" with "Ada Marsh", "Email" with "ada@example.com", "Address" with "12 Mill Lane" and "City" with "Leeds", then click "Place order". Verify the page says "Thanks, Ada Marsh" and shows the words "placed on" followed by a date written as two digits, a slash, two digits, a slash and four digits.
```
Failed at: step 1: Storefront fails to render because startup script errors
Page at the time: http://localhost:4173/

Kane's own reading of the failure (a lead, not an instruction):
```
step: 0-1
status: failed
error:
  message: The refreshed storefront remains blank, with only an empty root and no
    product or cart controls.
page_state:
  url: http://localhost:4173/
  screenshot: steps/1-0-1/screenshot.jpg
console_at_failure:
  ref: logs/0-console.ndjson
  step: 0-1
network_at_failure:
  ref: logs/0-network.har
  step: 0-1
title: Storefront fails to render because startup script errors
triage:
  status: triaged
  by:
    kind: agent
    id: v16-investigation/terminal
    at: '2026-11-19T20:32:37.348130+00:00'
  rca:
    root_cause: The storefront’s startup code fails while the page is loading, leaving
      the page empty instead of showing the catalog.
    category: application_issue/script_error
    confidence: 0.99
  verification:
    status: not_verified
  severity: critical
  suggested_fix:
    summary: Fix the startup code that calls ip.getJSON, then reload the storefront
      and confirm that the catalog and header cart controls appear.
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
