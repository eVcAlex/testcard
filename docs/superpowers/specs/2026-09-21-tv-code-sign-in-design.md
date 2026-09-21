# Sign in a TV with a code

Status: approved in chat 2026-09-21. Not built yet.

## Problem

A fresh Fire TV asks for an email and password typed with a remote. Sources are encrypted with a key derived from the
account password (`packages/core/src/sync/credentialCrypto.ts`), so a TV that signs in must end up holding that
password. A link-code flow therefore has to carry the password to the TV end to end, never readable by the server.

## Flow

1. TV: user picks **Sign in with a code**. The TV makes a random 8-character code (alphabet without look-alikes,
   40 bits) and a random 16-byte salt, and shows the code, the page address and a QR code for `<origin>/link#<code>`.
2. TV to server: `POST /link/start` with `{ lookup, salt }`. `lookup = base64(PBKDF2-SHA256(code, "testcard-link-lookup-v1", 210000))`.
   The server never sees the code.
3. Phone or computer opens `/link`, enters the code (or arrives with it in the URL fragment, which is never sent to a
   server), email and password. The page derives `lookup` the same way, asks `GET /link/session?lookup=` for the
   `salt`, and verifies the email and password against `POST /auth/sign-in/email` (a wrong password is shown on the
   page, not on the TV).
4. The page derives `key = PBKDF2-SHA256(code, salt, 210000)` (AES-GCM 256), encrypts `{ email, password }` with a
   fresh 96-bit IV and sends `POST /link/approve` with `{ lookup, blob, iv }`.
5. TV polls `GET /link/poll?lookup=` about every 2 s. On `ready` it receives `{ blob, iv }`, derives the same key,
   decrypts, and calls the normal `SyncController.signIn(email, password)`. The server deletes the row on that read.
6. The existing email and password form stays as the fallback.

## Server (apps/sync-worker)

- Migration `0002_link_sessions.sql`: `link_sessions(lookup TEXT PRIMARY KEY, salt TEXT NOT NULL, blob TEXT, iv TEXT,
  created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL)`.
- Routes, all unauthenticated and JSON, none logging bodies:
  - `POST /link/start`: validates shapes, deletes expired rows, inserts with a 10-minute expiry. A repeated `lookup`
    is rejected (409) so a code cannot be re-registered over a live one.
  - `GET /link/session?lookup=`: returns `{ salt }` while live and not yet approved, else 404.
  - `POST /link/approve`: sets `blob` and `iv` once (only if still null and live), else 404 or 409.
  - `GET /link/poll?lookup=`: `{ status: "waiting" }`, or `{ status: "ready", blob, iv }` and deletes the row,
    or 404 when expired or unknown.
- `GET /link`: the page, served as HTML with inline CSS and JS. It uses only WebCrypto.
- Abuse limits: at most one live session per `lookup`, body size caps, 10-minute expiry, one-time pickup. Because a
  guess needs the slow key derivation and there are 2^40 codes, brute force against live sessions is not practical.
  No code, password or blob is ever logged.

## Page (design)

Dark background and cream accent to match the TV app, one column, large type, mobile first. States: enter code,
signing in (button disabled, short progress text), success ("You're signed in on your TV"), and errors with plain
wording (code not found or expired, wrong email or password, network). No em dashes in the text. Mocked and approved
before it is built.

## TV (apps/mobile)

- `SignIn.tsx` gains a code mode as the first choice: code in large type, the address, a QR, "Waiting for you..."
  with a countdown, and a Cancel that returns to the form. The code renews when it expires.
- QR drawn from a pure-JavaScript matrix generator as plain views. No keys, no network.
- The shared crypto lives in `packages/core/src/sync/linkCrypto.ts` (`deriveLookup`, `deriveKey`, `seal`, `open`) so the
  TV and the tests use one implementation. The page carries its own small copy of the same steps; a test ties the two
  together with a fixed vector.
- `packages/core` stays free of Electron, React and Expo.

## Tests

- `linkCrypto`: seal then open round-trips, a wrong code fails to open, lookup is stable for a given code.
- A fixed vector that the page's copy must reproduce.
- Worker (vitest with D1): start, session, approve, poll happy path; expiry; poll is one-time; approve twice is
  rejected; a duplicate start is rejected.

## Out of scope

Account creation on the site, a device list, sign-out of other devices, a custom domain. Deploying the migration and
the Worker is a separate step that needs an explicit go.
