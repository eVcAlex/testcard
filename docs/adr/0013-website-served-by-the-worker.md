# ADR 0013: The website is built by apps/web and served by the sync Worker

## Status

Accepted (2026-10-08).

## Context

Testcard needs a public site: a home page with a demo guide, setup help, an FAQ, a privacy page, a beta waitlist and the
TV link page. The Worker already owns the domain and the API, so a second host would mean a second deploy, a second
origin and CORS between them.

## Decision

1. **`apps/web` builds the site.** React and Vite, with each route prerendered to static HTML at build time, so every
   page works and is indexable without script. The interactive demo is a separate lazy chunk.
2. **The sync Worker serves it** through its `assets` binding (`apps/web/dist`). `run_worker_first` lists the API paths
   (`/app/*`, `/auth/*`, `/link/*`, `/sync/*`, `/guides/*`, `/waitlist`) so a browser navigation never reaches the 404
   page. `html_handling = "drop-trailing-slash"` keeps URLs canonical, and `not_found_handling = "404-page"` returns the
   built `404.html` with a 404 status instead of an SPA fallback.
3. **Headers come from `public/_headers`**: a strict CSP with no inline script or style, HSTS, a minimal
   Permissions-Policy, and Cache-Control per path (immutable hashed assets, `no-cache` for pages, `no-store` for `/link`).
4. **The waitlist is stored in D1** behind `POST /waitlist`, with a honeypot field and a per-network daily limit. The
   form states what is kept and why.
5. **Deploys happen on merge to `main`** through `.github/workflows/sync-worker.yml`: typecheck, test (which builds the
   site first), apply D1 migrations, then `wrangler deploy`. Site and Worker ship together.

## Consequences

- One origin, one deploy and one set of headers. A site change redeploys the Worker, and the reverse.
- A new API path must be added to `run_worker_first`, or navigating to it shows the 404 page.
- The strict CSP means no inline scripts: the theme bootstrap is a separate file (`theme-init.js`).
- The site has no server rendering at request time, so anything dynamic goes through the API.
