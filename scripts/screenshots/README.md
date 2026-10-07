# Website screenshots

Everything on screen is invented: `fake-provider.mjs` is an Xtream-style server with made-up channels, guide, films and
series, and generated test-pattern artwork (sharp). No real provider, channel, logo or playlist is involved.

One-time: `cd scripts/screenshots && npm install` (playwright-core; this folder is outside the pnpm workspace).

## Desktop (Windows)
1. `pnpm --filter @testcard/desktop build`
2. `node scripts/screenshots/desktop.mjs` (if `ELECTRON_RUN_AS_NODE` is set in your shell it is dropped for the app).
   It uses a throwaway profile, adds the source through the app's own add call and writes `raw/desktop-live.png`
   and `raw/desktop-movies.png` at 1600x900. The video box in Live TV stays black: the demo streams are not real.

## Fire TV (Android emulator, adb on PATH, only ever `-s emulator-5554`)
1. Create a TV AVD from an installed image: `avdmanager create avd -n shots_tv -k "system-images;android-36;android-tv;x86_64" -d tv_1080p`
   and start it: `emulator -avd shots_tv -port 5554 -no-snapshot -no-audio -gpu swiftshader_indirect`.
2. A local sync server, so no real account is touched: in `apps/sync-worker`,
   `wrangler d1 migrations apply testcard-sync --local --persist-to <dir>` then
   `wrangler dev --local --port 8787 --ip 0.0.0.0 --persist-to <dir>`.
3. Run the fake provider: `node scripts/screenshots/fake-provider.mjs 9998`.
4. Build with Gradle 8.14.3 (the repo has no wrapper): in `apps/tv-native`,
   `gradle :app:assembleDebug -PsyncUrl=http://10.0.2.2:8787` for the seed route, or `:app:assembleRelease -PsyncUrl=http://10.0.2.2:8787 -PreleaseAbi=x86_64`
   for a build without the debug performance overlay (the emulator is x86_64; CI's release APK is armeabi-v7a only and will not install).
5. Seed (debug build only): `adb -s emulator-5554 shell "am start -n com.evcalex.testcard/.tv.MainActivity --es seed 'demo@example.test|demo-password-1|http://10.0.2.2:9998'"`.
   Then install the release build and sign in with the same email and password; the sources arrive by sync.
6. `adb -s emulator-5554 exec-out screencap -p > scripts/screenshots/raw/tv-home.png` (and `tv-guide.png`, Live TV, All channels under the Panel source).

## Then
`node scripts/screenshots/compress.mjs` and put the printed sizes into `SHOTS` in `apps/web/src/site.ts`.
