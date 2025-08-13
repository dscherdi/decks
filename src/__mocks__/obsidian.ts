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

  async read(file: TFile): Promise<string> {
    return this.files.get(file.path) || "";
  }

  async modify(file: TFile, content: string): Promise<void> {
    this.files.set(file.path, content);
  }

  getMarkdownFiles(): TFile[] {
    return this.markdownFiles;
  }

  getAbstractFileByPath(path: string): TFile | null {
    return this.markdownFiles.find((file) => file.path === path) || null;
  }

  // Test helper methods
  _addFile(path: string, content: string): void {
    this.files.set(path, content);
    if (path.endsWith(".md")) {
      this.markdownFiles.push(new TFile(path));
    }
  }

  _updateFileModTime(path: string, mtime: number): void {
    const file = this.markdownFiles.find((f) => f.path === path);
    if (file) {
      file.stat.mtime = mtime;
      file.stat.ctime = mtime;
    }
  }

  _clear(): void {
    this.files.clear();
    this.markdownFiles = [];
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
    console.log("Notice:", message);
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
    component: Component,
  ): void {
    el.textContent = content;
  }
}
