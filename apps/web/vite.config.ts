/// <reference types="vitest/config" />
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// In dev, API paths go to `wrangler dev` (apps/sync-worker, port 8787).
const api = { target: "http://localhost:8787", changeOrigin: true };

export default defineConfig({
  plugins: [react()],
  server: { proxy: { "/link/session": api, "/link/approve": api, "/auth": api, "/app": api } },
  test: { environment: "jsdom", globals: true, setupFiles: ["./src/test-setup.ts"] },
});
