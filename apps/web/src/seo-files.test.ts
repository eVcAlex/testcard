import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const pub = (f: string) => readFileSync(resolve(__dirname, "../public", f), "utf8");

it("sitemap lists /privacy and not /terms; robots points at the sitemap", () => {
  const map = pub("sitemap.xml");
  expect(map).toContain("https://evicted.dev/privacy");
  expect(map).not.toContain("/terms");
  expect(pub("robots.txt")).toContain("Sitemap: https://evicted.dev/sitemap.xml");
});
