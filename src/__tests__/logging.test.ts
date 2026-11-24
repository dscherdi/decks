import { Logger, MAX_LOG_BYTES, formatLogArg } from "../utils/logging";
import { DEFAULT_SETTINGS, type DecksSettings } from "../settings";

// The debug log is appended to by one writer at a time and moved aside when large; it is never read back.
function memoryAdapter(initial: Record<string, string> = {}) {
  const files = new Map(Object.entries(initial));
  let active = 0;
  const stats = { writes: 0, maxConcurrent: 0 };
  const io = async <T>(run: () => T): Promise<T> => {
    active++;
    stats.maxConcurrent = Math.max(stats.maxConcurrent, active);
    await new Promise((resolve) => setTimeout(resolve, 5));
    active--;
    return run();
  };
  const adapter = {
    stat: (path: string) =>
      io(() => (files.has(path) ? { type: "file" as const, ctime: 0, mtime: 0, size: files.get(path)!.length } : null)),
    exists: (path: string) => io(() => files.has(path)),
    write: (path: string, data: string) => io(() => void (stats.writes++, files.set(path, data))),
    append: (path: string, data: string) => io(() => void (stats.writes++, files.set(path, (files.get(path) ?? "") + data))),
    remove: (path: string) => io(() => void files.delete(path)),
    rename: (from: string, to: string) =>
      io(() => {
        files.set(to, files.get(from) ?? "");
        files.delete(from);
      }),
  };
  return { adapter, files, stats };
}

const LOG = ".obsidian/plugins/decks/debug.log";
const OLD = ".obsidian/plugins/decks/debug.old.log";

function logger(adapter: ReturnType<typeof memoryAdapter>["adapter"]): Logger {
  const settings: DecksSettings = structuredClone(DEFAULT_SETTINGS);
  settings.debug.enableLogging = true;
  return new Logger(settings, adapter, ".obsidian", "decks");
}

describe("debug log file", () => {
  beforeEach(() => {
    jest.spyOn(console, "debug").mockImplementation(() => {});
  });
  afterEach(() => jest.restoreAllMocks());

  it("appends every line in order, a burst in a few writes from one writer", async () => {
    const { adapter, files, stats } = memoryAdapter();
    const log = logger(adapter);
    for (let i = 0; i < 200; i++) log.debug(`line ${i}`);
    await log.flush();

    const lines = files.get(LOG)!.trimEnd().split("\n");
    expect(lines).toHaveLength(200);
    expect(lines.map((line) => line.replace(/^\[[^\]]+\] /, ""))).toEqual(
      Array.from({ length: 200 }, (_, i) => `line ${i}`)
    );
    expect(stats.writes).toBeLessThanOrEqual(3);
    expect(stats.maxConcurrent).toBe(1);
  });

  it("moves a large log aside before writing, replacing the older one", async () => {
    const big = "x".repeat(MAX_LOG_BYTES + 10);
    const { adapter, files } = memoryAdapter({ [LOG]: big, [OLD]: "older" });
    const log = logger(adapter);
    log.debug("fresh start");
    await log.flush();

    expect(files.get(OLD)).toBe(big);
    expect(files.get(LOG)).toMatch(/^\[[^\]]+\] fresh start\n$/);
  });

  it("writes an error by its name and message", async () => {
    const { adapter, files } = memoryAdapter();
    const log = logger(adapter);
    log.debug("Merge failed:", new Error("memory access out of bounds"), { code: 7 });
    await log.flush();

    expect(files.get(LOG)).toContain("Merge failed: Error: memory access out of bounds {\"code\":7}");
    expect(formatLogArg(new TypeError("bad"))).toBe("TypeError: bad");
  });

  it("still writes from a method handed out bound to another object", async () => {
    const { adapter, files } = memoryAdapter();
    const log = logger(adapter);
    const debug = log.debug.bind({});
    debug("from the database service");
    await log.flush();
    expect(files.get(LOG)).toContain("from the database service");
  });

  it("writes nothing when logging is off", async () => {
    const { adapter, files } = memoryAdapter();
    const log = new Logger(structuredClone(DEFAULT_SETTINGS), adapter, ".obsidian", "decks");
    log.debug("quiet");
    await log.flush();
    expect(files.has(LOG)).toBe(false);
  });
});
