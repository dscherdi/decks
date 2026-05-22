import { TestDeckService } from "../services/TestDeckService";

interface MemFS {
  files: Map<string, string>;
  dirs: Set<string>;
}

function makeApp(initial?: MemFS): { app: never; fs: MemFS } {
  const fs: MemFS = initial ?? { files: new Map(), dirs: new Set() };
  const app = {
    vault: {
      adapter: {
        exists: async (p: string) => fs.files.has(p) || fs.dirs.has(p),
        mkdir: async (p: string) => {
          fs.dirs.add(p);
        },
      },
      create: async (p: string, content: string) => {
        fs.files.set(p, content);
      },
    },
  };
  return { app: app as unknown as never, fs };
}

describe("TestDeckService.createTestCanvasDeck", () => {
  it("writes to the default 'Canvas decks/' folder when folderPath is empty", async () => {
    const { app, fs } = makeApp();
    const svc = new TestDeckService(app);

    const folder = await svc.createTestCanvasDeck("#decks/canvas", "");

    expect(folder).toBe("Canvas decks");
    const written = Array.from(fs.files.keys());
    expect(written).toHaveLength(1);
    expect(written[0]).toMatch(/^Canvas decks\/.*\.canvas$/);
    expect(fs.dirs.has("Canvas decks")).toBe(true);
  });

  it("writes to the user-configured folder when folderPath is non-empty", async () => {
    const { app, fs } = makeApp();
    const svc = new TestDeckService(app);

    const folder = await svc.createTestCanvasDeck(
      "#decks/canvas",
      "MyCanvases/sub",
    );

    expect(folder).toBe("MyCanvases/sub");
    const written = Array.from(fs.files.keys());
    expect(written[0]).toMatch(/^MyCanvases\/sub\/.*\.canvas$/);
  });

  it("strips a trailing slash from the folder path", async () => {
    const { app, fs } = makeApp();
    const svc = new TestDeckService(app);
    const folder = await svc.createTestCanvasDeck("#decks/canvas", "Decks/");
    expect(folder).toBe("Decks");
    expect(Array.from(fs.files.keys())[0]).toMatch(/^Decks\/.*\.canvas$/);
  });

  it("returns null and writes nothing if the target file already exists", async () => {
    const fs: MemFS = { files: new Map(), dirs: new Set() };
    // Seed the file at the expected default location.
    fs.files.set(
      "Canvas decks/Decks — Canvas getting started.canvas",
      "existing content",
    );
    const { app } = makeApp(fs);
    const svc = new TestDeckService(app);

    const folder = await svc.createTestCanvasDeck("#decks/canvas", "");

    expect(folder).toBeNull();
    expect(fs.files.size).toBe(1);
    expect(fs.files.get("Canvas decks/Decks — Canvas getting started.canvas")).toBe(
      "existing content",
    );
  });

  it("is idempotent on a second call", async () => {
    const { app, fs } = makeApp();
    const svc = new TestDeckService(app);

    const first = await svc.createTestCanvasDeck("#decks/canvas", "");
    expect(first).toBe("Canvas decks");
    expect(fs.files.size).toBe(1);

    const second = await svc.createTestCanvasDeck("#decks/canvas", "");
    expect(second).toBeNull();
    expect(fs.files.size).toBe(1);
  });

  it("embeds the deck tag in the written content", async () => {
    const { app, fs } = makeApp();
    const svc = new TestDeckService(app);
    await svc.createTestCanvasDeck("#decks/canvas", "");

    const content = Array.from(fs.files.values())[0];
    expect(content).toContain("#decks/canvas");
  });
});
