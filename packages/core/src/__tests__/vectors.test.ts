import { describe, expect, it } from "vitest";
import { buildVectors } from "../../scripts/make-vectors.js";
import { SCHEMA_SQL } from "../db/schema.js";

// Each file under test-vectors/ is compared with what the code produces now. A drift fails; `pnpm vectors` (vitest -u)
// rewrites them after an intended change.
describe("test vectors for the native app", async () => {
  const vectors = await buildVectors();
  for (const [file, rows] of Object.entries(vectors)) {
    it(`${file}.json matches the TypeScript output`, async () => {
      await expect(`${JSON.stringify(rows, null, 1)}\n`).toMatchFileSnapshot(`../../test-vectors/${file}.json`);
    });
  }

  // The native app opens the same schema, copied verbatim into its resources.
  it("schema.sql matches SCHEMA_SQL", async () => {
    await expect(SCHEMA_SQL).toMatchFileSnapshot("../../../../apps/tv-native/core/src/main/resources/schema.sql");
  });
});
