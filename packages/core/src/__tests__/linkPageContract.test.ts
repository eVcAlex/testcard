import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { LINK_ALPHABET, LINK_ITERATIONS, LINK_LOOKUP_SALT } from "../sync/linkCrypto.js";

/** The sign-in page repeats the crypto in plain browser JavaScript. Its constants must be the ones the TV uses. */
describe("the link page matches the TV's crypto", () => {
  const page = fs.readFileSync(path.resolve(__dirname, "../../../../apps/sync-worker/src/pages/linkPage.ts"), "utf8");
  const constant = (name: string) => new RegExp(`export const ${name} = (.+);`).exec(page)?.[1];

  it("uses the same alphabet, salt and iteration count", () => {
    expect(constant("LINK_ALPHABET")).toBe(JSON.stringify(LINK_ALPHABET));
    expect(constant("LINK_LOOKUP_SALT")).toBe(JSON.stringify(LINK_LOOKUP_SALT));
    expect(constant("LINK_ITERATIONS")?.replace(/_/g, "")).toBe(String(LINK_ITERATIONS));
  });
});
