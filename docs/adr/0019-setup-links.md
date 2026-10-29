# ADR 0019: Setup links (sources shared by link)

## Status

Accepted (2026-10-29). The Worker API, the sealing, the `/s` website page and the Windows app (share, shared links, import by
`testcard://` or paste) are built. The Fire TV entry is not.

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
- **Windows delivery.** The `/s` page only offers `testcard://s#…`; it claims nothing, so a chat app previewing the page cannot use a
  link up. The app registers the scheme (single-instance lock, so a link opens the running copy), previews the link (which counts one
  use), shows the person the name and the provider's host, and adds nothing until they agree, through the normal add-source path
  (login checked with the provider, kept in secure storage). A provider the device already has is reported and left alone, never
  overwritten or added twice. A link that is claimed but declined or fails is spent; the sender makes another.
- **Fire TV is not covered.** It has no deep links and always requires an account, and a 256-bit secret cannot be typed with a remote.
  The honest path today is to add the source on a PC or phone signed in to the account, which syncs to the TV; a short single-use
  code entered on the TV is the next step.
- Delivery notes from the design: a `/s` page that hands off to the app (`testcard://s#...`, needing a protocol registration and
  single-instance handling on desktop, which does not exist yet) or shows the download; on Fire TV, entering the link's
  code at first run. Sharing a provider login may breach the provider's terms or connection limits; the share screen should say so.
