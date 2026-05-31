import { wordDiff } from "@/utils/word-diff";

describe("wordDiff", () => {
  it("returns a single equal op for identical strings", () => {
    const ops = wordDiff("hello world", "hello world");
    expect(ops).toEqual([{ type: "equal", text: "hello world" }]);
  });

  it("reconstructs the 'before' text from equal+remove ops", () => {
    const before = "the quick brown fox";
    const ops = wordDiff(before, "the slow brown fox");
    const reconstructed = ops
      .filter((o) => o.type !== "add")
      .map((o) => o.text)
      .join("");
    expect(reconstructed).toBe(before);
  });

  it("reconstructs the 'after' text from equal+add ops", () => {
    const after = "the slow brown fox";
    const ops = wordDiff("the quick brown fox", after);
    const reconstructed = ops
      .filter((o) => o.type !== "remove")
      .map((o) => o.text)
      .join("");
    expect(reconstructed).toBe(after);
  });

  it("marks a replaced word as remove + add", () => {
    const ops = wordDiff("paris", "Paris");
    expect(ops.some((o) => o.type === "remove" && o.text === "paris")).toBe(true);
    expect(ops.some((o) => o.type === "add" && o.text === "Paris")).toBe(true);
  });

  it("handles empty before (pure addition)", () => {
    const ops = wordDiff("", "new text");
    expect(ops.every((o) => o.type === "add")).toBe(true);
  });
});
