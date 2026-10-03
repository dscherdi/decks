import { parseRequestRetention } from "../utils/request-retention";

describe("the profile editor's retention field", () => {
  it("takes either end of the range, with either decimal mark", () => {
    expect(["0.5", "0,5", "0.995", "0,995", " 0.9 "].map(parseRequestRetention)).toEqual([
      0.5, 0.5, 0.995, 0.995, 0.9,
    ]);
  });

  it("refuses a target just outside the range, or anything that is not a number", () => {
    for (const text of ["0.4999", "0,9951", "1", "", "  ", "abc", "0.9x"]) {
      expect(parseRequestRetention(text)).toBeNull();
    }
  });
});
