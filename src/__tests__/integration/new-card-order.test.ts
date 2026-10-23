import { MainDatabaseService } from "../../database/MainDatabaseService";
import {
  Scheduler,
  type DeckGroup,
  type DeckProfile,
  type DecksSettings,
  type Flashcard,
  type IBackupService,
  type NewCardOrder,
} from "@decks/core";
import { DEFAULT_SETTINGS } from "../../settings";
import { DatabaseTestUtils, setupTestDatabase, teardownTestDatabase } from "./database-test-utils";

const FIRST_WAVE = "## Cell\n\nThe unit of life.\n\n## Tissue\n\nCells working together.\n";
const GROWN_NOTE =
  "## Cell\n\nThe unit of life.\n\n## Membrane\n\nWhat bounds a cell.\n\n## Tissue\n\nCells working together.\n";

// A note grown in waves: its middle card was synced last.
describe("new cards in note order", () => {
  let db: MainDatabaseService;
  let scheduler: Scheduler;
  const backup: IBackupService = { createBackup: async () => undefined };

  beforeEach(async () => {
    db = await setupTestDatabase();
    const settings: DecksSettings = structuredClone(DEFAULT_SETTINGS);
    scheduler = new Scheduler(db, settings, backup);
  });

  afterEach(async () => {
    await teardownTestDatabase();
  });

  async function profileWith(order: NewCardOrder): Promise<DeckProfile> {
    const base = await db.getDefaultProfile();
    const id = `profile_${order}`;
    await db.createProfile({ ...base, id, name: `New cards ${order}`, isDefault: false, newCardOrder: order });
    const profile = await db.getProfileById(id);
    if (!profile) throw new Error("profile not created");
    return profile;
  }

  async function addDeck(id: string, profile: DeckProfile): Promise<void> {
    await db.createDeck(DatabaseTestUtils.createTestDeck({ id, name: id, filepath: `${id}.md`, tag: "#decks", profileId: profile.id }));
  }

  async function sync(deckId: string, profile: DeckProfile, fileContent: string): Promise<void> {
    await db.syncFlashcardsForDeck({
      deckId,
      deckName: deckId,
      deckFilepath: `${deckId}.md`,
      deckConfig: profile,
      fileContent,
    });
    // The next sync's cards are first seen strictly later.
    await new Promise((resolve) => setTimeout(resolve, 5));
  }

  async function introduced(next: () => Promise<Flashcard | null>): Promise<string[]> {
    const fronts: string[] = [];
    for (let card = await next(); card && card.state === "new"; card = await next()) {
      fronts.push(card.front);
      await scheduler.rate(card, "easy");
    }
    return fronts;
  }

  async function grownDeck(order: NewCardOrder): Promise<string[]> {
    const profile = await profileWith(order);
    await addDeck("deck_bio", profile);
    await sync("deck_bio", profile, FIRST_WAVE);
    await sync("deck_bio", profile, GROWN_NOTE);
    return introduced(() => scheduler.getNext(new Date(), "deck_bio"));
  }

  it("introduces the card synced last in its place in the note", async () => {
    expect(await grownDeck("note")).toEqual(["Cell", "Membrane", "Tissue"]);
  });

  it("still introduces it last when new cards come in the order added", async () => {
    expect(await grownDeck("created")).toEqual(["Cell", "Tissue", "Membrane"]);
  });

  it("introduces every new card once in random order", async () => {
    expect((await grownDeck("random")).sort()).toEqual(["Cell", "Membrane", "Tissue"]);
  });

  it("takes a group's decks in the group's order, each in note order", async () => {
    const profile = await profileWith("note");
    await addDeck("deck_cells", profile);
    await addDeck("deck_organs", profile);
    await sync("deck_organs", profile, "## Heart\n\nPumps blood.\n");
    await sync("deck_cells", profile, FIRST_WAVE);
    await sync("deck_cells", profile, GROWN_NOTE);
    const now = new Date().toISOString();
    const group: DeckGroup = {
      type: "group",
      tag: "#decks/biology",
      name: "Biology",
      deckIds: ["deck_cells", "deck_organs"],
      profile,
      lastReviewed: null,
      created: now,
      modified: now,
    };

    expect(await introduced(() => scheduler.getNextForDeckGroup(new Date(), group))).toEqual([
      "Cell",
      "Membrane",
      "Tissue",
      "Heart",
    ]);
  });

  it("keeps the setting through a save and an edit", async () => {
    const profile = await profileWith("note");
    expect(profile.newCardOrder).toBe("note");
    await db.updateProfile(profile.id, { newCardOrder: "random" });
    expect((await db.getProfileById(profile.id))?.newCardOrder).toBe("random");
    expect((await db.getDefaultProfile()).newCardOrder).toBe("created");
  });
});
