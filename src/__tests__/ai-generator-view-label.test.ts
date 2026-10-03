jest.mock("svelte", () => ({ mount: jest.fn(() => ({})), unmount: jest.fn() }));

import { I18n } from "@decks/core";
import { WorkspaceLeaf } from "obsidian";
import { AiGeneratorView, VIEW_TYPE_AI_GENERATOR } from "../components/AiGeneratorView";
import type { AiGeneratorOptions } from "../components/ai-generator-types";

type ViewState = { type: string; state: Record<string, unknown> };

// Obsidian's globals, as far as the view touches them in a node test run.
const host = globalThis as unknown as { activeDocument: unknown; window: unknown };
host.activeDocument = { createElement: () => ({ empty() {}, addClass() {} }) };
host.window ??= globalThis;

function make() {
  const leaf = new WorkspaceLeaf();
  const build = jest.fn(() => ({}) as AiGeneratorOptions);
  const view = new AiGeneratorView(leaf as never, () => null, build);
  leaf.view = view;
  const calls: ViewState[] = [];
  leaf.setViewState = jest.fn(async (vs: ViewState) => {
    calls.push(vs);
    await view.setState(vs.state, {} as never);
  });
  return { view, build, calls };
}

async function settle(): Promise<void> {
  jest.runAllTimers();
  for (let i = 0; i < 5; i++) await Promise.resolve();
}

describe("the session tab's label", () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it("names the tab after the source once the session has one", async () => {
    const { view, build, calls } = make();
    await view.setState({ sessionId: "ais_1" }, {} as never);
    expect(view.getDisplayText()).toBe(I18n.t.modals.aiGenerator.title);
    build.mockClear();

    view.noteSource("Lectures/Stats 1.pdf");
    await settle();

    expect(calls).toEqual([
      { type: VIEW_TYPE_AI_GENERATOR, state: { sessionId: "ais_1", label: "Stats 1" } },
    ]);
    expect(view.getDisplayText()).toBe(
      I18n.format(I18n.t.modals.aiGenerator.sessionTab, { source: "Stats 1" }),
    );
    // Refreshing the header never rebuilds the session.
    expect(build).not.toHaveBeenCalled();
  });

  it("leaves the header alone when the label has not changed", async () => {
    const { view, calls } = make();
    await view.setState({ sessionId: "ais_1", label: "Stats 1" }, {} as never);
    view.noteSource("Lectures/Stats 1.pdf");
    view.noteSource("");
    await settle();
    expect(calls).toEqual([]);
  });

  it("comes back with the workspace", async () => {
    const { view } = make();
    await view.setState({ sessionId: "ais_1", label: "Stats 1" }, {} as never);
    expect(view.getState()).toEqual({ sessionId: "ais_1", label: "Stats 1" });
    expect(view.getDisplayText()).toContain("Stats 1");
  });
});
