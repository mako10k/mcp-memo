import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  dts: true,
  target: "node18",
  outDir: "dist",
  sourcemap: false,
  clean: true,
  silent: true,
  banner: {
    js: "#!/usr/bin/env node"
  }
});
