I migrated the three call sites that the new majors broke; nothing has been built or run here, so Kane's re-walk is the first real check.

- **`src/main.jsx`**: React 19 removed `ReactDOM.render`, which was the blank-page crash in all three flows. It now uses `createRoot` from `react-dom/client`.
- **`src/pages/Product.jsx`**: react-markdown 10 no longer accepts the `source` prop, so the description is passed as children.
- **`src/pages/Checkout.jsx`**: react-hook-form 7 changed `register` and moved `errors`. The inputs now use `{...register('name', rules)}` and `errors` is read from `formState`.
