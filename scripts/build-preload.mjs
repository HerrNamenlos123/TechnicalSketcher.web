#!/usr/bin/env node
// Builds electron/preload.ts to dist-electron/preload.cjs as plain CommonJS. Kept separate from
// vite.config.ts's electron plugin - see the comment there for why.

import * as esbuild from "esbuild";

await esbuild.build({
  entryPoints: ["electron/preload.ts"],
  outfile: "dist-electron/preload.cjs",
  bundle: true,
  platform: "node",
  format: "cjs",
  external: ["electron"],
  target: "node18",
});
