import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import electron from "vite-plugin-electron";

// Set by the "electron:dev"/"electron:build" scripts only - the plain "dev"/"build" scripts used
// by the GitHub Pages pipeline are completely unaffected by this branch.
const isElectron = process.env.BUILD_TARGET === "electron";

// electron/main.ts runs as ESM (package.json has "type": "module", so plain ".js" output would
// otherwise be ambiguous to Node).
//
// electron/preload.ts is deliberately NOT built here. Electron loads preload scripts
// synchronously via require() before the page's first script runs (a dynamic import() can't
// satisfy that), so it must stay CommonJS regardless of this project's "type": "module" - but
// vite-plugin-electron's lib-mode format selection is driven entirely by that same "type" field
// and overrides any per-entry format override into ES anyway. Rather than fight that, the preload
// script is built separately by scripts/build-preload.mjs (plain esbuild, no ambiguity) - see the
// "electron:dev"/"electron:build" scripts in package.json.
const mainEntryConfig = {
  vite: {
    build: {
      outDir: "dist-electron",
      rollupOptions: {
        output: {
          format: "es" as const,
          entryFileNames: "[name].mjs",
        },
      },
    },
  },
};

export default defineConfig(async () => ({
  plugins: [
    vue(),
    ...(isElectron ? [electron([{ entry: "electron/main.ts", ...mainEntryConfig }])] : []),
  ],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  // The web build is served from /TechnicalSketcher.web/ on GitHub Pages; the Electron build is
  // loaded from disk via file://, which needs relative asset paths.
  base: isElectron ? "./" : "/TechnicalSketcher.web/",
}));
