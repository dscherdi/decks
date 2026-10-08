import { TFile, type App } from "obsidian";
import {
  AnchorStamper,
  buildDirectoryCards,
  collectCardEmbeds,
  DEFAULT_EXAM_SETTINGS,
  carriedProfiles,
  directoryMediaMime,
  directoryPackageRef,
  isValidDirectoryPublisherId,
  isValidDirectorySlug,
  packDpkg,
  parseHeaderLevels,
  sha256Hex,
  slugifyDirectoryTitle,
  writeDpkgDeckDb,
  type DeckTemplate,
  type DeckWithProfile,
  type DirectoryCardContent,
  type DirectoryDeckContent,
  type DirectoryMediaRef,
  type DpkgMediaInput,
  type Flashcard,
  type FlashcardType,
} from "@decks/core";
import type { IDatabaseService } from "../database/DatabaseFactory";
import { loadSqlJsMainThread } from "../database/loadSqlJsMainThread";
import { ObsidianNoteAccess } from "./ObsidianNoteAccess";
import type { DirectoryExportDetails } from "../settings";

/** One deck of an export, under the key the package files it by. */
export interface DirectoryExportDeck {
  deck: DeckWithProfile;
  /** Empty when the package holds this deck alone. */
  key: string;
  title: string;
}

export interface DirectoryExportPlan {
  decks: DirectoryExportDeck[];
  cardCount: number;
  mediaCount: number;
  missingMedia: string[];
}

export interface DirectoryExportOutput {
  bytes: Uint8Array;
  cardCount: number;
  mediaCount: number;
  skipped: number;
  unresolved: string[];
  /** The keys the package used, by note path, for the next export to keep. */
  deckKeys: Record<string, string>;
}

interface ResolvedMedia {
  ref: DirectoryMediaRef;
  input: DpkgMediaInput;
}

function normalizeTag(tag: string): string {
  return tag.replace(/^#/, "").toLowerCase();
}

/** Deck names without the words they all start with: "German A1 Verbs" → "Verbs". */
function withoutSharedPrefix(names: string[]): string[] {
  const words = names.map((name) => name.trim().split(/\s+/));
  let shared = 0;
  while (words.every((list) => list.length > shared + 1 && list[shared] === words[0][shared])) shared++;
  return words.map((list) => list.slice(shared).join(" "));
}

/**
 * The decks of one export, in the given order. A key already given to a note is
 * kept; a new note's key comes from its title and never repeats another.
 */
export function planExportDecks(decks: DeckWithProfile[], saved: Record<string, string> = {}): DirectoryExportDeck[] {
  if (decks.length === 1) return [{ deck: decks[0], key: "", title: decks[0].name }];
  const titles = withoutSharedPrefix(decks.map((deck) => deck.name));
  const used = new Set<string>();
  const keys = decks.map((deck) => {
    const kept = saved[deck.filepath];
    if (kept && isValidDirectorySlug(kept) && !used.has(kept)) {
      used.add(kept);
      return kept;
    }
    return "";
  });
  return decks.map((deck, index) => {
    let key = keys[index];
    if (!key) {
      const base = slugifyDirectoryTitle(titles[index]) || "deck";
      key = base;
      for (let n = 2; used.has(key); n++) key = `${base}-${n}`;
      used.add(key);
    }
    return { deck, key, title: titles[index] || deck.name };
  });
}

/** Builds a .dpkg package from the user's own decks: one note, or every deck note of a folder. */
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
  async plan(decks: DeckWithProfile[], details: DirectoryExportDetails): Promise<DirectoryExportPlan> {
    const planned = planExportDecks(decks, details.deckKeys);
    let cardCount = 0;
    let mediaCount = 0;
    const missingMedia: string[] = [];
    for (const { deck } of planned) {
      const cards = await this.db.getFlashcardsByDeck(deck.id);
      const embeds = collectCardEmbeds(cards);
      const missing = embeds.filter((path) => !this.mediaFile(path, deck.filepath));
      cardCount += cards.length;
      mediaCount += embeds.length - missing.length;
      missingMedia.push(...missing);
    }
    return { decks: planned, cardCount, mediaCount, missingMedia };
  }

  async export(decks: DeckWithProfile[], details: DirectoryExportDetails): Promise<DirectoryExportOutput> {
    if (!isValidDirectorySlug(details.slug)) throw new Error(`"${details.slug}" is not a valid slug`);
    const publisher = details.publisher;
    if (!publisher || !isValidDirectoryPublisherId(publisher.id)) throw new Error("The package needs a publisher handle");
    const ref = directoryPackageRef(publisher.id, details.slug);
    const planned = planExportDecks(decks, details.deckKeys);
    const media = new Map<string, ResolvedMedia>();
    const packaged: DirectoryDeckContent[] = [];
    const exams = new Map<string, DeckWithProfile["profile"]>();
    const studyProfiles = new Map<string, DeckWithProfile["profile"]>();
    let skipped = 0;
    const unresolved: string[] = [];

    for (const { deck, key, title } of planned) {
      const cards = await this.db.getFlashcardsByDeck(deck.id);
      // Pin today's ids in the note, so a later export of an edited card keeps its id.
      const titleMode = parseHeaderLevels(deck.profile).includes(0);
      await new AnchorStamper(new ObsidianNoteAccess(this.app), this.db).stampFileBatch(deck.filepath, cards, titleMode);
      await this.collectMedia(cards, deck.filepath, media);

      const exam = deck.profile.examEnabled === true;
      const built = buildDirectoryCards(ref, cards, (linkpath) => media.get(linkpath)?.ref ?? null, { exam });
      skipped += built.skipped.length;
      unresolved.push(...built.unresolved);
      if (built.cards.length === 0) continue;
      if (exam) exams.set(key, deck.profile);
      studyProfiles.set(key, deck.profile);
      packaged.push({ key, name: title, fileTags: deck.fileTags ?? [], cards: built.cards });
    }
    if (packaged.length === 0) throw new Error("The decks have no cards a package can carry");
    // A deck left alone takes the package's own key, as a single-deck package does.
    if (packaged.length === 1 && packaged[0].key !== "") {
      const only = packaged[0];
      packaged[0] = { ...only, key: "" };
      const profile = exams.get(only.key);
      if (profile) exams.set("", profile);
      const studyProfile = studyProfiles.get(only.key);
      if (studyProfile) studyProfiles.set("", studyProfile);
    }

    // Each deck studies with its profile's settings, so the package carries them.
    const carried = carriedProfiles(
      packaged.flatMap((deck) => {
        const profile = studyProfiles.get(deck.key);
        return profile ? [{ key: deck.key, profile }] : [];
      })
    );

    const all = packaged.flatMap((deck) => deck.cards);
    const seen = new Set<string>();
    for (const card of all) {
      if (seen.has(card.id)) throw new Error(`The card "${card.front.slice(0, 60)}" is in two of the decks`);
      seen.add(card.id);
    }

    const templates = this.templatesFor(
      await this.db.getAllDeckTemplates(),
      all,
      packaged.flatMap((deck) => deck.fileTags)
    );
    const SQL = await loadSqlJsMainThread();
    const deckDb = new SQL.Database();
    let deckDbBytes: Uint8Array;
    try {
      writeDpkgDeckDb(deckDb, ref, { decks: packaged, templates }, new Date().toISOString());
      deckDbBytes = deckDb.export();
    } finally {
      deckDb.close();
    }

    const typeCounts: Partial<Record<FlashcardType, number>> = {};
    for (const card of all) typeCounts[card.type] = (typeCounts[card.type] ?? 0) + 1;
    const { bytes } = await packDpkg({
      manifest: {
        publisher: { id: publisher.id, name: publisher.name },
        slug: details.slug,
        version: details.version,
        title: details.title,
        description: details.description,
        language: details.language,
        subject: details.subject,
        license: details.license,
        tags: [],
        cardCount: all.length,
        typeCounts,
        createdAt: new Date().toISOString(),
        generator: this.generator,
        decks: packaged.map((deck) => {
          const profile = exams.get(deck.key);
          return {
            key: deck.key,
            title: deck.key === "" ? details.title : deck.name,
            cardCount: deck.cards.length,
            exam: profile ? (profile.examSettings ?? DEFAULT_EXAM_SETTINGS) : null,
            profile: carried.byDeck.get(deck.key) ?? null,
          };
        }),
        profiles: carried.profiles,
      },
      deckDb: deckDbBytes,
      // The website reads the cards from here, each with the deck it belongs to.
      cardsJson: JSON.stringify(packaged.flatMap((deck) => deck.cards.map((card) => ({ ...card, deckKey: deck.key })))),
      media: [...media.values()].map((entry) => entry.input),
    });
    const deckKeys: Record<string, string> = {};
    for (const { deck, key } of planned) if (key !== "") deckKeys[deck.filepath] = key;
    return { bytes, cardCount: all.length, mediaCount: media.size, skipped, unresolved, deckKeys };
  }

  private async collectMedia(cards: Flashcard[], sourcePath: string, media: Map<string, ResolvedMedia>): Promise<void> {
    for (const linkpath of collectCardEmbeds(cards)) {
      if (media.has(linkpath)) continue;
      const file = this.mediaFile(linkpath, sourcePath);
      const mime = file ? directoryMediaMime(file.extension) : null;
      if (!file || !mime) continue;
      const bytes = new Uint8Array(await this.app.vault.readBinary(file));
      const ext = file.extension.toLowerCase();
      media.set(linkpath, { ref: { sha256: await sha256Hex(bytes), ext }, input: { bytes, ext, mime } });
    }
  }

  // Templates any packaged card or a deck note's own tags could bind to.
  private templatesFor(templates: DeckTemplate[], cards: DirectoryCardContent[], fileTags: string[]): DeckTemplate[] {
    const used = new Set([...fileTags, ...cards.flatMap((card) => card.tags)].map(normalizeTag));
    return templates.filter((template) => template.tags.some((tag) => used.has(normalizeTag(tag))));
  }
}
