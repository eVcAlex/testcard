# Public release plan

Each phase has a gate. Don't start the next phase until the gate is met. Track every item as a GitHub Issue with a `release` label and a milestone per phase.

## Phase 0: Prove it works (1 to 2 weeks)
- [ ] Install desktop 0.1.12 on a clean Windows machine; playback, Live TV page, preview, favourites, sync
- [ ] Install Fire TV 0.2.5 on a real Fire Stick; same checks
- [ ] Auto-update tested on both (old build -> new build)
- [ ] Provider short-guide fallback tested on a real Xtream source
- [ ] Own M3U `url-tvg` points at epg6.xml.gz with matching tvg-ids
- [ ] Fix the 3 EBUSY failures in openDatabase.test.ts (or mark them Windows-flaky); CI green
- [ ] Decide: keep or remove the Favourites and Recent tabs

**Gate:** you use it daily for a week without reaching for another player.

## Phase 1: Test demand (2 weeks, little code)
- [ ] **Choose the public name first (blocker).** "TestCard" is taken: testcard.com is a diagnostics company with a UK at-home test app, and it owns the search results. Check candidates for a free .com/.app domain, social handles, a clean Google page, and the trademark register before building the site or renaming the code
- [ ] Landing page: screenshots, short video of guide + preview, email waitlist
- [ ] Post to r/FireStick, Fire TV forums, IPTV communities; ask what people want
- [ ] Free beta to 20-50 people (sideload instructions, feedback channel)
- [ ] Track: installs, still active after 14 days, top complaints, "would you pay?" answers

**Gate:** at least ~10 people still using it after 2 weeks, and a clear top-3 request list. If not, fix the product before building billing.

## Phase 2: Legal and compliance (do before taking money)
- [ ] mpv: confirm GPL/LGPL obligations of the bundled build; add notices and a source offer, or switch to an LGPL build
- [ ] Third-party licences page in both apps (Kotlin and npm dependencies)
- [ ] Trademark/name check for "Testcard"
- [ ] Terms of service, privacy policy (what sync stores), refund policy
- [ ] Statement that no content is supplied; takedown contact
- [ ] Business entity and tax set up as needed for your country

**Gate:** nothing in the apps or installer is redistributed without the right licence text.

## Phase 3: Monetisation build
- [ ] Pick a merchant-of-record (Paddle or Lemon Squeezy; check current fees and terms)
- [ ] Define tiers: Free / Premium (monthly, yearly) / Lifetime; set prices
- [ ] Entitlements in sync-worker, tied to the sync account; webhook from the payment provider
- [ ] Trial clock; offline grace period (e.g. 7 days)
- [ ] Enforce in desktop and Fire TV; paywall screens; "buy on web, sign in on TV" flow
- [ ] Restore/transfer, device limit, refund handling
- [ ] Tests for entitlement states (trial, active, expired, grace, lifetime, refunded)

**Gate:** a test purchase end to end unlocks both apps; a refund locks them again.

## Phase 4: Ship-readiness
- [ ] Code-sign the Windows installer (avoid SmartScreen warnings)
- [ ] Decide Fire TV distribution: sideload (Downloader code) vs Amazon Appstore (needs Amazon payments and review)
- [ ] Clean public version number (0.1.x is auto-stamped; pick 1.0.0)
- [ ] Rollback plan for a bad build on the R2 update server (keep previous installer and manifest)
- [ ] Crash/error reporting that respects privacy; in-app diagnostics for "my provider doesn't work"
- [ ] FAQ and support email; setup guide (Xtream, M3U, EPG)
- [ ] Website: pricing, download, docs, legal pages

**Gate:** a stranger can find, install, pay, and get support without you.

## Phase 5: Launch and operate
- [ ] Soft launch to the waitlist first (discount for early supporters)
- [ ] Watch for 1 week: crashes, payment failures, support volume
- [ ] Public launch posts
- [ ] Weekly: triage issues, ship fixes, review conversion and churn

## Later (don't block launch)
Live time-shift, catch-up/record, TV link code, branding, profiles; see the roadmap memory.
