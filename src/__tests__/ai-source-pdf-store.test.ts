import { AiSourcePdfStore, PRUNE_AFTER_MS } from "../services/AiSourcePdfStore";
import { hashPdf } from "../utils/pdf";

const NOW = 1_800_000_000_000;

function memoryAdapter() {
  const files = new Map<string, { data: ArrayBuffer; mtime: number }>();
  const dirs = new Set<string>();
  let writes = 0;
  const adapter = {
    exists: (p: string) => Promise.resolve(files.has(p) || dirs.has(p)),
    stat: (p: string) => {
      const f = files.get(p);
      return Promise.resolve(f ? { type: "file" as const, ctime: f.mtime, mtime: f.mtime, size: f.data.byteLength } : null);
    },
    mkdir: (p: string) => {
      dirs.add(p);
      return Promise.resolve();
    },
    writeBinary: (p: string, data: ArrayBuffer) => {
      writes++;
      files.set(p, { data: data.slice(0), mtime: NOW });
      return Promise.resolve();
    },
    readBinary: (p: string) => {
      const f = files.get(p);
      return f ? Promise.resolve(f.data.slice(0)) : Promise.reject(new Error("missing"));
    },
    list: (p: string) =>
      Promise.resolve({ files: [...files.keys()].filter((f) => f.startsWith(`${p}/`)), folders: [] }),
    remove: (p: string) => {
      files.delete(p);
      return Promise.resolve();
    },
  };
  return { adapter, files, writes: () => writes };
}

const pdf = (text: string) => new TextEncoder().encode(`%PDF-1.4 ${text}`).buffer;
const DIR = ".obsidian/plugins/decks/ai-sources";
const age = (mem: ReturnType<typeof memoryAdapter>, hash: string, ms: number) => {
  const f = mem.files.get(`${DIR}/${hash}.pdf`);
  if (f) f.mtime = NOW - ms;
};

describe("kept copies of computer PDFs", () => {
  it("keeps a copy once and reads it back by hash", async () => {
    const mem = memoryAdapter();
    const store = new AiSourcePdfStore(mem.adapter, DIR);
    const bytes = pdf("lecture");
    const hash = hashPdf(bytes);
    await store.keep(hash, bytes);
    await store.keep(hash, bytes);
    expect(mem.writes()).toBe(1);
    const back = await store.read(hash);
    expect(back && hashPdf(back)).toBe(hash);
  });

  it("rewrites a copy that was cut short", async () => {
    const mem = memoryAdapter();
    const store = new AiSourcePdfStore(mem.adapter, DIR);
    const bytes = pdf("complete document");
    const hash = hashPdf(bytes);
    mem.files.set(`${DIR}/${hash}.pdf`, { data: bytes.slice(0, 5), mtime: NOW });
    expect(await store.read(hash)).toBeNull();
    await store.keep(hash, bytes);
    expect(await store.read(hash)).not.toBeNull();
  });

  it("returns nothing for a missing copy or one that is no longer that document", async () => {
    const mem = memoryAdapter();
    const store = new AiSourcePdfStore(mem.adapter, DIR);
    expect(await store.read("nope")).toBeNull();
    const bytes = pdf("original");
    const hash = hashPdf(bytes);
    await store.keep(hash, bytes);
    mem.files.set(`${DIR}/${hash}.pdf`, { data: pdf("replaced"), mtime: NOW });
    expect(await store.read(hash)).toBeNull();
  });

  it("prunes only old copies no session refers to", async () => {
    const mem = memoryAdapter();
    const writer = new AiSourcePdfStore(mem.adapter, DIR);
    const [used, oldStray, newStray] = [pdf("used"), pdf("old"), pdf("new")];
    for (const b of [used, oldStray, newStray]) await writer.keep(hashPdf(b), b);
    age(mem, hashPdf(used), PRUNE_AFTER_MS * 2);
    age(mem, hashPdf(oldStray), PRUNE_AFTER_MS * 2);
    age(mem, hashPdf(newStray), PRUNE_AFTER_MS / 2);
    // A later run on this or another device, so nothing counts as kept this run.
    const later = new AiSourcePdfStore(mem.adapter, DIR);
    expect(await later.prune(new Set([hashPdf(used)]), NOW)).toBe(1);
    expect(await later.read(hashPdf(used))).not.toBeNull();
    expect(await later.read(hashPdf(oldStray))).toBeNull();
    expect(await later.read(hashPdf(newStray))).not.toBeNull();
  });

  it("never prunes a copy kept during this run, however old its file", async () => {
    const mem = memoryAdapter();
    const store = new AiSourcePdfStore(mem.adapter, DIR);
    const bytes = pdf("attached before the session saved");
    await store.keep(hashPdf(bytes), bytes);
    age(mem, hashPdf(bytes), PRUNE_AFTER_MS * 2);
    expect(await store.prune(new Set(), NOW)).toBe(0);
  });

  it("prunes nothing before anything was kept", async () => {
    const store = new AiSourcePdfStore(memoryAdapter().adapter, DIR);
    expect(await store.prune(new Set(), NOW)).toBe(0);
  });
});
