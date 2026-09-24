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
2. **Publishing is automatic from main.** A Fire TV build of main uploads itself at the end of the
   "Android APK" workflow, using the repo secrets `CLOUDFLARE_API_TOKEN` (Workers, D1 and R2 edit)
   and `CLOUDFLARE_ACCOUNT_ID`. `pnpm release:android [run-id]` still publishes any run by hand,
   with the developer's own wrangler login. The "Sync worker" workflow likewise applies D1
   migrations and deploys the worker when main changes it.
3. **The manifest** is `{versionCode, versionName, commit, apks: {firetv}, notes}`. CI stamps every
   build with `versionCode = github.run_number`, because Android only installs a strictly higher one.
   Each APK is uploaded under its own name (`testcard-firetv-<run>.apk`), so no cache can serve an
   older one. `notes` lists, for the last 15 builds, the commit subjects since the build before
   (`scripts/release-manifest.mjs`), so commit subjects are written for the viewer.
4. **On the device**, `apps/mobile/src/update`: check shortly after launch and every six hours
   (switchable off under Account and updates), and offer a new version in a dialog with what
   changed; Later puts that version off. Update now downloads the APK in the app and installs it
   through Android's `PackageInstaller` session (the local module `modules/testcard-installer`),
   which reports a refusal instead of silently doing nothing, as handing the file to an
   `ACTION_VIEW` intent did (0.1.66 and earlier sat at "Downloading 100%"). If Testcard may not
   install apps yet, the dialog opens that setting and carries on once it is allowed.
5. **Signing key.** Updates install only if signed with the same key as the installed app. Builds
   use Expo's debug keystore, which is the same on every run. A dedicated keystore in GitHub
   secrets should replace it before the app leaves the owner's devices.

## Consequences

- The first build with the updater has to be installed by hand; later ones arrive in the app.
- Builds made before this change have versionCode 1 and no updater.
- The desktop app uses the same bucket through `electron-updater` (generic provider). `pnpm release:desktop` uploads the installer and `latest.yml` after `pnpm package`; the Account page has an Updates panel that checks, downloads on request and restarts to install. It never downloads on its own. Installers before 0.1.1 have no updater, so that one is installed by hand once. The installer is unsigned, so Windows SmartScreen can warn on that first install.
- Builds up to 0.1.66 install updates the old way, which did not work on the owner's Fire Stick:
  the first build with the installer module is installed by hand once.
