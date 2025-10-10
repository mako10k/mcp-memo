#!/usr/bin/env node
import { build } from "tsup";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = resolve(__dirname, "..");

async function ensureBuild() {
  await build({
    entry: [resolve(projectRoot, "src/index.ts")],
    format: "esm",
    dts: true,
    target: "node18",
    outDir: resolve(projectRoot, "dist"),
    silent: true,
    clean: false,
    splitting: false,
    sourcemap: true
  });
}

async function startServer() {
  await ensureBuild();

  const child = spawn(process.execPath, ["--enable-source-maps", "dist/index.js"], {
    cwd: projectRoot,
    stdio: "inherit"
  });

  child.on("exit", (code, signal) => {
    if (signal) {
      process.kill(process.pid, signal);
      return;
    }
    process.exit(code ?? 0);
  });
}

startServer().catch((error) => {
  console.error("memory-mcp failed to start:", error);
  process.exitCode = 1;
});
