import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const target = process.argv[2];
const entry =
  target === "smoke"
    ? "smoke.ts"
    : target === "spec-check"
      ? "specCheck.ts"
      : target === "compare"
        ? "compareOptimizers.ts"
        : "cli.ts";
const outName =
  target === "smoke"
    ? "smoke.cjs"
    : target === "spec-check"
      ? "specCheck.cjs"
      : target === "compare"
        ? "compareOptimizers.cjs"
        : "cli.cjs";
const out = resolve(here, `.bundle/${outName}`);

await build({
  entryPoints: [resolve(here, entry)],
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node20",
  outfile: out,
  sourcemap: "inline",
  logLevel: "warning",
  // fsrs-rs-nodejs is a native binding; keep external (resolved at runtime by node).
  external: ["fsrs-rs-nodejs"],
});
