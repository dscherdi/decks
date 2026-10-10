import { relocateFolder } from "../utils/relocate-folder";

/** Files by path; a folder exists while something lives under it or it was made. */
function memoryVault(files: Record<string, string>) {
  const store = new Map(Object.entries(files));
  const made = new Set<string>();
  const under = (folder: string) => [...store.keys()].filter((path) => path.startsWith(`${folder}/`));
  const isFolder = (path: string) => made.has(path) || under(path).length > 0;
  return {
    store,
    adapter: {
      exists: (path: string) => Promise.resolve(store.has(path) || isFolder(path)),
      list: (folder: string) => {
        const children = under(folder).map((path) => path.slice(folder.length + 1));
        const files = children.filter((rest) => !rest.includes("/")).map((rest) => `${folder}/${rest}`);
        const folders = [...new Set(children.filter((rest) => rest.includes("/")).map((rest) => `${folder}/${rest.split("/")[0]}`))];
        return Promise.resolve({ files, folders });
      },
      rename: (from: string, to: string) => {
        if (store.has(from)) {
          store.set(to, store.get(from) ?? "");
          store.delete(from);
        } else {
          for (const path of under(from)) {
            store.set(`${to}${path.slice(from.length)}`, store.get(path) ?? "");
            store.delete(path);
          }
          made.delete(from);
        }
        return Promise.resolve();
      },
      remove: (path: string) => {
        store.delete(path);
        return Promise.resolve();
      },
      rmdir: (path: string) => {
        if (under(path).length > 0) return Promise.reject(new Error("not empty"));
        made.delete(path);
        return Promise.resolve();
      },
      mkdir: (path: string) => {
        made.add(path);
        return Promise.resolve();
      },
    },
  };
}

const OLD = ".obsidian/plugins/decks/pdf-ocr";

describe("relocateFolder", () => {
  it("moves the whole folder, nested files included, when the new one does not exist", async () => {
    const vault = memoryVault({ [`${OLD}/a.json`]: "a", [`${OLD}/pdf1/p1.json`]: "p1" });
    expect(await relocateFolder(vault.adapter, OLD, "Decks OCR")).toBe(1);
    expect([...vault.store.keys()].sort()).toEqual(["Decks OCR/a.json", "Decks OCR/pdf1/p1.json"]);
  });

  it("merges into an existing folder, keeping files already there", async () => {
    const vault = memoryVault({
      [`${OLD}/a.json`]: "old a",
      [`${OLD}/b.json`]: "b",
      [`${OLD}/pdf1/p1.json`]: "p1",
      "Decks OCR/a.json": "new a",
    });
    expect(await relocateFolder(vault.adapter, OLD, "Decks OCR")).toBe(2);
    expect(Object.fromEntries(vault.store)).toEqual({
      "Decks OCR/a.json": "new a",
      "Decks OCR/b.json": "b",
      "Decks OCR/pdf1/p1.json": "p1",
    });
  });

  it("does nothing when there is no old folder", async () => {
    const vault = memoryVault({ "Decks OCR/a.json": "a" });
    expect(await relocateFolder(vault.adapter, OLD, "Decks OCR")).toBe(0);
    expect([...vault.store.keys()]).toEqual(["Decks OCR/a.json"]);
  });
});
