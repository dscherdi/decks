import { cardFieldDefs, fieldSetValue, type RefactorFieldSet } from "@decks/core";

describe("cardFieldDefs", () => {
  it("returns front/back for header-paragraph (front marked)", () => {
    const defs = cardFieldDefs("header-paragraph");
    expect(defs.map((d) => d.refKey)).toEqual(["front", "back"]);
    expect(defs[0].isFront).toBe(true);
    expect(defs[1].isFront).toBeUndefined();
  });

  it("returns front/back/notes for table and hint for spatial", () => {
    expect(cardFieldDefs("table").map((d) => d.refKey)).toEqual([
      "front",
      "back",
      "notes",
    ]);
    expect(cardFieldDefs("spatial").map((d) => d.refKey)).toEqual([
      "front",
      "back",
      "hint",
    ]);
  });

  it("returns sentence for cloze and listItem for image-occlusion", () => {
    expect(cardFieldDefs("cloze").map((d) => d.refKey)).toEqual([
      "front",
      "sentence",
    ]);
    expect(cardFieldDefs("image-occlusion").map((d) => d.refKey)).toEqual([
      "listItem",
    ]);
  });
});

describe("fieldSetValue", () => {
  it("reads each field of a table field set", () => {
    const fs: RefactorFieldSet = {
      type: "table",
      front: "Q",
      back: "A",
      notes: "N",
    };
    expect(fieldSetValue(fs, "front")).toBe("Q");
    expect(fieldSetValue(fs, "back")).toBe("A");
    expect(fieldSetValue(fs, "notes")).toBe("N");
  });

  it("reads cloze sentence and returns '' for an unknown key", () => {
    const fs: RefactorFieldSet = { type: "cloze", front: "H", sentence: "S" };
    expect(fieldSetValue(fs, "sentence")).toBe("S");
    expect(fieldSetValue(fs, "notes")).toBe("");
  });
});
