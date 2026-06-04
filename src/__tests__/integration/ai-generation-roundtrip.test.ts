jest.unmock("sql.js");
jest.mock("obsidian", () => jest.requireActual("../../__mocks__/obsidian"));

import { Vault } from "obsidian";
import {
  AiGenerationService,
  FlashcardParser,
  generateDeckId,
  type GeneratedCard,
  type HttpClient,
} from "@decks/core";
import { MainDatabaseService } from "../../database/MainDatabaseService";
import { FlashcardComposer } from "../../services/FlashcardComposer";
import { CanvasFlashcardExtractor } from "@decks/core";
import { setupTestDatabase, teardownTestDatabase } from "./database-test-utils";
import type { Deck, DeckProfile } from "../../database/types";

// A streaming transport that emits the whole generation payload as one
// OpenAI-style SSE delta — exercises the real AiGenerationService parse path.
function streamHttp(payload: string): HttpClient {
  const sse =
    `data: ${JSON.stringify({ choices: [{ delta: { content: payload } }] })}\n\n` +
    "data: [DONE]\n\n";
  return {
    request: async () => {
      throw new Error("request() should not be called");
    },
    stream: async (_req, onChunk) => {
      onChunk(sse);
    },
  };
}

async function generate(payload: string): Promise<GeneratedCard[]> {
  const service = new AiGenerationService(streamHttp(payload));
  const result = await service.generateStream(
    { provider: "openai", model: "gpt-4o-mini", apiKey: "k" },
    { prompt: "generate some cards" },
    { onCard: () => undefined },
  );
  return result.cards;
}

// A realistic streamed generation with one card carrying notes and one without.
const PAYLOAD = [
  "FRONT: What is photosynthesis?",
  "BACK: Conversion of light into chemical energy.",
  "NOTES: Occurs in chloroplasts.",
  "===END===",
  "FRONT: What is mitosis?",
  "BACK: Cell division producing two identical cells.",
  "NOTES:",
  "===END===",
  "",
].join("\n");

describe("AI generation → save → reparse → sync (integration)", () => {
  let db: MainDatabaseService;

  beforeEach(async () => {
    db = await setupTestDatabase();
  });
  afterEach(async () => {
    await teardownTestDatabase();
  });

  function appFor(vault: Vault): never {
    return { vault } as never;
  }

  async function syncAndRead(
    deckName: string,
    filePath: string,
    content: string,
    profile: DeckProfile,
  ) {
    const deck: Deck = {
      id: generateDeckId(filePath),
      name: deckName,
      filepath: filePath,
      tag: "decks",
      lastReviewed: null,
      profileId: profile.id,
      created: new Date().toISOString(),
      modified: new Date().toISOString(),
    };
    await db.createDeck(deck);
    const result = await db.syncFlashcardsForDeck({
      deckId: deck.id,
      deckName: deck.name,
      deckFilepath: deck.filepath,
      deckConfig: profile,
      fileContent: content,
    });
    expect(result.success).toBe(true);
    return db.getFlashcardsByDeck(deck.id);
  }

  it("generates cards, creates a new header-paragraph file, and notes survive reparse + sync", async () => {
    const cards = await generate(PAYLOAD);
    expect(cards).toEqual([
      {
        front: "What is photosynthesis?",
        back: "Conversion of light into chemical energy.",
        notes: "Occurs in chloroplasts.",
      },
      {
        front: "What is mitosis?",
        back: "Cell division producing two identical cells.",
        notes: "",
      },
    ]);

    const vault = new Vault();
    const composer = new FlashcardComposer(appFor(vault));
    const { filePath } = await composer.saveGenerated(cards, {
      kind: "new-file",
      format: "header-paragraph",
      folder: "Decks",
      name: "Biology",
      tag: "#decks",
      level: 2,
    });
    expect(filePath).toBe("Decks/Biology.md");
    const content = await vault.read(vault.getAbstractFileByPath(filePath)!);
    expect(content).toContain("---\n\nOccurs in chloroplasts."); // note delimiter

    // Reparse the saved file.
    const parsed = FlashcardParser.parseFlashcardsFromContent(content, 2);
    expect(parsed.map((p) => ({ front: p.front, back: p.back, notes: p.notes }))).toEqual([
      {
        front: "What is photosynthesis?",
        back: "Conversion of light into chemical energy.",
        notes: "Occurs in chloroplasts.",
      },
      {
        front: "What is mitosis?",
        back: "Cell division producing two identical cells.",
        notes: "",
      },
    ]);

    // Sync into the DB and confirm the persisted notes.
    const profile = await db.getDefaultProfile();
    const flashcards = await syncAndRead("Biology", filePath, content, profile);
    expect(flashcards).toHaveLength(2);
    const photo = flashcards.find((c) => c.front === "What is photosynthesis?");
    expect(photo?.notes).toBe("Occurs in chloroplasts.");
    expect(photo?.back).toBe("Conversion of light into chemical energy.");
  });

  it("appends generated header-paragraph cards to an existing markdown deck", async () => {
    const cards = await generate(PAYLOAD);
    const vault = new Vault();
    await vault.create(
      "Decks/Existing.md",
      "---\ntags:\n  - decks\n---\n\n## Old question?\n\nold answer\n",
    );
    const composer = new FlashcardComposer(appFor(vault));
    await composer.saveGenerated(cards, {
      kind: "append",
      format: "header-paragraph",
      filePath: "Decks/Existing.md",
      level: 2,
    });
    const content = await vault.read(vault.getAbstractFileByPath("Decks/Existing.md")!);
    const parsed = FlashcardParser.parseFlashcardsFromContent(content, 2);
    expect(parsed.map((p) => p.front)).toEqual([
      "Old question?",
      "What is photosynthesis?",
      "What is mitosis?",
    ]);
    expect(parsed.find((p) => p.front === "What is photosynthesis?")?.notes).toBe(
      "Occurs in chloroplasts.",
    );
  });

  it("creates a table file whose Notes column round-trips through sync", async () => {
    const cards = await generate(PAYLOAD);
    const vault = new Vault();
    const composer = new FlashcardComposer(appFor(vault));
    const { filePath } = await composer.saveGenerated(cards, {
      kind: "new-file",
      format: "table",
      folder: "Decks",
      name: "BioTable",
      tag: "#decks",
      level: 2,
    });
    const content = await vault.read(vault.getAbstractFileByPath(filePath)!);
    expect(content).toContain("| Front | Back | Notes |");

    const profile = await db.getDefaultProfile();
    const flashcards = await syncAndRead("BioTable", filePath, content, profile);
    const photo = flashcards.find((c) => c.front === "What is photosynthesis?");
    expect(photo?.type).toBe("table");
    expect(photo?.notes).toBe("Occurs in chloroplasts.");
  });

  it("creates a canvas file whose nodes extract back to cards with notes", async () => {
    const cards = await generate(PAYLOAD);
    const vault = new Vault();
    const composer = new FlashcardComposer(appFor(vault));
    const { filePath } = await composer.saveGenerated(cards, {
      kind: "new-file",
      format: "canvas",
      folder: "Canvas",
      name: "BioCanvas",
      tag: "#decks/canvas",
      level: 2,
    });
    expect(filePath).toBe("Canvas/BioCanvas.canvas");
    const content = await vault.read(vault.getAbstractFileByPath(filePath)!);

    const extracted = CanvasFlashcardExtractor.extract(content, 2);
    expect(extracted.map((c) => ({ front: c.front, notes: c.notes }))).toEqual([
      { front: "What is photosynthesis?", notes: "Occurs in chloroplasts." },
      { front: "What is mitosis?", notes: "" },
    ]);
  });
});
