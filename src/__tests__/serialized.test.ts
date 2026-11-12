import { serialized } from "@/utils/serialized";

/** A task that reports how many copies of it ran at once. */
function tracked() {
  const state = { runs: 0, active: 0, mostAtOnce: 0, failNext: false };
  const task = async (): Promise<void> => {
    state.runs++;
    state.active++;
    state.mostAtOnce = Math.max(state.mostAtOnce, state.active);
    await new Promise((resolve) => setTimeout(resolve, 0));
    state.active--;
    if (state.failNext) {
      state.failNext = false;
      throw new Error("failed");
    }
  };
  return { state, task };
}

describe("serialized", () => {
  it("never runs two calls at once", async () => {
    const { state, task } = tracked();
    const run = serialized(task);

    await Promise.all([run(), run()]);

    expect(state.mostAtOnce).toBe(1);
    expect(state.runs).toBe(2);
  });

  it("shares one later run between all calls made while one runs", async () => {
    const { state, task } = tracked();
    const run = serialized(task);

    await Promise.all([run(), run(), run(), run()]);

    expect(state.runs).toBe(2);
  });

  it("runs again for a call made after the last one ended", async () => {
    const { state, task } = tracked();
    const run = serialized(task);

    await run();
    await run();

    expect(state.runs).toBe(2);
    expect(state.mostAtOnce).toBe(1);
  });

  it("still runs the waiting call when the running one fails", async () => {
    const { state, task } = tracked();
    const run = serialized(task);
    state.failNext = true;

    const results = await Promise.allSettled([run(), run()]);

    expect(results.map((r) => r.status)).toEqual(["rejected", "fulfilled"]);
    expect(state.runs).toBe(2);
  });

  it("gives the failure of the later run to the calls that share it", async () => {
    const { state, task } = tracked();
    const run = serialized(task);

    const first = run();
    const second = run();
    const third = run();
    await first;
    state.failNext = true;

    await expect(second).rejects.toThrow("failed");
    await expect(third).rejects.toThrow("failed");
  });
});
