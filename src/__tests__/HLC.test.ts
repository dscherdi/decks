import {
  hlcSend,
  hlcReceive,
  hlcCompare,
  hlcEqual,
  hlcParse,
  type HLCState,
  type HLCValue,
} from "../services/HLC";

function freshState(): HLCState {
  return { pt: 0, lc: 0 };
}

describe("HLC", () => {
  describe("hlcSend", () => {
    it("advances pt to now and resets lc when now > pt", () => {
      const state = freshState();
      const value = hlcSend(state, "dev-a");
      expect(value[0]).toBeGreaterThan(0);
      expect(value[1]).toBe(0);
      expect(value[2]).toBe("dev-a");
      expect(state.pt).toBe(value[0]);
      expect(state.lc).toBe(0);
    });

    it("increments lc when called multiple times within the same millisecond", () => {
      // Pin state.pt to far future so Date.now() can never overtake it within the test.
      const state: HLCState = { pt: Number.MAX_SAFE_INTEGER - 100, lc: 0 };
      const a = hlcSend(state, "dev");
      const b = hlcSend(state, "dev");
      const c = hlcSend(state, "dev");
      expect(a[1]).toBe(1);
      expect(b[1]).toBe(2);
      expect(c[1]).toBe(3);
      expect(a[0]).toBe(b[0]);
      expect(b[0]).toBe(c[0]);
    });
  });

  describe("hlcReceive", () => {
    it("advances local pt past incoming pt when incoming is newer", () => {
      const state = freshState();
      const incoming: HLCValue = [Date.now() + 1_000_000, 5, "remote"];
      hlcReceive(state, incoming);
      expect(state.pt).toBeGreaterThanOrEqual(incoming[0]);
    });

    it("keeps local pt and bumps lc past incoming lc when pts equal", () => {
      const fixedPt = Number.MAX_SAFE_INTEGER - 100;
      const state: HLCState = { pt: fixedPt, lc: 3 };
      const incoming: HLCValue = [fixedPt, 7, "remote"];
      hlcReceive(state, incoming);
      expect(state.pt).toBe(fixedPt);
      expect(state.lc).toBe(8);
    });

    it("guarantees the next hlcSend produces a value strictly greater than incoming", () => {
      const state = freshState();
      const incoming: HLCValue = [Date.now() + 60_000, 99, "remote"];
      hlcReceive(state, incoming);
      const next = hlcSend(state, "local");
      expect(hlcCompare(next, incoming)).toBeGreaterThan(0);
    });
  });

  describe("hlcCompare", () => {
    it("orders by pt first", () => {
      expect(hlcCompare([1, 5, "z"], [2, 0, "a"])).toBeLessThan(0);
      expect(hlcCompare([2, 0, "a"], [1, 5, "z"])).toBeGreaterThan(0);
    });

    it("orders by lc when pt equal", () => {
      expect(hlcCompare([1, 1, "z"], [1, 2, "a"])).toBeLessThan(0);
    });

    it("uses deviceId as final tiebreaker", () => {
      expect(hlcCompare([1, 0, "a"], [1, 0, "b"])).toBeLessThan(0);
      expect(hlcCompare([1, 0, "b"], [1, 0, "a"])).toBeGreaterThan(0);
      expect(hlcCompare([1, 0, "a"], [1, 0, "a"])).toBe(0);
    });

    it("is consistent with hlcEqual", () => {
      expect(hlcEqual([1, 2, "x"], [1, 2, "x"])).toBe(true);
      expect(hlcCompare([1, 2, "x"], [1, 2, "x"])).toBe(0);
      expect(hlcEqual([1, 2, "x"], [1, 2, "y"])).toBe(false);
    });
  });

  describe("hlcParse", () => {
    it("parses a valid 3-element tuple", () => {
      expect(hlcParse([100, 5, "dev"])).toEqual([100, 5, "dev"]);
    });

    it("throws on wrong length", () => {
      expect(() => hlcParse([100, 5])).toThrow();
      expect(() => hlcParse([100, 5, "dev", "extra"])).toThrow();
    });

    it("throws on wrong types", () => {
      expect(() => hlcParse(["100", 5, "dev"])).toThrow();
      expect(() => hlcParse([100, "5", "dev"])).toThrow();
      expect(() => hlcParse([100, 5, 42])).toThrow();
    });

    it("throws on non-array input", () => {
      expect(() => hlcParse(null)).toThrow();
      expect(() => hlcParse({ pt: 100, lc: 5, dev: "dev" })).toThrow();
    });
  });

  describe("end-to-end skew scenario", () => {
    it("two devices stamp ops; both converge on the same total order", () => {
      // Device A is 5 seconds ahead of Device B's wall clock.
      // Simulate by stamping with explicit pt values.
      const aState: HLCState = { pt: 1_000_005, lc: 0 };
      const bState: HLCState = { pt: 1_000_000, lc: 0 };

      const op1FromA = hlcSend(aState, "a");
      // B receives A's op and stamps its own.
      hlcReceive(bState, op1FromA);
      const op2FromB = hlcSend(bState, "b");

      // A receives B's op.
      hlcReceive(aState, op2FromB);
      const op3FromA = hlcSend(aState, "a");

      // The three ops must be totally ordered: op1 < op2 < op3.
      expect(hlcCompare(op1FromA, op2FromB)).toBeLessThan(0);
      expect(hlcCompare(op2FromB, op3FromA)).toBeLessThan(0);
    });
  });
});
