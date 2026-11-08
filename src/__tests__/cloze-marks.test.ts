import { clozeMarkRange, clozeMarkRole } from "../utils/cloze-marks";

describe("clozeMarkRange", () => {
  it("covers one active mark", () => {
    expect(clozeMarkRange([2])).toEqual({ start: 2, end: 3 });
  });

  it("covers a line of active marks", () => {
    expect(clozeMarkRange([1, 2, 3])).toEqual({ start: 1, end: 4 });
  });

  it("is null when every active cloze sits in math", () => {
    expect(clozeMarkRange([])).toBeNull();
  });
});

describe("clozeMarkRole", () => {
  const line = { start: 1, end: 3 };

  it("blanks every mark of the range until revealed, then reveals them all", () => {
    expect([0, 1, 2, 3].map((i) => clozeMarkRole(i, line, "open", false))).toEqual([
      "context",
      "active",
      "active",
      "context",
    ]);
    expect([0, 1, 2, 3].map((i) => clozeMarkRole(i, line, "open", true))).toEqual([
      "context",
      "revealed",
      "revealed",
      "context",
    ]);
  });

  it("hides marks outside the range in hidden mode", () => {
    expect([0, 1, 3].map((i) => clozeMarkRole(i, line, "hidden", false))).toEqual(["blank", "active", "blank"]);
  });

  it("leaves every mark alone when nothing is active", () => {
    expect(clozeMarkRole(0, { start: -1, end: 0 }, "open", false)).toBe("context");
  });
});
