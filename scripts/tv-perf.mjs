// Repeatable device measurements for a TV app, the same for the React Native app and the native one (ADR 0012, Phase 0).
//   node scripts/tv-perf.mjs <package> <activity> [--runs 10] [--keys home,live] [--dry-run <gfxinfo.txt>]
//   e.g. node scripts/tv-perf.mjs com.evcalex.testcard .MainActivity
// Uses whatever device `pnpm android stick <ip>` last chose (.android-device), else the one adb sees.
// Prints JSON and writes perf-results/<package>-<date>.json. Key scripts press the D-pad at a fixed pace on whatever
// screen is showing, so put the app on the screen you want to measure (Home, Live, Movies, a Browse grid) first.
// --dry-run parses a saved `dumpsys gfxinfo` file instead of touching a device (a check of the parser).
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(fileURLToPath(import.meta.url), "..", "..");
const args = process.argv.slice(2);
const flag = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);

/** Frames, jank and percentiles out of `dumpsys gfxinfo <pkg>` text. */
export function parseGfxinfo(text) {
  const number = (pattern) => {
    const match = pattern.exec(text);
    return match === null ? null : Number(match[1]);
  };
  return {
    frames: number(/Total frames rendered: (\d+)/),
    jankyFrames: number(/Janky frames: (\d+)/),
    jankyPercent: number(/Janky frames: \d+ \(([\d.]+)%\)/),
    p50: number(/50th percentile: (\d+)ms/),
    p90: number(/90th percentile: (\d+)ms/),
    p95: number(/95th percentile: (\d+)ms/),
    p99: number(/99th percentile: (\d+)ms/),
  };
}

/** TotalTime (ms) out of `am start -W` text. */
export const parseStartTime = (text) => Number(/TotalTime: (\d+)/.exec(text)?.[1] ?? NaN);

/** Total PSS, Java heap and native heap (KB) out of `dumpsys meminfo <pkg>` text. */
export function parseMeminfo(text) {
  const kb = (pattern) => Number(pattern.exec(text)?.[1] ?? NaN);
  return { totalPssKb: kb(/TOTAL PSS:\s+(\d+)/), javaHeapKb: kb(/Java Heap:\s+(\d+)/), nativeHeapKb: kb(/Native Heap:\s+(\d+)/) };
}

const dryRun = flag("--dry-run");
if (dryRun !== undefined) {
  console.log(JSON.stringify(parseGfxinfo(readFileSync(dryRun, "utf8")), null, 2));
  process.exit(0);
}

const [pkg, activity] = args;
if (pkg === undefined || activity === undefined || pkg.startsWith("--")) {
  console.log("usage: node scripts/tv-perf.mjs <package> <activity> [--runs 10] [--keys home,live]");
  process.exit(1);
}
const runs = Number(flag("--runs", "10"));
const keyScripts = flag("--keys", "home").split(",");

const mac = process.platform === "darwin";
const sdk = process.env.ANDROID_HOME ?? (mac ? join(homedir(), "Library/Android/sdk") : "C:/Android/sdk");
const deviceFile = join(root, ".android-device");
const device = existsSync(deviceFile) ? readFileSync(deviceFile, "utf8").trim() : "";
const env = { ...process.env, ...(device !== "" ? { ANDROID_SERIAL: device } : {}), PATH: [join(sdk, "platform-tools"), process.env.PATH].join(delimiter) };
const adb = (...a) => execFileSync("adb", a, { encoding: "utf8", env, maxBuffer: 64 * 1024 * 1024 });
const shell = (command) => adb("shell", command);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const component = `${pkg}/${activity.startsWith(".") ? pkg + activity : activity}`;

// Fixed D-pad sequences at a fixed pace. The pace is deliberately quicker than a person's, to stress the thread.
const SCRIPTS = {
  home: ["DPAD_RIGHT", "DPAD_RIGHT", "DPAD_RIGHT", "DPAD_DOWN", "DPAD_RIGHT", "DPAD_RIGHT", "DPAD_DOWN", "DPAD_LEFT", "DPAD_LEFT", "DPAD_UP", "DPAD_UP"],
  live: ["DPAD_DOWN", "DPAD_DOWN", "DPAD_DOWN", "DPAD_DOWN", "DPAD_DOWN", "DPAD_DOWN", "DPAD_UP", "DPAD_UP", "DPAD_UP", "DPAD_RIGHT", "DPAD_RIGHT", "DPAD_LEFT"],
  movies: ["DPAD_RIGHT", "DPAD_RIGHT", "DPAD_RIGHT", "DPAD_RIGHT", "DPAD_DOWN", "DPAD_RIGHT", "DPAD_RIGHT", "DPAD_DOWN", "DPAD_DOWN", "DPAD_LEFT", "DPAD_UP"],
  browse: ["DPAD_DOWN", "DPAD_DOWN", "DPAD_DOWN", "DPAD_DOWN", "DPAD_RIGHT", "DPAD_RIGHT", "DPAD_DOWN", "DPAD_DOWN", "DPAD_DOWN", "DPAD_UP", "DPAD_UP", "DPAD_UP"],
};
const KEY_INTERVAL_MS = 250;
const REPEATS = 6;

async function startTimes(kind) {
  const times = [];
  for (let run = 0; run < runs; run += 1) {
    if (kind === "cold") shell(`am force-stop ${pkg}`);
    else shell("input keyevent KEYCODE_HOME");
    await sleep(1500);
    times.push(parseStartTime(shell(`am start -W -n ${component}`)));
    await sleep(4000);
  }
  const sorted = [...times].sort((a, b) => a - b);
  return { times, median: sorted[Math.floor(sorted.length / 2)], max: sorted.at(-1) };
}

async function keyScript(name) {
  const keys = SCRIPTS[name];
  if (keys === undefined) throw new Error(`no key script "${name}" (${Object.keys(SCRIPTS).join(", ")})`);
  shell(`dumpsys gfxinfo ${pkg} reset`);
  for (let repeat = 0; repeat < REPEATS; repeat += 1) {
    for (const key of keys) {
      shell(`input keyevent KEYCODE_${key}`);
      await sleep(KEY_INTERVAL_MS);
    }
  }
  await sleep(500);
  return parseGfxinfo(shell(`dumpsys gfxinfo ${pkg}`));
}

const result = { package: pkg, date: new Date().toISOString(), device: device || "default", model: shell("getprop ro.product.model").trim(), os: shell("getprop ro.build.version.release").trim() };
result.cold = await startTimes("cold");
result.warm = await startTimes("warm");
shell(`am start -W -n ${component}`);
await sleep(4000);
result.keys = {};
for (const name of keyScripts) result.keys[name] = await keyScript(name);
result.memory = parseMeminfo(shell(`dumpsys meminfo ${pkg}`));
// `[perf]` is the React Native app's log tag, `TC_PERF` the native one's.
result.logcat = shell("logcat -d -v brief").split("\n").filter((line) => /\[perf\]|TC_PERF/.test(line)).slice(-200);

mkdirSync(join(root, "perf-results"), { recursive: true });
writeFileSync(join(root, "perf-results", `${pkg}-${result.date.slice(0, 10)}.json`), JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));
