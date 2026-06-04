import type { Flashcard } from "@/database/types";
import type { RefactorFieldSet } from "@decks/core";
import {
  cardToRefactorFieldSet,
  fieldSetToEdits,
} from "@/services/AiRefactorController";

function makeCard(partial: Partial<Flashcard>): Flashcard {
  return {
    id: "card_1",
    deckId: "deck_1",
    front: "",
    back: "",
    type: "header-paragraph",
    sourceFile: "test.md",
    contentHash: "hash",
    breadcrumb: "",
    notes: "",
    tags: [],
    hint: "",
    clozeText: null,
    clozeOrder: null,
    sourceNodeId: null,
    state: "new",
    dueDate: new Date().toISOString(),
    interval: 0,
    repetitions: 0,
    difficulty: 5,
    stability: 0,
    lapses: 0,
    lastReviewed: null,
    suspendedAt: null,
    buriedUntil: null,
    created: new Date().toISOString(),
    modified: new Date().toISOString(),
    ...partial,
  };
}

describe("cardToRefactorFieldSet", () => {
  it("maps header-paragraph fields", () => {
    const fs = cardToRefactorFieldSet(
      makeCard({ type: "header-paragraph", front: "Q?", back: "A" }),
    );
    expect(fs).toEqual({ type: "header-paragraph", front: "Q?", back: "A" });
  });

  it("maps table fields including notes", () => {
    const fs = cardToRefactorFieldSet(
      makeCard({ type: "table", front: "F", back: "B", notes: "N" }),
    );
    expect(fs).toEqual({ type: "table", front: "F", back: "B", notes: "N" });
  });

  it("maps cloze back to sentence", () => {
    const fs = cardToRefactorFieldSet(
      makeCard({ type: "cloze", front: "Ctx", back: "a ==b== c" }),
    );
    expect(fs).toEqual({ type: "cloze", front: "Ctx", sentence: "a ==b== c" });
  });

  it("maps spatial fields including hint", () => {
    const fs = cardToRefactorFieldSet(
      makeCard({ type: "spatial", front: "F", back: "B", hint: "H" }),
    );
    expect(fs).toEqual({ type: "spatial", front: "F", back: "B", hint: "H" });
  });

  it("extracts the numbered item for image-occlusion", () => {
    const fs = cardToRefactorFieldSet(
      makeCard({
        type: "image-occlusion",
        back: "1. first\n2. second\n3. third",
        clozeOrder: 1,
        clozeText: "second",
      }),
    );
    expect(fs).toEqual({ type: "image-occlusion", listItem: "second" });
  });
});

describe("fieldSetToEdits", () => {
  const cases: RefactorFieldSet[] = [
    { type: "header-paragraph", front: "Q", back: "A" },
    { type: "table", front: "F", back: "B", notes: "N" },
    { type: "cloze", front: "C", sentence: "a ==b==" },
    { type: "spatial", front: "F", back: "B", hint: "H" },
    { type: "image-occlusion", listItem: "x" },
  ];

  it("round-trips every field set into a matching edit shape", () => {
    for (const fs of cases) {
      const edits = fieldSetToEdits(fs);
      expect(edits).toEqual(fs);
    }
  });
});
