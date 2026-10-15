import preact from "@preact/preset-vite";
import { defineConfig } from "vite";

// In dev, the proxy and the sign-in go to `wrangler dev` (apps/sync-worker, port 8787).
const api = { target: "http://localhost:8787", changeOrigin: true };

// Built into the website's output, so the sync Worker serves it at /watch from the same origin as the API and the stream
// proxy (the session cookie then rides along on every video request). Build the website first: it empties its own dist.
export default defineConfig({
  base: "/watch/",
  plugins: [preact()],
  build: { outDir: "../web/dist/watch", emptyOutDir: true, target: "es2022" },
  server: { proxy: { "/auth": api, "/sync": api, "/watch/p": api } },
  test: { environment: "node" },
});
