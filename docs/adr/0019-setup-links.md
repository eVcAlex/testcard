# ADR 0019: Setup links (sources shared by link)

## Status

Accepted (2026-10-29). The Worker API, the schema and the sealing are built; the web page, the desktop sharing and import
screens and the Fire TV entry are not yet.

## Context

A person who already has IPTV details should be able to give someone a link that gets them watching without typing a
server address, login or guide URL. The details are credentials, so the link must not contain them, must be revocable,
and must not give the receiver anything of the sender's Testcard account.

## Decision

1. **A sealed profile, referenced by link.** `https://evicted.dev/s#<id>.<secret>`. The sender's device validates the source
   (`SetupProfilePayloadSchema`, strict: one source, no pins, hidden items or history) and seals it with AES-GCM under a key
   derived by HKDF from `<secret>`, bound to `<id>`. The Worker stores only that ciphertext (`setup_profiles`).
2. **The secret is only in the fragment**, which browsers do not send, so the Worker, its logs and any proxy never see it.
   A second HKDF output is a *proof*; the Worker stores its SHA-256 and gives the ciphertext only to a request that shows
   the matching proof. Knowing the id alone gets nothing.
3. **The link is a bearer credential**, so it is short-lived (7 days by default, 30 at most), single-use by default (up to
   5), and revocable: revoking empties the stored ciphertext at once, even for a link already claimed. A sender can have 25
   live links. Claiming is one atomic statement, so racing devices cannot both win a single-use link, and every failure
   (unknown id, wrong proof, expired, revoked, used up) answers identically. Claims are rate-limited per network per day.
4. **Claiming needs no account**; creating, listing and revoking need the sender's session at `/share`. The payload has no
   account material, so a link never reaches the sender's account. The sender's label is plaintext and shown only to them.
5. **The receiving device validates again** after opening, then stores the login through the platform's secure storage
   exactly as a hand-typed source would be. Nothing is logged.
6. **No new auth system.** Existing sessions and rate limiting are reused.

## Consequences

- The server cannot read shared credentials, but a link that is leaked can be claimed until it is used up, expires or is
  revoked; the sender's list shows how often it has been claimed.
- A single-use link whose import fails after the claim is spent; the sender makes a new one.
- `/setup` is already the website's help page, so the API lives under `/share` and the page at `/s`.
- Delivery still to build: a `/s` page that hands off to the app (`testcard://s#...`, needing a protocol registration and
  single-instance handling on desktop, which does not exist yet) or shows the download; on Fire TV, entering the link's
  code at first run. Sharing a provider login may breach the provider's terms or connection limits; the share screen should say so.
