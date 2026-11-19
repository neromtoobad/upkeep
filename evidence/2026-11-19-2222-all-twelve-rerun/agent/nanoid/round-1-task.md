# Make this app work on an upgraded dependency

This app worked before the upgrade below. A check that passed on the old version now fails on the new one.
Change the app code so it works on the new version.

## The upgrade
- nanoid: 2.1.11 -> 6.0.2 (major)

## What fails now
Building the app fails: build failed: "default" is not exported by "node_modules/nanoid/index.browser.js", imported by "src/orders.js".

```
> margin-paper-goods@1.0.0 build
> vite build

vite v4.0.0 building for production...
transforming...
✓ 661 modules transformed.
"default" is not exported by "node_modules/nanoid/index.browser.js", imported by "src/orders.js".
file: src/orders.js:1:7
1: import nanoid from 'nanoid';
          ^
2: 
3: const KEY = 'margin_orders';
error during build:
RollupError: "default" is not exported by "node_modules/nanoid/index.browser.js", imported by "src/orders.js".
    at error (file://node_modules/rollup/dist/es/shared/node-entry.js:2287:30)
    at Module.error (file://node_modules/rollup/dist/es/shared/node-entry.js:13751:16)
    at Module.traceVariable (file://node_modules/rollup/dist/es/shared/node-entry.js:14181:29)
    at ModuleScope.findVariable (file://node_modules/rollup/dist/es/shared/node-entry.js:12621:39)
    at FunctionScope.findVariable (file://node_modules/rollup/dist/es/shared/node-entry.js:7130:38)
    at ChildScope.findVariable (file://node_modules/rollup/dist/es/shared/node-entry.js:7130:38)
    at Identifier.bind (file://node_modules/rollup/dist/es/shared/node-entry.js:8325:40)
    at CallExpression.bind (file://node_modules/rollup/dist/es/shared/node-entry.js:5898:23)
    at CallExpression.bind (file://node_modules/rollup/dist/es/shared/node-entry.js:9896:15)
    at Property.bind (file://node_modules/rollup/dist/es/shared/node-entry.js:5898:23)
```

## Where the app uses the package
```
src/orders.js:1  import nanoid from 'nanoid';
```

## What changed in the package
The new version is installed. Read these before guessing:
- node_modules/nanoid/index.d.ts  (the new API, as types)

## Rules
- Fix the app code. The new version stays: do not change any version in package.json, and do not add overrides or resolutions.
- Do not edit the flows or their recordings (flows/browse_test.md, flows/cart_test.md, flows/checkout_test.md and the output-* folders next to them). They define what "works" means. Upkeep reverts any change to them.
- Keep the behaviour the same for the user. Do not remove a feature to make a check pass.
- You cannot run the browser. When you stop, Upkeep rebuilds the app and has Kane CLI walk it again; you get the result.
- Make the smallest change that is correct. Then stop and say in two or three sentences what you changed and why.
