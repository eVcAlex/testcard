import { describe, expect, it } from "vitest";
import { parseAndroid, parseDesktop } from "./releases.ts";

describe("releases", () => {
  it("reads the Windows installer from electron-builder's latest.yml", () => {
    expect(parseDesktop("version: 1.4.2\nfiles:\n  - url: x\npath: Testcard-Setup-1.4.2.exe\nsha512: abc\n")).toEqual({ version: "1.4.2", file: "Testcard-Setup-1.4.2.exe" });
  });
  it("returns undefined for a garbled yml", () => {
    expect(parseDesktop("nonsense")).toBeUndefined();
  });
  it("reads the Fire TV apk from latest.json", () => {
    expect(parseAndroid({ apks: { firetv: "testcard-firetv.apk" } })).toEqual({ file: "testcard-firetv.apk" });
  });
  it("returns undefined when there is no Fire TV apk or the shape is wrong", () => {
    expect(parseAndroid({ apks: {} })).toBeUndefined();
    expect(parseAndroid(null)).toBeUndefined();
    expect(parseAndroid({ apks: { firetv: "../evil.apk" } })).toBeUndefined();
  });
  it("reads an optional SHA-256 and ignores a malformed one", () => {
    const hex = "a".repeat(64);
    expect(parseDesktop(`version: 1.0.0\npath: a.exe\nsha256: ${hex.toUpperCase()}\n`)?.sha256).toBe(hex);
    expect(parseDesktop("version: 1.0.0\npath: a.exe\nsha256: nope\n")).toEqual({ version: "1.0.0", file: "a.exe" });
    expect(parseAndroid({ apks: { firetv: "a.apk" }, sha256: { firetv: hex } })?.sha256).toBe(hex);
  });
});
