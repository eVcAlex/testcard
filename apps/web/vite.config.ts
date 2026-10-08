/// <reference types="vitest/config" />
import preact from "@preact/preset-vite";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { defineConfig } from "vite";

// In dev, API paths go to `wrangler dev` (apps/sync-worker, port 8787).
const api = { target: "http://localhost:8787", changeOrigin: true };

// The site runs on Preact through its React compatibility layer (about 40 kB gzipped smaller than React DOM). The preset
// aliases react / react-dom in the browser build; the same aliases are spelled out here so the SSR prerender and the
// tests resolve them too, which needs the packages that import "react" to be bundled/inlined rather than externalised.
const compat = {
  react: "preact/compat",
  "react-dom/test-utils": "preact/test-utils",
  "react-dom/client": "preact/compat/client",
  "react-dom/server": "preact/compat/server",
  "react-dom": "preact/compat",
  "react/jsx-runtime": "preact/jsx-runtime",
  "react/jsx-dev-runtime": "preact/jsx-dev-runtime",
};
const reactConsumers = [/@testcard\//, /@tanstack\//, /@testing-library\//];

// @testing-library/react CommonJS entry requires react-dom itself, which no alias can reach. Its ES module build
// imports react-dom through the aliases above, so tests drive the same Preact the site ships.
const rtlEsm = join(dirname(createRequire(import.meta.url).resolve("@testing-library/react/package.json")), "dist/@testing-library/react.esm.js");

export default defineConfig({
  plugins: [preact()],
  resolve: { alias: compat },
  ssr: { noExternal: reactConsumers },
  server: { proxy: { "/link/session": api, "/link/approve": api, "/auth": api, "/app": api, "/waitlist": api } },
  test: { alias: { "@testing-library/react": rtlEsm }, environment: "jsdom", globals: true, setupFiles: ["./src/test-setup.ts"], server: { deps: { inline: reactConsumers } } },
});
