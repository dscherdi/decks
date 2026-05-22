import { Vault, MetadataCache, TFile } from "../__mocks__/obsidian";
import { DeckManager } from "../services/DeckManager";
import type { IDatabaseService } from "../database/DatabaseFactory";
import type { DecksSettings } from "../settings";

// Minimal stub for the database — scanVaultForDecks doesn't hit it, but the
// constructor accepts the type so we cast a small object.
const dbStub = {} as IDatabaseService;

function makeSettings(
  canvasFolder: string,
  canvasTag = "#decks/canvas",
): DecksSettings {
  return {
    parsing: { folderSearchPath: "", deckTag: "#decks" },
    canvasDecks: { folderPath: canvasFolder, tagName: canvasTag },
    // The fields below are unused by scanVaultForDecks but required by the type.
    review: {} as never,
    ui: {} as never,
    backup: {} as never,
    debug: {} as never,
    paths: {} as never,
    fsrs: {} as never,
    i18n: {} as never,
    hasCreatedTestDeck: false,
  } as unknown as DecksSettings;
}

describe("DeckManager.scanVaultForDecks (canvas)", () => {
  let vault: Vault;
  let metadata: MetadataCache;

  beforeEach(() => {
    vault = new Vault();
    metadata = new MetadataCache();
  });

  it("emits one entry per .canvas file in the configured folder", () => {
    vault._addFile("Canvases/Anatomy.canvas", "{\"nodes\":[]}");
    vault._addFile("Canvases/Vocab.canvas", "{\"nodes\":[]}");
    const settings = makeSettings("Canvases", "#decks/canvas");
    const mgr = new DeckManager(
      vault as never,
      metadata as never,
      dbStub,
      { settings },
    );

    const result = mgr.scanVaultForDecks();
    const tagged = result.get("#decks/canvas");
    expect(tagged).toBeDefined();
    expect(tagged!.map((f) => f.path).sort()).toEqual([
      "Canvases/Anatomy.canvas",
      "Canvases/Vocab.canvas",
    ]);
  });

  it("ignores .canvas files outside the configured folder", () => {
    vault._addFile("Canvases/A.canvas", "{}");
    vault._addFile("Other/B.canvas", "{}");
    const settings = makeSettings("Canvases", "#decks/canvas");
    const mgr = new DeckManager(
      vault as never,
      metadata as never,
      dbStub,
      { settings },
    );

    const result = mgr.scanVaultForDecks();
    const tagged = result.get("#decks/canvas");
    expect(tagged?.map((f) => f.path)).toEqual(["Canvases/A.canvas"]);
  });

  it("disables canvas scanning entirely when folderPath is empty", () => {
    vault._addFile("Canvases/A.canvas", "{}");
    const settings = makeSettings("", "#decks/canvas");
    const mgr = new DeckManager(
      vault as never,
      metadata as never,
      dbStub,
      { settings },
    );

    const result = mgr.scanVaultForDecks();
    expect(result.size).toBe(0);
  });

  it("uses the configured canvas tag", () => {
    vault._addFile("Canvases/A.canvas", "{}");
    const settings = makeSettings("Canvases", "#cards/visual");
    const mgr = new DeckManager(
      vault as never,
      metadata as never,
      dbStub,
      { settings },
    );

    const result = mgr.scanVaultForDecks();
    expect(Array.from(result.keys())).toEqual(["#cards/visual"]);
  });

  it("scans markdown and canvas files in the same pass", () => {
    vault._addFile("notes/q1.md", "## Q\nA");
    metadata._setCache("notes/q1.md", {
      tags: [{ tag: "#decks/math" }],
    } as never);
    vault._addFile("Canvases/Visual.canvas", "{\"nodes\":[]}");
    // Stamp the markdown deck tag via metadata; canvas auto-tagged via setting.
    const settings = makeSettings("Canvases", "#decks/canvas");
    const mgr = new DeckManager(
      vault as never,
      metadata as never,
      dbStub,
      { settings },
    );

    const result = mgr.scanVaultForDecks();
    expect(result.get("#decks/math")?.map((f) => f.path)).toEqual([
      "notes/q1.md",
    ]);
    expect(result.get("#decks/canvas")?.map((f) => f.path)).toEqual([
      "Canvases/Visual.canvas",
    ]);
  });

  it("getMarkdownFiles excludes canvas files from the markdown scan", () => {
    vault._addFile("notes/q1.md", "");
    vault._addFile("notes/q2.canvas", "{}");
    // Sanity check the mock behavior, since the production scan relies on it.
    expect(vault.getMarkdownFiles().map((f) => f.path)).toEqual([
      "notes/q1.md",
    ]);
    expect(
      vault
        .getFiles()
        .map((f: TFile) => f.path)
        .sort(),
    ).toEqual(["notes/q1.md", "notes/q2.canvas"]);
  });
});
