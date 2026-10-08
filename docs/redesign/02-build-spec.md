# Build spec (owner decisions applied)

Read `01-plan.md` first. This file overrides it where they differ.

## Decisions from the owner
- Direction: **A "Now & Next"** (prototype `apps/web/prototypes/a.html`) as the base. Improve it (see below). Borrow C's honesty (spec table, requirements, FAQ, privacy) and a few of B's motifs only as small removable details (colour-bar strip, "No signal" 404, station clock).
- Domain stays **evicted.dev**. Product name stays "Testcard" for now, so every title/H1 lede says "Testcard IPTV player" and "by Evicted". Keep the name in one place (`site.ts`) where practical.
- **App is not released.** Primary CTA everywhere is **"Join the beta waitlist"**. No download buttons are live. `site.ts` gets `RELEASE_STATE: "waitlist" | "beta" | "public"`. In `waitlist` state `/download` is a "coming soon / join the beta" page; keep the existing manifest-driven download code and tests working behind the other states.
- **Free.** Say "Free". No pricing. A "buy me a coffee" link may come later; do not add one.
- **Windows installer is unsigned for now.** The download page (in beta/public states) shows the SmartScreen note and the SHA-256, controlled by `SIGNED = false` in `site.ts`. Copy flips when it is true.
- **Fire TV** installs via a Downloader code. The code is not public yet: show "Downloader code: shared with beta testers" and never put a real code in the repo.
- **Light/dark toggle**: default to the system setting, a visible toggle, remembered in `localStorage` (try/catch), applied before first paint with a tiny inline-free approach compatible with CSP (an external `/theme-init.js`, 'self').
- Waitlist form: email + optional checkboxes "Windows" / "Fire TV". Honest copy: what is stored (email, devices, time), used only to invite to the beta, delete on request at hello@evicted.dev. No cookies, no analytics, no confirmation email for now.

## Improvements over prototype A
- Give the demo more room at 1280 (the hero should be stacked or a 5/7 split where the demo is clearly wider; no truncated channel names).
- Mobile: the demo must not trap scroll in a tiny box; show 6 now/next rows and a "show all channels" control.
- Larger, calmer type for H1/lede; fewer boxes, more hairlines; less repetition between sections.
- Keep it obviously a demo ("Demo · invented channels").
- Hero tune-in (static -> picture) at 600ms only for the preview, none under reduced motion.

## Architecture
- Keep the stack: React 19, Vite, TanStack Router/Query, wretch, vitest. Do not rewrite.
- Routes: `/`, `/download`, `/setup`, `/faq`, `/privacy`, `/link` (noindex, behaviour unchanged), 404.
- Build-time **prerender** of every static route to `dist/<route>/index.html` with per-route `<title>`, description, canonical, OG/Twitter, JSON-LD; client hydrates. Worker `not_found_handling = "404-page"` with a real `404.html`.
- Per-route head from one routes manifest (`src/routes-meta.ts`).
- Demo: `src/demo/` (data, reducer, components), lazy-hydrated; static now/next HTML rendered server-side so it works without JS. Target < 15 kB gz for the demo, < 60 kB gz total JS on `/`.
- Components are small and reusable (`Header`, `Footer`, `ThemeToggle`, `WaitlistForm`, `Spec`, `Faq`, `Demo`). No giant page component.
- Tests: vitest for reducer, waitlist form, routes-meta, prerender output, worker route. Keep all 37 existing tests green (update, never delete without replacement).

## Waitlist backend (apps/sync-worker)
- `POST /waitlist` JSON `{email, windows?, firetv?, website?}` (`website` is a honeypot: if non-empty, return 200 and store nothing). Validate with zod: trimmed, lower-cased, length <= 254, a conservative email regex. Store in D1 table `waitlist(id, email UNIQUE, windows, firetv, created_at)` via a new migration; duplicate email returns the same 200 (no enumeration). Rate limit per IP (hash the IP with a daily salt, keep in D1 or use a simple per-IP counter table; never store raw IPs). Same-origin only (check `Origin`), `Cache-Control: no-store`, no CORS headers. Add the path to `run_worker_first`. Tests in `apps/sync-worker/test`.
- Do NOT deploy and do NOT run migrations against remote. Publishing needs the owner's go.

## Security
- `_headers`: HSTS, Permissions-Policy, COOP, CORP, full CSP (`default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'; upgrade-insecure-requests`), immutable cache for hashed assets, no-cache for HTML. No inline scripts/styles in output (JSON-LD `application/ld+json` is allowed).

## SEO copy rules
- Titles: `/` "Testcard IPTV player for Windows & Fire TV | by Evicted"; `/download` "Testcard IPTV player: beta for Windows & Fire TV"; `/setup` "Add Xtream or M3U sources to Testcard: setup guide"; `/faq` "Testcard IPTV player FAQ: EPG, sources, legality".
- Honest, specific, no clichés. No invented stats/testimonials. "Tens of thousands of channels", never a number.
- JSON-LD: Organization + WebSite + SoftwareApplication on `/` (no offers beyond `price: 0`, no ratings); FAQPage on `/faq` except legality/pricing/version answers.
- sitemap.xml generated at build with lastmod; robots.txt; 1200x630 OG image generated with sharp (already a dev dependency) from the colour-bar/ruled-circle motif.
