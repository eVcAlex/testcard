import { defineConfig } from "vitest/config";

// Dev-time evaluations against external services. Kept out of vitest.config.ts so `pnpm test` stays
// offline, fast and deterministic.
export default defineConfig({
  test: {
    environment: "node",
    include: ["evals/**/*.eval.ts"],
  },
});
