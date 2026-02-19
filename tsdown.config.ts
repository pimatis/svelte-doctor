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
]);
