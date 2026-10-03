import {
  FlashcardParser,
  generateFlashcardId,
  generateReverseFlashcardId,
  type AiMatchService,
  type OverlapCandidate,
} from "@decks/core";
import { AiMatchController } from "@/services/AiMatchController";
import { DEFAULT_SETTINGS, type DecksSettings } from "@/settings";
import type { AiKeyStore } from "@/services/AiKeyStore";
import type { IDatabaseService } from "@/database/DatabaseFactory";
import type { Deck, Flashcard } from "@/database/types";

// Minimal key store double; the real one needs a vault adapter.
const keyStore = { get: async () => "k" } as unknown as AiKeyStore;

const NOTE = [
  "## Mitochondria function\n\nproduce cellular energy ATP\n",
  "## Ribosome function\n\nbuild cellular proteins\n",
  "## Chloroplast function\n\ncapture light energy\n",
].join("\n");

// A reverse note's rows: each card, then its reverse with front and back swapped.
function reverseNoteRows(): Flashcard[] {
  const parsed = FlashcardParser.parseFlashcardsFromContent(NOTE, 2, "Note", true, false);
  const row = (id: string, front: string, back: string) =>
    ({ id, deckId: "deck_1", front, back, type: "header-paragraph" }) as Flashcard;
  return [
    ...parsed.map((c) => row(generateFlashcardId(c.front), c.front, c.back)),
    ...parsed.map((c) => row(generateReverseFlashcardId(c.front), c.back, c.front)),
  ];
}

function controller(): {
  match: AiMatchController;
  candidates: () => OverlapCandidate[];
} {
  let seen: OverlapCandidate[] = [];
  const service: Pick<AiMatchService, "mapConcepts" | "findDuplicates"> = {
    mapConcepts: async () => new Map(),
    // Judges every candidate a duplicate, so whatever is offered comes back.
    findDuplicates: async (_config, candidates) => {
      seen = [...candidates];
      const out = new Map<string, string[]>();
      for (const c of candidates) out.set(c.stagedId, [...(out.get(c.stagedId) ?? []), c.existingId]);
      return out;
    },
  };
  const db: Pick<IDatabaseService, "getDeckByFilepath" | "getFlashcardsByDeck"> = {
    getDeckByFilepath: async () => ({ id: "deck_1" }) as Deck,
    getFlashcardsByDeck: async () => reverseNoteRows(),
  };
  const settings: DecksSettings = {
    ...DEFAULT_SETTINGS,
    ai: { ...DEFAULT_SETTINGS.ai, enabled: true, provider: "decks-pro" },
  };
  return { match: new AiMatchController(service, settings, keyStore, db), candidates: () => seen };
}

describe("AiMatchController.similar on a reverse note", () => {
  it("compares a staged card with the note's cards, not their reverse twins", async () => {
    const { match, candidates } = controller();
    const found = await match.similar("Bio.md", [
      { id: "row1", front: "Mitochondria function?", back: "produce cellular energy" },
    ]);

    expect(candidates().some((c) => c.existingId.startsWith("rcard_"))).toBe(false);
    // The twin no longer takes a slot, so a third distinct card is checked.
    expect(candidates().map((c) => c.existingId)).toContain(generateFlashcardId("Chloroplast function"));
    expect(found.get("row1")).not.toContain("produce cellular energy ATP");
    expect(found.get("row1")).toContain("Mitochondria function");
  });

  it("still finds a staged card written the other way round", async () => {
    const { match } = controller();
    const found = await match.similar("Bio.md", [
      { id: "row1", front: "produce cellular energy ATP", back: "Mitochondria function" },
    ]);
    expect(found.get("row1")).toContain("Mitochondria function");
  });
});
