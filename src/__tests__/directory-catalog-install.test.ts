import { setRequestUrlHandler, type DataAdapter } from "obsidian";
import { I18n, directoryPackageUrl, packDpkg, type DirectoryDeckRecord } from "@decks/core";
import { DirectoryService } from "../services/DirectoryService";
import type { IDatabaseService } from "../database/DatabaseFactory";
import type { Logger } from "../utils/logging";
import { isFreshInstall } from "../utils/first-install";

async function buildPackage(slug: string, version: number): Promise<Uint8Array> {
  const { bytes } = await packDpkg({
    manifest: {
      publisher: { id: "decksmd", name: "DecksMD" },
      slug,
      version,
      title: "World capitals",
      description: "",
      language: "en",
      subject: "",
      tags: [],
      license: "",
      cardCount: 1,
      typeCounts: {},
      createdAt: "2026-10-01T00:00:00.000Z",
      generator: "test",
      decks: [{ key: "", title: "World capitals", cardCount: 1, exam: null }],
    },
    deckDb: new Uint8Array([1, 2, 3, version]),
    cardsJson: "[]",
    media: [],
  });
  return bytes;
}

function record(slug: string, version: number): DirectoryDeckRecord {
  return {
    id: `deck_dir_${slug}`,
    publisher: "decksmd",
    slug,
    version,
    title: slug,
    description: "",
    manifestJson: "{}",
    archiveSha256: "0".repeat(64),
    fileTagsByKey: {},
    importedAt: "2026-10-01T00:00:00.000Z",
    modified: "2026-10-01T00:00:00.000Z",
    removedAt: null,
  };
}

function setup(installed: DirectoryDeckRecord[] = []) {
  const imported: Uint8Array[] = [];
  const db = {
    listDirectoryDecks: jest.fn(async () => installed),
    importDirectoryPackage: jest.fn(async (bytes: Uint8Array) => {
      imported.push(bytes);
      return { decks: [] };
    }),
  } as unknown as IDatabaseService;
  const adapter = {
    exists: jest.fn(async () => true),
    list: jest.fn(async () => ({ files: [], folders: [] })),
    mkdir: jest.fn(async () => {}),
    writeBinary: jest.fn(async () => {}),
  } as unknown as DataAdapter;
  const logger = { debug: jest.fn() } as unknown as Logger;
  return { service: new DirectoryService(adapter, "Decks media", db, logger), imported };
}

function serve(slug: string, bytes: Uint8Array): void {
  setRequestUrlHandler(async ({ url }) =>
    url === directoryPackageUrl(slug)
      ? { status: 200, text: "", json: null, arrayBuffer: bytes.slice().buffer }
      : { status: 404, text: "", json: null }
  );
}

describe("adding a deck from the directory's list in the plugin", () => {
  it("downloads the free package by slug and installs it without asking", async () => {
    const { service, imported } = setup();
    const pkg = await buildPackage("capitals", 1);
    serve("capitals", pkg);
    expect(await service.addFromCatalog("capitals")).toEqual({ ok: true, title: "World capitals", updated: false });
    expect(imported).toEqual([pkg]);
  });

  it("calls it an update when the package is already installed", async () => {
    const { service } = setup([record("capitals", 1)]);
    serve("capitals", await buildPackage("capitals", 2));
    expect(await service.addFromCatalog("capitals")).toMatchObject({ ok: true, updated: true });
  });

  it("reports a failed download, and refuses a package for another deck", async () => {
    const { service, imported } = setup();
    setRequestUrlHandler(async () => ({ status: 404, text: "", json: null }));
    expect(await service.addFromCatalog("capitals")).toEqual({ ok: false, error: I18n.t.directory.downloadFailed });

    setRequestUrlHandler(async () => ({
      status: 200,
      text: "",
      json: null,
      arrayBuffer: (await buildPackage("capitals", 1)).slice().buffer,
    }));
    expect(await service.addFromCatalog("rivers")).toEqual({ ok: false, error: I18n.t.directory.invalidPackage });
    expect(imported).toEqual([]);
  });
});

describe("a fresh install", () => {
  it("is recognised by Obsidian handing over no saved settings", () => {
    expect(isFreshInstall(null)).toBe(true);
    expect(isFreshInstall(undefined)).toBe(true);
    expect(isFreshInstall({})).toBe(true);
    expect(isFreshInstall({ ui: { lastSeenVersion: "2.12.4" } })).toBe(false);
  });
});
