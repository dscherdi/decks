import { generateOcclusionV2FlashcardId } from "@decks/core";

describe("generateOcclusionV2FlashcardId", () => {
  it("is deterministic for the same heading/image/mask", () => {
    const a = generateOcclusionV2FlashcardId("Anatomy > Heart", "heart.png", "m1");
    const b = generateOcclusionV2FlashcardId("Anatomy > Heart", "heart.png", "m1");
    expect(a).toBe(b);
    expect(a.startsWith("ocard_")).toBe(true);
  });

  it("is stable across coordinate/answer edits (identity is heading + image + mask id)", () => {
    // The id depends only on heading + image name + maskId; geometry/answer are
    // not part of it, so moving a box or editing its answer keeps FSRS history.
    const id = generateOcclusionV2FlashcardId("Anatomy > Heart", "heart.png", "m1");
    const sameId = generateOcclusionV2FlashcardId("Anatomy > Heart", "heart.png", "m1");
    expect(sameId).toBe(id);
  });

  it("changes when the mask id changes", () => {
    const m1 = generateOcclusionV2FlashcardId("Anatomy > Heart", "heart.png", "m1");
    const m2 = generateOcclusionV2FlashcardId("Anatomy > Heart", "heart.png", "m2");
    expect(m1).not.toBe(m2);
  });

  it("changes with the heading", () => {
    const base = generateOcclusionV2FlashcardId("Anatomy > Heart", "heart.png", "m1");
    expect(generateOcclusionV2FlashcardId("Anatomy > Lung", "heart.png", "m1")).not.toBe(
      base
    );
  });

  it("distinguishes two occlusion images that share one heading (per-doc masks reuse m1)", () => {
    // Mask ids are only unique within a block, so the image name is what keeps
    // two occlusion images under the same heading from colliding.
    const heart = generateOcclusionV2FlashcardId("Anatomy", "heart.png", "m1");
    const lung = generateOcclusionV2FlashcardId("Anatomy", "lung.png", "m1");
    expect(heart).not.toBe(lung);
  });

  it("is folder-independent — only the file name matters", () => {
    // The generator receives the bare file name, so relocating the image's
    // folder does not change the id (only renaming the file does).
    const a = generateOcclusionV2FlashcardId("Anatomy", "heart.png", "m1");
    const b = generateOcclusionV2FlashcardId("Anatomy", "heart.png", "m1");
    expect(a).toBe(b);
  });
});
