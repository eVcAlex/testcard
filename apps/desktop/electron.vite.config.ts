import { resolve } from "node:path";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  main: {
    // @testcard/core is a workspace package whose package.json points "main" straight at
    // TS source (bundler-resolved relative imports like "../source/types.js" -> types.ts).
    // Left externalized, Node's own loader would try to import that source directly at
    // runtime and fail to resolve those specifiers (Node's native .ts support doesn't do
    // bundler-style .js -> .ts extension mapping) — exactly the ERR_MODULE_NOT_FOUND this
    // caused. Excluding it here makes Vite bundle it from source instead, the same way it
    // already does for the renderer. `sax` is core's only non-native runtime dependency and
    // isn't declared in this app's own package.json, so it's excluded too rather than left
    // for Node to resolve from a package.json that doesn't list it.
    plugins: [externalizeDepsPlugin({ exclude: ["@testcard/core", "sax"] })],
    build: {
      rollupOptions: {
        input: { index: resolve(__dirname, "src/main/index.ts") },
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: { index: resolve(__dirname, "src/preload/index.ts") },
      },
    },
  },
  renderer: {
    root: resolve(__dirname, "src/renderer"),
    build: {
      rollupOptions: {
        // Two entries: the main window and the transparent on-video overlay window (ADR 0002).
        // Rollup dedupes React + the shared token/font chunk across them.
        input: {
          index: resolve(__dirname, "src/renderer/index.html"),
          overlay: resolve(__dirname, "src/renderer/overlay.html"),
        },
      },
    },
    plugins: [react()],
  },
});
