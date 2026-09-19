// Local Android TV development: an emulator, plus a debug build whose JavaScript loads from this PC.
//   pnpm android:emulator   start the "tv1080" Android TV emulator (1080p, the same 960 dp as a Fire Stick)
//   pnpm android:install    fetch the newest debug APK built by CI ("debug" target) and install it
//   pnpm android:run        start the dev server, point the device at it and launch the app
//   pnpm android:type "text"   type into the focused field (a PC keyboard may not reach the emulator)
//   pnpm android:log        show the app's log (JS errors, native crashes) from the device
// Native code is built by CI, not here: pnpm's deep node_modules paths break CMake on Windows (250 chars).
// The device can be the emulator or a Fire Stick over the network (adb connect <ip>).
// The SDK lives in C:/Android; override with ANDROID_HOME / JAVA_HOME.
import { execFileSync, spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(fileURLToPath(import.meta.url), "..", "..");
const sdk = process.env.ANDROID_HOME ?? "C:/Android/sdk";
const jdk = process.env.JAVA_HOME ?? "C:/Android/jdk17";
const env = {
  ...process.env,
  ANDROID_HOME: sdk,
  ANDROID_SDK_ROOT: sdk,
  JAVA_HOME: jdk,
  PATH: [join(jdk, "bin"), join(sdk, "platform-tools"), join(sdk, "emulator"), process.env.PATH].join(";"),
};

const run = (command, args, options = {}) =>
  new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: "inherit", shell: true, env, ...options });
    child.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`${command} exited with ${code}`))));
  });

const command = process.argv[2];
if (command === "emulator") {
  // -gpu host uses the PC's graphics card; -no-snapshot-save keeps every start a clean boot.
  await run("emulator", ["-avd", "tv1080", "-gpu", "host", "-no-snapshot-save"]);
} else if (command === "install") {
  const runId = execFileSync("gh", ["api", "repos/eVcAlex/testcard/actions/artifacts?name=testcard-debug", "--jq", ".artifacts[0].workflow_run.id"], { encoding: "utf8", env, shell: true }).trim();
  if (runId === "" || runId === "null") throw new Error('No debug APK yet: run the "Android APK" workflow with target "debug".');
  const dir = mkdtempSync(join(tmpdir(), "testcard-debug-"));
  await run("gh", ["run", "download", runId, "-n", "testcard-debug", "-D", dir]);
  await run("adb", ["install", "-r", "-d", join(dir, "testcard-debug.apk")]);
} else if (command === "run") {
  await run("adb", ["reverse", "tcp:8081", "tcp:8081"]);
  await run("adb", ["shell", "am", "start", "-a", "android.intent.action.MAIN", "-c", "android.intent.category.LEANBACK_LAUNCHER", "-n", "com.evcalex.testcard/.MainActivity"]).catch(() => undefined);
  await run("pnpm", ["exec", "expo", "start", "--port", "8081"], { cwd: join(root, "apps", "mobile"), env: { ...env, EXPO_TV: "1" } });
} else if (command === "type") {
  if (process.argv.length < 4) {
    console.log('usage: pnpm android:type "text to type"   (click the field and press select first)');
    process.exit(1);
  }
  await run("adb", ["shell", "input", "text", `'${process.argv.slice(3).join(" ").replace(/ /g, "%s")}'`]);
} else if (command === "log") {
  await run("adb", ["logcat", "-v", "time", "ReactNativeJS:V", "AndroidRuntime:E", "*:S"]);
} else {
  console.log("usage: node scripts/android-dev.mjs emulator | install | run | type | log");
  process.exit(1);
}
