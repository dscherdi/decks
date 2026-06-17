import { type App, TFile } from "obsidian";
import type { Flashcard } from "../database/types";
import {
  type ContextItem,
  extForMime,
  savePastedImage,
  buildContextPayload,
  buildComposerRequest,
  buildGenerationComposerRequest,
  readImageAsBase64,
  readNoteText,
} from "../utils/attachments";

interface FakeFile {
  path: string;
  ext: string;
  text?: string;
  bytes?: number[];
}

/** A fake App whose vault serves a fixed set of files (text + binary). */
function mockVaultApp(files: FakeFile[]): App {
  const byPath = new Map(files.map((f) => [f.path, f]));
  const asTFile = (f: FakeFile) => {
    const file = {
      path: f.path,
      name: f.path.split("/").pop() ?? f.path,
      extension: f.ext,
    };
    Object.setPrototypeOf(file, TFile.prototype);
    return file;
  };
  return {
    vault: {
      getAbstractFileByPath: (p: string) => {
        const f = byPath.get(p);
        return f ? asTFile(f) : null;
      },
      cachedRead: async (file: { path: string }) =>
        byPath.get(file.path)?.text ?? "",
      readBinary: async (file: { path: string }) =>
        new Uint8Array(byPath.get(file.path)?.bytes ?? []).buffer,
    },
  } as unknown as App;
}

const card = { sourceFile: "card-source.md" } as unknown as Flashcard;
const ctx = (
  kind: "note" | "image",
  path: string,
  label: string,
): ContextItem => ({ id: `${kind}:${path}`, kind, path, label });

describe("extForMime", () => {
  it("maps supported image MIME types to extensions", () => {
    expect(extForMime("image/png")).toBe("png");
    expect(extForMime("image/jpeg")).toBe("jpg");
    expect(extForMime("image/gif")).toBe("gif");
    expect(extForMime("image/webp")).toBe("webp");
    expect(extForMime("IMAGE/PNG")).toBe("png");
  });

  it("returns null for unsupported types", () => {
    expect(extForMime("text/plain")).toBeNull();
    expect(extForMime("image/bmp")).toBeNull();
  });
});

describe("savePastedImage", () => {
  function mockApp(): {
    app: App;
    writes: { path: string; bytes: number }[];
  } {
    const writes: { path: string; bytes: number }[] = [];
    const app = {
      fileManager: {
        getAvailablePathForAttachment: async (name: string) =>
          `attachments/${name}`,
      },
      vault: {
        createBinary: async (path: string, data: ArrayBuffer) => {
          writes.push({ path, bytes: data.byteLength });
          return {};
        },
      },
    } as unknown as App;
    return { app, writes };
  }

  function fakeImage(type: string): File {
    return {
      type,
      arrayBuffer: async () => new Uint8Array([1, 2, 3, 4]).buffer,
    } as unknown as File;
  }

  it("saves an image to the attachments folder and returns its path/name", async () => {
    const { app, writes } = mockApp();
    const result = await savePastedImage(app, "deck.md", fakeImage("image/png"));
    expect(result).toEqual({
      path: "attachments/pasted-image.png",
      name: "pasted-image.png",
    });
    expect(writes).toEqual([{ path: "attachments/pasted-image.png", bytes: 4 }]);
  });

  it("returns null and writes nothing for a non-image", async () => {
    const { app, writes } = mockApp();
    const result = await savePastedImage(app, "deck.md", fakeImage("text/plain"));
    expect(result).toBeNull();
    expect(writes).toHaveLength(0);
  });
});

describe("readNoteText", () => {
  it("returns the note's text", async () => {
    const app = mockVaultApp([{ path: "a.md", ext: "md", text: "Body" }]);
    expect(await readNoteText(app, "a.md")).toBe("Body");
  });

  it("returns null for a missing file", async () => {
    const app = mockVaultApp([]);
    expect(await readNoteText(app, "missing.md")).toBeNull();
  });
});

describe("readImageAsBase64", () => {
  it("reads a supported image as base64 with its mime type", async () => {
    const app = mockVaultApp([{ path: "p.png", ext: "png", bytes: [1, 2, 3] }]);
    expect(await readImageAsBase64(app, "p.png")).toEqual({
      mimeType: "image/png",
      dataBase64: "AQID", // base64 of [1,2,3]
    });
  });

  it("returns null for an unsupported extension", async () => {
    const app = mockVaultApp([{ path: "a.txt", ext: "txt", bytes: [1] }]);
    expect(await readImageAsBase64(app, "a.txt")).toBeNull();
  });

  it("returns null for a missing file", async () => {
    const app = mockVaultApp([]);
    expect(await readImageAsBase64(app, "missing.png")).toBeNull();
  });
});

describe("buildContextPayload", () => {
  it("serializes a note into labeled sourceContext text", async () => {
    const app = mockVaultApp([{ path: "notes/a.md", ext: "md", text: "Alpha body" }]);
    const { sourceContext, images } = await buildContextPayload(app, card, [
      ctx("note", "notes/a.md", "a.md"),
    ]);
    expect(sourceContext).toBe("# a.md\nAlpha body");
    expect(images).toEqual([]);
  });

  it("joins multiple notes with a separator, in order", async () => {
    const app = mockVaultApp([
      { path: "a.md", ext: "md", text: "Alpha" },
      { path: "b.md", ext: "md", text: "Beta" },
    ]);
    const { sourceContext } = await buildContextPayload(app, card, [
      ctx("note", "a.md", "a.md"),
      ctx("note", "b.md", "b.md"),
    ]);
    expect(sourceContext).toBe("# a.md\nAlpha\n\n---\n\n# b.md\nBeta");
  });

  it("serializes an image into base64 (not into sourceContext)", async () => {
    const app = mockVaultApp([{ path: "img/p.png", ext: "png", bytes: [1, 2, 3] }]);
    const { sourceContext, images } = await buildContextPayload(app, card, [
      ctx("image", "img/p.png", "p.png"),
    ]);
    expect(sourceContext).toBeUndefined();
    expect(images).toEqual([{ mimeType: "image/png", dataBase64: "AQID" }]);
  });

  it("handles mixed notes + images and skips missing files", async () => {
    const app = mockVaultApp([
      { path: "a.md", ext: "md", text: "Alpha" },
      { path: "p.png", ext: "png", bytes: [255] },
    ]);
    const { sourceContext, images } = await buildContextPayload(app, card, [
      ctx("note", "a.md", "a.md"),
      ctx("note", "gone.md", "gone.md"), // missing → skipped
      ctx("image", "p.png", "p.png"),
    ]);
    expect(sourceContext).toBe("# a.md\nAlpha");
    expect(images).toEqual([{ mimeType: "image/png", dataBase64: "/w==" }]);
  });

  it("returns undefined sourceContext when there is no text", async () => {
    const app = mockVaultApp([]);
    const { sourceContext, images } = await buildContextPayload(app, card, []);
    expect(sourceContext).toBeUndefined();
    expect(images).toEqual([]);
  });
});

describe("buildComposerRequest", () => {
  it("expands @mentions inline into instructions and assembles pills", async () => {
    const app = mockVaultApp([
      { path: "ref.md", ext: "md", text: "Reference content" },
      { path: "pic.png", ext: "png", bytes: [1, 2, 3] },
    ]);
    const { instructions, sourceContext, images } = await buildComposerRequest(
      app,
      card,
      "Use @ref to improve.",
      [ctx("image", "pic.png", "pic.png")],
      [ctx("note", "ref.md", "ref")],
    );
    expect(instructions).toBe(
      "Use \n\n[[ref]]\nReference content\n to improve.",
    );
    expect(sourceContext).toBeUndefined(); // pills here are image-only
    expect(images).toEqual([{ mimeType: "image/png", dataBase64: "AQID" }]);
  });

  it("returns undefined instructions for an empty prompt and no mentions", async () => {
    const app = mockVaultApp([]);
    const { instructions, images } = await buildComposerRequest(
      app,
      card,
      "   ",
      [],
      [],
    );
    expect(instructions).toBeUndefined();
    expect(images).toEqual([]);
  });
});

describe("buildGenerationComposerRequest with PDF items", () => {
  const pdfCtx: ContextItem = {
    id: "pdf:abc",
    kind: "pdf",
    path: "book.pdf",
    label: "book.pdf",
  };

  it("ignores pdf context items (resolved separately by the modal)", async () => {
    const app = mockVaultApp([{ path: "a.md", ext: "md", text: "Alpha" }]);
    const { sourceContext, images } = await buildGenerationComposerRequest(
      app,
      "Make cards",
      [ctx("note", "a.md", "a.md"), pdfCtx],
      [],
    );
    // The PDF contributes nothing here; only the note text lands in sourceContext.
    expect(sourceContext).toBe("# a.md\nAlpha");
    expect(images).toEqual([]);
  });

  it("yields undefined sourceContext when only a pdf is attached", async () => {
    const app = mockVaultApp([]);
    const { sourceContext, images } = await buildGenerationComposerRequest(
      app,
      "Make cards",
      [pdfCtx],
      [],
    );
    expect(sourceContext).toBeUndefined();
    expect(images).toEqual([]);
  });
});
