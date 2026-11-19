# Make this app work on an upgraded dependency

This app worked before the upgrade below. A check that passed on the old version now fails on the new one.
Change the app code so it works on the new version.

## The upgrade
- @vitejs/plugin-react: 3.0.0 -> 6.3.0 (major)
- vite: 4.0.0 -> 8.3.8 (major)
- react: 17.0.2 -> 19.3.1 (major)
- react-dom: 17.0.2 -> 19.3.1 (major)
- react-hook-form: 6.15.8 -> 7.92.0 (major)
- react-markdown: 5.0.3 -> 10.1.0 (major)

## What fails now
Kane CLI walked the app in a real browser, following plain-English flows. These flows passed before the upgrade and fail after it:

### browse_test.md
Kane: The localhost root remains blank after waiting and refreshing; no shop content or navigation is available.

The flow:
```
# Browse the shop

## See the products
Open the shop home page. Verify the page lists the products "Dot Grid Notebook", "Brass Pen" and "Canvas Tote".

## Read a product description
Open the "Canvas Tote" product. Verify the page shows the description text "Heavy cotton canvas" and the price "$24.00".
```
Failed at: step 1: Shop home page fails to render due to JavaScript error
Page at the time: http://localhost:4173/

Kane's own reading of the failure (a lead, not an instruction):
```
step: 0-1
status: failed
error:
  message: The localhost root remains blank after waiting and refreshing; no shop
    content or navigation is available.
page_state:
  url: http://localhost:4173/
  screenshot: steps/1-0-1/screenshot.jpg
console_at_failure:
  ref: logs/0-console.ndjson
  step: 0-1
network_at_failure:
  ref: logs/0-network.har
  step: 0-1
title: Shop home page fails to render due to JavaScript error
triage:
  status: triaged
  by:
    kind: agent
    id: v16-investigation/terminal
    at: '2026-11-19T20:41:04.028569+00:00'
  rca:
    root_cause: The page’s startup code tries to use a render function that is not
      available, so no shop content or navigation is shown.
    category: application_issue/script_error
    confidence: 0.99
  verification:
    status: not_verified
  severity: major
  suggested_fix:
    summary: Fix the home page’s render-function import or initialization, then reload
      the page and confirm that Dot Grid Notebook, Brass Pen, and Canvas Tote appear.
```

Browser console errors during the flow:
```
oi.default.render is not a function
```

### cart_test.md
Kane: The storefront remains completely blank after waiting and refreshing, so the named product cannot be opened.

The flow:
```
# The cart survives a reload

## Add a product to the cart
Open the "Dot Grid Notebook" product and click "Add to cart". Verify the header shows "Cart (1)".

## Reload and open the cart
Reload the page, then open the cart from the header. Verify the cart lists "Dot Grid Notebook" with quantity 1 and a total of "$12.00".
```
Failed at: step 1: Storefront crashes during initial render
Page at the time: http://localhost:4173/

Kane's own reading of the failure (a lead, not an instruction):
```
step: 0-1
status: failed
error:
  message: The storefront remains completely blank after waiting and refreshing, so
    the named product cannot be opened.
page_state:
  url: http://localhost:4173/
  screenshot: steps/1-0-1/screenshot.jpg
console_at_failure:
  ref: logs/0-console.ndjson
  step: 0-1
network_at_failure:
  ref: logs/0-network.har
  step: 0-1
title: Storefront crashes during initial render
triage:
  status: triaged
  by:
    kind: agent
    id: v16-investigation/terminal
    at: '2026-11-19T20:39:41.099670+00:00'
  rca:
    root_cause: The storefront's own page code fails while it is starting, preventing
      any store content from appearing.
    category: application_issue/script_error
    confidence: 0.99
  verification:
    status: not_verified
  severity: critical
  suggested_fix:
    summary: Fix the startup rendering error, then reload the storefront and rerun
      the cart check.
```

Browser console errors during the flow:
```
oi.default.render is not a function
```

### checkout_test.md
Kane: The page stayed completely blank after waits and refresh, with no product or cart controls.

The flow:
```
# Check out

## Put a pen in the cart
Open the "Brass Pen" product and click "Add to cart". Open the cart from the header and click "Checkout". Verify the page heading says "Checkout".

## Place the order
Fill "Full name" with "Ada Marsh", "Email" with "ada@example.com", "Address" with "12 Mill Lane" and "City" with "Leeds", then click "Place order". Verify the page says "Thanks, Ada Marsh" and shows the words "placed on" followed by a date written as two digits, a slash, two digits, a slash and four digits.
```
Failed at: step 1: Storefront fails to render on initial load
Page at the time: http://localhost:4173/

Kane's own reading of the failure (a lead, not an instruction):
```
step: 0-1
status: failed
error:
  message: The page stayed completely blank after waits and refresh, with no product
    or cart controls.
page_state:
  url: http://localhost:4173/
  screenshot: steps/1-0-1/screenshot.jpg
console_at_failure:
  ref: logs/0-console.ndjson
  step: 0-1
network_at_failure:
  ref: logs/0-network.har
  step: 0-1
title: Storefront fails to render on initial load
triage:
  status: triaged
  by:
    kind: agent
    id: v16-investigation/terminal
    at: '2026-11-19T20:40:45.448198+00:00'
  rca:
    root_cause: The page fails while starting up, leaving all storefront controls
      blank.
    category: application_issue/script_error
    confidence: 0.99
  verification:
    status: not_verified
  severity: critical
  suggested_fix:
    summary: Fix the page startup error, then reload and confirm that the product
      list, cart, and checkout controls appear.
```

Browser console errors during the flow:
```
oi.default.render is not a function
```

## Where the app uses the package
```
src/App.jsx:1  import React, { useEffect, useState } from 'react';
src/cart.js:1  import { createContext, useContext, useEffect, useState } from 'react';
src/components/Header.jsx:1  import React from 'react';
src/components/Swatch.jsx:1  import React from 'react';
src/main.jsx:1  import React from 'react';
src/main.jsx:2  import ReactDOM from 'react-dom';
src/pages/Cart.jsx:1  import React from 'react';
src/pages/Checkout.jsx:1  import React from 'react';
src/pages/Checkout.jsx:2  import { useForm } from 'react-hook-form';
src/pages/Home.jsx:1  import React from 'react';
src/pages/Order.jsx:1  import React from 'react';
src/pages/Product.jsx:1  import React, { useState } from 'react';
src/pages/Product.jsx:3  import ReactMarkdown from 'react-markdown';
src/router.js:1  import { useEffect, useState } from 'react';
vite.config.js:1  import { defineConfig } from 'vite';
vite.config.js:2  import react from '@vitejs/plugin-react';
```

## What changed in the package
The new version is installed. Read these before guessing:
- node_modules/react-hook-form/dist/index.d.ts  (the new API, as types)

## Rules
- Fix the app code. The new version stays: do not change any version in package.json, and do not add overrides or resolutions.
- Do not edit the flows or their recordings (flows/browse_test.md, flows/cart_test.md, flows/checkout_test.md and the output-* folders next to them). They define what "works" means. Upkeep reverts any change to them.
- Keep the behaviour the same for the user. Do not remove a feature to make a check pass.
- You cannot run the browser. When you stop, Upkeep rebuilds the app and has Kane CLI walk it again; you get the result.
- Make the smallest change that is correct. Then stop and say in two or three sentences what you changed and why.
