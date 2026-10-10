import { nextPref, paintThemeColour, readPref, setPref } from "./theme.ts";

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

  it("keeps the theme-color metas in step with the chosen theme and restores the media variants on auto", () => {
    document.head.insertAdjacentHTML("beforeend", '<meta name="theme-color" content="#efe8d6" media="(prefers-color-scheme: light)"><meta name="theme-color" content="#11100d" media="(prefers-color-scheme: dark)">');
    const metas = () => [...document.querySelectorAll('meta[name="theme-color"]')].map((m) => m.getAttribute("content"));
    media(false);
    setPref("light");
    expect(metas()).toEqual(["#efe8d6", "#efe8d6"]);
    setPref("dark");
    expect(metas()).toEqual(["#11100d", "#11100d"]);
    paintThemeColour(document, "auto");
    expect(metas()).toEqual(["#efe8d6", "#11100d"]);
    document.head.querySelectorAll('meta[name="theme-color"]').forEach((m) => m.remove());
  });
});
