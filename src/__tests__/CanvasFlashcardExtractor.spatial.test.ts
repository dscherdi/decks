import { CanvasFlashcardExtractor } from "../services/CanvasFlashcardExtractor";

describe("CanvasFlashcardExtractor spatial extraction", () => {
  type Node = { id: string; text: string };
  type Edge = { id: string; fromNode: string; toNode: string; label?: string };

  function buildCanvas(nodes: Node[], edges: Edge[] = []): string {
    return JSON.stringify({
      nodes: nodes.map((n) => ({
        id: n.id,
        type: "text",
        text: n.text,
        x: 0,
        y: 0,
        width: 100,
        height: 50,
      })),
      edges,
    });
  }

  it("produces one spatial card from a single edge A->B", () => {
    const json = buildCanvas(
      [
        { id: "A", text: "Capital of France?" },
        { id: "B", text: "Paris" },
      ],
      [{ id: "e1", fromNode: "A", toNode: "B", label: "what city" }],
    );
    const cards = CanvasFlashcardExtractor.extract(json);
    expect(cards).toHaveLength(1);
    expect(cards[0]).toMatchObject({
      front: "Capital of France?",
      back: "Paris",
      hint: "what city",
      type: "spatial",
      edgeId: "e1",
      sourceNodeId: "A",
    });
  });

  it("cascading A->B->C produces exactly 2 cards and B is NOT also parsed standalone", () => {
    const json = buildCanvas(
      [
        { id: "A", text: "## Hdr A\nbody A" },
        { id: "B", text: "## Hdr B\nbody B" },
        { id: "C", text: "## Hdr C\nbody C" },
      ],
      [
        { id: "e-ab", fromNode: "A", toNode: "B", label: "next" },
        { id: "e-bc", fromNode: "B", toNode: "C", label: "next" },
      ],
    );
    const cards = CanvasFlashcardExtractor.extract(json);
    expect(cards).toHaveLength(2);
    expect(cards.every((c) => c.type === "spatial")).toBe(true);
    const pairs = cards.map((c) => `${c.sourceNodeId}->${c.edgeId}`).sort();
    expect(pairs).toEqual(["A->e-ab", "B->e-bc"]);
  });

  it("one-to-many edges produce one card per edge", () => {
    const json = buildCanvas(
      [
        { id: "Q", text: "Photosynthesis" },
        { id: "S", text: "Sunlight" },
        { id: "G", text: "Glucose" },
      ],
      [
        { id: "e1", fromNode: "Q", toNode: "S", label: "needs" },
        { id: "e2", fromNode: "Q", toNode: "G", label: "produces" },
      ],
    );
    const cards = CanvasFlashcardExtractor.extract(json);
    expect(cards).toHaveLength(2);
    expect(cards.every((c) => c.front === "Photosynthesis")).toBe(true);
    expect(new Set(cards.map((c) => c.back))).toEqual(new Set(["Sunlight", "Glucose"]));
  });

  it("many-to-one edges produce one card per edge", () => {
    const json = buildCanvas(
      [
        { id: "X", text: "X" },
        { id: "Y", text: "Y" },
        { id: "Z", text: "Z" },
      ],
      [
        { id: "e1", fromNode: "X", toNode: "Z" },
        { id: "e2", fromNode: "Y", toNode: "Z" },
      ],
    );
    const cards = CanvasFlashcardExtractor.extract(json);
    expect(cards).toHaveLength(2);
    expect(cards.every((c) => c.back === "Z")).toBe(true);
    expect(new Set(cards.map((c) => c.front))).toEqual(new Set(["X", "Y"]));
  });

  it("strips #tags from the from-node text and stores them as card tags", () => {
    const json = buildCanvas(
      [
        { id: "A", text: "What is FSRS? #algo #spaced-repetition" },
        { id: "B", text: "Free Spaced Repetition Scheduler" },
      ],
      [{ id: "e1", fromNode: "A", toNode: "B", label: "expands" }],
    );
    const cards = CanvasFlashcardExtractor.extract(json);
    expect(cards).toHaveLength(1);
    expect(cards[0].front).toBe("What is FSRS?");
    expect(cards[0].tags.sort()).toEqual(["algo", "spaced-repetition"]);
  });

  it("edge with no label yields a card with empty hint", () => {
    const json = buildCanvas(
      [
        { id: "A", text: "A" },
        { id: "B", text: "B" },
      ],
      [{ id: "e1", fromNode: "A", toNode: "B" }],
    );
    const cards = CanvasFlashcardExtractor.extract(json);
    expect(cards).toHaveLength(1);
    expect(cards[0].hint).toBe("");
  });

  it("edges to non-text nodes are dropped by the parser before reaching the extractor", () => {
    // Mimic raw JSON with a file-type node and an edge that touches it.
    const json = JSON.stringify({
      nodes: [
        { id: "T", type: "text", text: "Hello" },
        { id: "F", type: "file", file: "x.md" },
      ],
      edges: [{ id: "e1", fromNode: "T", toNode: "F", label: "see" }],
    });
    const cards = CanvasFlashcardExtractor.extract(json);
    // No spatial card (edge dropped). T is standalone -> default parser, no h2 inside, so nothing.
    expect(cards).toEqual([]);
  });

  it("standalone (unconnected) nodes fall through to the existing 4-rule parser", () => {
    const json = buildCanvas([
      { id: "hp", text: "## Q\nA" },
      { id: "tbl", text: "## T\n\n| Front | Back |\n| --- | --- |\n| f | b |\n" },
    ]);
    const cards = CanvasFlashcardExtractor.extract(json);
    expect(cards).toHaveLength(2);
    expect(cards.map((c) => c.type).sort()).toEqual(["header-paragraph", "table"]);
  });

  it("mixed canvas yields spatial cards AND standalone-parsed cards", () => {
    const json = buildCanvas(
      [
        { id: "A", text: "Front-A" },
        { id: "B", text: "Back-B" },
        { id: "alone", text: "## standalone Q\nstandalone A" },
      ],
      [{ id: "e1", fromNode: "A", toNode: "B", label: "lbl" }],
    );
    const cards = CanvasFlashcardExtractor.extract(json);
    expect(cards).toHaveLength(2);
    expect(cards.find((c) => c.type === "spatial")?.front).toBe("Front-A");
    expect(cards.find((c) => c.type === "header-paragraph")?.front).toBe(
      "standalone Q",
    );
  });

  it("expands cloze in back when clozeEnabled (one card per cloze, shared edgeId/hint/tags)", () => {
    const json = buildCanvas(
      [
        { id: "A", text: "Capitals" },
        { id: "B", text: "==Paris== and ==Madrid==" },
      ],
      [{ id: "e1", fromNode: "A", toNode: "B", label: "examples" }],
    );
    const cards = CanvasFlashcardExtractor.extract(json, 2, undefined, true);
    expect(cards).toHaveLength(2);
    expect(cards.every((c) => c.type === "cloze")).toBe(true);
    expect(cards.every((c) => c.edgeId === "e1")).toBe(true);
    expect(cards.every((c) => c.hint === "examples")).toBe(true);
    expect(cards.map((c) => c.clozeText).sort()).toEqual(["Madrid", "Paris"]);
    expect(cards.map((c) => c.clozeOrder).sort()).toEqual([0, 1]);
  });

  it("keeps cloze markup literal when clozeEnabled=false", () => {
    const json = buildCanvas(
      [
        { id: "A", text: "Capitals" },
        { id: "B", text: "==Paris==" },
      ],
      [{ id: "e1", fromNode: "A", toNode: "B", label: "ex" }],
    );
    const cards = CanvasFlashcardExtractor.extract(json, 2, undefined, false);
    expect(cards).toHaveLength(1);
    expect(cards[0].type).toBe("spatial");
    expect(cards[0].back).toBe("==Paris==");
  });

  it("handles a cycle A<->B without looping forever", () => {
    const json = buildCanvas(
      [
        { id: "A", text: "A" },
        { id: "B", text: "B" },
      ],
      [
        { id: "e-ab", fromNode: "A", toNode: "B", label: "to-B" },
        { id: "e-ba", fromNode: "B", toNode: "A", label: "to-A" },
      ],
    );
    const cards = CanvasFlashcardExtractor.extract(json);
    expect(cards).toHaveLength(2);
    const ids = cards.map((c) => c.edgeId).sort();
    expect(ids).toEqual(["e-ab", "e-ba"]);
  });

  it("handles a self-loop A->A as a single card whose front equals its back", () => {
    const json = buildCanvas(
      [{ id: "A", text: "self" }],
      [{ id: "e-self", fromNode: "A", toNode: "A", label: "loop" }],
    );
    const cards = CanvasFlashcardExtractor.extract(json);
    expect(cards).toHaveLength(1);
    expect(cards[0].front).toBe("self");
    expect(cards[0].back).toBe("self");
    expect(cards[0].edgeId).toBe("e-self");
  });

  it("emits cards in a stable order (sorted by edge id) across runs", () => {
    const json = buildCanvas(
      [
        { id: "A", text: "A" },
        { id: "B", text: "B" },
        { id: "C", text: "C" },
      ],
      [
        { id: "edge-z", fromNode: "A", toNode: "B", label: "z" },
        { id: "edge-a", fromNode: "A", toNode: "C", label: "a" },
      ],
    );
    const a = CanvasFlashcardExtractor.extract(json).map((c) => c.edgeId);
    const b = CanvasFlashcardExtractor.extract(json).map((c) => c.edgeId);
    expect(a).toEqual(b);
    expect(a).toEqual(["edge-a", "edge-z"]);
  });
});
