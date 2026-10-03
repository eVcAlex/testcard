#!/usr/bin/env node
// Every sentence the React Native app can show must still be in the native app (parity ledger, plan phase 16). Reads the string
// literals and JSX text of apps/mobile/src and the shared core, keeps the ones that read as text for a person, and lists the
// ones that appear nowhere in apps/tv-native's Kotlin. Differences that are intended go in parity/strings-allow.txt (one per line).
//
//   node apps/tv-native/parity/strings-diff.mjs
import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..", "..");
const walk = (dir, pick) =>
  readdirSync(dir).flatMap((name) => {
    if (name === "node_modules" || name === "__tests__" || name === "build") return [];
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path, pick) : pick(path) ? [path] : [];
  });

const sources = [
  ...walk(join(root, "apps", "mobile", "src"), (p) => /\.tsx?$/.test(p) && !/\.test\./.test(p)),
  ...walk(join(root, "packages", "core", "src"), (p) => /\.ts$/.test(p) && !/\.test\./.test(p) && /(sync|source|setup|update|account|player|playback|epg|catchup|profile|hidden)/i.test(p)),
];
const kotlin = walk(join(root, "apps", "tv-native"), (p) => p.endsWith(".kt") && !/[\\/]build[\\/]/.test(p) && !/[\\/]test[\\/]/i.test(p) && !/androidTest/.test(p))
  .map((p) => readFileSync(p, "utf8"))
  .join("\n");
// Compared with quotes, escapes, `${...}` and `{...}` holes and runs of spaces taken out of both sides.
const squash = (text) =>
  text
    .replace(/\\["'`n]/g, "")
    .replace(/\$\{[^}]*\}|\$[A-Za-z_]\w*|\{[^}]*\}/g, "")
    .replace(/[\s"'`’‘“”]+/g, " ")
    .trim()
    .toLowerCase();
// The Kotlin side only loses quotes and line breaks: its braces are code, not holes, and must not swallow the text between them.
const haystack = kotlin.replace(/\\["'`n]/g, "").replace(/[\s"'`’‘“”]+/g, " ").toLowerCase();
const allowFile = join(here, "strings-allow.txt");
const allow = new Set(existsSync(allowFile) ? readFileSync(allowFile, "utf8").split("\n").map((l) => squash(l)).filter(Boolean) : []);

const found = new Map();
const keep = (text) =>
  /[A-Za-z]{3,}\s+[A-Za-z]{2,}/.test(text) && !/^(import|export|const|function|return|http|\/|\.|@|#|SELECT|INSERT|UPDATE|DELETE|CREATE|PRAGMA|WITH)\b/.test(text) && !/[;{}=]|=>|\bfunction\b/.test(text.replace(/\$\{[^}]*\}/g, "")) && text.length >= 8;
for (const file of sources) {
  const code = readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
  const add = (text) => {
    const t = text.trim();
    if (keep(t) && !found.has(t)) found.set(t, relative(root, file).replaceAll("\\", "/"));
  };
  for (const m of code.matchAll(/"((?:[^"\\\n]|\\.)*)"/g)) add(m[1]);
  for (const m of code.matchAll(/'((?:[^'\\\n]|\\.)*)'/g)) add(m[1]);
  for (const m of code.matchAll(/`((?:[^`\\]|\\.)*)`/g)) add(m[1]);
  for (const m of code.matchAll(/>\s*([^<>{}\n][^<>{}]*?)\s*</g)) add(m[1].replace(/\s+/g, " "));
}
const missing = [...found].filter(([text]) => {
  const s = squash(text);
  if (s.length < 6 || allow.has(s)) return false;
  // Text with holes in it is checked by its pieces of plain words.
  const pieces = text.split(/\$\{[^}]*\}|\{[^}]*\}/).map(squash).filter((p) => p.length >= 6);
  return !(pieces.length === 0 ? haystack.includes(s) : pieces.every((p) => haystack.includes(p)));
});
for (const [text, file] of missing) console.log(`${file}: ${text}`);
console.log(`\n${missing.length} of ${found.size} strings are not in the native app.`);
process.exitCode = missing.length === 0 ? 0 : 1;
