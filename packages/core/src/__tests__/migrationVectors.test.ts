import { describe, expect, it } from "vitest";
import { buildMigrationVectors, SEED } from "../../scripts/make-migration-vectors.js";

// The migration vectors of the native app (see scripts/make-migration-vectors.ts). Needs better-sqlite3, so under Electron as Node.
describe("migration vectors for the native app", () => {
  for (const [file, value] of Object.entries(buildMigrationVectors())) {
    it(`${file}.json matches the TypeScript output`, async () => {
      await expect(`${JSON.stringify({ seed: SEED, cases: value }, null, 1)}\n`).toMatchFileSnapshot(`../../test-vectors/${file}.json`);
    });
  }
});
