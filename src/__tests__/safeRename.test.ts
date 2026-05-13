import { safeRename } from "../utils/adapter";
import type { DataAdapter } from "obsidian";

function makeAdapter(rename: jest.Mock): DataAdapter {
  return { rename } as unknown as DataAdapter;
}

describe("safeRename", () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it("succeeds on first try when rename is happy", async () => {
    const rename = jest.fn().mockResolvedValue(undefined);
    await safeRename(makeAdapter(rename), "a", "b");
    expect(rename).toHaveBeenCalledTimes(1);
  });

  it("retries up to 3 times on EBUSY then succeeds", async () => {
    const rename = jest
      .fn()
      .mockRejectedValueOnce(new Error("EBUSY: resource busy"))
      .mockRejectedValueOnce(new Error("EBUSY: resource busy"))
      .mockResolvedValueOnce(undefined);
    const promise = safeRename(makeAdapter(rename), "a", "b");
    // Drain the backoff sleeps.
    await jest.runAllTimersAsync();
    await promise;
    expect(rename).toHaveBeenCalledTimes(3);
  });

  it("throws after retries exhausted", async () => {
    const rename = jest
      .fn()
      .mockRejectedValue(new Error("EPERM: operation not permitted"));
    const promise = safeRename(makeAdapter(rename), "a", "b");
    promise.catch(() => undefined); // suppress unhandled rejection
    await jest.runAllTimersAsync();
    await expect(promise).rejects.toThrow(/EPERM/);
    expect(rename).toHaveBeenCalledTimes(3);
  });

  it("does NOT retry on non-transient errors (fails fast on EACCES)", async () => {
    const rename = jest
      .fn()
      .mockRejectedValue(new Error("EACCES: permission denied"));
    await expect(safeRename(makeAdapter(rename), "a", "b")).rejects.toThrow(/EACCES/);
    expect(rename).toHaveBeenCalledTimes(1);
  });
});
