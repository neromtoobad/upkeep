I changed the two date format strings in `src/pages/Order.jsx`: `'DD/MM/YYYY'` is now `'dd/MM/yyyy'`, and `'dddd D MMMM'` is now `'EEEE d MMMM'`. Not run here; Kane's re-walk is the check.

date-fns 2 and later use Unicode tokens and throw on the old `DD`, `YYYY` and `D`, which is what crashed the confirmation page. The second string (the "arrive by" date) was not in Kane's error, but it would have thrown next on the same page, so I fixed it in the same edit. The page should show the same text as before, e.g. `25/11/2026` and `Monday 30 November`.
