// Makes the generated Android project sign its release build with our own keystore instead of Expo's debug one.
// Run after `expo prebuild`. Does nothing unless ANDROID_KEYSTORE_BASE64 is set, so builds keep working until the
// secrets exist. Needs ANDROID_KEYSTORE_PASSWORD, ANDROID_KEY_ALIAS, ANDROID_KEY_PASSWORD too.
// Switching keys is a one-time break: a device running a build signed with the debug key must be uninstalled first.
import { readFileSync, writeFileSync } from "node:fs";

const { ANDROID_KEYSTORE_BASE64: keystore } = process.env;
if (!keystore) {
  console.log("No ANDROID_KEYSTORE_BASE64: release stays signed with the debug key.");
  process.exit(0);
}
for (const name of ["ANDROID_KEYSTORE_PASSWORD", "ANDROID_KEY_ALIAS", "ANDROID_KEY_PASSWORD"]) {
  if (!process.env[name]) throw new Error(`${name} is not set`);
}

const dir = "apps/mobile/android/app/";
writeFileSync(`${dir}release.keystore`, Buffer.from(keystore, "base64"));

const gradle = readFileSync(`${dir}build.gradle`, "utf8");
const withKey = gradle.replace(
  "    buildTypes {",
  `    signingConfigs.create("release") {
        storeFile file('release.keystore')
        storePassword System.getenv("ANDROID_KEYSTORE_PASSWORD")
        keyAlias System.getenv("ANDROID_KEY_ALIAS")
        keyPassword System.getenv("ANDROID_KEY_PASSWORD")
    }
    buildTypes {`,
);
const marker = "            // see https://reactnative.dev/docs/signed-apk-android.\n            signingConfig signingConfigs.debug";
if (!withKey.includes(marker) || withKey === gradle) throw new Error("build.gradle is not shaped as expected; update scripts/sign-release.mjs");
writeFileSync(`${dir}build.gradle`, withKey.replace(marker, marker.replace("signingConfigs.debug", "signingConfigs.release")));
console.log("Release signed with the release keystore.");
