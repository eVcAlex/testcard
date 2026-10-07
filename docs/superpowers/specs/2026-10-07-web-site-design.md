# Testcard website and shared theme

## Intent

`evicted.dev` is the Testcard site. Replace the hand-written HTML (the Worker's `/link` page and the
old `evicted-site` worker's page) with a proper web app, and make the site, desktop and TV/mobile apps
draw from one theme.

Stack (user's choice): React, Vite, TanStack (Router + Query), wretch, vitest.

## Decisions

- **Hosting:** the existing `testcard-sync` Worker serves the built site through a wrangler `assets`
  binding with SPA fallback. One deploy, same origin as the API, no CORS.
- **Domains:** `evicted.dev`, `www.evicted.dev` and `sync.evicted.dev` all point at `testcard-sync`.
  `sync.evicted.dev` stays so installed apps keep working.
- **Theme:** TV/mobile keep a darker background via a per-platform override; everything else
  (accent, text, type, radii, spacing) is shared.

## Structure

- `packages/theme`: tokens in one TS file (desktop "Mist" palette as the base). A generate script
  writes `tokens.css` for the site and desktop. The TS object is imported by `apps/mobile` and
  `apps/tv-native` (replacing the hex copy in `apps/mobile/src/theme.ts`). Desktop `tokens.css` is
  replaced by the generated file. The TV override sets its darker neutrals.
- `apps/web`: Vite SPA, TanStack Router (file or code routes, code routes preferred, three pages),
  TanStack Query for server state, a single wretch instance for `/link/*`, `/auth/*` and `/app/*`.
  Builds to `apps/web/dist`.
- `apps/sync-worker`: `wrangler.toml` gains `[assets] directory = "../web/dist"`,
  `not_found_handling = "single-page-application"` and `run_worker_first` for the API paths
  (`/auth/*`, `/link/*`, `/sync/*`, `/guides/*`, `/app/*`). Delete `GET /link` and `pages/linkPage.ts`.
  Routes list adds `evicted.dev` and `www.evicted.dev` as custom domains.

## Pages

- `/`: what Testcard is, download buttons.
- `/download`: Windows installer and Fire TV APK from the release manifest at `/app/`.
- `/link`: TV code entry plus sign in / create account. Same behaviour as today's HTML page:
  `GET /link/session?lookup=`, `POST /link/approve`, better-auth sign-in and sign-up under `/auth/*`,
  code format `XXXX-XXXX`, confirm-password on create, inline error, done view.
- Out of scope: account dashboard, blog, docs.

## TV app

The link-code screen text/URL in `apps/tv-native` changes to `evicted.dev/link` (needs a new Fire TV
build).

## Testing

- vitest in `apps/web`: wretch client (success, 4xx error mapping), link flow (code format, lookup,
  approve, sign-in vs create), download page (manifest to links).
- vitest in `packages/theme`: generated CSS and exported TS contain the same values for every token,
  and the TV override only changes the keys it declares.
- Existing Worker tests stay green; add one asserting API paths are not swallowed by the SPA fallback.

## Rollout

1. In the Cloudflare dashboard, remove `evicted.dev` and `www` from `evicted-site`.
2. Build web, deploy `testcard-sync` (adds the domains).
3. Check `evicted.dev`, `evicted.dev/link`, `sync.evicted.dev/sync/pull` (401).
4. New Windows build (picks up theme) and Fire TV build (new link URL, theme).

Publishing steps need the user's go each time.

## Open assumptions

- Site copy and download buttons are minimal placeholders until the user supplies wording.
- Light theme: the site follows desktop's existing `data-theme="light"` tokens via
  `prefers-color-scheme`.
