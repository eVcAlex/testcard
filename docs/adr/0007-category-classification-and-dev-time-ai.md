# ADR 0007: Category classification is deterministic; TypeSafe/Jev is a development-time evaluator

## Status

Accepted.

## Context

Provider category names are messy and inconsistent: `UK| SKY SPORTS ᴴᴰ/ᴿᴬᵂ`, `|EN| HORROR/THRILLER`,
`🧸 Kids Channels`, `NETFLIX DOCU-SERIES ⁴ᴷ ³⁸⁴⁰ᴾ`, `##### PPV #####`. The only structure Testcard
extracted was the country prefix (`parseName`). Browsing 480+ live categories, or a wall of movie
categories, by raw name is poor UX, and a canonical **genre** (Sports, Kids, Documentary, …) is the
obvious missing facet.

Semantic judgement of this kind is where a model like TypeSafe's Jev is strong (it recognised `GAA`,
`MILB`, `NCAAF` and `SETANTA` as sports where a keyword list could not). But Testcard is a local,
single-user desktop app whose core (`packages/core`) is reused by future Android/Fire TV apps, and:

- A TypeSafe API key must never live in the Electron app, the renderer, the sync worker, or any
  application runtime — a shipped key is a leaked key, and a proxy would add a server we don't
  otherwise need for this feature.
- Playback and browsing must never depend on a network call, and must stay fast with tens of
  thousands of channels.
- Category names are third-party data; nothing that could carry a URL or credential may leave the
  device.

## Decision

1. **The runtime classifier is deterministic and pure.** `classifyCategory(rawName)` in
   `packages/core/src/normalise/classifyCategory.ts` returns `{ genre, service, language, tags }`
   from rules alone — no network, no clock, no randomness. It runs during import (next to the
   existing `country` parse) and the result is stored on `categories`, `movie_categories` and
   `series_categories` (`genre`, `language`, `service`, `tags`). The provider's own `raw_name` is
   never replaced.
2. **Everything it produces is advisory.** Unknown → `null`/empty. The UI derives filters
   (`GenreBar`) from stored values and behaves normally without them. `separator`/`junk` are
   *flags*, never grounds to hide or delete a category (a `4K| UHD` category still holds channels).
   `adult` categories stay browsable by name but are never promoted to a top-level genre filter.
3. **Stored results are cached by rule version.** `CLASSIFIER_VERSION` is recorded in
   `schema_meta`; on open, `reclassifyCategories` recomputes every category when it differs (hundreds
   of rows, milliseconds). This also back-fills existing installs and lets a rule fix reach them
   without a provider refresh. Bump the version whenever a rule changes.
4. **TypeSafe/Jev is used by the developer, not the app.** `packages/core/evals/categoryJev.eval.ts`
   (`pnpm --filter @testcard/core eval:categories`, needs `TYPESAFE_API_KEY` in the developer's own
   environment) asks Jev a Choice (genre) and a Noul (is this uninformative?) question about each
   real category name and reports where the rules and Jev disagree. Humans then fix the *rules*.
   Jev never writes anything the app reads. Responses are cached in the git-ignored
   `evals/.cache/`; `QUESTION_VERSION` invalidates them if the wording changes.
5. **The audit is reproducible offline.** Cases where the rules and Jev independently agree with
   confidence ≥ 0.9 are frozen into `src/__tests__/fixtures/categoryGolden.json`
   (`WRITE_GOLDEN=1`). `classifyCategory.test.ts` asserts against that fixture with no network.
6. **Only category names are ever sent, and only after a filter.** `evals/safeToSend.ts` refuses
   any string that looks like a URL, hostname, email, `key=value` credential, query string or long
   token (tested). The harness has no access to source names, hosts, usernames or passwords.
7. **The boundary is enforced mechanically.** `__tests__/coreBoundary.test.ts` fails if
   `packages/core` imports or declares Electron, React, desktop-app or AI-service modules, or reads a
   TypeSafe credential.

### What "confidence" means

- **Rules → app:** there is no probability. A field is either set by an explicit rule or `null`.
  When keywords from two genres appear, the one mentioned first wins (`DRAMA/ROMANCE` → drama);
  `adult` always wins because that is the costly mistake.
- **Jev → dev tool:** Choice `confidence` (0–1, from the answer's probability distribution) orders
  the disagreement report; ≥ 0.9 agreement with the rules qualifies a case for the golden set.
  Noul answers carry no confidence, only a probability of yes. Jev's judgement is an input to a
  human decision, not an oracle — it was wrong in the audit too (e.g. it agreed `ADULT SWIM` was
  adult content; the rule was corrected by review and pinned with a regression test).

### Fallbacks

There is nothing to fall back *from*: the app never calls TypeSafe. If the classifier misses a name
the category is simply unfiltered by genre; if the eval can't reach TypeSafe the developer loses the
audit, not the app.

## Alternatives considered

- **Runtime Jev calls from the app or sync worker, cached in SQLite.** Rejected: puts a credential
  (or a new server) in the runtime, adds a network dependency to import, sends user data off-device,
  and makes classification non-reproducible. The deterministic classifier reaches ~98% agreement
  with Jev on real data without any of that.
- **Shipping a Jev-generated lookup table.** Rejected as brittle: providers rename categories
  constantly; rules generalise (`… PPV`, `… KIDS ⁴ᴷ`) where a table of exact strings does not.

## Consequences

- Rule changes are cheap to validate: run the eval, read the disagreements, add a test, bump
  `CLASSIFIER_VERSION`.
- The classifier is English-centric (genre words, language prefixes). Non-English providers will see
  fewer genres until rules are added; the failure mode is "unfiltered", never "wrong or broken".
- Adding a schema column requires an ADR 0005 migration (done: v7). `reclassifyCategories` is
  DB-backed and therefore, per ADR 0003, verified in the desktop smoke test rather than by a plain
  Vitest run; the pure classifier carries the unit tests.
- Future Android/Fire TV apps get the classifier and its tests for free, because it lives in core.
