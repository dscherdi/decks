import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const target = process.argv[2];
const entry =
  target === "smoke" ? "smoke.ts" : target === "spec-check" ? "specCheck.ts" : "cli.ts";
const out = resolve(
  here,
  `.bundle/${target === "smoke" ? "smoke.cjs" : target === "spec-check" ? "specCheck.cjs" : "cli.cjs"}`
);

await build({
  entryPoints: [resolve(here, entry)],
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node20",
  outfile: out,
  sourcemap: "inline",
  logLevel: "warning",
  external: [],
});
