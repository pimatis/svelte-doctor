import { defineConfig } from "tsdown";

export default defineConfig([
  {
    entry: ["src/cli.ts"],
    format: "esm",
    dts: false,
    clean: true,
    splitting: false,
    sourcemap: false,
    banner: {
      js: "#!/usr/bin/env node",
    },
  },
  {
    entry: ["src/index.ts"],
    format: "esm",
    dts: true,
    clean: false,
    splitting: false,
    sourcemap: false,
  },
  {
    entry: ["src/core/scan-worker.ts"],
    format: "esm",
    dts: false,
    clean: false,
    splitting: false,
    sourcemap: false,
  },
]);
