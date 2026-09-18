import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * The architectural rule the whole codebase leans on (README, CONTEXT.md): `packages/core` is pure
 * TypeScript that a future Android/Fire TV app reuses, so it must never depend on Electron, React,
 * the desktop app, or any UI/host framework. Checked mechanically rather than by review, and it also
 * keeps external AI services out of core (TypeSafe/Jev is a development-time tool — ADR 0007).
 */
const coreRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const FORBIDDEN = [
  /^electron($|\/)/,
  /^react($|-|\/)/,
  /^@testcard\/desktop/,
  /^apps\//,
  /^@electron/,
  /typesafe/i,
];

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (entry === "node_modules" || entry === ".cache" || entry === "dist") return [];
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx)$/.test(entry) ? [path] : [];
  });
}

function importedModules(source: string): string[] {
  const specifiers: string[] = [];
  for (const match of source.matchAll(/(?:^|\n)\s*(?:import|export)\b[^"'`\n]*?from\s+["']([^"']+)["']/g)) specifiers.push(match[1] as string);
  for (const match of source.matchAll(/(?:^|[^\w.])import\(\s*["']([^"']+)["']\s*\)/g)) specifiers.push(match[1] as string);
  for (const match of source.matchAll(/(?:^|\n)\s*import\s+["']([^"']+)["']/g)) specifiers.push(match[1] as string);
  return specifiers;
}

describe("packages/core stays free of host frameworks", () => {
  // The dev-time Jev audit lives in evals/ and is not part of the shipped package surface.
  const shipped = sourceFiles(join(coreRoot, "src")).filter((file) => !file.includes(`${join("src", "__tests__")}`));

  it("scans a meaningful number of files", () => {
    expect(shipped.length).toBeGreaterThan(20);
  });

  it("imports no Electron, React, desktop-app or AI-service modules", () => {
    const violations: string[] = [];
    for (const file of shipped) {
      for (const specifier of importedModules(readFileSync(file, "utf8"))) {
        if (FORBIDDEN.some((pattern) => pattern.test(specifier))) violations.push(`${relative(coreRoot, file)} imports "${specifier}"`);
      }
    }
    expect(violations).toEqual([]);
  });

  it("declares no Electron, React or AI-service dependencies", () => {
    const manifest = JSON.parse(readFileSync(join(coreRoot, "package.json"), "utf8")) as Record<string, Record<string, string> | undefined>;
    const declared = [...Object.keys(manifest["dependencies"] ?? {}), ...Object.keys(manifest["devDependencies"] ?? {}), ...Object.keys(manifest["peerDependencies"] ?? {})];
    expect(declared.filter((name) => FORBIDDEN.some((pattern) => pattern.test(name)))).toEqual([]);
  });

  it("never reads a TypeSafe credential from the shipped source", () => {
    const offenders = shipped.filter((file) => /TYPESAFE_API_KEY|api\.typesafe\.ai/.test(readFileSync(file, "utf8")));
    expect(offenders.map((file) => relative(coreRoot, file))).toEqual([]);
  });
});
