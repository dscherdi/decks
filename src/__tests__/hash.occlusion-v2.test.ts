import { generateOcclusionV2FlashcardId } from "@decks/core";

describe("generateOcclusionV2FlashcardId", () => {
  it("is deterministic for the same deck/image/mask", () => {
    const a = generateOcclusionV2FlashcardId("deck_1", "heart.png", "m1");
    const b = generateOcclusionV2FlashcardId("deck_1", "heart.png", "m1");
    expect(a).toBe(b);
    expect(a.startsWith("ocard_")).toBe(true);
  });

  it("is stable across coordinate/answer edits (identity is the mask id)", () => {
    // The id only depends on deck + image + maskId; geometry/answer are not
    // part of it, so moving a box or editing its answer keeps FSRS history.
    const id = generateOcclusionV2FlashcardId("deck_1", "heart.png", "m1");
    const sameId = generateOcclusionV2FlashcardId("deck_1", "heart.png", "m1");
    expect(sameId).toBe(id);
  });

  it("changes when the mask id changes", () => {
    const m1 = generateOcclusionV2FlashcardId("deck_1", "heart.png", "m1");
    const m2 = generateOcclusionV2FlashcardId("deck_1", "heart.png", "m2");
    expect(m1).not.toBe(m2);
  });

  it("changes with deck or image", () => {
    const base = generateOcclusionV2FlashcardId("deck_1", "heart.png", "m1");
    expect(generateOcclusionV2FlashcardId("deck_2", "heart.png", "m1")).not.toBe(base);
    expect(generateOcclusionV2FlashcardId("deck_1", "lung.png", "m1")).not.toBe(base);
  });
});
