// Every option the host builds must have a prop to land in. Both mount paths
// once hand-listed props, and four of them were never forwarded — the component
// gives every prop a default, so nothing failed loudly.

import { readFileSync } from "node:fs";
import * as path from "node:path";

const root = path.join(__dirname, "..", "components");
const types = readFileSync(path.join(root, "ai-generator-types.ts"), "utf8");
const modal = readFileSync(path.join(root, "AiGeneratorModal.svelte"), "utf8");
const view = readFileSync(path.join(root, "AiGeneratorView.ts"), "utf8");

function optionKeys(): string[] {
  const start = types.indexOf("export interface AiGeneratorOptions {");
  expect(start).toBeGreaterThan(-1);
  const body = types.slice(start, types.indexOf("\n}", start));
  const keys = new Set<string>();
  for (const line of body.split("\n").slice(1)) {
    // Top-level members only: nested object literals are indented further.
    const m = /^ {2}(\w+)\??:/.exec(line);
    if (m) keys.add(m[1]);
  }
  return [...keys];
}

describe("AiGeneratorOptions reaches the component", () => {
  it("finds the options and the props", () => {
    expect(optionKeys().length).toBeGreaterThan(10);
  });

  it("declares a prop for every option", () => {
    const props = new Set(
      [...modal.matchAll(/^\s*export let (\w+)/gm)].map((m) => m[1]),
    );
    const missing = optionKeys().filter((k) => !props.has(k));
    expect(missing).toEqual([]);
  });

  it("spreads the options rather than listing them", () => {
    // A hand-maintained list is what went wrong before; the spread cannot.
    expect(view).toContain("...this.options");
  });
});
