# ADR 0017: The web player is the paid part

## Status

Proposed (2026-10-14). Nothing is built. This records the model and what to measure before building it.

## Context

The apps (Windows, Android and Fire TV) play video straight from the provider, and sync carries only small sealed
records, so they cost almost nothing per user. The web player (ADR 0015) is different: every stream goes through the
Worker (`/watch/p`), one request per HLS segment, plus CPU time. It is the only feature whose cost grows with how much
someone watches. It also is the only way onto an iPhone, so a paywall there has no free native alternative for iOS.

## Decision

1. **Free:** the Windows and Android apps, account sync, and managing Sources and Profiles (ADR 0016, which is sync
   only). **Paid:** watching through the web player's stream proxy.
2. **Recurring only at launch**: a monthly price and a discounted yearly one. No lifetime option yet. The cost recurs, so
   the revenue should; a lifetime option can be added later with a fair-use cap and a price set from real usage, but it
   cannot be withdrawn once sold.
3. **The daily cap stays for paid accounts** (`WATCH_DAILY_CAP_MB`), and is shown to the viewer in plain words.
4. **A short trial or small free allowance**, so someone can confirm their provider works through the proxy before paying
   (some providers cannot be reached from a data centre at all).
5. **Mechanism, when built:** an entitlement per account in D1, checked in `routes/watch.ts` next to the `WEB_PLAYER` and
   daily-cap checks; the player shows "needs a licence" with a checkout link when it is missing. A hosted checkout whose
   webhook sets the entitlement (Lemon Squeezy handles VAT; Stripe is the alternative). No licence key to type.

## Before building

- **Measure the real cost** of a viewing hour: switch `WEB_PLAYER` on for the owner's own account for a week and read
  Cloudflare's request and CPU figures. Set the monthly price at a small multiple of what a heavy user costs.
- **Check Cloudflare's current terms and plan pricing** for proxying video before enabling it for anyone else.
- **Decide the trial** (hours or days) and the cap shown to viewers.

## Consequences

- Revenue follows the one cost that grows with use. Apps stay free, which keeps the install base and sync value.
- iPhone users, who have no native app, are the ones asked to pay. That is acceptable only if the price is modest and the
  trial is real.
- Any licensing code touches the Worker's request path, so it needs its own tests and a rollout behind the existing
  `WEB_PLAYER` switch.

## Not decided

The price; trial length; whether a free tier of the web player (a few hours a month) is worth its cost; refunds.

## How to measure (one week, owner's account only)

1. Set `WEB_PLAYER = "on"` in `apps/sync-worker/wrangler.toml` on a deploy only the owner uses, and watch normally for a
   week (live, a film, a series). Leave `WATCH_DAILY_CAP_MB` as it is.
2. **Bytes carried**, from D1 (`watch_usage` is per account per UTC day):
   `wrangler d1 execute testcard-sync --remote --command "SELECT day, ROUND(bytes/1048576.0) AS mb FROM watch_usage ORDER BY day"`
3. **Requests and CPU time** for the same days, from the Worker's metrics in the Cloudflare dashboard (requests per day,
   and CPU time per request). Requests include the app's sync calls, so subtract a day with the player off for a baseline.
4. Work out three numbers: **requests per GB**, **CPU milliseconds per GB**, and **GB per hour of viewing** (hours
   watched come from the owner's own notes). Price a heavy user at one or two cap-days of that per month, against
   Cloudflare's current rates for requests and CPU on the plan in use.
5. Write the result and the chosen price under "Decision" here, and move this ADR to Accepted.

The count is written when a stream ends, so a day with one very long stream can read low and the next day high.

## Update 2026-10-14: first measurements, and what they change

**Measured** (remote preview against the live account, Cloudflare dashboard, rolling 24 hours; figures rounded to ±10):

| | Total requests | Worker invocations | CPU P90 |
|---|---|---|---|
| Before | 4.14k | 3.30k | 13 ms |
| After a 10 minute live TV test | 4.28k | 3.43k | 13 ms |
| After a second 10 minute test | 4.47k | 3.62k | 12 ms |

That is about 13 to 19 requests a minute, or **roughly 800 to 1,150 requests per hour of live viewing**, with CPU
unchanged. Bytes carried were not measured (the daily cap was 0, which skips counting, and migration 0008 is not applied
in production).

**What it changes.** At that rate the Workers paid plan's included requests (about 10 million a month, to be confirmed
on Cloudflare's pricing page) cover several thousand viewing hours a month, and the owner intends to take that plan for
sending email from the domain anyway. Request and CPU cost per viewer is negligible, so **cost is no longer the reason
to charge**. Decision 2 (recurring only, no lifetime yet) stands as caution, but the price should be set by what a
licence buys the service, not by cost:

- abuse control: an open proxy attracts scraping and relays, and an account that pays can be limited or removed;
- provider blocking: every viewer shares Cloudflare's addresses, and providers may start refusing them;
- support time;
- Cloudflare's terms on proxying video, which are the likeliest limit.

A modest yearly price, or a generous free allowance with a cap, fits these better than a price derived from cost.

**Still to confirm:** the master agreement and acceptable use policy, and what the paid plan
includes for email sending, and Cloudflare's current terms for proxying video.

**Bytes (measured, browser Network tab):** 228 MB transferred in 11 min 12 s of live BBC 1 HD, about 20 MB a minute or
**1.2 GB per hour** (around 2.7 Mbps). 203.6 MB of that was a single request: the raw transport stream played through
mpegts.js, which is one long connection rather than many. The earlier HLS attempt moved about 2.9 MB per segment. So
request count per hour depends on the provider's format (about one for a raw stream, roughly a thousand for HLS), while
bytes per hour are steady. The 20 GB daily cap is about 16 hours of viewing per account. Outbound data is not billed on
Workers as far as is known, but it is the figure Cloudflare's terms are most likely to care about; confirm them before
switching the player on for others.

## Confirmed from Cloudflare's documentation (read 2026-10-14)

Sources: Workers pricing (updated 2 Oct 2026), Workers limits (updated 12 Oct 2026), Developer Platform
Service-Specific Terms (updated 28 Sep 2026).

- **Pricing:** the paid plan is $5 a month minimum and includes 10 million requests and 30 million CPU-milliseconds a
  month; above that, $0.30 per million requests and $0.02 per million CPU-ms. "There are no additional charges for data
  transfer (egress) or throughput (bandwidth)." At about 1,000 requests and 12 ms CPU per viewing hour, the included
  allowance covers roughly 10,000 viewing hours a month.
- **Free plan** is not enough: 100,000 requests a day (error 1027 beyond that) and 10 ms CPU per request. The observed
  P90 of 12 to 13 ms is over that limit, which Cloudflare tolerates only occasionally.
- **Paid plan limits that matter:** no request cap; CPU time per request 30 s by default (up to 5 min); no duration limit
  on an HTTP request while the client stays connected; no enforced response body size; six connections waiting for
  headers per invocation (the proxy makes one fetch at a time, so this is fine).
- **Streams can be cut.** When Cloudflare updates the Workers runtime, existing streaming responses get up to 20 minutes
  to finish before the process ends them. The player's existing feed handling (move on after an error) covers this;
  a long raw stream should reconnect rather than show an error.
- **Terms:** the Developer Platform terms let Cloudflare temporarily limit requests that put "an undue burden" on its
  network, and limit or suspend for suspected violations of the Agreement. The account holder is solely responsible for
  what end users do. The sections read contain no restriction aimed at relaying video, and the Stream and Images terms
  do not apply (neither is used). **Not reviewed:** the master agreement and acceptable use policy, which are the other
  half of the answer; a provider's own terms on relaying a login through a third party are a separate question.
