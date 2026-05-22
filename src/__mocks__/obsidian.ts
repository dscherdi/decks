export class TFile {
  path: string;
  name: string;
  extension: string;
  basename: string;
  stat: { mtime: number; ctime: number };

  constructor(path?: string) {
    this.path = path || "";
    this.name = (path || "").split("/").pop() || "";
    const parts = this.name.split(".");
    this.extension = parts.length > 1 ? parts.pop() || "" : "";
    this.basename = parts.join(".");
    const now = Date.now();
    this.stat = { mtime: now, ctime: now };
  }
}

export class TAbstractFile {
  path: string;
  name: string;

  constructor(path: string) {
    this.path = path;
    this.name = path.split("/").pop() || "";
  }
}

export interface CachedMetadata {
  tags?: { tag: string }[];
  frontmatter?: Record<string, any>;
}

export class Vault {
  private files: Map<string, string> = new Map();
  private markdownFiles: TFile[] = [];
  private otherFiles: TFile[] = [];

  async read(file: TFile): Promise<string> {
    return this.files.get(file.path) || "";
  }

  async modify(file: TFile, content: string): Promise<void> {
    this.files.set(file.path, content);
  }

  async process(file: TFile, fn: (data: string) => string): Promise<string> {
    const current = this.files.get(file.path) ?? "";
    const next = fn(current);
    this.files.set(file.path, next);
    return next;
  }

  getMarkdownFiles(): TFile[] {
    return this.markdownFiles;
  }

  // Returns markdown files plus any other tracked file (e.g. .canvas).
  // Mirrors Obsidian's vault.getFiles() which returns all files regardless
  // of extension.
  getFiles(): TFile[] {
    return [...this.markdownFiles, ...this.otherFiles];
  }

  getAbstractFileByPath(path: string): TFile | null {
    return (
      this.markdownFiles.find((file) => file.path === path) ||
      this.otherFiles.find((file) => file.path === path) ||
      null
    );
  }

  getAllFolders(): { path: string }[] {
    const folders = new Set<string>();
    const allPaths = [
      ...this.markdownFiles.map((f) => f.path),
      ...this.otherFiles.map((f) => f.path),
    ];
    for (const p of allPaths) {
      const parts = p.split("/");
      for (let i = 1; i < parts.length; i++) {
        folders.add(parts.slice(0, i).join("/"));
      }
    }
    return Array.from(folders).map((path) => ({ path }));
  }

  // Test helper methods
  _addFile(path: string, content: string): void {
    this.files.set(path, content);
    if (path.endsWith(".md")) {
      this.markdownFiles.push(new TFile(path));
    } else {
      this.otherFiles.push(new TFile(path));
    }
  }

  _updateFileModTime(path: string, mtime: number): void {
    const file =
      this.markdownFiles.find((f) => f.path === path) ||
      this.otherFiles.find((f) => f.path === path);
    if (file) {
      file.stat.mtime = mtime;
      file.stat.ctime = mtime;
    }
  }

  _clear(): void {
    this.files.clear();
    this.markdownFiles = [];
    this.otherFiles = [];
  }
}

export class MetadataCache {
  private cache: Map<string, CachedMetadata> = new Map();

  getFileCache(file: TFile): CachedMetadata | null {
    return this.cache.get(file.path) || null;
  }

  // Test helper methods
  _setCache(path: string, metadata: CachedMetadata): void {
    this.cache.set(path, metadata);
  }

  _clear(): void {
    this.cache.clear();
  }
}

export class Component {
  load(): void {}
  unload(): void {}
}

export class Notice {
  constructor(message: string) {
    console.debug("Notice:", message);
  }
}

export class Plugin {
  app: any;
  manifest: any;

  constructor() {
    this.app = {
      vault: new Vault(),
      metadataCache: new MetadataCache(),
    };
    this.manifest = { dir: "/" };
  }

  loadData(): Promise<any> {
    return Promise.resolve({});
  }

  saveData(data: any): Promise<void> {
    return Promise.resolve();
  }
}

export class PluginSettingTab {
  app: any;
  plugin: Plugin;
  containerEl: HTMLElement;

  constructor(app: any, plugin: Plugin) {
    this.app = app;
    this.plugin = plugin;
    this.containerEl = document.createElement("div");
  }

  display(): void {}
  hide(): void {}
}

export class Modal {
  app: any;
  contentEl: HTMLElement;

  constructor(app: any) {
    this.app = app;
    this.contentEl = document.createElement("div");
  }

  open(): void {}
  close(): void {}
}

export class ItemView {
  app: any;
  containerEl: HTMLElement;
  contentEl: HTMLElement;

  constructor(leaf: any) {
    this.containerEl = document.createElement("div");
    this.contentEl = document.createElement("div");
  }

  onOpen(): Promise<void> {
    return Promise.resolve();
  }

  onClose(): Promise<void> {
    return Promise.resolve();
  }

  getViewType(): string {
    return "";
  }

  getDisplayText(): string {
    return "";
  }

  getIcon(): string {
    return "";
  }
}

export class WorkspaceLeaf {
  view: any;

  setViewState(state: any): Promise<void> {
    return Promise.resolve();
  }

  openFile(file: TFile): Promise<void> {
    return Promise.resolve();
  }
}

export class MarkdownRenderer {
  static renderMarkdown(
    content: string,
    el: HTMLElement,
    sourcePath: string,
    component: Component
  ): void {
    el.textContent = content;
  }
}

// Return all tags from a CachedMetadata (both frontmatter and inline).
// Mirrors Obsidian's getAllTags() — used by DeckManager to discover decks.
export function getAllTags(metadata: CachedMetadata | null): string[] | null {
  if (!metadata) return null;
  const tags: string[] = [];
  if (metadata.tags) {
    for (const t of metadata.tags) {
      tags.push(t.tag.startsWith("#") ? t.tag : "#" + t.tag);
    }
  }
  const fm = metadata.frontmatter?.tags;
  if (Array.isArray(fm)) {
    for (const raw of fm) {
      if (typeof raw !== "string") continue;
      tags.push(raw.startsWith("#") ? raw : "#" + raw);
    }
  } else if (typeof fm === "string") {
    tags.push(fm.startsWith("#") ? fm : "#" + fm);
  }
  return tags;
}

// normalizePath: trims, collapses repeated slashes, and converts backslashes.
// Mirrors Obsidian's behavior closely enough for path-resolver unit tests.
export function normalizePath(path: string): string {
  if (!path) return "";
  return path
    .replace(/\\/g, "/")
    .replace(/\/{2,}/g, "/")
    .replace(/^\/+|\/+$/g, "");
}

// Tests run in Node; treat them as a Linux desktop. DeviceLocalState only
// embeds the platform prefix in deviceId strings, so this default is harmless.
export const Platform = {
  isDesktop: true,
  isMobile: false,
  isDesktopApp: true,
  isMobileApp: false,
  isIosApp: false,
  isAndroidApp: false,
  isPhone: false,
  isTablet: false,
  isMacOS: false,
  isWin: false,
  isLinux: true,
  isSafari: false,
  resourcePathPrefix: "",
};
