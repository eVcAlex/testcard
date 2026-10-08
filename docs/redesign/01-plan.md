# Testcard site redesign: audit, design system, directions (prototype round)

Status: planning only. Prototypes live in `apps/web/prototypes/`. The production site is untouched.
Live evicted.dev could not be inspected from the build sandbox (proxy 403); the audit is from code, a local build and the committed screenshots.
Baseline: build OK, 37 tests pass, typecheck OK, JS 324 kB (105 kB gz).

## 1. Biggest opportunities
1. Crawlers see an empty `#root` and one shared title/description on every route. Prerender static routes.
2. Name collision: testcard.com owns the results (release-plan). Every page says "Testcard IPTV player by Evicted" until a name is chosen.
3. Nothing shows the product above the fold; the guide grid is the signature and sits in a lazy screenshot at the bottom.
4. /download is where conversions die: no version, date, size, checksum, requirements, SmartScreen note (installer unsigned), Fire TV Downloader steps. "Checking..." first.
5. No content for how people search: setup (Xtream/M3U), EPG troubleshooting, "is this legal / where do channels come from". Honest "we ship no channels" is a trust advantage.
6. Homepage reads like a template (problem/answer cards + 6 feature cards); test-card metaphor unused.
7. Waste: Inter is 352 kB unsubsetted; hashed assets not immutable; no HSTS/Permissions-Policy; unknown URLs return 200 (soft 404s).
8. Type is app-scaled (13px body); mobile and nav untested.

## 2. Design system ("Mist, broadcast edition")
- **Type:** Inter Variable only, subset (~50 kB), preload. No mono face: `tabular-nums` for times and spec tables. Site scale: body 16/1.55, small 14, meta 12.5 uppercase +0.06em, H2 clamp(28-40), H1 clamp(40-72) wght 640 tracking -0.025em. App UI inside demos keeps the 13px app scale.
- **Colour:** surfaces from `@testcard/theme`; hero/demo frames use the `tv` palette (#0a0d11). Sand accent at most once per viewport (primary CTA, "card" in wordmark, focus ring), never body links. Live red only for LIVE dot and guide now-line. Colour bars only as a 4px x 7-segment strip, desaturated ~25%.
- **Grid:** 4px base, 12 col, 1200 max, prose 64ch. Sections separated by hairlines, not cards.
- **Radius:** 6 chips/inputs, 9 buttons/cards, 13 screen frames. Pill only for the LIVE tag.
- **Motion:** only what moves in the app: now-line creeps, preview cross-fades, focus slides. 120ms hover/focus, 200ms panels, 600ms one-time hero tune-in. No parallax/scroll-jacking. Reduced motion: no tune-in, no noise, instant now-line.
- **Icons:** inline SVG 1.5px stroke on a 20px grid, currentColor, no emoji, no icon tiles.
- **Background:** flat; demo/hero frames on `--surface-sunken` with a 1px border-strong edge and a faint scanline (disabled for prefers-contrast: more).
- **Test-card metaphor (pick 3):** 7-bar strip; "No signal" standby (404 + demo empty search); station clock; ruled circle only for OG image/404. Frames the content, never is the content.

## 3. Directions
**A. Now & Next** - the guide is the homepage. Hero H1 "The guide is the page." Right-hand column is the interactive guide demo. Sections: names tidied, one channel every feed, films/series/catch-up, sofa and desk, bring your own sources, download. JS ~13-15 kB gz. Risk: looks like a screenshot; demo is an LCP risk.

**B. Ident** - an honest broadcast station. Hero 16:9 screen opens on test card + bars, tunes into the real app after 600ms. H1 "A player. Not a provider." Tonight's schedule (features as programme listings), "what Testcard isn't", remote channel-surf demo, sync, FAQ teaser, download. JS ~6-8 kB gz. Risk: kitsch, UK-centric, bets on the name.

**C. Spec sheet** - document-style. Sticky ToC, "Testcard: an IPTV player for Windows and Fire TV.", ruled spec table, annotated screenshot, compact keyboard-first guide demo, requirements, privacy, FAQ, download with checksums. JS ~8-10 kB gz. Risk: cold; needs owner facts; best for SEO.

## 4. Demo spec
- ~14 invented channels, 4 categories, 2 fake sources. Fixed clock 20:58 advancing 1 demo minute per 4 s, looping at 21:30; paused under reduced motion. Raw name stored next to tidy name.
- Preview: canvas/CSS test pattern per channel, seeded hue, 300ms tune static, "Muted preview" badge, no video, no requests.
- State: `{mode, category, query, focus:{channelId,slotIndex}, playing, favs, clock, showRawNames}`; one reducer; no Date.now() in render.
- Keys (only when focus is inside the demo): arrows move, Enter play, F favourite, / search, Esc clear, T TV mode. Legend visible.
- A11y: channel **listbox** with roving tabindex (not an ARIA grid); option label "Peak Sport, now: X until 21:30, next: Y"; programme cells aria-hidden; aria-live "Selected: ..." region; category rail is a tablist; section labelled "Demo - invented channels".
- Mobile (<720px): now/next rows with progress bar, preview on top, chips for categories.
- Budget: < 15 kB gz JS, < 4 kB CSS. Static now/next HTML works without JS.

## 5. Information architecture
`/` positioning + demo + download; `/download` versions, size, SHA-256, requirements, SmartScreen, Fire TV Downloader steps; `/setup` first source (Xtream, M3U, XMLTV, refresh, link TV); `/faq`; `/link` unchanged, noindex; `/privacy` real policy; 404 "No signal" with a real 404 status. No /windows, /fire-tv, blog.

## 6. SEO
- **Prerender:** after `vite build`, an SSR build renders each static route with TanStack memory history to `dist/<route>/index.html` with per-route head; client `hydrateRoot`; download data from the manifest at build. Worker `not_found_handling` -> `"404-page"`. Sitemap with lastmod; 1200x630 OG PNG per page.
- **Clusters:** branded -> `/`, `/download`; "IPTV player for Windows / M3U player PC / Xtream player / IPTV player with EPG" -> `/`; "Fire TV IPTV player" -> `/download#fire-tv`; "how to add M3U/Xtream" -> `/setup`; "EPG not showing", "is an IPTV player legal" -> `/faq` anchors.
- **Titles:** `/` "Testcard - IPTV player for Windows & Fire TV | by Evicted"; `/download` "Download Testcard IPTV player - Windows & Fire TV"; `/setup` "Add Xtream or M3U sources to Testcard - setup guide"; `/faq` "Testcard IPTV player FAQ - EPG, sources, legality".
- **JSON-LD:** SoftwareApplication + Organization + WebSite on `/`; no AggregateRating without real reviews. FAQPage on /faq, but not for pricing, legality or version-specific answers.
- **Name:** never bare "Testcard"; invest in non-branded pages that survive a rename.

## 7. Security / performance / accessibility
- Headers: HSTS, Permissions-Policy, COOP, CORP, CSP with `script-src/style-src/img-src/font-src 'self'`, `object-src 'none'`, `upgrade-insecure-requests`; hashed assets immutable; HTML no-cache.
- LCP element = H1 text. JS < 60 kB gz on `/`; code-split React Query to /link and download refresh. AVIF + webp hero with width/height.
- Contrast: faint #69727a ~3.7:1 fails for text; live red borderline, pair with the word LIVE. Focus ring 2px sand + offset, skip link, reduced motion, dialog nav sheet on mobile, screenshots framed in the tv palette in both themes.

## 8. Recommendation
Hybrid: C's structure and honesty, A's guide demo as the hero, B's ident only as a removable motif layer (bars, 404, clock, OG).

## 9. Open decisions for the owner
1. Name (keep Testcard, or rename before launch?). 2. Pricing (free beta wording). 3. Windows signing. 4. Fire TV distribution (Downloader code vs Appstore). 5. Real facts: min Windows/Fire OS, sizes, checksums, recording/phone plans, whether profiles and encrypted sync are in the public build. 6. Light mode or dark-only. 7. Beta feedback channel.
