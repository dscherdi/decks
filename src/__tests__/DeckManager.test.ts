import { generateFlashcardId } from "@decks/core";
import { DeckManager } from "../services/DeckManager";
import type { IDatabaseService } from "../database/DatabaseFactory";
import { TFile, type MetadataCache, type Vault } from "obsidian";

describe("DeckManager", () => {
  describe("syncDecks orphan cleanup", () => {
    it("does not delete decks whose files exist when the metadata cache is cold", async () => {
      // Files exist in the vault registry, but the metadata cache is cold
      // (getFileCache returns null) — as at Obsidian startup. The old code
      // treated these as orphaned and deleted them (and their cards).
      const existing = new Map<string, TFile>([
        ["a.md", new TFile("a.md")],
        ["b.md", new TFile("b.md")],
      ]);
      const vault = {
        getMarkdownFiles: () => [...existing.values()],
        getFiles: () => [] as TFile[],
        getAbstractFileByPath: (p: string) => existing.get(p) ?? null,
      } as unknown as Vault;
      const metadataCache = {
        getFileCache: () => null, // cold cache
      } as unknown as MetadataCache;

      const deleteDeckByFilepath = jest.fn(async () => {});
      const db = {
        getAllDecks: jest.fn(async () => [
          { id: "d_a", name: "A", filepath: "a.md" },
          { id: "d_b", name: "B", filepath: "b.md" },
          { id: "d_gone", name: "Gone", filepath: "gone.md" }, // file truly deleted
        ]),
        deleteDeckByFilepath,
      } as unknown as IDatabaseService;

      const mgr = new DeckManager(vault, metadataCache, db);
      await mgr.syncDecks();

      // Only the deck whose file is actually gone should be deleted.
      expect(deleteDeckByFilepath).toHaveBeenCalledTimes(1);
      expect(deleteDeckByFilepath).toHaveBeenCalledWith("gone.md");
      expect(deleteDeckByFilepath).not.toHaveBeenCalledWith("a.md");
      expect(deleteDeckByFilepath).not.toHaveBeenCalledWith("b.md");
    });
  });

  describe("getStaleDeckIds", () => {
    function makeManager(
      meta: { id: string; filepath: string; lastSyncedMtime: number }[],
      fileMtimes: Record<string, number | undefined>
    ): DeckManager {
      const db = {
        getAllDeckSyncMeta: jest.fn(async () => meta),
      } as unknown as IDatabaseService;
      const vault = {
        getAbstractFileByPath: (path: string) => {
          const mtime = fileMtimes[path];
          if (mtime === undefined) return null;
          const f = new TFile(path);
          f.stat = { mtime, ctime: mtime, size: 0 };
          return f;
        },
      } as unknown as Vault;
      const metadataCache = {} as unknown as MetadataCache;
      return new DeckManager(vault, metadataCache, db);
    }

    it("returns decks whose file mtime exceeds last_synced_mtime", async () => {
      const mgr = makeManager(
        [
          { id: "fresh", filepath: "fresh.md", lastSyncedMtime: 1000 },
          { id: "changed", filepath: "changed.md", lastSyncedMtime: 1000 },
        ],
        { "fresh.md": 1000, "changed.md": 2000 }
      );
      const stale = await mgr.getStaleDeckIds();
      expect(stale.has("changed")).toBe(true);
      expect(stale.has("fresh")).toBe(false);
    });

    it("treats never-synced (mtime 0) decks as stale", async () => {
      const mgr = makeManager(
        [{ id: "new", filepath: "new.md", lastSyncedMtime: 0 }],
        { "new.md": 1234 }
      );
      const stale = await mgr.getStaleDeckIds();
      expect(stale.has("new")).toBe(true);
    });

    it("treats decks with a missing file as stale (so a re-scan reconciles)", async () => {
      const mgr = makeManager(
        [{ id: "gone", filepath: "gone.md", lastSyncedMtime: 1000 }],
        {}
      );
      const stale = await mgr.getStaleDeckIds();
      expect(stale.has("gone")).toBe(true);
    });
  });

  describe("getDeckStats", () => {
    it("counts mature cards via countMatureCards, not by fetching all cards", async () => {
      const db = {
        countTotalCards: jest.fn(async () => 100),
        countNewCards: jest.fn(async () => 5),
        countDueCards: jest.fn(async () => 9),
        countMatureCards: jest.fn(async () => 42),
        getFlashcardsByDeck: jest.fn(async () => []),
        getDeckWithProfile: jest.fn(async () => null),
        getDailyReviewCounts: jest.fn(async () => ({ newCount: 0, reviewCount: 0 })),
      } as unknown as IDatabaseService;
      const mgr = new DeckManager(
        {} as unknown as Vault,
        {} as unknown as MetadataCache,
        db
      );

      const stats = await mgr.getDeckStats("deck_1", false);

      expect(stats.matureCount).toBe(42);
      expect(stats.totalCount).toBe(100);
      expect(db.countMatureCards).toHaveBeenCalledWith("deck_1");
      // The expensive all-cards fetch must NOT be used for stats.
      expect(db.getFlashcardsByDeck).not.toHaveBeenCalled();
    });

    it("clamps new + due counts by the remaining global daily cap", async () => {
      const db = {
        countTotalCards: jest.fn(async () => 100),
        countNewCards: jest.fn(async () => 5),
        countDueCards: jest.fn(async () => 9),
        countMatureCards: jest.fn(async () => 0),
        getFlashcardsByDeck: jest.fn(async () => []),
        getDeckWithProfile: jest.fn(async () => null),
        getDailyReviewCounts: jest.fn(async () => ({ newCount: 0, reviewCount: 0 })),
      } as unknown as IDatabaseService;
      const mgr = new DeckManager(
        {} as unknown as Vault,
        {} as unknown as MetadataCache,
        db
      );

      // No cap → raw counts (9 due, 5 new).
      const uncapped = await mgr.getDeckStats("d", true, Infinity);
      expect(uncapped.dueCount).toBe(9);
      expect(uncapped.newCount).toBe(5);

      // Budget 2: reviews take it first (2 due), new gets the leftover (0).
      const two = await mgr.getDeckStats("d", true, 2);
      expect(two.dueCount).toBe(2);
      expect(two.newCount).toBe(0);

      // Budget 12: all 9 due + 3 new (leftover 3).
      const twelve = await mgr.getDeckStats("d", true, 12);
      expect(twelve.dueCount).toBe(9);
      expect(twelve.newCount).toBe(3);

      // Cap exhausted → nothing shown.
      const zero = await mgr.getDeckStats("d", true, 0);
      expect(zero.dueCount).toBe(0);
      expect(zero.newCount).toBe(0);
    });
  });

  describe("flashcard ID generation", () => {
    it("should generate consistent IDs for the same content", () => {
      const id1 = generateFlashcardId("What is 2+2?");
      const id2 = generateFlashcardId("What is 2+2?");

      expect(id1).toBe(id2);
      expect(id1).toMatch(/^card_[a-z0-9]+$/);
    });

    it("should generate different IDs for different content", () => {
      const id1 = generateFlashcardId("Question 1");
      const id2 = generateFlashcardId("Question 2");

      expect(id1).not.toBe(id2);
    });

    it("should generate the same ID for the same content regardless of deck", () => {
      // IDs are deck-independent: a card keeps its identity (and review history)
      // when it moves between decks or its deck file is renamed.
      const question = "What is 2+2?";
      expect(generateFlashcardId(question)).toBe(generateFlashcardId(question));
    });
  });
});
