import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    cli: "src/cli.ts",
    mcp: "src/mcp.ts",
  },
  format: ["esm"],
  target: "es2022",
  platform: "node",
  dts: true,
  clean: true,
  sourcemap: true,
  splitting: false,
  shims: false,
  banner: {
    js: "#!/usr/bin/env node",
  },
});
