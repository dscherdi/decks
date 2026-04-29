import type { DataAdapter } from "obsidian";
import type {
  Deck,
  DeckProfile,
  DeckWithProfile,
  ProfileTagMapping,
  Flashcard,
  FlashcardType,
  ReviewLog,
  ReviewSession,
  CustomDeck,
  CustomDeckType,
} from "./types";
import { DEFAULT_PROFILE_ID, deckWithProfile } from "./types";
import type { FilterDefinition } from "./types";
import { SQL_QUERIES } from "./schemas";
import { compileFilter } from "../services/FilterEngine";
import type { SyncData, SyncResult } from "../services/FlashcardSynchronizer";
import type {
  SqlJsValue,
  ReviewLogRow,
  CountResult,
  BacklogRow,
  DateCountRow,
  SqlRecord,
  SqlRow,
} from "./sql-types";
import type { IDatabaseService } from "./DatabaseFactory";
import { generateFlashcardId, generateCustomDeckId, generateCustomDeckCardId } from "../utils/hash";

export interface QueryConfig {
  asObject?: boolean;
}

function serializeTags(tags: string[] | undefined): string {
  if (!tags || tags.length === 0) return "";
  return tags.filter((t) => t.length > 0).join(",");
}

export abstract class BaseDatabaseService implements IDatabaseService {
  protected dbPath: string;
  protected adapter: DataAdapter;
  protected debugLog: (
    message: string,
    ...args: (string | number | object)[]
  ) => void;
  public migrationNotice: string | null = null;

  constructor(
    dbPath: string,
    adapter: DataAdapter,
    debugLog: (message: string, ...args: (string | number | object)[]) => void
  ) {
    this.dbPath = dbPath;
    this.adapter = adapter;
    this.debugLog = debugLog;
  }

  // Abstract methods to be implemented by concrete classes
  // Core abstract methods that must be implemented by subclasses
  abstract initialize(): Promise<void>;
  abstract close(): Promise<void>;
  abstract save(): Promise<void>;
  abstract executeSql(sql: string, params?: SqlJsValue[]): Promise<void>;
  abstract syncFlashcardsForDeck(
    data: SyncData,
    progressCallback?: (progress: number, message?: string) => void
  ): Promise<SyncResult>;

  // Shared business logic methods
  protected parseDeckRow(row: (string | number | null)[]): Deck {
    return {
      id: row[0] as string,
      name: row[1] as string,
      filepath: row[2] as string,
      tag: row[3] as string,
      lastReviewed: row[4] as string | null,
      profileId: row[5] as string,
      created: row[6] as string,
      modified: row[7] as string,
    };
  }

  protected parseProfileRow(row: (string | number | null)[]): DeckProfile {
    return {
      id: row[0] as string,
      name: row[1] as string,
      hasNewCardsLimitEnabled: Boolean(row[2]),
      newCardsPerDay: row[3] as number,
      hasReviewCardsLimitEnabled: Boolean(row[4]),
      reviewCardsPerDay: row[5] as number,
      headerLevel: row[6] as number,
      reviewOrder: row[7] as "due-date" | "random",
      learningSteps: (row[8] as string) ?? "1m",
      relearningSteps: (row[9] as string) ?? "10m",
      fsrs: {
        requestRetention: row[10] as number,
        profile: row[11] as "INTENSIVE" | "STANDARD",
      },
      clozeEnabled: Boolean(row[12]),
      clozeShowContext: (row[13] as "open" | "hidden") ?? "open",
      isDefault: Boolean(row[14]),
      created: row[15] as string,
      modified: row[16] as string,
    };
  }

  protected parseTagMappingRow(row: (string | number | null)[]): ProfileTagMapping {
    return {
      id: row[0] as string,
      profileId: row[1] as string,
      tag: row[2] as string,
      created: row[3] as string,
    };
  }

  protected parseCustomDeckRow(row: (string | number | null)[]): CustomDeck {
    return {
      id: row[0] as string,
      name: row[1] as string,
      deckType: (row[2] as string as CustomDeckType) ?? 'manual',
      filterDefinition: row[3] as string | null,
      lastReviewed: row[4] as string | null,
      created: row[5] as string,
      modified: row[6] as string,
    };
  }

  protected rowToFlashcard(row: (string | number | null)[]): Flashcard {
    const tagsRaw = (row[21] as string) || "";
    const tags = tagsRaw === "" ? [] : tagsRaw.split(",").filter((t) => t.length > 0);
    return {
      id: row[0] as string,
      deckId: row[1] as string,
      front: row[2] as string,
      back: row[3] as string,
      type: row[4] as FlashcardType,
      sourceFile: row[5] as string,
      contentHash: row[6] as string,
      breadcrumb: row[7] as string,
      notes: (row[8] as string) || "",
      clozeText: (row[9] as string) ?? null,
      clozeOrder: (row[10] as number) ?? null,
      state: row[11] as "new" | "review",
      dueDate: row[12] as string,
      interval: row[13] as number,
      repetitions: row[14] as number,
      difficulty: row[15] as number,
      stability: row[16] as number,
      lapses: row[17] as number,
      lastReviewed: row[18] as string | null,
      created: row[19] as string,
      modified: row[20] as string,
      tags,
    };
  }

  protected rowToReviewSession(row: (string | number | null)[]): ReviewSession {
    return {
      id: row[0] as string,
      deckId: row[1] as string,
      startedAt: row[2] as string,
      endedAt: row[3] as string | null,
      goalTotal: row[4] as number,
      doneUnique: row[5] as number,
    };
  }

  // Utility methods
  protected getCurrentTimestamp(): string {
    return new Date().toISOString();
  }

  protected getRatingLabel(rating: number): "again" | "hard" | "good" | "easy" {
    switch (rating) {
      case 1:
        return "again";
      case 2:
        return "hard";
      case 3:
        return "good";
      case 4:
        return "easy";
      default:
        return "good";
    }
  }

  // DECK OPERATIONS - Implemented using abstract SQL methods
  async createDeck(deck: Omit<Deck, "created" | "modified" | "profileId"> & { id?: string; profileId?: string }): Promise<string> {
    const now = this.getCurrentTimestamp();

    // If no profileId provided, check for tag mapping, else use DEFAULT
    let profileId = deck.profileId;
    if (!profileId) {
      const tagProfileId = await this.getProfileIdForTag(deck.tag);
      profileId = tagProfileId || DEFAULT_PROFILE_ID;
    }

    const fullDeck: Deck = {
      ...deck,
      profileId,
      created: now,
      modified: now,
    };

    await this.executeSql(SQL_QUERIES.INSERT_DECK, [
      fullDeck.id,
      fullDeck.name,
      fullDeck.filepath,
      fullDeck.tag,
      fullDeck.lastReviewed,
      fullDeck.profileId,
      fullDeck.created,
      fullDeck.modified,
    ]);

    return fullDeck.id;
  }

  async getDeckById(id: string): Promise<Deck | null> {
    const results = (await this.querySql(SQL_QUERIES.GET_DECK_BY_ID, [id])) as (
      | string
      | number
      | null
    )[][];
    return results.length > 0 ? this.parseDeckRow(results[0]) : null;
  }

  async getDeckByFilepath(filepath: string): Promise<Deck | null> {
    const results = (await this.querySql(SQL_QUERIES.GET_DECK_BY_FILEPATH, [filepath])) as (
      | string
      | number
      | null
    )[][];
    return results.length > 0 ? this.parseDeckRow(results[0]) : null;
  }

  async getDeckByTag(tag: string): Promise<Deck | null> {
    const results = (await this.querySql(SQL_QUERIES.GET_DECK_BY_TAG, [tag])) as (
      | string
      | number
      | null
    )[][];
    return results.length > 0 ? this.parseDeckRow(results[0]) : null;
  }

  async getAllDecks(): Promise<Deck[]> {
    const results = (await this.querySql(SQL_QUERIES.GET_ALL_DECKS, [])) as (
      | string
      | number
      | null
    )[][];
    return results.map((row) => this.parseDeckRow(row));
  }

  async updateDeck(id: string, updates: Partial<Deck>): Promise<void> {
    const updateFields: string[] = [];
    const params: (string | number | null)[] = [];

    if (updates.name !== undefined) {
      updateFields.push("name = ?");
      params.push(updates.name);
    }
    if (updates.filepath !== undefined) {
      updateFields.push("filepath = ?");
      params.push(updates.filepath);
    }
    if (updates.tag !== undefined) {
      updateFields.push("tag = ?");
      params.push(updates.tag);
    }
    if (updates.lastReviewed !== undefined) {
      updateFields.push("last_reviewed = ?");
      params.push(updates.lastReviewed || null);
    }
    if (updates.profileId !== undefined) {
      updateFields.push("profile_id = ?");
      params.push(updates.profileId);
    }

    updateFields.push("modified = ?");
    params.push(this.getCurrentTimestamp());
    params.push(id);

    const sql = `UPDATE decks SET ${updateFields.join(", ")} WHERE id = ?`;
    await this.executeSql(sql, params);
  }

  async updateDeckTimestamp(deckId: string): Promise<void> {
    const sql = `UPDATE decks SET modified = ? WHERE id = ?`;
    await this.executeSql(sql, [this.getCurrentTimestamp(), deckId]);
  }

  async updateDeckLastReviewed(
    deckId: string,
    timestamp: string
  ): Promise<void> {
    const sql = `UPDATE decks SET last_reviewed = ?, modified = ? WHERE id = ?`;
    await this.executeSql(sql, [timestamp, this.getCurrentTimestamp(), deckId]);
  }

  // Header level is now in the profile, not the deck
  // This method is deprecated - modify the profile instead

  async renameDeck(
    oldDeckId: string,
    newDeckId: string,
    newName: string,
    newFilepath: string
  ): Promise<void> {
    // Update deck
    const sql1 = `UPDATE decks SET id = ?, name = ?, filepath = ?, modified = ? WHERE id = ?`;
    await this.executeSql(sql1, [
      newDeckId,
      newName,
      newFilepath,
      this.getCurrentTimestamp(),
      oldDeckId,
    ]);

    // Update flashcard deck_id references
    const sql2 = `UPDATE flashcards SET deck_id = ? WHERE deck_id = ?`;
    await this.executeSql(sql2, [newDeckId, oldDeckId]);

    // Update review logs
    const sql3 = `UPDATE review_logs SET deck_id = ? WHERE deck_id = ?`;
    await this.executeSql(sql3, [newDeckId, oldDeckId]);

    // Update review sessions
    const sql4 = `UPDATE review_sessions SET deck_id = ? WHERE deck_id = ?`;
    await this.executeSql(sql4, [newDeckId, oldDeckId]);
  }

  async deleteDeck(id: string): Promise<void> {
    const sql = `DELETE FROM decks WHERE id = ?`;
    await this.executeSql(sql, [id]);
  }

  async deleteDeckByFilepath(filepath: string): Promise<void> {
    const sql = `DELETE FROM decks WHERE filepath = ?`;
    await this.executeSql(sql, [filepath]);
  }

  async getDecksByTag(tag: string): Promise<Deck[]> {
    const results = (await this.querySql(SQL_QUERIES.GET_DECKS_BY_TAG, [tag])) as (
      | string
      | number
      | null
    )[][];
    return results.map((row) => this.parseDeckRow(row));
  }

  // PROFILE OPERATIONS
  async createProfile(profile: Omit<DeckProfile, 'created' | 'modified'>): Promise<string> {
    const now = this.getCurrentTimestamp();

    // Prevent creating additional DEFAULT profiles
    if (profile.isDefault) {
      const existing = await this.getDefaultProfile();
      if (existing) {
        throw new Error('A DEFAULT profile already exists');
      }
    }

    // Check for duplicate names
    const existing = await this.getProfileByName(profile.name);
    if (existing) {
      throw new Error(`Profile with name "${profile.name}" already exists`);
    }

    await this.executeSql(SQL_QUERIES.INSERT_PROFILE, [
      profile.id,
      profile.name,
      profile.hasNewCardsLimitEnabled ? 1 : 0,
      profile.newCardsPerDay,
      profile.hasReviewCardsLimitEnabled ? 1 : 0,
      profile.reviewCardsPerDay,
      profile.headerLevel,
      profile.reviewOrder,
      profile.learningSteps ?? "1m",
      profile.relearningSteps ?? "10m",
      profile.fsrs.requestRetention,
      profile.fsrs.profile,
      profile.clozeEnabled ? 1 : 0,
      profile.clozeShowContext ?? "open",
      profile.isDefault ? 1 : 0,
      now,
      now,
    ]);

    return profile.id;
  }

  async getProfileById(id: string): Promise<DeckProfile | null> {
    const results = (await this.querySql(SQL_QUERIES.GET_PROFILE_BY_ID, [id])) as (
      | string
      | number
      | null
    )[][];
    return results.length > 0 ? this.parseProfileRow(results[0]) : null;
  }

  async getProfileByName(name: string): Promise<DeckProfile | null> {
    const results = (await this.querySql(SQL_QUERIES.GET_PROFILE_BY_NAME, [name])) as (
      | string
      | number
      | null
    )[][];
    return results.length > 0 ? this.parseProfileRow(results[0]) : null;
  }

  async getAllProfiles(): Promise<DeckProfile[]> {
    const results = (await this.querySql(SQL_QUERIES.GET_ALL_PROFILES, [])) as (
      | string
      | number
      | null
    )[][];
    return results.map((row) => this.parseProfileRow(row));
  }

  async getDefaultProfile(): Promise<DeckProfile> {
    const results = (await this.querySql(SQL_QUERIES.GET_DEFAULT_PROFILE, [])) as (
      | string
      | number
      | null
    )[][];
    if (results.length === 0) {
      throw new Error('DEFAULT profile not found in database');
    }
    return this.parseProfileRow(results[0]);
  }

  async updateProfile(id: string, updates: Partial<Omit<DeckProfile, 'id' | 'created' | 'modified' | 'isDefault'>>): Promise<void> {
    const current = await this.getProfileById(id);
    if (!current) {
      throw new Error(`Profile not found: ${id}`);
    }

    // Cannot modify DEFAULT profile name
    if (current.isDefault && updates.name && updates.name !== 'DEFAULT') {
      throw new Error('Cannot rename DEFAULT profile');
    }

    // Check for duplicate names
    if (updates.name && updates.name !== current.name) {
      const existing = await this.getProfileByName(updates.name);
      if (existing) {
        throw new Error(`Profile with name "${updates.name}" already exists`);
      }
    }

    const updated: DeckProfile = {
      ...current,
      ...updates,
      fsrs: updates.fsrs ? { ...current.fsrs, ...updates.fsrs } : current.fsrs,
    };

    await this.executeSql(SQL_QUERIES.UPDATE_PROFILE, [
      updated.name,
      updated.hasNewCardsLimitEnabled ? 1 : 0,
      updated.newCardsPerDay,
      updated.hasReviewCardsLimitEnabled ? 1 : 0,
      updated.reviewCardsPerDay,
      updated.headerLevel,
      updated.reviewOrder,
      updated.learningSteps,
      updated.relearningSteps,
      updated.fsrs.requestRetention,
      updated.fsrs.profile,
      updated.clozeEnabled ? 1 : 0,
      updated.clozeShowContext ?? "open",
      this.getCurrentTimestamp(),
      id,
    ]);
  }

  async deleteProfile(id: string): Promise<void> {
    const profile = await this.getProfileById(id);
    if (!profile) {
      throw new Error(`Profile not found: ${id}`);
    }

    if (profile.isDefault) {
      return;
    }

    // Get DEFAULT profile ID
    const defaultProfile = await this.getDefaultProfile();

    // Reset all decks using this profile to DEFAULT
    const now = this.getCurrentTimestamp();
    await this.executeSql(SQL_QUERIES.RESET_DECKS_TO_DEFAULT_PROFILE, [
      defaultProfile.id,
      now,
      id,
    ]);

    // Delete tag mappings
    await this.executeSql(SQL_QUERIES.DELETE_TAG_MAPPINGS_FOR_PROFILE, [id]);

    // Delete profile
    await this.executeSql(SQL_QUERIES.DELETE_PROFILE, [id]);
  }

  async getDeckCountForProfile(profileId: string): Promise<number> {
    const results = (await this.querySql(SQL_QUERIES.COUNT_DECKS_USING_PROFILE, [profileId])) as (
      | string
      | number
      | null
    )[][];
    if (results.length === 0) return 0;
    return (results[0][0] as number) || 0;
  }

  async getDecksByProfile(profileId: string): Promise<Deck[]> {
    const results = (await this.querySql(SQL_QUERIES.GET_DECKS_BY_PROFILE, [profileId])) as (
      | string
      | number
      | null
    )[][];
    return results.map((row) => this.parseDeckRow(row));
  }

  // PROFILE TAG MAPPING OPERATIONS
  async createTagMapping(profileId: string, tag: string): Promise<string> {
    const id = `mapping_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    const now = this.getCurrentTimestamp();

    await this.executeSql(SQL_QUERIES.INSERT_PROFILE_TAG_MAPPING, [
      id,
      profileId,
      tag,
      now,
    ]);

    return id;
  }

  async getTagMappingsForProfile(profileId: string): Promise<ProfileTagMapping[]> {
    const results = (await this.querySql(SQL_QUERIES.GET_TAG_MAPPINGS_FOR_PROFILE, [profileId])) as (
      | string
      | number
      | null
    )[][];
    return results.map((row) => this.parseTagMappingRow(row));
  }

  async getAllTagMappings(): Promise<ProfileTagMapping[]> {
    const results = (await this.querySql(SQL_QUERIES.GET_ALL_TAG_MAPPINGS)) as (
      | string
      | number
      | null
    )[][];
    return results.map((row) => this.parseTagMappingRow(row));
  }

  async getProfileIdForTag(tag: string): Promise<string | null> {
    // Get all tag mappings
    const allMappings = await this.querySql(SQL_QUERIES.GET_ALL_TAG_MAPPINGS) as (
      | string
      | number
      | null
    )[][];

    if (allMappings.length === 0) return null;

    // Find all mappings that match this tag (either exact match or parent tag)
    const matchingMappings: { profileId: string; tag: string }[] = [];

    for (const row of allMappings) {
      const mapping = this.parseTagMappingRow(row);

      // Check if the mapping tag matches the deck tag
      // Match if: exact match OR mapping tag is a parent of deck tag
      // Example: deck tag "#flashcards/math", mapping tag "#flashcards" -> matches
      // Example: deck tag "#flashcards/math", mapping tag "#flashcards/math" -> matches
      // Example: deck tag "#flashcards", mapping tag "#flashcards/math" -> does NOT match

      if (tag === mapping.tag || tag.startsWith(mapping.tag + '/')) {
        matchingMappings.push({ profileId: mapping.profileId, tag: mapping.tag });
      }
    }

    if (matchingMappings.length === 0) return null;

    // Return the most specific tag (longest tag path)
    // Sort by tag length descending, then return the first one
    matchingMappings.sort((a, b) => b.tag.length - a.tag.length);

    return matchingMappings[0].profileId;
  }

  async deleteTagMapping(id: string): Promise<void> {
    await this.executeSql(SQL_QUERIES.DELETE_TAG_MAPPING, [id]);
  }

  async applyProfileToTag(profileId: string, tag: string): Promise<number> {
    if (profileId === DEFAULT_PROFILE_ID) {
      // Remove explicit mapping so the tag inherits from its parent
      const existingMappings = await this.getAllTagMappings();
      const existing = existingMappings.find(m => m.tag === tag);
      if (existing) {
        await this.deleteTagMapping(existing.id);
      }
    } else {
      // Upsert mapping via UNIQUE(tag)
      await this.createTagMapping(profileId, tag);
    }

    const allDecks = await this.getAllDecks();
    const allMappings = await this.getAllTagMappings();
    const mappedTags = new Set(allMappings.map(m => m.tag));
    let count = 0;

    for (const deck of allDecks) {
      if (deck.tag === tag) {
        // Exact match — always update
        const resolvedProfileId = await this.getProfileIdForTag(deck.tag) || DEFAULT_PROFILE_ID;
        if (deck.profileId !== resolvedProfileId) {
          await this.updateDeck(deck.id, { profileId: resolvedProfileId });
          count++;
        }
      } else if (deck.tag.startsWith(tag + '/')) {
        // Child tag — skip if it has its own explicit tag mapping
        if (!mappedTags.has(deck.tag)) {
          const resolvedProfileId = await this.getProfileIdForTag(deck.tag) || DEFAULT_PROFILE_ID;
          if (deck.profileId !== resolvedProfileId) {
            await this.updateDeck(deck.id, { profileId: resolvedProfileId });
            count++;
          }
        }
      }
    }

    return count;
  }

  // HELPER METHODS FOR BACKWARD COMPATIBILITY
  async getDeckWithProfile(deckId: string): Promise<DeckWithProfile | null> {
    const deck = await this.getDeckById(deckId);
    if (!deck) return null;

    let profile = await this.getProfileById(deck.profileId);
    if (!profile) {
      // Profile not found - fall back to DEFAULT profile
      console.warn(`Profile ${deck.profileId} not found for deck ${deck.id}. Reverting to DEFAULT profile.`);
      profile = await this.getDefaultProfile();

      // Update deck to use DEFAULT profile
      await this.updateDeck(deck.id, { profileId: profile.id });
      deck.profileId = profile.id;
    }

    return deckWithProfile(deck, profile);
  }

  async getAllDecksWithProfiles(): Promise<DeckWithProfile[]> {
    const decks = await this.getAllDecks();
    const profiles = await this.getAllProfiles();
    const profileMap = new Map(profiles.map(p => [p.id, p]));
    const defaultProfile = await this.getDefaultProfile();

    const result: DeckWithProfile[] = [];
    for (const deck of decks) {
      let profile = profileMap.get(deck.profileId);
      if (!profile) {
        // Profile not found - fall back to DEFAULT profile
        console.warn(`Profile ${deck.profileId} not found for deck ${deck.id}. Reverting to DEFAULT profile.`);
        profile = defaultProfile;

        // Update deck to use DEFAULT profile
        await this.updateDeck(deck.id, { profileId: profile.id });
        deck.profileId = profile.id;
      }
      result.push(deckWithProfile(deck, profile));
    }
    return result;
  }

  // FLASHCARD OPERATIONS
  async createFlashcard(
    flashcard: Omit<Flashcard, "created" | "modified"> & { id?: string }
  ): Promise<void> {
    const now = this.getCurrentTimestamp();
    // Use provided ID first, then generate from front text
    const flashcardId = flashcard.id || generateFlashcardId(flashcard.front, flashcard.deckId);
    const flashcardWithId = {
      ...flashcard,
      id: flashcardId,
      created: now,
      modified: now,
    };

    const sql = `INSERT OR IGNORE INTO flashcards
                 (id, deck_id, front, back, type, source_file, content_hash, breadcrumb, notes,
                  cloze_text, cloze_order, state, due_date,
                  interval, repetitions, difficulty, stability, lapses, last_reviewed, created, modified, tags)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

    await this.executeSql(sql, [
      flashcardWithId.id,
      flashcardWithId.deckId,
      flashcardWithId.front,
      flashcardWithId.back,
      flashcardWithId.type,
      flashcardWithId.sourceFile,
      flashcardWithId.contentHash,
      flashcardWithId.breadcrumb || "",
      flashcardWithId.notes || "",
      flashcardWithId.clozeText ?? null,
      flashcardWithId.clozeOrder ?? null,
      flashcardWithId.state,
      flashcardWithId.dueDate,
      flashcardWithId.interval,
      flashcardWithId.repetitions,
      flashcardWithId.difficulty,
      flashcardWithId.stability,
      flashcardWithId.lapses,
      flashcardWithId.lastReviewed,
      flashcardWithId.created,
      flashcardWithId.modified,
      serializeTags(flashcardWithId.tags),
    ]);
  }

  async getFlashcardById(flashcardId: string): Promise<Flashcard | null> {
    const sql = `SELECT * FROM flashcards WHERE id = ?`;
    const results = (await this.querySql(sql, [flashcardId])) as (
      | string
      | number
      | null
    )[][];
    return results.length > 0 ? this.rowToFlashcard(results[0]) : null;
  }

  async getFlashcardsByDeck(deckId: string): Promise<Flashcard[]> {
    const sql = `SELECT * FROM flashcards WHERE deck_id = ? ORDER BY created`;
    const results = (await this.querySql(sql, [deckId])) as (
      | string
      | number
      | null
    )[][];
    return results.map((row: (string | number | null)[]) =>
      this.rowToFlashcard(row)
    );
  }

  async getAllFlashcards(): Promise<Flashcard[]> {
    const sql = `SELECT * FROM flashcards ORDER BY created`;
    const results = (await this.querySql(sql, [])) as (
      | string
      | number
      | null
    )[][];
    return results.map((row: (string | number | null)[]) =>
      this.rowToFlashcard(row)
    );
  }

  async getAllFlashcardTags(): Promise<string[]> {
    const sql = `SELECT DISTINCT tags FROM flashcards WHERE tags != ''`;
    const results = (await this.querySql(sql, [])) as (string | number | null)[][];
    const tagSet = new Set<string>();
    for (const row of results) {
      const tagStr = (row[0] as string) || "";
      for (const tag of tagStr.split(",")) {
        const trimmed = tag.trim();
        if (trimmed.length > 0) tagSet.add(trimmed);
      }
    }
    return Array.from(tagSet).sort();
  }

  async getDueFlashcards(deckId: string): Promise<Flashcard[]> {
    const now = this.getCurrentTimestamp();
    const sql = `SELECT * FROM flashcards WHERE deck_id = ? AND due_date <= ? ORDER BY due_date`;
    const results = (await this.querySql(sql, [deckId, now])) as (
      | string
      | number
      | null
    )[][];
    return results.map((row: (string | number | null)[]) =>
      this.rowToFlashcard(row)
    );
  }

  async getReviewableFlashcards(deckId: string): Promise<Flashcard[]> {
    const now = this.getCurrentTimestamp();
    const sql = `SELECT * FROM flashcards WHERE deck_id = ? AND (state = 'new' OR due_date <= ?) ORDER BY due_date`;
    const results = (await this.querySql(sql, [deckId, now])) as (
      | string
      | number
      | null
    )[][];
    return results.map((row: (string | number | null)[]) =>
      this.rowToFlashcard(row)
    );
  }

  async getNewCardsForReview(deckId: string): Promise<Flashcard[]> {
    const sql = `SELECT * FROM flashcards WHERE deck_id = ? AND state = 'new' ORDER BY created LIMIT 100`;
    const results = (await this.querySql(sql, [deckId])) as (
      | string
      | number
      | null
    )[][];
    return results.map((row: (string | number | null)[]) =>
      this.rowToFlashcard(row)
    );
  }

  async getReviewCardsForReview(deckId: string): Promise<Flashcard[]> {
    const now = this.getCurrentTimestamp();
    const sql = `SELECT * FROM flashcards WHERE deck_id = ? AND state = 'review' AND due_date <= ? ORDER BY due_date LIMIT 100`;
    const results = (await this.querySql(sql, [deckId, now])) as (
      | string
      | number
      | null
    )[][];
    return results.map((row: (string | number | null)[]) =>
      this.rowToFlashcard(row)
    );
  }

  async updateFlashcard(
    flashcardId: string,
    updates: Partial<Flashcard>
  ): Promise<void> {
    const updateFields: string[] = [];
    const params: (string | number | null)[] = [];

    Object.keys(updates).forEach((key) => {
      if (updates[key as keyof Flashcard] !== undefined && key !== "id") {
        if (key === "deckId") {
          updateFields.push("deck_id = ?");
        } else if (key === "sourceFile") {
          updateFields.push("source_file = ?");
        } else if (key === "contentHash") {
          updateFields.push("content_hash = ?");
        } else if (key === "dueDate") {
          updateFields.push("due_date = ?");
        } else if (key === "lastReviewed") {
          updateFields.push("last_reviewed = ?");
        } else if (key === "clozeText") {
          updateFields.push("cloze_text = ?");
        } else if (key === "clozeOrder") {
          updateFields.push("cloze_order = ?");
        } else {
          updateFields.push(`${key} = ?`);
        }
        if (key === "tags") {
          params.push(serializeTags(updates.tags));
        } else {
          params.push(updates[key as keyof Flashcard] as string | number | null ?? null);
        }
      }
    });

    updateFields.push("modified = ?");
    params.push(this.getCurrentTimestamp());
    params.push(flashcardId);

    const sql = `UPDATE flashcards SET ${updateFields.join(", ")} WHERE id = ?`;
    await this.executeSql(sql, params);
  }

  async updateFlashcardDeckIds(
    oldDeckId: string,
    newDeckId: string
  ): Promise<void> {
    const sql = `UPDATE flashcards SET deck_id = ? WHERE deck_id = ?`;
    await this.executeSql(sql, [newDeckId, oldDeckId]);
  }

  async migrateFlashcardIdentity(
    oldId: string,
    newCard: Omit<Flashcard, "created" | "modified">
  ): Promise<void> {
    const now = this.getCurrentTimestamp();

    // Update flashcard ID and content
    await this.executeSql(
      `UPDATE flashcards
             SET id = ?, front = ?, back = ?, content_hash = ?, notes = ?, tags = ?, modified = ?
             WHERE id = ?`,
      [newCard.id, newCard.front, newCard.back, newCard.contentHash, newCard.notes || "", serializeTags(newCard.tags), now, oldId]
    );

    // Migrate review_logs to new ID (critical since FK removed)
    await this.executeSql(
      `UPDATE review_logs SET flashcard_id = ? WHERE flashcard_id = ?`,
      [newCard.id, oldId]
    );
  }

  async deleteFlashcard(id: string): Promise<void> {
    const sql = `DELETE FROM flashcards WHERE id = ?`;
    await this.executeSql(sql, [id]);
  }

  async deleteFlashcardsByFile(sourceFile: string): Promise<void> {
    const sql = `DELETE FROM flashcards WHERE source_file = ?`;
    await this.executeSql(sql, [sourceFile]);
  }

  // BATCH OPERATIONS
  async batchCreateFlashcards(
    flashcards: Array<Omit<Flashcard, "created" | "modified">>
  ): Promise<void> {
    if (flashcards.length === 0) return;

    const now = this.getCurrentTimestamp();
    const sql = `INSERT OR IGNORE INTO flashcards
                 (id, deck_id, front, back, type, source_file, content_hash, breadcrumb, notes,
                  cloze_text, cloze_order, state, due_date,
                  interval, repetitions, difficulty, stability, lapses, last_reviewed, created, modified, tags)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

    for (const flashcard of flashcards) {
      await this.executeSql(sql, [
        flashcard.id,
        flashcard.deckId,
        flashcard.front,
        flashcard.back,
        flashcard.type,
        flashcard.sourceFile,
        flashcard.contentHash,
        flashcard.breadcrumb || "",
        flashcard.notes || "",
        flashcard.clozeText ?? null,
        flashcard.clozeOrder ?? null,
        flashcard.state,
        flashcard.dueDate,
        flashcard.interval,
        flashcard.repetitions,
        flashcard.difficulty,
        flashcard.stability,
        flashcard.lapses,
        flashcard.lastReviewed,
        now,
        now,
        serializeTags(flashcard.tags),
      ]);
    }
  }

  async batchUpdateFlashcards(
    updates: Array<{ id: string; updates: Partial<Flashcard> }>
  ): Promise<void> {
    if (updates.length === 0) return;

    for (const update of updates) {
      await this.updateFlashcard(update.id, update.updates);
    }
  }

  async batchDeleteFlashcards(flashcardIds: string[]): Promise<void> {
    if (flashcardIds.length === 0) return;

    const placeholders = flashcardIds.map(() => "?").join(",");
    const sql = `DELETE FROM flashcards WHERE id IN (${placeholders})`;
    await this.executeSql(sql, flashcardIds);
  }

  // COUNT OPERATIONS
  async countNewCards(deckId: string): Promise<number> {
    const sql =
      "SELECT COUNT(*) as count FROM flashcards WHERE deck_id = ? AND state = 'new'";
    const results = await this.querySql<CountResult>(sql, [deckId], {
      asObject: true,
    });
    return results[0]?.count || 0;
  }

  async countDueCards(deckId: string): Promise<number> {
    const now = this.getCurrentTimestamp();
    const sql = `SELECT COUNT(*) as count FROM flashcards WHERE deck_id = ? AND state = 'review' AND due_date <= ?`;
    const results = await this.querySql<CountResult>(sql, [deckId, now], {
      asObject: true,
    });
    return results[0]?.count || 0;
  }

  async countTotalCards(deckId: string): Promise<number> {
    const sql = "SELECT COUNT(*) as count FROM flashcards WHERE deck_id = ?";
    const results = await this.querySql<CountResult>(sql, [deckId], {
      asObject: true,
    });
    return results[0]?.count || 0;
  }

  // FORECAST OPERATIONS (optimized SQL)
  async getScheduledDueByDay(
    deckId: string,
    startDate: string,
    endDate: string
  ): Promise<{ day: string; count: number }[]> {
    const results = await this.querySql<DateCountRow>(
      SQL_QUERIES.GET_SCHEDULED_DUE_BY_DAY,
      [deckId, startDate, endDate],
      { asObject: true }
    );
    return results.map((row) => ({
      day: row.date,
      count: row.count,
    }));
  }

  async getScheduledDueByDayMulti(
    deckIds: string[],
    startDate: string,
    endDate: string
  ): Promise<{ day: string; count: number }[]> {
    if (deckIds.length === 0) return [];

    // Generate dynamic IN clause
    const placeholders = deckIds.map(() => "?").join(",");
    const sql = `
      SELECT substr(due_date,1,10) AS day, COUNT(*) AS c
      FROM flashcards
      WHERE deck_id IN (${placeholders}) AND state='review'
        AND due_date >= ? AND due_date < ?
      GROUP BY day
      ORDER BY day
    `;

    const results = await this.querySql(sql, [...deckIds, startDate, endDate], {
      asObject: true,
    });
    return results.map((row: { day: string; c: number }) => ({
      day: row.day,
      count: row.c || 0,
    }));
  }

  async getCurrentBacklog(
    deckId: string,
    currentDate: string
  ): Promise<number> {
    const results = await this.querySql<BacklogRow>(
      SQL_QUERIES.GET_CURRENT_BACKLOG,
      [deckId, currentDate],
      { asObject: true }
    );
    return results[0]?.n || 0;
  }

  async getCurrentBacklogMulti(
    deckIds: string[],
    currentDate: string
  ): Promise<number> {
    if (deckIds.length === 0) return 0;

    // Generate dynamic IN clause
    const placeholders = deckIds.map(() => "?").join(",");
    const sql = `
      SELECT COUNT(*) as n
      FROM flashcards
      WHERE deck_id IN (${placeholders}) AND state='review' AND due_date < ?
    `;

    const results = await this.querySql<BacklogRow>(
      sql,
      [...deckIds, currentDate],
      {
        asObject: true,
      }
    );
    return results[0]?.n || 0;
  }

  async getDeckReviewCountRange(
    deckId: string,
    startDate: string,
    endDate: string
  ): Promise<number> {
    const results = await this.querySql<BacklogRow>(
      SQL_QUERIES.GET_DECK_REVIEW_COUNT_RANGE,
      [deckId, startDate, endDate],
      { asObject: true }
    );
    return results[0]?.n || 0;
  }

  async countNewCardsToday(deckId: string, nextDayStartsAt = 4): Promise<number> {
    const now = new Date();
    const studyDayStart = this.getStudyDayStart(now, nextDayStartsAt);
    const studyDayEnd = this.getStudyDayEnd(now, nextDayStartsAt);

    const sql = `SELECT COUNT(DISTINCT r.flashcard_id) as count
                 FROM review_logs r
                 JOIN flashcards f ON r.flashcard_id = f.id
                 WHERE f.deck_id = ?
                   AND r.reviewed_at >= ?
                   AND r.reviewed_at < ?
                   AND r.old_state = 'new'`;
    const results = await this.querySql<CountResult>(sql, [deckId, studyDayStart, studyDayEnd], {
      asObject: true,
    });
    return results[0]?.count || 0;
  }

  async countReviewCardsToday(deckId: string, nextDayStartsAt = 4): Promise<number> {
    const now = new Date();
    const studyDayStart = this.getStudyDayStart(now, nextDayStartsAt);
    const studyDayEnd = this.getStudyDayEnd(now, nextDayStartsAt);

    const sql = `SELECT COUNT(DISTINCT r.flashcard_id) as count
                 FROM review_logs r
                 JOIN flashcards f ON r.flashcard_id = f.id
                 WHERE f.deck_id = ?
                   AND r.reviewed_at >= ?
                   AND r.reviewed_at < ?
                   AND r.old_state = 'review'`;
    const results = await this.querySql<CountResult>(sql, [deckId, studyDayStart, studyDayEnd], {
      asObject: true,
    });
    return results[0]?.count || 0;
  }

  /**
   * Calculates the start of the current Study Day in UTC
   */
  private getStudyDayStart(now: Date, nextDayStartsAt: number): string {
    const localMidnight = new Date(now);
    localMidnight.setHours(0, 0, 0, 0);

    const studyDayStart = new Date(localMidnight);
    studyDayStart.setHours(nextDayStartsAt, 0, 0, 0);

    // If current time is before the study day rollover, use previous day
    if (now < studyDayStart) {
      studyDayStart.setDate(studyDayStart.getDate() - 1);
    }

    return studyDayStart.toISOString();
  }

  /**
   * Calculates the end of the current Study Day in UTC
   */
  private getStudyDayEnd(now: Date, nextDayStartsAt: number): string {
    const start = new Date(this.getStudyDayStart(now, nextDayStartsAt));
    start.setHours(start.getHours() + 24);
    return start.toISOString();
  }

  // REVIEW LOG OPERATIONS
  async createReviewLog(log: Omit<ReviewLog, "id">): Promise<void> {
    const logId = `log_${Date.now()}_${Math.random()
      .toString(36)
      .substring(2, 11)}`;
    await this.insertReviewLog({ ...log, id: logId });
  }

  async insertReviewLog(reviewLog: ReviewLog): Promise<void> {
    // Build dynamic SQL to only include defined values
    this.debugLog("Inserting review log: ", reviewLog);
    const columns: string[] = [];
    const placeholders: string[] = [];
    const params: SqlJsValue[] = [];

    // Required fields
    const requiredFields: [string, SqlJsValue][] = [
      ["id", reviewLog.id],
      ["flashcard_id", reviewLog.flashcardId],
      ["reviewed_at", reviewLog.reviewedAt],
      ["rating", reviewLog.rating],
      ["rating_label", reviewLog.ratingLabel],
      ["old_state", reviewLog.oldState],
      ["old_repetitions", reviewLog.oldRepetitions],
      ["old_lapses", reviewLog.oldLapses],
      ["old_stability", reviewLog.oldStability],
      ["old_difficulty", reviewLog.oldDifficulty],
      ["new_state", reviewLog.newState],
      ["new_repetitions", reviewLog.newRepetitions],
      ["new_lapses", reviewLog.newLapses],
      ["new_stability", reviewLog.newStability],
      ["new_difficulty", reviewLog.newDifficulty],
      ["old_interval_minutes", reviewLog.oldIntervalMinutes],
      ["new_interval_minutes", reviewLog.newIntervalMinutes],
      ["old_due_at", reviewLog.oldDueAt],
      ["new_due_at", reviewLog.newDueAt],
      ["elapsed_days", reviewLog.elapsedDays],
      ["retrievability", reviewLog.retrievability],
      ["request_retention", reviewLog.requestRetention],
      ["profile", reviewLog.profile],
      ["maximum_interval_days", reviewLog.maximumIntervalDays],
      ["min_minutes", reviewLog.minMinutes],
      ["fsrs_weights_version", reviewLog.fsrsWeightsVersion],
      ["scheduler_version", reviewLog.schedulerVersion],
    ];

    // Optional fields - only include if defined and not null/undefined
    const optionalFields: [string, SqlJsValue][] = [
      ["last_reviewed_at", reviewLog.lastReviewedAt || null],
      ["session_id", reviewLog.sessionId || null],
      ["shown_at", reviewLog.shownAt || null],
      ["time_elapsed_ms", reviewLog.timeElapsedMs || null],
      ["note_model_id", reviewLog.noteModelId || null],
      ["card_template_id", reviewLog.cardTemplateId || null],
      ["content_hash", reviewLog.contentHash || null],
      ["client", reviewLog.client || null],
    ];

    // Add all required fields
    for (const [column, value] of requiredFields) {
      if (value === undefined) {
        this.debugLog(
          `Required field '${column}' is undefined in review log. Full log:`,
          reviewLog
        );
        throw new Error(
          `Required field '${column}' is undefined in review log`
        );
      }
      columns.push(column);
      placeholders.push("?");
      params.push(value);
    }

    // Add optional fields only if they have values
    for (const [column, value] of optionalFields) {
      if (value !== null && value !== undefined) {
        columns.push(column);
        placeholders.push("?");
        params.push(value);
      }
    }

    const sql = `INSERT INTO review_logs (${columns.join(
      ", "
    )}) VALUES (${placeholders.join(", ")})`;
    await this.querySql(sql, params as (string | number | null)[]);
  }

  async getLatestReviewLogForFlashcard(
    flashcardId: string
  ): Promise<ReviewLog | null> {
    const sql = `SELECT * FROM review_logs WHERE flashcard_id = ? ORDER BY reviewed_at DESC LIMIT 1`;
    const results = await this.querySql<ReviewLogRow>(sql, [flashcardId], {
      asObject: true,
    });

    if (results.length === 0) return null;

    const row = results[0];
    return {
      id: row.id,
      flashcardId: row.flashcard_id,
      sessionId: row.session_id || undefined,
      lastReviewedAt: row.last_reviewed_at,
      reviewedAt: row.reviewed_at,
      rating: row.rating as 1 | 2 | 3 | 4,
      ratingLabel: this.getRatingLabel(row.rating),
      timeElapsedMs: row.time_elapsed_ms,
      oldState: row.old_state as "new" | "review",
      oldRepetitions: row.old_repetitions,
      oldLapses: row.old_lapses,
      oldStability: row.old_stability,
      oldDifficulty: row.old_difficulty,
      newState: row.new_state as "new" | "review",
      newRepetitions: row.new_repetitions,
      newLapses: row.new_lapses,
      newStability: row.new_stability,
      newDifficulty: row.new_difficulty,
      oldIntervalMinutes: row.old_interval_minutes,
      newIntervalMinutes: row.new_interval_minutes,
      oldDueAt: row.old_due_at,
      newDueAt: row.new_due_at,
      elapsedDays: row.elapsed_days,
      retrievability: row.retrievability,
      requestRetention: row.request_retention,
      profile: row.profile as "INTENSIVE" | "STANDARD",
      maximumIntervalDays: row.maximum_interval_days,
      minMinutes: row.min_minutes,
      fsrsWeightsVersion: row.fsrs_weights_version,
      schedulerVersion: row.scheduler_version,
    };
  }

  async getAllReviewLogs(): Promise<ReviewLog[]> {
    const sql = `SELECT * FROM review_logs ORDER BY reviewed_at DESC`;
    const results = await this.querySql<ReviewLogRow>(sql, [], {
      asObject: true,
    });

    return results.map((row) => ({
      id: row.id,
      flashcardId: row.flashcard_id,
      sessionId: row.session_id || undefined,
      lastReviewedAt: row.last_reviewed_at,
      reviewedAt: row.reviewed_at,
      rating: row.rating as 1 | 2 | 3 | 4,
      ratingLabel: this.getRatingLabel(row.rating),
      timeElapsedMs: row.time_elapsed_ms,
      oldState: row.old_state as "new" | "review",
      oldRepetitions: row.old_repetitions,
      oldLapses: row.old_lapses,
      oldStability: row.old_stability,
      oldDifficulty: row.old_difficulty,
      newState: row.new_state as "new" | "review",
      newRepetitions: row.new_repetitions,
      newLapses: row.new_lapses,
      newStability: row.new_stability,
      newDifficulty: row.new_difficulty,
      oldIntervalMinutes: row.old_interval_minutes,
      newIntervalMinutes: row.new_interval_minutes,
      oldDueAt: row.old_due_at,
      newDueAt: row.new_due_at,
      elapsedDays: row.elapsed_days,
      retrievability: row.retrievability,
      requestRetention: row.request_retention,
      profile: row.profile as "INTENSIVE" | "STANDARD",
      maximumIntervalDays: row.maximum_interval_days,
      minMinutes: row.min_minutes,
      fsrsWeightsVersion: row.fsrs_weights_version,
      schedulerVersion: row.scheduler_version,
    }));
  }

  async reviewLogExists(reviewLogId: string): Promise<boolean> {
    const sql = `SELECT 1 as found FROM review_logs WHERE id = ? LIMIT 1`;
    const results = await this.querySql(sql, [reviewLogId], {
      asObject: true,
    });
    return results.length > 0;
  }

  // OPTIMIZED REVIEW LOG QUERIES FOR STATISTICS
  async getReviewLogsByDeck(deckId: string): Promise<ReviewLog[]> {
    const sql = `
      SELECT rl.*
      FROM review_logs rl
      JOIN flashcards f ON rl.flashcard_id = f.id
      WHERE f.deck_id = ?
      ORDER BY rl.reviewed_at DESC
    `;
    const results = await this.querySql(sql, [deckId], { asObject: true });
    return this.mapRowsToReviewLogs(results as ReviewLogRow[]);
  }

  async getReviewLogsByDecks(deckIds: string[]): Promise<ReviewLog[]> {
    if (deckIds.length === 0) return [];

    const placeholders = deckIds.map(() => "?").join(",");
    const sql = `
      SELECT rl.*
      FROM review_logs rl
      JOIN flashcards f ON rl.flashcard_id = f.id
      WHERE f.deck_id IN (${placeholders})
      ORDER BY rl.reviewed_at DESC
    `;
    const results = await this.querySql(sql, deckIds, { asObject: true });
    return this.mapRowsToReviewLogs(results as ReviewLogRow[]);
  }

  private mapRowsToReviewLogs(results: ReviewLogRow[]): ReviewLog[] {
    return results.map((row) => ({
      id: row.id,
      flashcardId: row.flashcard_id,
      sessionId: row.session_id || undefined,
      lastReviewedAt: row.last_reviewed_at,
      reviewedAt: row.reviewed_at,
      rating: row.rating as 1 | 2 | 3 | 4,
      ratingLabel: this.getRatingLabel(row.rating),
      timeElapsedMs: row.time_elapsed_ms,
      oldState: row.old_state as "new" | "review",
      oldRepetitions: row.old_repetitions,
      oldLapses: row.old_lapses,
      oldStability: row.old_stability,
      oldDifficulty: row.old_difficulty,
      newState: row.new_state as "new" | "review",
      newRepetitions: row.new_repetitions,
      newLapses: row.new_lapses,
      newStability: row.new_stability,
      newDifficulty: row.new_difficulty,
      oldIntervalMinutes: row.old_interval_minutes,
      newIntervalMinutes: row.new_interval_minutes,
      oldDueAt: row.old_due_at,
      newDueAt: row.new_due_at,
      elapsedDays: row.elapsed_days,
      retrievability: row.retrievability,
      requestRetention: row.request_retention,
      profile: row.profile as "INTENSIVE" | "STANDARD",
      maximumIntervalDays: row.maximum_interval_days,
      minMinutes: row.min_minutes,
      fsrsWeightsVersion: row.fsrs_weights_version,
      schedulerVersion: row.scheduler_version,
    }));
  }

  // REVIEW SESSION OPERATIONS
  async createReviewSession(
    session: Omit<ReviewSession, "id">
  ): Promise<string> {
    const sessionId = `session_${Date.now()}_${Math.random()
      .toString(36)
      .substring(2, 11)}`;
    await this.insertReviewSession({ ...session, id: sessionId });
    return sessionId;
  }

  async getReviewSessionById(sessionId: string): Promise<ReviewSession | null> {
    const sql = `SELECT * FROM review_sessions WHERE id = ?`;
    const results = (await this.querySql(sql, [sessionId])) as (
      | string
      | number
      | null
    )[][];
    return results.length > 0 ? this.rowToReviewSession(results[0]) : null;
  }

  async getActiveReviewSession(deckId: string): Promise<ReviewSession | null> {
    const sql = `SELECT * FROM review_sessions WHERE deck_id = ? AND ended_at IS NULL ORDER BY started_at DESC LIMIT 1`;
    const results = (await this.querySql(sql, [deckId])) as (
      | string
      | number
      | null
    )[][];
    return results.length > 0 ? this.rowToReviewSession(results[0]) : null;
  }

  async getAllReviewSessions(): Promise<ReviewSession[]> {
    const sql = `SELECT * FROM review_sessions ORDER BY started_at DESC`;
    const results = (await this.querySql(sql, [])) as (
      | string
      | number
      | null
    )[][];
    return results.map((row: (string | number | null)[]) =>
      this.rowToReviewSession(row)
    );
  }

  async updateReviewSessionDoneUnique(
    sessionId: string,
    doneUnique: number
  ): Promise<void> {
    const sql = `UPDATE review_sessions SET done_unique = ? WHERE id = ?`;
    await this.executeSql(sql, [doneUnique, sessionId]);
  }

  async endReviewSession(sessionId: string): Promise<void> {
    const sql = `UPDATE review_sessions SET ended_at = ? WHERE id = ?`;
    await this.executeSql(sql, [this.getCurrentTimestamp(), sessionId]);
  }

  async insertReviewSession(session: ReviewSession): Promise<void> {
    const sql = `INSERT INTO review_sessions (id, deck_id, started_at, ended_at, goal_total, done_unique)
                 VALUES (?, ?, ?, ?, ?, ?)`;

    await this.executeSql(sql, [
      session.id,
      session.deckId,
      session.startedAt,
      session.endedAt ?? null,
      session.goalTotal,
      session.doneUnique,
    ]);
  }

  async reviewSessionExists(sessionId: string): Promise<boolean> {
    const sql = `SELECT 1 as found FROM review_sessions WHERE id = ? LIMIT 1`;
    const results = await this.querySql(sql, [sessionId], {
      asObject: true,
    });
    return results.length > 0;
  }

  async isCardReviewedInSession(
    sessionId: string,
    flashcardId: string
  ): Promise<boolean> {
    const sql = `SELECT 1 as found FROM review_logs WHERE session_id = ? AND flashcard_id = ? LIMIT 1`;
    const results = await this.querySql(sql, [sessionId, flashcardId], {
      asObject: true,
    });
    return results.length > 0;
  }

  async getDailyReviewCounts(
    deckId: string,
    nextDayStartsAt = 4
  ): Promise<{ newCount: number; reviewCount: number }> {
    const newCount = await this.countNewCardsToday(deckId, nextDayStartsAt);
    const reviewCount = await this.countReviewCardsToday(deckId, nextDayStartsAt);

    return { newCount, reviewCount };
  }

  // UTILITY OPERATIONS
  async purgeDatabase(): Promise<void> {
    await this.executeSql("DELETE FROM review_logs");
    await this.executeSql("DELETE FROM review_sessions");
    await this.executeSql("DELETE FROM flashcards");
    await this.executeSql("DELETE FROM decks");
  }

  async resetDeckProgress(deckId: string): Promise<void> {
    const now = new Date().toISOString();
    await this.executeSql(SQL_QUERIES.DELETE_REVIEW_LOGS_FOR_DECK, [deckId]);
    await this.executeSql(SQL_QUERIES.DELETE_REVIEW_SESSIONS_FOR_DECK, [deckId]);
    await this.executeSql(SQL_QUERIES.RESET_DECK_FLASHCARDS, [now, deckId]);
  }

  async resetCustomDeckProgress(customDeckId: string): Promise<void> {
    const deck = await this.getCustomDeckById(customDeckId);
    if (!deck) return;
    const now = new Date().toISOString();

    if (deck.deckType === 'filter' && deck.filterDefinition) {
      const cardIds = await this.getFlashcardIdsForCustomDeck(customDeckId);
      if (cardIds.length === 0) return;
      const placeholders = cardIds.map(() => "?").join(", ");
      await this.executeSql(
        `DELETE FROM review_logs WHERE flashcard_id IN (${placeholders})`,
        cardIds
      );
      await this.executeSql(
        `UPDATE flashcards SET state = 'new', due_date = ?, interval = 0, repetitions = 0, difficulty = 5.0, stability = 0, lapses = 0, last_reviewed = NULL, modified = ? WHERE id IN (${placeholders})`,
        [now, now, ...cardIds]
      );
      return;
    }

    await this.executeSql(SQL_QUERIES.DELETE_REVIEW_LOGS_FOR_CUSTOM_DECK, [customDeckId]);
    await this.executeSql(SQL_QUERIES.RESET_CUSTOM_DECK_FLASHCARDS, [now, customDeckId]);
  }

  // CUSTOM DECK OPERATIONS

  async createCustomDeck(name: string, deckType: CustomDeckType = 'manual', filterDefinition: string | null = null): Promise<string> {
    const id = generateCustomDeckId(name);
    const now = new Date().toISOString();
    await this.executeSql(SQL_QUERIES.INSERT_CUSTOM_DECK, [
      id, name, deckType, filterDefinition, null, now, now,
    ]);
    return id;
  }

  async getCustomDeckById(id: string): Promise<CustomDeck | null> {
    const results = (await this.querySql(SQL_QUERIES.GET_CUSTOM_DECK_BY_ID, [id])) as (
      | string | number | null
    )[][];
    return results.length > 0 ? this.parseCustomDeckRow(results[0]) : null;
  }

  async getCustomDeckByName(name: string): Promise<CustomDeck | null> {
    const results = (await this.querySql(SQL_QUERIES.GET_CUSTOM_DECK_BY_NAME, [name])) as (
      | string | number | null
    )[][];
    return results.length > 0 ? this.parseCustomDeckRow(results[0]) : null;
  }

  async getAllCustomDecks(): Promise<CustomDeck[]> {
    const results = (await this.querySql(SQL_QUERIES.GET_ALL_CUSTOM_DECKS)) as (
      | string | number | null
    )[][];
    return results.map((row) => this.parseCustomDeckRow(row));
  }

  async updateCustomDeck(id: string, updates: { name?: string; filterDefinition?: string | null }): Promise<void> {
    const existing = await this.getCustomDeckById(id);
    if (!existing) return;
    const now = new Date().toISOString();
    await this.executeSql(SQL_QUERIES.UPDATE_CUSTOM_DECK, [
      updates.name ?? existing.name,
      updates.filterDefinition !== undefined ? updates.filterDefinition : existing.filterDefinition,
      now,
      id,
    ]);
  }

  async updateCustomDeckLastReviewed(id: string, timestamp: string): Promise<void> {
    const now = new Date().toISOString();
    await this.executeSql(SQL_QUERIES.UPDATE_CUSTOM_DECK_LAST_REVIEWED, [
      timestamp, now, id,
    ]);
  }

  async deleteCustomDeck(id: string): Promise<void> {
    await this.executeSql(SQL_QUERIES.DELETE_CUSTOM_DECK, [id]);
  }

  async addCardsToCustomDeck(customDeckId: string, flashcardIds: string[]): Promise<void> {
    const now = new Date().toISOString();
    for (const flashcardId of flashcardIds) {
      const id = generateCustomDeckCardId(customDeckId, flashcardId);
      await this.executeSql(SQL_QUERIES.INSERT_CUSTOM_DECK_CARD, [
        id, customDeckId, flashcardId, now,
      ]);
    }
  }

  async removeCardsFromCustomDeck(customDeckId: string, flashcardIds: string[]): Promise<void> {
    for (const flashcardId of flashcardIds) {
      await this.executeSql(SQL_QUERIES.DELETE_CUSTOM_DECK_CARD, [
        customDeckId, flashcardId,
      ]);
    }
  }

  async removeAllCardsFromCustomDeck(customDeckId: string): Promise<void> {
    await this.executeSql(SQL_QUERIES.DELETE_ALL_CUSTOM_DECK_CARDS, [customDeckId]);
  }

  private buildFilterQuery(filterDef: string, selectClause: string, extraWhere?: string, extraParams?: SqlJsValue[]): { sql: string; params: SqlJsValue[] } {
    const definition: FilterDefinition = JSON.parse(filterDef);
    const compiled = compileFilter(definition);
    const from = compiled.requiresDeckJoin
      ? "flashcards f JOIN decks d ON f.deck_id = d.id"
      : "flashcards f";
    const where = extraWhere
      ? `(${compiled.whereClause}) AND (${extraWhere})`
      : compiled.whereClause;
    const params = [...compiled.params, ...(extraParams ?? [])];
    return { sql: `SELECT ${selectClause} FROM ${from} WHERE ${where}`, params };
  }

  async getFlashcardsForCustomDeck(customDeckId: string): Promise<Flashcard[]> {
    const deck = await this.getCustomDeckById(customDeckId);
    if (!deck) return [];

    if (deck.deckType === 'filter' && deck.filterDefinition) {
      const { sql, params } = this.buildFilterQuery(deck.filterDefinition, "f.*", undefined, undefined);
      const results = (await this.querySql(`${sql} ORDER BY f.created`, params)) as (string | number | null)[][];
      return results.map((row) => this.rowToFlashcard(row));
    }

    const results = (await this.querySql(SQL_QUERIES.GET_FLASHCARDS_FOR_CUSTOM_DECK, [customDeckId])) as (
      | string | number | null
    )[][];
    return results.map((row) => this.rowToFlashcard(row));
  }

  async getCustomDecksForFlashcard(flashcardId: string): Promise<CustomDeck[]> {
    const results = (await this.querySql(SQL_QUERIES.GET_CUSTOM_DECKS_FOR_FLASHCARD, [flashcardId])) as (
      | string | number | null
    )[][];
    return results.map((row) => this.parseCustomDeckRow(row));
  }

  async getFlashcardIdsForCustomDeck(customDeckId: string): Promise<string[]> {
    const deck = await this.getCustomDeckById(customDeckId);
    if (!deck) return [];

    if (deck.deckType === 'filter' && deck.filterDefinition) {
      const { sql, params } = this.buildFilterQuery(deck.filterDefinition, "f.id");
      const results = (await this.querySql(sql, params)) as (string | number | null)[][];
      return results.map((row) => row[0] as string);
    }

    const results = (await this.querySql(SQL_QUERIES.GET_FLASHCARD_IDS_FOR_CUSTOM_DECK, [customDeckId])) as (
      | string | number | null
    )[][];
    return results.map((row) => row[0] as string);
  }

  async countNewCardsCustomDeck(customDeckId: string): Promise<number> {
    const deck = await this.getCustomDeckById(customDeckId);
    if (!deck) return 0;
    const now = new Date().toISOString();

    if (deck.deckType === 'filter' && deck.filterDefinition) {
      const { sql, params } = this.buildFilterQuery(
        deck.filterDefinition, "COUNT(*)", "f.state = ? AND f.due_date <= ?", ["new", now]
      );
      const results = (await this.querySql(sql, params)) as (string | number | null)[][];
      return (results[0]?.[0] as number) ?? 0;
    }

    const results = (await this.querySql(SQL_QUERIES.COUNT_NEW_CARDS_CUSTOM_DECK, [customDeckId, now])) as (
      | string | number | null
    )[][];
    return (results[0]?.[0] as number) ?? 0;
  }

  async countDueCardsCustomDeck(customDeckId: string): Promise<number> {
    const deck = await this.getCustomDeckById(customDeckId);
    if (!deck) return 0;
    const now = new Date().toISOString();

    if (deck.deckType === 'filter' && deck.filterDefinition) {
      const { sql, params } = this.buildFilterQuery(
        deck.filterDefinition, "COUNT(*)", "f.state = ? AND f.due_date <= ?", ["review", now]
      );
      const results = (await this.querySql(sql, params)) as (string | number | null)[][];
      return (results[0]?.[0] as number) ?? 0;
    }

    const results = (await this.querySql(SQL_QUERIES.COUNT_DUE_CARDS_CUSTOM_DECK, [customDeckId, now])) as (
      | string | number | null
    )[][];
    return (results[0]?.[0] as number) ?? 0;
  }

  async countTotalCardsCustomDeck(customDeckId: string): Promise<number> {
    const deck = await this.getCustomDeckById(customDeckId);
    if (!deck) return 0;

    if (deck.deckType === 'filter' && deck.filterDefinition) {
      const { sql, params } = this.buildFilterQuery(deck.filterDefinition, "COUNT(*)");
      const results = (await this.querySql(sql, params)) as (string | number | null)[][];
      return (results[0]?.[0] as number) ?? 0;
    }

    const results = (await this.querySql(SQL_QUERIES.COUNT_TOTAL_CARDS_CUSTOM_DECK, [customDeckId])) as (
      | string | number | null
    )[][];
    return (results[0]?.[0] as number) ?? 0;
  }

  async getDueCardsForCustomDeck(customDeckId: string): Promise<Flashcard[]> {
    const deck = await this.getCustomDeckById(customDeckId);
    if (!deck) return [];
    const now = new Date().toISOString();

    if (deck.deckType === 'filter' && deck.filterDefinition) {
      const { sql, params } = this.buildFilterQuery(
        deck.filterDefinition, "f.*", "f.state = ? AND f.due_date <= ?", ["review", now]
      );
      const results = (await this.querySql(`${sql} ORDER BY f.due_date ASC`, params)) as (string | number | null)[][];
      return results.map((row) => this.rowToFlashcard(row));
    }

    const results = (await this.querySql(SQL_QUERIES.GET_DUE_CARDS_FOR_CUSTOM_DECK, [customDeckId, now])) as (
      | string | number | null
    )[][];
    return results.map((row) => this.rowToFlashcard(row));
  }

  async getNewCardsForCustomDeck(customDeckId: string): Promise<Flashcard[]> {
    const deck = await this.getCustomDeckById(customDeckId);
    if (!deck) return [];
    const now = new Date().toISOString();

    if (deck.deckType === 'filter' && deck.filterDefinition) {
      const { sql, params } = this.buildFilterQuery(
        deck.filterDefinition, "f.*", "f.state = ? AND f.due_date <= ?", ["new", now]
      );
      const results = (await this.querySql(`${sql} ORDER BY f.due_date ASC`, params)) as (string | number | null)[][];
      return results.map((row) => this.rowToFlashcard(row));
    }

    const results = (await this.querySql(SQL_QUERIES.GET_NEW_CARDS_FOR_CUSTOM_DECK, [customDeckId, now])) as (
      | string | number | null
    )[][];
    return results.map((row) => this.rowToFlashcard(row));
  }

  async query(
    sql: string,
    params: SqlJsValue[] = [],
    config?: QueryConfig
  ): Promise<Record<string, SqlJsValue>[] | SqlJsValue[][]> {
    return (await this.querySql(
      sql,
      params as (string | number | null)[],
      config
    ));
  }

  // BACKUP OPERATIONS - Concrete implementations using abstract db methods
  async createBackupDatabase(backupPath: string): Promise<void> {
    try {
      // Export current database to buffer
      const data = await this.exportDatabaseToBuffer();

      // Write the SQLite database file (convert Uint8Array to ArrayBuffer)
      await this.adapter.writeBinary(
        backupPath,
        data.buffer.slice(0) as ArrayBuffer
      );

      this.debugLog(`SQLite backup created at: ${backupPath}`);
    } catch (error) {
      console.error("Failed to create backup database:", error);
      throw error;
    }
  }

  async restoreFromBackupDatabase(backupPath: string): Promise<void> {
    try {
      // Check if backup file exists
      if (!(await this.adapter.exists(backupPath))) {
        throw new Error(`Backup file not found: ${backupPath}`);
      }

      // Read the backup SQLite file
      const backupData = await this.adapter.readBinary(backupPath);

      // Restore from backup using concrete implementation
      await this.restoreFromBackupData(new Uint8Array(backupData));

      // Save the updated database
      await this.save();

      this.debugLog(`Database restored from backup: ${backupPath}`);
    } catch (error) {
      console.error("Failed to restore from backup database:", error);
      throw error;
    }
  }

  async restoreFromBackupData(backupData: Uint8Array): Promise<void> {
    // Old column names that were renamed in later schema versions
    const COLUMN_RENAMES: Record<string, string> = {
      new_due_date: "new_due_at",
      old_due_date: "old_due_at",
      new_interval: "new_interval_minutes",
      old_interval: "old_interval_minutes",
      weights_version: "fsrs_weights_version",
      time_elapsed: "time_elapsed_ms",
    };

    try {
      const backupDb = await this.createBackupDatabaseInstance(backupData);

      // Get current schema column names
      const currentLogColumns = new Set(
        (await this.querySql("PRAGMA table_info(review_logs)") as SqlJsValue[][])
          .map(row => row[1] as string)
      );
      const currentSessionColumns = new Set(
        (await this.querySql("PRAGMA table_info(review_sessions)") as SqlJsValue[][])
          .map(row => row[1] as string)
      );

      // Restore deckprofiles
      try {
        const currentProfileColumns = new Set(
          (await this.querySql("PRAGMA table_info(deckprofiles)") as SqlJsValue[][])
            .map(row => row[1] as string)
        );

        const backupProfileCols = (await this.queryBackupDatabase(
          backupDb, "PRAGMA table_info(deckprofiles)"
        )).map(row => row[1] as string);

        const profileMapping: { backupIndex: number; currentName: string }[] = [];
        for (let i = 0; i < backupProfileCols.length; i++) {
          const col = backupProfileCols[i];
          if (currentProfileColumns.has(col)) {
            profileMapping.push({ backupIndex: i, currentName: col });
          }
        }

        if (profileMapping.length > 0) {
          const profiles = await this.queryBackupDatabase(
            backupDb, "SELECT * FROM deckprofiles"
          );
          const columns = profileMapping.map(m => m.currentName);
          const placeholders = columns.map(() => "?").join(", ");
          const insertIgnoreSql = `INSERT OR IGNORE INTO deckprofiles (${columns.join(", ")}) VALUES (${placeholders})`;
          const insertReplaceSql = `INSERT OR REPLACE INTO deckprofiles (${columns.join(", ")}) VALUES (${placeholders})`;

          const isDefaultIndex = backupProfileCols.indexOf("is_default");

          for (const profile of profiles) {
            const values = profileMapping.map(m => profile[m.backupIndex]);
            const isDefault = isDefaultIndex >= 0 && Boolean(profile[isDefaultIndex]);
            await this.executeSql(isDefault ? insertIgnoreSql : insertReplaceSql, values);
          }
        }
      } catch {
        this.debugLog("Backup does not contain deckprofiles table, skipping");
      }

      // Restore profile_tag_mappings
      try {
        const currentTagMappingColumns = new Set(
          (await this.querySql("PRAGMA table_info(profile_tag_mappings)") as SqlJsValue[][])
            .map(row => row[1] as string)
        );

        const backupTagMappingCols = (await this.queryBackupDatabase(
          backupDb, "PRAGMA table_info(profile_tag_mappings)"
        )).map(row => row[1] as string);

        const tagMappingMapping: { backupIndex: number; currentName: string }[] = [];
        for (let i = 0; i < backupTagMappingCols.length; i++) {
          const col = backupTagMappingCols[i];
          if (currentTagMappingColumns.has(col)) {
            tagMappingMapping.push({ backupIndex: i, currentName: col });
          }
        }

        if (tagMappingMapping.length > 0) {
          const mappings = await this.queryBackupDatabase(
            backupDb, "SELECT * FROM profile_tag_mappings"
          );
          const columns = tagMappingMapping.map(m => m.currentName);
          const placeholders = columns.map(() => "?").join(", ");
          const insertSql = `INSERT OR REPLACE INTO profile_tag_mappings (${columns.join(", ")}) VALUES (${placeholders})`;

          for (const mapping of mappings) {
            const values = tagMappingMapping.map(m => mapping[m.backupIndex]);
            await this.executeSql(insertSql, values);
          }
        }
      } catch {
        this.debugLog("Backup does not contain profile_tag_mappings table, skipping");
      }

      // Restore review_sessions (schema is stable across versions)
      try {
        const backupSessionCols = (await this.queryBackupDatabase(
          backupDb, "PRAGMA table_info(review_sessions)"
        )).map(row => row[1] as string);

        const sessionMapping: { backupIndex: number; currentName: string }[] = [];
        for (let i = 0; i < backupSessionCols.length; i++) {
          const col = backupSessionCols[i];
          if (currentSessionColumns.has(col)) {
            sessionMapping.push({ backupIndex: i, currentName: col });
          }
        }

        if (sessionMapping.length > 0) {
          const sessions = await this.queryBackupDatabase(
            backupDb, "SELECT * FROM review_sessions"
          );
          const columns = sessionMapping.map(m => m.currentName);
          const placeholders = columns.map(() => "?").join(", ");
          const insertSql = `INSERT OR IGNORE INTO review_sessions (${columns.join(", ")}) VALUES (${placeholders})`;

          for (const session of sessions) {
            const values = sessionMapping.map(m => session[m.backupIndex]);
            await this.executeSql(insertSql, values);
          }
        }
      } catch {
        this.debugLog("Backup does not contain review_sessions table, skipping");
      }

      // Restore review_logs (handles column renames across schema versions)
      try {
        const backupLogCols = (await this.queryBackupDatabase(
          backupDb, "PRAGMA table_info(review_logs)"
        )).map(row => row[1] as string);

        const logMapping: { backupIndex: number; currentName: string }[] = [];
        for (let i = 0; i < backupLogCols.length; i++) {
          const backupCol = backupLogCols[i];
          const currentName = COLUMN_RENAMES[backupCol] ?? backupCol;
          if (currentLogColumns.has(currentName)) {
            logMapping.push({ backupIndex: i, currentName });
          }
        }

        if (logMapping.length > 0) {
          const logs = await this.queryBackupDatabase(
            backupDb, "SELECT * FROM review_logs"
          );
          const columns = logMapping.map(m => m.currentName);
          const placeholders = columns.map(() => "?").join(", ");
          const insertSql = `INSERT OR IGNORE INTO review_logs (${columns.join(", ")}) VALUES (${placeholders})`;

          for (const log of logs) {
            const values = logMapping.map(m => log[m.backupIndex]);
            await this.executeSql(insertSql, values);
          }
        }
      } catch {
        this.debugLog("Backup does not contain review_logs table, skipping");
      }

      // Restore custom_decks
      try {
        const currentCustomDeckColumns = new Set(
          (await this.querySql("PRAGMA table_info(custom_decks)") as SqlJsValue[][])
            .map(row => row[1] as string)
        );

        const backupCustomDeckCols = (await this.queryBackupDatabase(
          backupDb, "PRAGMA table_info(custom_decks)"
        )).map(row => row[1] as string);

        const customDeckMapping: { backupIndex: number; currentName: string }[] = [];
        for (let i = 0; i < backupCustomDeckCols.length; i++) {
          const col = backupCustomDeckCols[i];
          if (currentCustomDeckColumns.has(col)) {
            customDeckMapping.push({ backupIndex: i, currentName: col });
          }
        }

        if (customDeckMapping.length > 0) {
          const customDecks = await this.queryBackupDatabase(
            backupDb, "SELECT * FROM custom_decks"
          );
          const columns = customDeckMapping.map(m => m.currentName);
          const placeholders = columns.map(() => "?").join(", ");
          const insertSql = `INSERT OR REPLACE INTO custom_decks (${columns.join(", ")}) VALUES (${placeholders})`;

          for (const deck of customDecks) {
            const values = customDeckMapping.map(m => deck[m.backupIndex]);
            await this.executeSql(insertSql, values);
          }
        }
      } catch {
        this.debugLog("Backup does not contain custom_decks table, skipping");
      }

      // Restore custom_deck_cards
      try {
        const currentCardColumns = new Set(
          (await this.querySql("PRAGMA table_info(custom_deck_cards)") as SqlJsValue[][])
            .map(row => row[1] as string)
        );

        const backupCardCols = (await this.queryBackupDatabase(
          backupDb, "PRAGMA table_info(custom_deck_cards)"
        )).map(row => row[1] as string);

        const cardMapping: { backupIndex: number; currentName: string }[] = [];
        for (let i = 0; i < backupCardCols.length; i++) {
          const col = backupCardCols[i];
          if (currentCardColumns.has(col)) {
            cardMapping.push({ backupIndex: i, currentName: col });
          }
        }

        if (cardMapping.length > 0) {
          const cards = await this.queryBackupDatabase(
            backupDb, "SELECT * FROM custom_deck_cards"
          );
          const columns = cardMapping.map(m => m.currentName);
          const placeholders = columns.map(() => "?").join(", ");
          const insertSql = `INSERT OR IGNORE INTO custom_deck_cards (${columns.join(", ")}) VALUES (${placeholders})`;

          for (const card of cards) {
            const values = cardMapping.map(m => card[m.backupIndex]);
            await this.executeSql(insertSql, values);
          }
        }
      } catch {
        this.debugLog("Backup does not contain custom_deck_cards table, skipping");
      }

      await this.closeBackupDatabaseInstance(backupDb);
      this.debugLog("Database restored from backup data");
    } catch (error) {
      console.error("Failed to restore from backup data:", error);
      throw error;
    }
  }

  // Abstract methods for database-specific operations
  abstract exportDatabaseToBuffer(): Promise<Uint8Array>;
  abstract createBackupDatabaseInstance(
    backupData: Uint8Array
  ): Promise<string | object>;
  abstract queryBackupDatabase(
    backupDb: string | object,
    sql: string
  ): Promise<SqlJsValue[][]>;
  abstract closeBackupDatabaseInstance(
    backupDb: string | object
  ): Promise<void>;

  // Abstract querySql methods - implemented by concrete classes
  abstract querySql<T>(
    sql: string,
    params: SqlJsValue[],
    config: { asObject: true }
  ): Promise<T[]>;
  abstract querySql(
    sql: string,
    params?: SqlJsValue[],
    config?: { asObject?: false }
  ): Promise<SqlRow[]>;
  abstract querySql<T = SqlRecord>(
    sql: string,
    params?: SqlJsValue[],
    config?: QueryConfig
  ): Promise<T[] | SqlJsValue[][]>;

  abstract syncWithDisk(): Promise<void>;
}
