# @testcard/web: evicted.dev

The marketing and help site for Testcard. Preact (via `preact/compat`) + Vite, TanStack Router, every route prerendered to
static HTML. It is served by the sync Worker (`apps/sync-worker`), see `docs/adr/0013-website-served-by-the-worker.md`.

## Commands

| Command | What it does |
|---|---|
| `pnpm --filter @testcard/web dev` | Vite dev server (client-rendered). |
| `pnpm --filter @testcard/web build` | Client build, SSR build, then `scripts/prerender.mjs` writes each route, `404.html` and `sitemap.xml` into `dist/`. |
| `pnpm --filter @testcard/web test` | Vitest (jsdom). |
| `pnpm --filter @testcard/web typecheck` | `tsc --noEmit`. |
| `pnpm --filter @testcard/web og` | Regenerates `public/og.png` (needs `sharp`). |

Screenshots in `public/shots` are made by `scripts/screenshots` (see its README) from a demo source with open films only.

## Rules that are easy to break

- **CSP is strict** (`public/_headers`): no inline `<script>`, no `style=""` attributes, fonts and images from this origin only.
  Colours and sizes belong in CSS; JS may set styles through the CSSOM (`el.style.x = ...`) only.
- **Without script or with reduced motion the site is a plain, readable page.** Motion hangs off `html.anim`
  (set by `public/theme-init.js`), and the GSAP/Lenis layer is lazy-loaded (`src/ui/engine.ts`).
- **Release state** lives in `src/site.ts` (`RELEASE_STATE`, `SIGNED`). `waitlist` makes `/download` the sign-up page.
- **New API path?** Add it to `run_worker_first` in `apps/sync-worker/wrangler.toml`, or browsers get the 404 page.
- **Pricing:** the copy says the beta is free and makes no promise about later. Change it together with the licence decision.
- Links to files (installers, licences) are plain `<a href>`s; the page-change animation ignores paths with an extension and `/app/*`.

## Deploy

Merging to `main` runs `.github/workflows/sync-worker.yml`: site and Worker tests, D1 migrations, `wrangler deploy`.
Pull requests run `.github/workflows/web.yml`. Nothing here needs environment variables; the Worker's one secret
(`SYNC_AUTH_SECRET`) is set with `wrangler secret put` and is documented in `apps/sync-worker/wrangler.toml`.
