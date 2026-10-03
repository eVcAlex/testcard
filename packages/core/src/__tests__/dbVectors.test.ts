import { describe, expect, it } from "vitest";
import { buildDbVectors } from "../../scripts/make-db-vectors.js";

// The database vectors of the native app (see scripts/make-db-vectors.ts). Needs better-sqlite3, so under Electron as Node
// on a machine whose binary is built for Electron. `pnpm --filter @testcard/core vectors:db` rewrites them.
describe("database vectors for the native app", async () => {
  const vectors = await buildDbVectors();
  for (const [file, value] of Object.entries(vectors)) {
    it(`${file}.json matches the TypeScript output`, async () => {
      await expect(`${JSON.stringify(value, null, 1)}\n`).toMatchFileSnapshot(`../../test-vectors/${file}.json`);
    });
  }
});
