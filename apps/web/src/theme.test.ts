import { nextPref, readPref, setPref } from "./theme.ts";

const media = (light: boolean) => vi.spyOn(window, "matchMedia").mockImplementation(() => ({ matches: light }) as MediaQueryList);

afterEach(() => { vi.restoreAllMocks(); localStorage.clear(); document.documentElement.removeAttribute("data-theme"); document.documentElement.removeAttribute("data-theme-pref"); });

describe("theme", () => {
  it("cycles auto, light, dark", () => {
    expect([nextPref("auto"), nextPref("light"), nextPref("dark")]).toEqual(["light", "dark", "auto"]);
  });

  it("applies an explicit choice and remembers it", () => {
    setPref("dark");
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(localStorage.getItem("tc-theme")).toBe("dark");
    expect(readPref()).toBe("dark");
  });

  it("auto follows the system and forgets the stored choice", () => {
    media(true);
    setPref("dark");
    setPref("auto");
    expect(document.documentElement.dataset.theme).toBe("light");
    expect(localStorage.getItem("tc-theme")).toBeNull();
    expect(readPref()).toBe("auto");
  });

  it("still applies the choice when storage throws", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("blocked"); });
    expect(() => setPref("light")).not.toThrow();
    expect(document.documentElement.dataset.theme).toBe("light");
  });
});
