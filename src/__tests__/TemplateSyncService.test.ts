import { TemplateSyncService } from "../services/TemplateSyncService";
import type { IDatabaseService } from "../database/DatabaseFactory";

const { TFile } = jest.requireActual("../__mocks__/obsidian");

/** Minimal app whose vault returns a fixed file content. */
function makeApp(content: string) {
  return {
    vault: {
      read: async () => content,
      getMarkdownFiles: () => [],
    },
    metadataCache: { getFileCache: () => null },
  } as never;
}

/** Capture upsert payloads from the DB. */
function makeDb(): { db: IDatabaseService; upserts: Record<string, unknown>[] } {
  const upserts: Record<string, unknown>[] = [];
  const db = {
    upsertDeckTemplate: async (t: Record<string, unknown>) => {
      upserts.push(t);
    },
    deleteDeckTemplateByFile: async () => undefined,
  } as unknown as IDatabaseService;
  return { db, upserts };
}

describe("TemplateSyncService", () => {
  const file = new TFile("Templates/Vocab.md");

  it("reads binding tags from normal `tags` frontmatter (no decks-tags)", async () => {
    const content = [
      "---",
      "tags:",
      "  - vocab",
      "  - jp",
      "---",
      "```decks-html-front",
      "<b>{{1}}</b>",
      "```",
      "```decks-md-back",
      "{{2}}",
      "```",
    ].join("\n");
    const { db, upserts } = makeDb();
    const svc = new TemplateSyncService(makeApp(content), db, () => "Templates");

    await svc.syncFile(file);

    expect(upserts).toHaveLength(1);
    expect(upserts[0]).toMatchObject({
      sourceFile: "Templates/Vocab.md",
      tags: ["#vocab", "#jp"],
      frontTemplate: "<b>{{1}}</b>",
      frontType: "html",
      backTemplate: "{{2}}",
      backType: "md",
    });
  });

  it("supports inline array tags and a horizontal-rule template", async () => {
    const content = [
      "---",
      "tags: [grammar]",
      "---",
      "# {{1}}",
      "",
      "---",
      "",
      "{{2}}",
    ].join("\n");
    const { db, upserts } = makeDb();
    const svc = new TemplateSyncService(makeApp(content), db, () => "Templates");

    await svc.syncFile(file);

    expect(upserts[0]).toMatchObject({
      tags: ["#grammar"],
      frontTemplate: "# {{1}}",
      frontType: "md",
      backTemplate: "{{2}}",
      backType: "md",
    });
  });

  it("reads an inline/header tag (## Heading #example) with no frontmatter", async () => {
    const content = [
      "## Human Anatomy Overview  #example ",
      "",
      "| Structure | Function |",
      "| --- | --- |",
      "| Cornea | Refracts light |",
      "",
      "```decks-html-front",
      '<div style="color: #fff;">{{Structure}}</div>',
      "```",
      "```decks-html-back",
      "{{Function}}",
      "```",
    ].join("\n");
    const { db, upserts } = makeDb();
    const svc = new TemplateSyncService(makeApp(content), db, () => "Templates");

    await svc.syncFile(file);

    expect(upserts).toHaveLength(1);
    // The header tag binds; the CSS color #fff inside the codeblock is NOT a tag.
    expect(upserts[0].tags).toEqual(["#example"]);
    expect(upserts[0]).toMatchObject({ frontType: "html", backType: "html" });
  });

  it("isTemplateFile only matches markdown files under the folder", () => {
    const { db } = makeDb();
    const svc = new TemplateSyncService(makeApp(""), db, () => "Templates");
    expect(svc.isTemplateFile(new TFile("Templates/A.md"))).toBe(true);
    expect(svc.isTemplateFile(new TFile("Other/A.md"))).toBe(false);
    expect(svc.isTemplateFile(new TFile("Templates/A.canvas"))).toBe(false);
  });
});
