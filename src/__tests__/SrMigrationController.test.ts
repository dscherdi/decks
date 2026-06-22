import { buildReviewProperties } from "@/services/SrMigrationController";

describe("buildReviewProperties", () => {
  it("carries over user properties and drops tags/position/sr-* keys", () => {
    const out = buildReviewProperties(
      {
        author: "Jane",
        tags: ["a", "b"],
        position: { start: 0 },
        "sr-due": "2024-01-01",
      },
      {}
    );
    expect(out).toContain("author: Jane");
    expect(out).not.toContain("tags:");
    expect(out).not.toContain("position");
    expect(out).not.toContain("sr-due");
  });

  it("injects cross-link properties on a note with no frontmatter", () => {
    const out = buildReviewProperties(undefined, {
      Flashcards: "[[Note (Flashcards)]]",
      "Origin note": "[[folder/Note]]",
    });
    expect(out).toContain("Flashcards: [[Note (Flashcards)]]");
    expect(out).toContain("Origin note: [[folder/Note]]");
  });

  it("overwrites an existing property instead of duplicating it", () => {
    const out = buildReviewProperties(
      { "Origin note": "https://user-supplied.example", author: "Jane" },
      { "Origin note": "[[folder/Note]]" }
    );
    // Exactly one "Origin note" key, holding the injected value.
    expect(out.match(/^Origin note:/gm)).toHaveLength(1);
    expect(out).toContain("Origin note: [[folder/Note]]");
    expect(out).not.toContain("https://user-supplied.example");
    expect(out).toContain("author: Jane");
  });

  it("overwrites case-insensitively (user 'origin note' vs injected 'Origin note')", () => {
    const out = buildReviewProperties(
      { "origin note": "old", Flashcards: "old-deck" },
      { "Origin note": "[[new]]", Flashcards: "[[deck]]" }
    );
    expect(out.match(/origin note:/gim)).toHaveLength(1);
    expect(out.match(/^Flashcards:/gm)).toHaveLength(1);
    expect(out).toContain("Origin note: [[new]]");
    expect(out).toContain("Flashcards: [[deck]]");
    expect(out).not.toContain("old");
  });

  it("returns an empty string when there is nothing to write", () => {
    expect(buildReviewProperties(undefined, {})).toBe("");
    expect(buildReviewProperties({ tags: ["x"] }, {})).toBe("");
  });
});
