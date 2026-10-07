import { TFile, type App } from "obsidian";
import {
  AnchorStamper,
  buildDirectoryCards,
  collectCardEmbeds,
  directoryMediaMime,
  isValidDirectorySlug,
  packDpkg,
  parseHeaderLevels,
  sha256Hex,
  writeDpkgDeckDb,
  type DeckTemplate,
  type DeckWithProfile,
  type DirectoryMediaRef,
  type DpkgMediaInput,
  type Flashcard,
  type FlashcardType,
} from "@decks/core";
import type { IDatabaseService } from "../database/DatabaseFactory";
import { loadSqlJsMainThread } from "../database/loadSqlJsMainThread";
import { ObsidianNoteAccess } from "./ObsidianNoteAccess";
import type { DirectoryExportDetails } from "../settings";


export interface DirectoryExportPlan {
  cards: Flashcard[];
  mediaCount: number;
  missingMedia: string[];
}

export interface DirectoryExportOutput {
  bytes: Uint8Array;
  cardCount: number;
  mediaCount: number;
  skipped: number;
  unresolved: string[];
}

interface ResolvedMedia {
  ref: DirectoryMediaRef;
  input: DpkgMediaInput;
}

function normalizeTag(tag: string): string {
  return tag.replace(/^#/, "").toLowerCase();
}

/** Builds a .dpkg package from one of the user's own decks. */
export class DirectoryExporter {
  constructor(
    private app: App,
    private db: IDatabaseService,
    private generator: string
  ) {}

  private mediaFile(linkpath: string, sourcePath: string): TFile | null {
    const file = this.app.metadataCache.getFirstLinkpathDest(linkpath, sourcePath);
    return file instanceof TFile && directoryMediaMime(file.extension) ? file : null;
  }

  /** Cards and media the export would carry, before anything is written. */
  async plan(deck: DeckWithProfile): Promise<DirectoryExportPlan> {
    const cards = await this.db.getFlashcardsByDeck(deck.id);
    const embeds = collectCardEmbeds(cards);
    const missingMedia = embeds.filter((path) => !this.mediaFile(path, deck.filepath));
    return { cards, mediaCount: embeds.length - missingMedia.length, missingMedia };
  }

  async export(deck: DeckWithProfile, details: DirectoryExportDetails): Promise<DirectoryExportOutput> {
    if (!isValidDirectorySlug(details.slug)) throw new Error(`"${details.slug}" is not a valid slug`);
    const cards = await this.db.getFlashcardsByDeck(deck.id);

    // Pin today's ids in the note, so a later export of an edited card keeps its id.
    const titleMode = parseHeaderLevels(deck.profile).includes(0);
    await new AnchorStamper(new ObsidianNoteAccess(this.app), this.db).stampFileBatch(deck.filepath, cards, titleMode);

    const media = new Map<string, ResolvedMedia>();
    for (const linkpath of collectCardEmbeds(cards)) {
      const file = this.mediaFile(linkpath, deck.filepath);
      const mime = file ? directoryMediaMime(file.extension) : null;
      if (!file || !mime) continue;
      const bytes = new Uint8Array(await this.app.vault.readBinary(file));
      const ext = file.extension.toLowerCase();
      media.set(linkpath, { ref: { sha256: await sha256Hex(bytes), ext }, input: { bytes, ext, mime } });
    }

    const built = buildDirectoryCards(details.slug, cards, (linkpath) => media.get(linkpath)?.ref ?? null);
    if (built.cards.length === 0) throw new Error("The deck has no cards a package can carry");

    const SQL = await loadSqlJsMainThread();
    const deckDb = new SQL.Database();
    let deckDbBytes: Uint8Array;
    try {
      writeDpkgDeckDb(
        deckDb,
        details.slug,
        {
          name: details.title,
          fileTags: deck.fileTags ?? [],
          cards: built.cards,
          templates: this.templatesFor(await this.db.getAllDeckTemplates(), built.cards, deck.fileTags ?? []),
        },
        new Date().toISOString()
      );
      deckDbBytes = deckDb.export();
    } finally {
      deckDb.close();
    }

    const typeCounts: Partial<Record<FlashcardType, number>> = {};
    for (const card of built.cards) typeCounts[card.type] = (typeCounts[card.type] ?? 0) + 1;
    const { bytes } = await packDpkg({
      manifest: {
        ...details,
        tags: [],
        cardCount: built.cards.length,
        typeCounts,
        createdAt: new Date().toISOString(),
        generator: this.generator,
      },
      deckDb: deckDbBytes,
      cardsJson: JSON.stringify(built.cards),
      media: [...media.values()].map((entry) => entry.input),
    });
    return {
      bytes,
      cardCount: built.cards.length,
      mediaCount: media.size,
      skipped: built.skipped.length,
      unresolved: built.unresolved,
    };
  }

  // Templates any packaged card or the note's own tags could bind to.
  private templatesFor(templates: DeckTemplate[], cards: { tags: string[] }[], fileTags: string[]): DeckTemplate[] {
    const used = new Set([...fileTags, ...cards.flatMap((card) => card.tags)].map(normalizeTag));
    return templates.filter((template) => template.tags.some((tag) => used.has(normalizeTag(tag))));
  }
}
