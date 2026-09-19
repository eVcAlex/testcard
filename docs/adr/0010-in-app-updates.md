# ADR 0010: The Android app updates itself from the sync worker's release bucket

## Status

Accepted. Not yet run on a device.

## Context

A sideloaded APK gets no store updates. The GitHub repo is private, so a device cannot download
release assets without a token, and a token must never ship inside the app.

## Decision

1. **A public, read-only release bucket.** Cloudflare R2 bucket `testcard-releases`, served by the
   existing sync worker at `/app/<file>` (`routes/release.ts`, allow-listed file types, no session).
   It holds build output only: `latest.json` and the APKs.
2. **Publishing is one command**, `pnpm release:android`, which takes the newest successful "Android
   APK" run and uploads it with the developer's own wrangler login. No Cloudflare token lives in
   GitHub. Automating it means adding a scoped token as a repo secret; nothing else changes.
3. **The manifest** is `{versionCode, versionName, apks: {firetv, phone}}`. CI stamps every build
   with `versionCode = github.run_number`, because Android only installs a strictly higher one.
4. **On the device**, `apps/mobile/src/update`: check at launch, show "Sources (update)" in the
   rail, and on Update now download the APK and hand it to Android's package installer. The user
   confirms once; the first time, Android asks to allow installs from Testcard
   (`REQUEST_INSTALL_PACKAGES`).
5. **Signing key.** Updates install only if signed with the same key as the installed app. Builds
   use Expo's debug keystore, which is the same on every run. A dedicated keystore in GitHub
   secrets should replace it before the app leaves the owner's devices.

## Consequences

- The first build with the updater has to be installed by hand; later ones arrive in the app.
- Builds made before this change have versionCode 1 and no updater.
- The desktop app can use the same bucket (`electron-updater` generic provider) later.
- The update path has not been exercised on a Fire Stick: the package-installer hand-off is the
  part most likely to need a fix.
