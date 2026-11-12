import { DeckManager } from "../services/DeckManager";
import { DEFAULT_PROFILE_ID } from "../database/types";
import type { IDatabaseService } from "../database/DatabaseFactory";
import { TFile, type MetadataCache, type Vault } from "obsidian";

interface DeckRow {
  id: string;
  name: string;
  filepath: string;
  tag: string;
  profileId: string;
}

const NOTE = "Notes/Verbs.md";
const EXAMS_PROFILE = "profile_exams";

// One note carrying the given tags, over a database that keeps what the sync writes.
function setup(noteTags: string[], deck?: Pick<DeckRow, "tag" | "profileId">) {
  const file = new TFile(NOTE);
  const vault = {
    getMarkdownFiles: () => [file],
    getFiles: () => [] as TFile[],
    getAbstractFileByPath: (path: string) => (path === NOTE ? file : null),
    adapter: { exists: async () => true },
  } as unknown as Vault;
  const metadataCache = {
    getFileCache: () => ({ tags: noteTags.map((tag) => ({ tag })) }),
  } as unknown as MetadataCache;

  // The exam tag is the only one a profile is mapped to.
  const profileFor = (tags: string[]) => (tags.includes("#decks/exams") ? EXAMS_PROFILE : null);
  const rows = new Map<string, DeckRow>();
  if (deck) rows.set("deck_verbs", { id: "deck_verbs", name: "Verbs", filepath: NOTE, ...deck });
  const createDeck = jest.fn(async (created: Omit<DeckRow, "profileId">) => {
    rows.set(created.id, { ...created, profileId: profileFor([created.tag]) ?? DEFAULT_PROFILE_ID });
    return created.id;
  });
  const updateDeck = jest.fn(async (id: string, updates: Partial<DeckRow>) => {
    const row = rows.get(id);
    if (row) rows.set(id, { ...row, ...updates });
  });
  const db = {
    getAllDecks: async () => [...rows.values()].map((row) => ({ ...row })),
    getProfileIdForTags: async (tags: string[]) => profileFor(tags),
    createDeck,
    updateDeck,
    setDeckFileTags: jest.fn(async () => {}),
    deleteDeckByFilepath: jest.fn(async () => {}),
  } as unknown as IDatabaseService;

  const manager = new DeckManager(vault, metadataCache, db);
  const row = () => [...rows.values()].find((r) => r.filepath === NOTE);
  // Runs the sync and reports the tag and profile the note's deck has afterwards.
  const syncAndRead = async () => {
    await manager.syncDecks();
    const current = row();
    return current ? `${current.tag} ${current.profileId}` : "no deck";
  };
  return { manager, file, createDeck, updateDeck, syncAndRead };
}

describe("a note with two deck tags", () => {
  // Same depth, so the alphabetically first one is the deck's tag: the exam tag.
  const settled = `#decks/exams ${EXAMS_PROFILE}`;

  it("keeps its deck's tag and profile from one sync to the next", async () => {
    const { syncAndRead, updateDeck } = setup(["#decks/french", "#decks/exams"], {
      tag: "#decks/exams",
      profileId: EXAMS_PROFILE,
    });

    const seen = [await syncAndRead(), await syncAndRead(), await syncAndRead()];

    expect(seen).toEqual([settled, settled, settled]);
    expect(updateDeck).not.toHaveBeenCalled();
  });

  it("settles a deck that carries the other tag", async () => {
    const { syncAndRead } = setup(["#decks/french", "#decks/exams"], {
      tag: "#decks/french",
      profileId: DEFAULT_PROFILE_ID,
    });

    const seen = [await syncAndRead(), await syncAndRead(), await syncAndRead()];

    expect(seen).toEqual([settled, settled, settled]);
  });

  it("gets one deck when it is new", async () => {
    const { syncAndRead, createDeck } = setup(["#decks/french", "#decks/exams"]);

    expect(await syncAndRead()).toBe(settled);
    expect(createDeck).toHaveBeenCalledTimes(1);
  });

  it("is listed once by the vault scan", () => {
    const { manager, file } = setup(["#other", "#decks/french", "#decks/exams"]);

    expect([...manager.scanVaultForDecks()]).toEqual([["#decks/exams", [file]]]);
  });

  it("is filed under the more specific tag when it also has the plain one", async () => {
    const { syncAndRead } = setup(["#decks", "#decks/spanish"], {
      tag: "#decks",
      profileId: DEFAULT_PROFILE_ID,
    });

    const filed = `#decks/spanish ${DEFAULT_PROFILE_ID}`;
    expect([await syncAndRead(), await syncAndRead()]).toEqual([filed, filed]);
  });
});

describe("a note whose only tag shares the deck tag's prefix", () => {
  it("is still listed, under that tag", () => {
    const { manager, file } = setup(["#decks-archive"]);

    expect([...manager.scanVaultForDecks()]).toEqual([["#decks-archive", [file]]]);
  });
});
