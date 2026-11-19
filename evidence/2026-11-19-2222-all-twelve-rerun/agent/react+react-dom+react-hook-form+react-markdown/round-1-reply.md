I updated the app code for the new versions, but I couldn't build or run anything here, so none of it is tested yet; the Kane walk after the rebuild will be the first check.

- **Blank page (the reported failure):** React 19 removed `ReactDOM.render`, which is the error in the console. `src/main.jsx` now starts the app with `createRoot` from `react-dom/client`.
- **Product description:** react-markdown 10 no longer accepts the `source` prop, so in `src/pages/Product.jsx` the description is now passed as children.
- **Checkout form:** react-hook-form 7 changed how inputs are registered (`{...register('name', rules)}` instead of a `ref`) and moved `errors` under `formState`. `src/pages/Checkout.jsx` now uses both, with the same validation rules and error messages as before.
