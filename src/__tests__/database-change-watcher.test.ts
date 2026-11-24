import { DatabaseChangeWatcher } from "../utils/database-change-watcher";

// The database file is merged once per version another device writes; a version that fails is not read again every tick.
function watcher(options: { mtime: number; fail?: boolean; mergeMs?: number }) {
  const state = { ...options, merges: 0, refreshed: 0, logs: [] as string[] };
  const watch = new DatabaseChangeWatcher({
    mtime: async () => state.mtime,
    merge: async () => {
      state.merges++;
      if (state.mergeMs) await new Promise((resolve) => setTimeout(resolve, state.mergeMs));
      if (state.fail) throw new Error("memory access out of bounds");
    },
    onMerged: async () => {
      state.refreshed++;
    },
    log: (message, error) => state.logs.push(error instanceof Error ? `${message}: ${error.message}` : message),
  });
  return { watch, state };
}

describe("database change watcher", () => {
  it("merges a newer file once", async () => {
    const { watch, state } = watcher({ mtime: 100 });
    await watch.remember();
    await watch.check();
    expect(state.merges).toBe(0);

    state.mtime = 200;
    await watch.check();
    await watch.check();
    expect(state.merges).toBe(1);
    expect(state.refreshed).toBe(1);
  });

  it("does not retry a failed version until the file changes", async () => {
    const { watch, state } = watcher({ mtime: 100, fail: true });
    await watch.remember();
    state.mtime = 200;
    for (let i = 0; i < 5; i++) await watch.check();
    expect(state.merges).toBe(1);
    expect(state.logs.some((line) => line.endsWith("memory access out of bounds"))).toBe(true);

    state.mtime = 300;
    state.fail = false;
    await watch.check();
    expect(state.merges).toBe(2);
    expect(state.refreshed).toBe(1);
  });

  it("does not start a second merge while one is running", async () => {
    const { watch, state } = watcher({ mtime: 100, mergeMs: 30 });
    await watch.remember();
    state.mtime = 200;
    await Promise.all([watch.check(), watch.check(), watch.check()]);
    expect(state.merges).toBe(1);
  });
});
