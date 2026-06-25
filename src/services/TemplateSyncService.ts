import { App, TFile, parseYaml, parseFrontMatterTags } from "obsidian";
import { parseTemplateFile } from "@decks/core";
import type { IDatabaseService } from "../database/DatabaseFactory";
import type { Logger } from "../utils/logging";

/**
 * Watches the configured template folder and keeps the deck_templates DB cache
 * in sync with the template markdown files. Templates are bound to flashcards
 * by tag at render time, so this service only maintains the cache — it never
 * touches flashcards. All DB calls are async and run off the UI thread.
 */
export class TemplateSyncService {
  constructor(
    private app: App,
    private db: IDatabaseService,
    private getTemplateFolder: () => string,
    private logger?: Logger
  ) {}

  /** Deterministic id from the source path (hash, stable across sessions). */
  private templateId(sourceFile: string): string {
    let hash = 0;
    for (let i = 0; i < sourceFile.length; i++) {
      hash = (hash << 5) - hash + sourceFile.charCodeAt(i);
      hash = hash & hash;
    }
    return `tpl_${Math.abs(hash).toString(36)}`;
  }

  /** True when `path` is a markdown file inside the configured template folder. */
  isTemplateFile(file: TFile): boolean {
    if (file.extension !== "md") return false;
    const folder = this.getTemplateFolder().trim();
    if (!folder) return false;
    return file.path === folder || file.path.startsWith(folder + "/");
  }

  /**
   * Read the template's binding tags from its content (deterministic — avoids
   * metadataCache timing on load). Mirrors Obsidian's "file tags": frontmatter
   * `tags` PLUS inline `#tags` in the body (e.g. a `## Heading #example`). Code
   * fences are stripped first so CSS colors like `#fff` aren't treated as tags.
   * Returns normalized `#tag` strings.
   */
  private readTags(content: string): string[] {
    const out = new Set<string>();

    const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
    let body = content;
    if (fmMatch) {
      body = content.slice(fmMatch[0].length);
      try {
        const fm = parseYaml(fmMatch[1]) as Record<string, unknown> | null;
        for (const tag of (fm && parseFrontMatterTags(fm)) ?? []) out.add(tag);
      } catch {
        // ignore malformed frontmatter
      }
    }

    // Inline tags from the prose (not inside code fences).
    const prose = body.replace(/```[\s\S]*?```/g, "").replace(/~~~[\s\S]*?~~~/g, "");
    const tagRe = /(?:^|\s)#([A-Za-z][A-Za-z0-9_/-]*)/g;
    let m: RegExpExecArray | null;
    while ((m = tagRe.exec(prose)) !== null) out.add("#" + m[1]);

    return Array.from(out).filter((t) => t.length > 1);
  }

  /** Parse a template file and upsert it into the cache. */
  async syncFile(file: TFile): Promise<void> {
    try {
      const content = await this.app.vault.read(file);
      const set = parseTemplateFile(content);
      if (!set || !set.front) {
        // No usable template — drop any stale cache row for this file.
        console.debug(`[decks-templates] no template in ${file.path} (dropping)`);
        await this.db.deleteDeckTemplateByFile(file.path);
        return;
      }
      const tags = this.readTags(content);
      console.debug(`[decks-templates] sync ${file.path} tags=${JSON.stringify(tags)} front=${set.front.engine} back=${set.back?.engine ?? "-"}`);
      await this.db.upsertDeckTemplate({
        id: this.templateId(file.path),
        sourceFile: file.path,
        tags,
        frontTemplate: set.front.template,
        frontType: set.front.engine,
        backTemplate: set.back?.template ?? "",
        backType: set.back?.engine ?? "md",
        notesTemplate: set.notes?.template ?? null,
        notesType: set.notes?.engine ?? null,
      });
    } catch (error) {
      this.logger?.error?.(`Template sync failed for ${file.path}`, error);
    }
  }

  async handleDelete(path: string): Promise<void> {
    await this.db.deleteDeckTemplateByFile(path);
  }

  async handleRename(file: TFile, oldPath: string): Promise<void> {
    const wasTemplate = this.isUnderFolder(oldPath);
    const isTemplate = this.isTemplateFile(file);
    if (wasTemplate && !isTemplate) {
      await this.db.deleteDeckTemplateByFile(oldPath);
      return;
    }
    if (wasTemplate) {
      await this.db.renameDeckTemplate(
        oldPath,
        file.path,
        this.templateId(file.path)
      );
    }
    // Re-parse so tag/content edits accompanying the rename are captured.
    if (isTemplate) await this.syncFile(file);
  }

  private isUnderFolder(path: string): boolean {
    const folder = this.getTemplateFolder().trim();
    if (!folder) return false;
    return path === folder || path.startsWith(folder + "/");
  }

  /** Rebuild the whole cache from the template folder (called on load). */
  async syncAll(): Promise<void> {
    const folder = this.getTemplateFolder().trim();
    if (!folder) {
      console.debug("[decks-templates] syncAll skipped: no template folder set");
      return;
    }
    const files = this.app.vault
      .getMarkdownFiles()
      .filter((f) => this.isTemplateFile(f));
    console.debug(`[decks-templates] syncAll folder="${folder}" files=${files.length}`);
    for (const file of files) await this.syncFile(file);
  }
}
