---
name: verify
description: How to visually verify UI changes in this repo when Supabase auth credentials aren't available.
---

# Verifying Coastline UI changes

The app shell (`(tabs)`) is auth-guarded behind real Supabase credentials, so a
headless session usually can't reach the tabs directly. The workaround that
works end-to-end:

1. **Harness route.** Create a throwaway `"use client"` page at
   `src/app/verify-harness/page.tsx` (NOT `_`-prefixed — App Router treats
   `_folders` as private and 404s them; delete the page before committing). In
   a `useEffect`, seed the real store with `useTrip.setState({...})` — fake
   `trip`/`days`/`stops`, `routesPending: false` — and override the mutations
   under test (e.g. `saveAnalysis`, `dismissInsight`) with local-state
   implementations so nothing hits Supabase. Stub `window.fetch` for any
   `/api/*` route the component calls. Render the component under test inside
   `max-w-md`.
2. **Dev server.** `npm run dev` (background), page at
   `http://localhost:3000/verify-harness`.
3. **Playwright.** Installed ad hoc in the scratchpad (`npm i playwright`);
   launch with `executablePath: "/opt/pw-browsers/chromium"` — the pinned
   playwright version won't match the preinstalled browser revision otherwise.
   Use a phone viewport (390×844, deviceScaleFactor 2, `hasTouch: true`).
   Toggle dark mode by setting `document.documentElement.dataset.theme`.
4. Screenshot every state (loading, results, empty, error, light/dark) and
   drive gestures (swipes via `page.mouse` move/down/up sequences).

Before pushing: `npm run lint`, `npm test`, `npm run build` (build is the
typecheck gate).
