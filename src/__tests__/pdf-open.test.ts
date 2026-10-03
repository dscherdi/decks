import { App, TFile, WorkspaceLeaf } from "obsidian";
import { openVaultPdf } from "../utils/pdf-open";

interface OpenCall {
  file: TFile;
  state: { eState?: { subpath?: string } } | undefined;
}

function fakeApp(paths: string[], openTabs: string[] = []) {
  const files = paths.map((p) => new TFile(p));
  const opened: OpenCall[] = [];
  const leafFor = (shown: string | null) => {
    const leaf = new WorkspaceLeaf();
    leaf.openFile = (file: TFile, state?: OpenCall["state"]) => {
      opened.push({ file, state });
      return Promise.resolve();
    };
    return Object.assign(leaf, { getViewState: () => ({ state: { file: shown } }) });
  };
  const tabs = openTabs.map(leafFor);
  const newTab = leafFor(null);
  const app = {
    vault: { getAbstractFileByPath: (p: string) => files.find((f) => f.path === p) ?? null },
    workspace: {
      getLeavesOfType: (type: string) => (type === "pdf" ? tabs : []),
      getLeaf: () => newTab,
      setActiveLeaf: () => {},
    },
  } as unknown as App;
  return { app, opened, tabs, newTab };
}

describe("opening a vault PDF at a page", () => {
  it("opens the file itself, so a '#' in its name stays part of the path", async () => {
    const path = "Books/61211-04-S#1-2000099.pdf";
    const { app, opened } = fakeApp([path, "Books/61211-04-S.md"]);
    expect(await openVaultPdf(app, path, 12)).toBe(true);
    expect(opened).toHaveLength(1);
    expect(opened[0].file.path).toBe(path);
    expect(opened[0].state?.eState?.subpath).toBe("#page=12");
  });

  it("reuses a tab already showing the PDF", async () => {
    const path = "a.pdf";
    const { app, opened, tabs } = fakeApp([path], ["other.pdf", path]);
    let used: unknown = null;
    tabs[1].openFile = (file: TFile) => {
      used = tabs[1];
      opened.push({ file, state: undefined });
      return Promise.resolve();
    };
    await openVaultPdf(app, path, null);
    expect(used).toBe(tabs[1]);
  });

  it("refuses a path that is missing or not a PDF", async () => {
    const { app, opened } = fakeApp(["notes.md"]);
    expect(await openVaultPdf(app, "gone.pdf", 1)).toBe(false);
    expect(await openVaultPdf(app, "notes.md", 1)).toBe(false);
    expect(opened).toHaveLength(0);
  });
});
