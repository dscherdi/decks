import { type App, TFile, arrayBufferToBase64 } from "obsidian";
import type { RefactorImage } from "@decks/core";
import type { Flashcard } from "../database/types";
import { extractSourceContext } from "./source-context";

/** A context attachment shown as a pill in the AI composer. */
export interface ContextItem {
  id: string;
  kind: "note" | "image";
  path: string;
  label: string;
}

const IMAGE_MIME: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
};

/** Image extensions we can attach as vision context. */
export const IMAGE_EXTENSIONS = Object.keys(IMAGE_MIME);

/** MIME type for an image extension, or null when unsupported. */
export function imageMime(ext: string): string | null {
  return IMAGE_MIME[ext.toLowerCase()] ?? null;
}

/** Read an image file as a base64 RefactorImage, or null if missing/unsupported. */
export async function readImageAsBase64(
  app: App,
  path: string,
): Promise<RefactorImage | null> {
  const file = app.vault.getAbstractFileByPath(path);
  if (!(file instanceof TFile)) return null;
  const mimeType = imageMime(file.extension);
  if (!mimeType) return null;
  const buffer = await app.vault.readBinary(file);
  return { mimeType, dataBase64: arrayBufferToBase64(buffer) };
}

/** Read a note's full text, or null if missing. */
export async function readNoteText(
  app: App,
  path: string,
): Promise<string | null> {
  const file = app.vault.getAbstractFileByPath(path);
  if (!(file instanceof TFile)) return null;
  return app.vault.cachedRead(file);
}

/**
 * Resolve the attached context items into the request payload: note text is
 * concatenated into `sourceContext` (the card's own note uses the windowed
 * extractor; others are read in full), and images become base64 attachments.
 */
export async function buildContextPayload(
  app: App,
  card: Flashcard,
  contexts: ContextItem[],
): Promise<{ sourceContext?: string; images: RefactorImage[] }> {
  const textParts: string[] = [];
  const images: RefactorImage[] = [];

  for (const item of contexts) {
    if (item.kind === "image") {
      const image = await readImageAsBase64(app, item.path);
      if (image) images.push(image);
      continue;
    }
    const text =
      item.path === card.sourceFile
        ? await extractSourceContext(app, card)
        : await readNoteText(app, item.path);
    if (text) textParts.push(`# ${item.label}\n${text}`);
  }

  return {
    sourceContext: textParts.length ? textParts.join("\n\n---\n\n") : undefined,
    images,
  };
}
