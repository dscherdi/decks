import { stagedCardsFromSnapshot } from "../services/ai-session-rows";
import type { AiSessionSnapshot, GenRow } from "../components/ai-generator-types";

const QUESTION = {
  front: "Which measure is robust to outliers?",
  back: "- [ ] Mean\n- [x] Median\n- [ ] Range\n%%The median ignores extreme values.%%",
  notes: "",
  page: 12,
};

function snapshot(rows: GenRow[], over: Partial<AiSessionSnapshot> = {}): AiSessionSnapshot {
  return {
    sessionId: "ais_1",
    sourceKind: "pdf",
    sourceRef: "Stats.pdf",
    sourceHash: "h1",
    selectedIds: [],
    model: null,
    cardType: "basic",
    rows,
    turns: [],
    supersededRowIds: [],
    droppedIds: [],
    destinationPath: null,
    profileId: null,
    ...over,
  };
}

const row = (id: string, over: Partial<GenRow> = {}): GenRow => ({
  id,
  card: { front: `Front ${id}`, back: "Back", notes: "" },
  keep: true,
  saved: false,
  ...over,
});

describe("stagedCardsFromSnapshot", () => {
  it("stores a question's options, answers and explanation", () => {
    const [card] = stagedCardsFromSnapshot(
      snapshot([row("q1", { card: QUESTION })], { cardType: "mcq" }),
      "ais_1",
    );
    expect(card.options).toEqual(["Mean", "Median", "Range"]);
    expect(card.correct).toEqual([1]);
    expect(card.explanation).toBe("The median ignores extreme values.");
    expect(card.valid).toBe(true);
    expect(card.sourcePage).toBe(12);
  });

  it("leaves the question fields empty for flashcards and for unusable questions", () => {
    const [basic] = stagedCardsFromSnapshot(snapshot([row("b1")]), "ais_1");
    expect([basic.options, basic.correct, basic.explanation, basic.valid]).toEqual([
      null,
      null,
      null,
      null,
    ]);
    const [broken] = stagedCardsFromSnapshot(
      snapshot([row("q2", { invalid: "no-correct" })], { cardType: "mcq" }),
      "ais_1",
    );
    expect(broken.options).toBeNull();
    expect(broken.valid).toBe(false);
  });

  it("maps each row's state to its stored status", () => {
    const cards = stagedCardsFromSnapshot(
      snapshot(
        [
          row("a"),
          row("b", { keep: false }),
          row("c", { saved: true }),
          row("d"),
        ],
        { supersededRowIds: ["d"] },
      ),
      "ais_1",
    );
    expect(cards.map((c) => [c.id, c.status])).toEqual([
      ["ais_1:a", "kept"],
      ["ais_1:b", "discarded"],
      ["ais_1:c", "saved"],
      ["ais_1:d", "superseded"],
    ]);
  });
});
