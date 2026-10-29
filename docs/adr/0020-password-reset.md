# ADR 0020: Password reset by email

## Status

Accepted (2026-10-29). Worker, website page and the sign-in hints are built. Not yet exercised against real mail delivery
or on a Fire TV.

## Context

An account password is also the key that seals each source's login and each profile (`credentialCrypto.ts`); the server
holds only ciphertext. There was no way to recover a forgotten password, and a password changed any other way would have left
every device throwing on sealed rows it could no longer open.

## Decision

1. **Reset by email** with better-auth's `request-password-reset` / `reset-password`. The mail comes from
   `noreply@evicted.dev` through the existing `EMAIL` binding, sent after the answer so a known address is not slower than an
   unknown one. The token lasts an hour and works once. The request answers the same for any address; both calls are rate
   limited (5 requests an hour, 10 resets in ten minutes, per better-auth's limiter).
2. **A reset clears what the old password sealed.** In one D1 batch the account's `sources` and `profiles` rows are deleted
   and every session removed. The salt, favourites, recents and progress (not sealed) stay.
3. **Devices put it back themselves.** A signed-out device signs in again with the new password; `forgetSession` zeroes its
   sync cursors, so everything it still holds is sealed under the new key and uploaded. No counter or new client protocol was
   needed, and Fire TV's `SyncController` already behaves the same way. If no device still has a source, it is lost and
   must be added again (or sent as a setup link).
4. **Changing the password while signed in is closed** (`/auth/change-password` answers 404): it has no way to re-seal.
5. **Pages:** `/reset` on the website asks for the address, or, arriving from the emailed link, sets the new password. The
   token is removed from the address bar once read. The sign-in forms link to it, and the sign-up copy now says what a reset costs.

## Consequences

- A forgotten password no longer locks the account, but costs the synced sources unless a device still holds them.
- Anyone with access to the mailbox can reset the password and so clear the account's synced sources (not its
  history), though not read them; the mail says so.
- No email verification exists at sign-up, so an address that was mistyped belongs to someone else; the reset mail would go
  to them. Worth adding verification before this is widely relied on.
