import { isDirectoryDeckPath } from "@decks/core";
import type { DirectoryService } from "./DirectoryService";

// Set once on load, so each render host needs no extra constructor argument.
let active: DirectoryService | null = null;

export function setDirectoryRenderer(service: DirectoryService | null): void {
  active = service;
}

/** Directory cards render with cached media and plain-text links; other cards are unchanged. */
export function renderableCardMarkdown(content: string, sourcePath: string): string {
  return active && isDirectoryDeckPath(sourcePath) ? active.prepareMarkdown(content) : content;
}

/** The path Obsidian resolves a card's embeds against; directory cards have none. */
export function renderSourcePath(sourcePath: string): string {
  return isDirectoryDeckPath(sourcePath) ? "" : sourcePath;
}

/** An embed in a directory card, from the media cache; undefined for any other card. */
export function directoryEmbedUrl(linkpath: string, sourcePath: string): string | null | undefined {
  if (!isDirectoryDeckPath(sourcePath)) return undefined;
  return active ? active.resolveEmbed(linkpath) : null;
}
