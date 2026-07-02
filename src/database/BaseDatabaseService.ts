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
  CramSession,
  CramCard,
  CramDeckKind,
  CustomDeck,
  CustomDeckType,
  FsrsWeightSet,
  TemplateRow,
  DeckTemplate,
  TemplateFaceType,
} from "./types";
import { DEFAULT_PROFILE_ID, deckWithProfile } from "./types";
import type { FilterDefinition } from "./types";
import { generateCustomDeckCardId, generateCustomDeckId, generateFlashcardId, SQL_QUERIES, type SyncOpV1 } from "@decks/core";
import { normalizeProfile } from "@decks/core";
import { compileFilter, type FilterCompileOptions } from "@decks/core";
import type { SyncData, SyncResult } from "@decks/core";
import type {
  SqlJsValue,
  ReviewLogRow,
  CountResult,
  BacklogRow,
  DateCountRow,
  SqlRecord,
  SqlRow,
} from "@decks/core";
import type { IDatabaseService, JournalStateRow } from "./DatabaseFactory";
import type { SyncLog } from "../services/SyncLog";
import { generateOldFlashcardId } from "@decks/core";

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
  protected filterCompileOptions: FilterCompileOptions = {};
  // Sync log is injected post-construction by main.ts. When unset, CRUD
  // methods just write to the DB (tests + the early plugin-init window).
  protected syncLog: SyncLog | null = null;
  // Dirty since last save(). Set by any executeSql() (which is the only
  // mutation path on the public surface; querySql() doesn't touch this).
  // Read by main.ts's periodic snapshot timer to decide whether to call
  // save() — when nothing's dirty, a save would just rewrite the same bytes
  // to disk and trigger an unnecessary iCloud upload.
  protected dirty = false;

  constructor(
    dbPath: string,
    adapter: DataAdapter,
    debugLog: (message: string, ...args: (string | number | object)[]) => void
  ) {
    this.dbPath = dbPath;
    this.adapter = adapter;
    this.debugLog = debugLog;
  }

  setFilterCompileOptions(options: FilterCompileOptions): void {
    this.filterCompileOptions = options;
  }

  setSyncLog(syncLog: SyncLog): void {
    this.syncLog = syncLog;
  }

  isDirty(): boolean {
    return this.dirty;
  }

  /**
   * Mark the in-memory DB as having unsaved mutations. Called from
   * concrete subclasses' executeSql() (the worker forwards via message,
   * MainDatabaseService runs inline) and from save() with `false` after
   * a successful persist.
   */
  protected markDirty(value: boolean): void {
    this.dirty = value;
  }

  /**
   * Emit an op to the sync log if one is attached. Helper for CRUD methods
   * so each call site stays one line. Never throws — sync log failures
   * shouldn't break local DB writes.
   */
  protected emitSyncOp(op: SyncOpV1): void {
    if (!this.syncLog) return;
    try {
      this.syncLog.append(op);
    } catch (error) {
      this.debugLog("syncLog.append threw (continuing):", error as object);
    }
  }

  // Abstract methods to be implemented by concrete classes
  // Core abstract methods that must be implemented by subclasses
  abstract initialize(): Promise<void>;
  abstract whenReady(): Promise<void>;
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
      fileTags: this.parseJsonTags(row[9]),
    };
  }

  /** Parse a JSON-array tag column, tolerating null/blank/malformed values. */
  private parseJsonTags(value: string | number | null): string[] {
    if (typeof value !== "string" || value.trim() === "") return [];
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? (parsed as string[]) : [];
    } catch {
      return [];
    }
  }

  /** Parse the extra_header_levels JSON column into deduped valid levels (1-6). */
  private parseJsonHeaderLevels(value: string | number | null): number[] {
    if (typeof value !== "string" || value.trim() === "") return [];
    try {
      const parsed = JSON.parse(value);
      if (!Array.isArray(parsed)) return [];
      return Array.from(
        new Set(
          parsed.filter(
            (l): l is number => typeof l === "number" && l >= 1 && l <= 6
          )
        )
      );
    } catch {
      return [];
    }
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
      extraHeaderLevels: this.parseJsonHeaderLevels(row[17]),
      reviewOrder: row[7] as "due-date" | "random",
      learningSteps: (row[8] as string) ?? "1m",
      relearningSteps: (row[9] as string) ?? "10m",
      fsrs: {
        requestRetention: row[10] as number,
        profile: normalizeProfile(row[11] as string),
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
    const tagsRaw = (row[24] as string) || "";
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
      sourceNodeId: (row[11] as string) ?? null,
      edgeId: (row[12] as string) ?? null,
      hint: (row[13] as string) || "",
      state: row[14] as "new" | "review",
      dueDate: row[15] as string,
      interval: row[16] as number,
      repetitions: row[17] as number,
      difficulty: row[18] as number,
      stability: row[19] as number,
      lapses: row[20] as number,
      lastReviewed: row[21] as string | null,
      created: row[22] as string,
      modified: row[23] as string,
      tags,
      suspendedAt: (row[25] as string) ?? null,
      buriedUntil: (row[26] as string) ?? null,
      templateRow: row[27]
        ? (JSON.parse(row[27] as string) as TemplateRow)
        : null,
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

  protected rowToCramSession(row: (string | number | null)[]): CramSession {
    return {
      id: row[0] as string,
      deckKey: row[1] as string,
      deckKind: row[2] as CramDeckKind,
      startedAt: row[3] as string,
      endedAt: row[4] as string | null,
      goalTotal: row[5] as number,
      graduatedCount: row[6] as number,
      created: row[7] as string,
      modified: row[8] as string,
    };
  }

  protected rowToCramCard(row: (string | number | null)[]): CramCard {
    return {
      id: row[0] as string,
      sessionId: row[1] as string,
      flashcardId: row[2] as string,
      tempState: row[3] as CramCard["tempState"],
      tempStability: row[4] as number,
      tempDifficulty: row[5] as number,
      tempInterval: row[6] as number,
      tempDueAt: row[7] as string,
      reps: row[8] as number,
      graduatedAt: row[9] as string | null,
      created: row[10] as string,
      modified: row[11] as string,
    };
  }

  // DECK TEMPLATE CACHE OPERATIONS
  // Templates are authored as files in the template folder and synced here.
  // All paths go through executeSql/querySql, so both Worker and Main inherit.

  protected parseDeckTemplateRow(
    row: (string | number | null)[]
  ): DeckTemplate {
    const tagsRaw = (row[2] as string) || "[]";
    let tags: string[] = [];
    try {
      const parsed = JSON.parse(tagsRaw);
      if (Array.isArray(parsed)) tags = parsed as string[];
    } catch {
      tags = [];
    }
    return {
      id: row[0] as string,
      sourceFile: row[1] as string,
      tags,
      frontTemplate: (row[3] as string) || "",
      frontType: (row[4] as TemplateFaceType) || "md",
      backTemplate: (row[5] as string) || "",
      backType: (row[6] as TemplateFaceType) || "md",
      notesTemplate: (row[7] as string) ?? null,
      notesType: (row[8] as TemplateFaceType) ?? null,
      created: row[9] as string,
      modified: row[10] as string,
    };
  }

  async getAllDeckTemplates(): Promise<DeckTemplate[]> {
    const rows = (await this.querySql(
      SQL_QUERIES.GET_ALL_DECK_TEMPLATES,
      []
    )) as (string | number | null)[][];
    return rows.map((row) => this.parseDeckTemplateRow(row));
  }

  async upsertDeckTemplate(
    template: Omit<DeckTemplate, "created" | "modified">
  ): Promise<void> {
    const now = this.getCurrentTimestamp();
    await this.executeSql(SQL_QUERIES.UPSERT_DECK_TEMPLATE, [
      template.id,
      template.sourceFile,
      JSON.stringify(template.tags ?? []),
      template.frontTemplate,
      template.frontType,
      template.backTemplate,
      template.backType,
      template.notesTemplate,
      template.notesType,
      now,
      now,
    ]);
  }

  async deleteDeckTemplateByFile(sourceFile: string): Promise<void> {
    await this.executeSql(SQL_QUERIES.DELETE_DECK_TEMPLATE_BY_FILE, [sourceFile]);
  }

  async renameDeckTemplate(
    oldSourceFile: string,
    newSourceFile: string,
    newId: string
  ): Promise<void> {
    await this.executeSql(SQL_QUERIES.UPDATE_DECK_TEMPLATE_SOURCE_FILE, [
      newId,
      newSourceFile,
      this.getCurrentTimestamp(),
      oldSourceFile,
    ]);
  }

  async setDeckFileTags(deckId: string, fileTags: string[]): Promise<void> {
    await this.executeSql(SQL_QUERIES.UPDATE_DECK_FILE_TAGS, [
      JSON.stringify(fileTags ?? []),
      deckId,
    ]);
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
      JSON.stringify(profile.extraHeaderLevels ?? []),
    ]);

    this.emitSyncOp({
      o: "profile_upsert",
      p: {
        id: profile.id,
        name: profile.name,
        hasNewCardsLimitEnabled: profile.hasNewCardsLimitEnabled,
        newCardsPerDay: profile.newCardsPerDay,
        hasReviewCardsLimitEnabled: profile.hasReviewCardsLimitEnabled,
        reviewCardsPerDay: profile.reviewCardsPerDay,
        headerLevel: profile.headerLevel,
        extraHeaderLevels: profile.extraHeaderLevels ?? [],
        reviewOrder: profile.reviewOrder,
        learningSteps: profile.learningSteps ?? "1m",
        relearningSteps: profile.relearningSteps ?? "10m",
        fsrsRequestRetention: profile.fsrs.requestRetention,
        fsrsProfile: profile.fsrs.profile,
        clozeEnabled: profile.clozeEnabled,
        clozeShowContext: profile.clozeShowContext ?? "open",
        isDefault: profile.isDefault,
        created: now,
        modified: now,
      },
    });

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

    // If a field that affects MARKDOWN PARSING changed, every deck pointing
    // at this profile needs to be re-parsed (the parser interprets headers
    // and cloze syntax based on these). Other fields (FSRS retention, daily
    // limits, learning steps, review order) only affect future scheduling
    // and don't change card content; the existing mtime gate keeps all decks
    // fast-path on the next refresh.
    const parsingAffected =
      updated.headerLevel !== current.headerLevel ||
      JSON.stringify(updated.extraHeaderLevels ?? []) !==
        JSON.stringify(current.extraHeaderLevels ?? []) ||
      updated.clozeEnabled !== current.clozeEnabled;

    const modifiedAt = this.getCurrentTimestamp();
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
      JSON.stringify(updated.extraHeaderLevels ?? []),
      modifiedAt,
      id,
    ]);

    if (parsingAffected) {
      // Force every deck on this profile to re-parse on next sync.
      await this.clearLastSyncedMtimeForProfile(id);
    }

    this.emitSyncOp({
      o: "profile_upsert",
      p: {
        id,
        name: updated.name,
        hasNewCardsLimitEnabled: updated.hasNewCardsLimitEnabled,
        newCardsPerDay: updated.newCardsPerDay,
        hasReviewCardsLimitEnabled: updated.hasReviewCardsLimitEnabled,
        reviewCardsPerDay: updated.reviewCardsPerDay,
        headerLevel: updated.headerLevel,
        extraHeaderLevels: updated.extraHeaderLevels ?? [],
        reviewOrder: updated.reviewOrder,
        learningSteps: updated.learningSteps,
        relearningSteps: updated.relearningSteps,
        fsrsRequestRetention: updated.fsrs.requestRetention,
        fsrsProfile: updated.fsrs.profile,
        clozeEnabled: updated.clozeEnabled,
        clozeShowContext: updated.clozeShowContext ?? "open",
        isDefault: updated.isDefault,
        created: updated.created,
        modified: modifiedAt,
      },
    });
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

    // Soft delete tag mappings owned by this profile. Note: we emit
    // tag_mapping_delete ops below for each affected mapping so other
    // devices see the cascade rather than guessing it from the profile
    // tombstone alone.
    const ownedMappings = await this.getTagMappingsForProfile(id);
    await this.executeSql(SQL_QUERIES.DELETE_TAG_MAPPINGS_FOR_PROFILE, [now, id]);
    for (const m of ownedMappings) {
      this.emitSyncOp({ o: "tag_mapping_delete", p: { id: m.id, deletedAt: now } });
    }

    // Soft delete profile
    await this.executeSql(SQL_QUERIES.DELETE_PROFILE, [now, now, id]);
    this.emitSyncOp({ o: "profile_delete", p: { id, deletedAt: now } });
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

    this.emitSyncOp({
      o: "tag_mapping_upsert",
      p: { id, profileId, tag, created: now },
    });

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
    const now = this.getCurrentTimestamp();
    await this.executeSql(SQL_QUERIES.DELETE_TAG_MAPPING, [now, id]);
    this.emitSyncOp({ o: "tag_mapping_delete", p: { id, deletedAt: now } });
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
          // The new profile may have a different headerLevel / clozeEnabled,
          // so the cached parsed flashcards no longer reflect parsing rules.
          // Reset the mtime gate so the next sync reparses this deck.
          await this.setDeckLastSyncedMtime(deck.id, 0);
          count++;
        }
      } else if (deck.tag.startsWith(tag + '/')) {
        // Child tag — skip if it has its own explicit tag mapping
        if (!mappedTags.has(deck.tag)) {
          const resolvedProfileId = await this.getProfileIdForTag(deck.tag) || DEFAULT_PROFILE_ID;
          if (deck.profileId !== resolvedProfileId) {
            await this.updateDeck(deck.id, { profileId: resolvedProfileId });
            await this.setDeckLastSyncedMtime(deck.id, 0);
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
                  cloze_text, cloze_order, source_node_id, edge_id, hint, state, due_date,
                  interval, repetitions, difficulty, stability, lapses, last_reviewed, created, modified, tags,
                  suspended_at, buried_until)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

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
      flashcardWithId.sourceNodeId ?? null,
      flashcardWithId.edgeId ?? null,
      flashcardWithId.hint || "",
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
      flashcardWithId.suspendedAt ?? null,
      flashcardWithId.buriedUntil ?? null,
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
    const sql = `SELECT * FROM flashcards WHERE deck_id = ? AND due_date <= ?
      AND suspended_at IS NULL
      AND (buried_until IS NULL OR buried_until <= ?)
      ORDER BY due_date`;
    const results = (await this.querySql(sql, [deckId, now, now])) as (
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
    const sql = `SELECT * FROM flashcards WHERE deck_id = ? AND (state = 'new' OR due_date <= ?)
      AND suspended_at IS NULL
      AND (buried_until IS NULL OR buried_until <= ?)
      ORDER BY due_date`;
    const results = (await this.querySql(sql, [deckId, now, now])) as (
      | string
      | number
      | null
    )[][];
    return results.map((row: (string | number | null)[]) =>
      this.rowToFlashcard(row)
    );
  }

  async getNewCardsForReview(deckId: string): Promise<Flashcard[]> {
    const now = this.getCurrentTimestamp();
    const sql = `SELECT * FROM flashcards WHERE deck_id = ? AND state = 'new'
      AND suspended_at IS NULL
      AND (buried_until IS NULL OR buried_until <= ?)
      ORDER BY created LIMIT 100`;
    const results = (await this.querySql(sql, [deckId, now])) as (
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
    const sql = `SELECT * FROM flashcards WHERE deck_id = ? AND state = 'review' AND due_date <= ?
      AND suspended_at IS NULL
      AND (buried_until IS NULL OR buried_until <= ?)
      ORDER BY due_date LIMIT 100`;
    const results = (await this.querySql(sql, [deckId, now, now])) as (
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

    // `modified` is auto-stamped to "now" UNLESS the caller passed an
    // explicit value (e.g. the sync-log rate handler sets it to the source
    // device's reviewedAt so the modified-match guard in rate_undo works).
    const callerProvidedModified = updates.modified !== undefined;

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
        } else if (key === "sourceNodeId") {
          updateFields.push("source_node_id = ?");
        } else if (key === "edgeId") {
          updateFields.push("edge_id = ?");
        } else if (key === "suspendedAt") {
          updateFields.push("suspended_at = ?");
        } else if (key === "buriedUntil") {
          updateFields.push("buried_until = ?");
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

    if (!callerProvidedModified) {
      updateFields.push("modified = ?");
      params.push(this.getCurrentTimestamp());
    }
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
                  cloze_text, cloze_order, source_node_id, edge_id, hint, state, due_date,
                  interval, repetitions, difficulty, stability, lapses, last_reviewed, created, modified, tags,
                  suspended_at, buried_until)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

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
        flashcard.sourceNodeId ?? null,
        flashcard.edgeId ?? null,
        flashcard.hint || "",
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
        flashcard.suspendedAt ?? null,
        flashcard.buriedUntil ?? null,
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

  // COUNT OPERATIONS. Queue counts exclude suspended + actively-buried cards;
  // total/maturity counts (countTotalCards, GET_CARD_STATS) include them.
  async countNewCards(deckId: string): Promise<number> {
    const now = this.getCurrentTimestamp();
    const sql =
      `SELECT COUNT(*) as count FROM flashcards WHERE deck_id = ? AND state = 'new'
       AND suspended_at IS NULL
       AND (buried_until IS NULL OR buried_until <= ?)`;
    const results = await this.querySql<CountResult>(sql, [deckId, now], {
      asObject: true,
    });
    return results[0]?.count || 0;
  }

  async countDueCards(deckId: string): Promise<number> {
    const now = this.getCurrentTimestamp();
    const sql = `SELECT COUNT(*) as count FROM flashcards WHERE deck_id = ? AND state = 'review' AND due_date <= ?
      AND suspended_at IS NULL
      AND (buried_until IS NULL OR buried_until <= ?)`;
    const results = await this.querySql<CountResult>(sql, [deckId, now, now], {
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

  // Total cards across all decks in one query.
  async countAllCards(): Promise<number> {
    const results = await this.querySql<CountResult>(
      "SELECT COUNT(*) as count FROM flashcards",
      [],
      { asObject: true }
    );
    return results[0]?.count || 0;
  }

  // Mature = review state with interval > 21 days (30240 min).
  async countMatureCards(deckId: string): Promise<number> {
    const results = await this.querySql<CountResult>(
      "SELECT COUNT(*) as count FROM flashcards WHERE deck_id = ? AND state = 'review' AND interval > 30240",
      [deckId],
      { asObject: true }
    );
    return results[0]?.count || 0;
  }

  // Per-deck card counts (total / new / due / mature) for ALL decks in a single
  // grouped query — the batched equivalent of countTotalCards + countNewCards +
  // countDueCards + countMatureCards run per deck. Predicates mirror those
  // methods exactly (queue counts exclude suspended/actively-buried cards).
  async getDeckCardStatsBatch(): Promise<
    { deckId: string; total: number; newCount: number; dueCount: number; matureCount: number }[]
  > {
    const now = this.getCurrentTimestamp();
    const sql = `
      SELECT deck_id,
        COUNT(*) AS total,
        SUM(CASE WHEN state = 'new' AND suspended_at IS NULL
                 AND (buried_until IS NULL OR buried_until <= ?) THEN 1 ELSE 0 END) AS new_count,
        SUM(CASE WHEN state = 'review' AND due_date <= ? AND suspended_at IS NULL
                 AND (buried_until IS NULL OR buried_until <= ?) THEN 1 ELSE 0 END) AS due_count,
        SUM(CASE WHEN state = 'review' AND interval > 30240 THEN 1 ELSE 0 END) AS mature_count
      FROM flashcards
      GROUP BY deck_id`;
    const rows = await this.querySql<{
      deck_id: string;
      total: number;
      new_count: number;
      due_count: number;
      mature_count: number;
    }>(sql, [now, now, now], { asObject: true });
    return rows.map((r) => ({
      deckId: r.deck_id,
      total: r.total ?? 0,
      newCount: r.new_count ?? 0,
      dueCount: r.due_count ?? 0,
      matureCount: r.mature_count ?? 0,
    }));
  }

  // Per-deck "studied today" counts (distinct new / review cards) for ALL decks
  // in a single grouped query — the batched equivalent of getDailyReviewCounts.
  async getDailyReviewCountsBatch(
    nextDayStartsAt = 4
  ): Promise<{ deckId: string; newCount: number; reviewCount: number }[]> {
    const now = new Date();
    const studyDayStart = this.getStudyDayStart(now, nextDayStartsAt);
    const studyDayEnd = this.getStudyDayEnd(now, nextDayStartsAt);
    const sql = `
      SELECT f.deck_id,
        COUNT(DISTINCT CASE WHEN r.old_state = 'new' THEN r.flashcard_id END) AS new_count,
        COUNT(DISTINCT CASE WHEN r.old_state = 'review' THEN r.flashcard_id END) AS review_count
      FROM review_logs r
      JOIN flashcards f ON r.flashcard_id = f.id
      WHERE r.reviewed_at >= ? AND r.reviewed_at < ?
      GROUP BY f.deck_id`;
    const rows = await this.querySql<{
      deck_id: string;
      new_count: number;
      review_count: number;
    }>(sql, [studyDayStart, studyDayEnd], { asObject: true });
    return rows.map((r) => ({
      deckId: r.deck_id,
      newCount: r.new_count ?? 0,
      reviewCount: r.review_count ?? 0,
    }));
  }

  // FORECAST OPERATIONS (optimized SQL)
  async getScheduledDueByDay(
    deckId: string,
    startDate: string,
    endDate: string
  ): Promise<{ day: string; count: number }[]> {
    const now = this.getCurrentTimestamp();
    const results = await this.querySql<DateCountRow>(
      SQL_QUERIES.GET_SCHEDULED_DUE_BY_DAY,
      [deckId, startDate, endDate, now],
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

    const now = this.getCurrentTimestamp();
    const placeholders = deckIds.map(() => "?").join(",");
    const sql = `
      SELECT substr(due_date,1,10) AS day, COUNT(*) AS c
      FROM flashcards
      WHERE deck_id IN (${placeholders}) AND state='review'
        AND due_date >= ? AND due_date < ?
        AND suspended_at IS NULL
        AND (buried_until IS NULL OR buried_until <= ?)
      GROUP BY day
      ORDER BY day
    `;

    const results = await this.querySql(sql, [...deckIds, startDate, endDate, now], {
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
      [deckId, currentDate, currentDate],
      { asObject: true }
    );
    return results[0]?.n || 0;
  }

  async getCurrentBacklogMulti(
    deckIds: string[],
    currentDate: string
  ): Promise<number> {
    if (deckIds.length === 0) return 0;

    const placeholders = deckIds.map(() => "?").join(",");
    const sql = `
      SELECT COUNT(*) as n
      FROM flashcards
      WHERE deck_id IN (${placeholders}) AND state='review' AND due_date < ?
        AND suspended_at IS NULL
        AND (buried_until IS NULL OR buried_until <= ?)
    `;

    const results = await this.querySql<BacklogRow>(
      sql,
      [...deckIds, currentDate, currentDate],
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

  async countCardsStudiedTodayAllDecks(nextDayStartsAt = 4): Promise<number> {
    const now = new Date();
    const studyDayStart = this.getStudyDayStart(now, nextDayStartsAt);
    const studyDayEnd = this.getStudyDayEnd(now, nextDayStartsAt);

    // Distinct cards studied today across all decks — both new (first study,
    // old_state 'new') and review cards — for the global daily cap.
    const sql = `SELECT COUNT(DISTINCT flashcard_id) as count
                 FROM review_logs
                 WHERE reviewed_at >= ?
                   AND reviewed_at < ?
                   AND old_state IN ('new', 'review')`;
    const results = await this.querySql<CountResult>(sql, [studyDayStart, studyDayEnd], {
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
      ["fsrs_weight_set_id", reviewLog.fsrsWeightSetId || null],
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
    await this.querySql(sql, params);
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
      profile: row.profile as "INTENSIVE" | "STANDARD" | "TRAINED",
      maximumIntervalDays: row.maximum_interval_days,
      minMinutes: row.min_minutes,
      fsrsWeightsVersion: row.fsrs_weights_version,
      schedulerVersion: row.scheduler_version,
      fsrsWeightSetId: row.fsrs_weight_set_id ?? null,
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
      profile: row.profile as "INTENSIVE" | "STANDARD" | "TRAINED",
      maximumIntervalDays: row.maximum_interval_days,
      minMinutes: row.min_minutes,
      fsrsWeightsVersion: row.fsrs_weights_version,
      schedulerVersion: row.scheduler_version,
      fsrsWeightSetId: row.fsrs_weight_set_id ?? null,
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

  /**
   * Every review log, used by the global FSRS weight optimizer. All profiles feed
   * training — STANDARD, the user's TRAINED reviews (iterative self-improvement), and
   * legacy INTENSIVE-era rows, which are valid observations now that the sub-day weight
   * overrides are gone.
   *
   * Returns oldest-first ordering for chronological replay.
   */
  async getReviewLogsForTraining(): Promise<ReviewLog[]> {
    const sql = `
      SELECT *
      FROM review_logs
      ORDER BY reviewed_at ASC
    `;
    const results = await this.querySql(sql, [], { asObject: true });
    return this.mapRowsToReviewLogs(results as ReviewLogRow[]);
  }

  // ---- Trained FSRS weight sets ------------------------------------------

  private parseWeightSetRow(row: SqlRecord): FsrsWeightSet {
    let weights: number[] = [];
    try {
      const parsed = JSON.parse(String(row.weights));
      if (Array.isArray(parsed)) weights = parsed as number[];
    } catch {
      weights = [];
    }
    return {
      id: row.id as string,
      weights,
      trainedAt: row.trained_at as string,
      reviewsTrained: (row.reviews_trained as number) ?? 0,
      cardsTrained: (row.cards_trained as number) ?? 0,
      beforeLogLoss: (row.before_log_loss as number | null) ?? null,
      afterLogLoss: (row.after_log_loss as number | null) ?? null,
      steps: (row.steps as number) ?? 0,
      durationMs: (row.duration_ms as number) ?? 0,
      weightsVersion: (row.weights_version as string) ?? "fsrs-6",
      created: row.created as string,
      modified: row.modified as string,
      deletedAt: (row.deleted_at as string | null) ?? null,
    };
  }

  /**
   * Persist a trained weight set as a new (immutable) history row and return its id.
   * The active set is always the newest live row, so inserting one makes it active.
   */
  async saveTrainedWeightSet(
    input: Omit<FsrsWeightSet, "id" | "created" | "modified" | "deletedAt">
  ): Promise<string> {
    const id = `ws_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
    const now = this.getCurrentTimestamp();
    const weightsJson = JSON.stringify(input.weights);
    await this.executeSql(SQL_QUERIES.INSERT_WEIGHT_SET, [
      id,
      weightsJson,
      input.trainedAt,
      input.reviewsTrained,
      input.cardsTrained,
      input.beforeLogLoss,
      input.afterLogLoss,
      input.steps,
      input.durationMs,
      input.weightsVersion,
      now,
      now,
    ]);

    this.emitSyncOp({
      o: "weight_set_upsert",
      p: {
        id,
        weights: weightsJson,
        trainedAt: input.trainedAt,
        reviewsTrained: input.reviewsTrained,
        cardsTrained: input.cardsTrained,
        beforeLogLoss: input.beforeLogLoss,
        afterLogLoss: input.afterLogLoss,
        steps: input.steps,
        durationMs: input.durationMs,
        weightsVersion: input.weightsVersion,
        created: now,
        modified: now,
        deletedAt: null,
      },
    });

    return id;
  }

  async getActiveTrainedWeightSet(): Promise<FsrsWeightSet | null> {
    const results = await this.querySql<SqlRecord>(
      SQL_QUERIES.GET_ACTIVE_WEIGHT_SET,
      [],
      { asObject: true }
    );
    return results.length > 0 ? this.parseWeightSetRow(results[0]) : null;
  }

  async getAllTrainedWeightSets(): Promise<FsrsWeightSet[]> {
    const results = await this.querySql<SqlRecord>(
      SQL_QUERIES.GET_ALL_WEIGHT_SETS,
      [],
      { asObject: true }
    );
    return results.map((row) => this.parseWeightSetRow(row));
  }

  /** Reset to defaults: soft-delete every live weight set (TRAINED decks then use shipped weights). */
  async clearTrainedWeights(): Promise<void> {
    const live = await this.getAllTrainedWeightSets();
    if (live.length === 0) return;
    const now = this.getCurrentTimestamp();
    await this.executeSql(SQL_QUERIES.CLEAR_WEIGHT_SETS, [now, now]);
    for (const set of live) {
      this.emitSyncOp({
        o: "weight_set_upsert",
        p: {
          id: set.id,
          weights: JSON.stringify(set.weights),
          trainedAt: set.trainedAt,
          reviewsTrained: set.reviewsTrained,
          cardsTrained: set.cardsTrained,
          beforeLogLoss: set.beforeLogLoss,
          afterLogLoss: set.afterLogLoss,
          steps: set.steps,
          durationMs: set.durationMs,
          weightsVersion: set.weightsVersion,
          created: set.created,
          modified: now,
          deletedAt: now,
        },
      });
    }
  }

  async getLatestReviewLogForSession(
    sessionId: string
  ): Promise<ReviewLog | null> {
    const sql = `SELECT * FROM review_logs WHERE session_id = ? ORDER BY reviewed_at DESC LIMIT 1`;
    const results = await this.querySql<ReviewLogRow>(sql, [sessionId], {
      asObject: true,
    });
    if (results.length === 0) return null;
    return this.mapRowsToReviewLogs(results)[0];
  }

  async getReviewLogById(reviewLogId: string): Promise<ReviewLog | null> {
    const sql = `SELECT * FROM review_logs WHERE id = ? LIMIT 1`;
    const results = await this.querySql<ReviewLogRow>(sql, [reviewLogId], {
      asObject: true,
    });
    if (results.length === 0) return null;
    return this.mapRowsToReviewLogs(results)[0];
  }

  async deleteReviewLogById(reviewLogId: string): Promise<void> {
    await this.executeSql("DELETE FROM review_logs WHERE id = ?", [
      reviewLogId,
    ]);
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
      profile: row.profile as "INTENSIVE" | "STANDARD" | "TRAINED",
      maximumIntervalDays: row.maximum_interval_days,
      minMinutes: row.min_minutes,
      fsrsWeightsVersion: row.fsrs_weights_version,
      schedulerVersion: row.scheduler_version,
      fsrsWeightSetId: row.fsrs_weight_set_id ?? null,
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
    this.emitSyncOp({
      o: "session_start",
      p: {
        id: sessionId,
        deckId: session.deckId,
        startedAt: session.startedAt,
        goalTotal: session.goalTotal,
      },
    });
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
    this.emitSyncOp({
      o: "session_progress",
      p: { id: sessionId, doneUnique },
    });
  }

  async endReviewSession(sessionId: string): Promise<void> {
    const endedAt = this.getCurrentTimestamp();
    const sql = `UPDATE review_sessions SET ended_at = ? WHERE id = ?`;
    await this.executeSql(sql, [endedAt, sessionId]);
    this.emitSyncOp({
      o: "session_end",
      p: { id: sessionId, endedAt },
    });
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

  async countCardReviewsInSession(
    sessionId: string,
    flashcardId: string
  ): Promise<number> {
    const sql = `SELECT COUNT(*) as count FROM review_logs WHERE session_id = ? AND flashcard_id = ?`;
    const results = await this.querySql<{ count: number }>(
      sql,
      [sessionId, flashcardId],
      { asObject: true }
    );
    return results.length > 0 ? results[0].count : 0;
  }

  // CRAM (DRILL) OPERATIONS
  // Isolated from real scheduling: these never touch flashcards or review_logs
  // and never emit sync ops. Cross-device convergence is handled by
  // merge-before-save (last-write-wins on `modified`).

  async createCramSession(
    session: Omit<CramSession, "id" | "created" | "modified">
  ): Promise<string> {
    const id = `cram_${Date.now()}_${Math.random()
      .toString(36)
      .substring(2, 11)}`;
    const now = this.getCurrentTimestamp();
    await this.executeSql(SQL_QUERIES.INSERT_CRAM_SESSION, [
      id,
      session.deckKey,
      session.deckKind,
      session.startedAt,
      session.endedAt ?? null,
      session.goalTotal,
      session.graduatedCount,
      now,
      now,
    ]);
    return id;
  }

  async getCramSessionById(id: string): Promise<CramSession | null> {
    const results = (await this.querySql(SQL_QUERIES.GET_CRAM_SESSION_BY_ID, [
      id,
    ])) as (string | number | null)[][];
    return results.length > 0 ? this.rowToCramSession(results[0]) : null;
  }

  async getActiveCramSessionForDeck(
    deckKey: string
  ): Promise<CramSession | null> {
    const results = (await this.querySql(
      SQL_QUERIES.GET_ACTIVE_CRAM_SESSION_FOR_DECK,
      [deckKey]
    )) as (string | number | null)[][];
    return results.length > 0 ? this.rowToCramSession(results[0]) : null;
  }

  async updateCramSessionProgress(
    id: string,
    graduatedCount: number
  ): Promise<void> {
    await this.executeSql(SQL_QUERIES.UPDATE_CRAM_SESSION_PROGRESS, [
      graduatedCount,
      this.getCurrentTimestamp(),
      id,
    ]);
  }

  async endCramSession(id: string): Promise<void> {
    const now = this.getCurrentTimestamp();
    await this.executeSql(SQL_QUERIES.UPDATE_CRAM_SESSION_END, [now, now, id]);
  }

  async batchCreateCramCards(
    cards: Array<Omit<CramCard, "created" | "modified">>
  ): Promise<void> {
    if (cards.length === 0) return;
    const now = this.getCurrentTimestamp();
    for (const card of cards) {
      await this.executeSql(SQL_QUERIES.INSERT_CRAM_CARD, [
        card.id,
        card.sessionId,
        card.flashcardId,
        card.tempState,
        card.tempStability,
        card.tempDifficulty,
        card.tempInterval,
        card.tempDueAt,
        card.reps,
        card.graduatedAt ?? null,
        now,
        now,
      ]);
    }
  }

  async getCramCardById(id: string): Promise<CramCard | null> {
    const results = (await this.querySql(SQL_QUERIES.GET_CRAM_CARD_BY_ID, [
      id,
    ])) as (string | number | null)[][];
    return results.length > 0 ? this.rowToCramCard(results[0]) : null;
  }

  async getNextDueCramCard(sessionId: string): Promise<CramCard | null> {
    const results = (await this.querySql(SQL_QUERIES.GET_NEXT_CRAM_CARD, [
      sessionId,
    ])) as (string | number | null)[][];
    return results.length > 0 ? this.rowToCramCard(results[0]) : null;
  }

  async countRemainingCramCards(sessionId: string): Promise<number> {
    const results = await this.querySql<{ count: number }>(
      SQL_QUERIES.COUNT_REMAINING_CRAM_CARDS,
      [sessionId],
      { asObject: true }
    );
    return results.length > 0 ? results[0].count : 0;
  }

  async updateCramCard(
    id: string,
    updates: {
      tempState: CramCard["tempState"];
      tempStability: number;
      tempDifficulty: number;
      tempInterval: number;
      tempDueAt: string;
      reps: number;
    }
  ): Promise<void> {
    await this.executeSql(SQL_QUERIES.UPDATE_CRAM_CARD, [
      updates.tempState,
      updates.tempStability,
      updates.tempDifficulty,
      updates.tempInterval,
      updates.tempDueAt,
      updates.reps,
      this.getCurrentTimestamp(),
      id,
    ]);
  }

  async graduateCramCard(
    id: string,
    graduatedAt: string,
    reps: number
  ): Promise<void> {
    await this.executeSql(SQL_QUERIES.GRADUATE_CRAM_CARD, [
      graduatedAt,
      reps,
      this.getCurrentTimestamp(),
      id,
    ]);
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
    this.emitSyncOp({ o: "deck_reset", p: { deckId, resetAt: now } });
  }

 /**
   * Recovery: Migrates orphaned review logs by reverse-computing old IDs from 
   * the current flashcard text, then rebuilds each card's FSRS scheduling 
   * state from its most recent review log.
   */
  async rebuildCardStateFromReviewLogs(): Promise<number> {
    const now = this.getCurrentTimestamp();

    // 1. Fetch current cards to compute what their old IDs used to be
    // Assuming 'id' is the new ID, and we have 'front'
    const cards = await this.querySql<{ id: string, front: string, back: string }>(
      `SELECT id, front FROM flashcards`,
      [],
      { asObject: true }
    );

    // 2. Compute the ID migrations in TypeScript
    const idMigrations: { oldId: string, newId: string }[] = [];
    for (const card of cards) {
      // NOTE: Replace this with your exact old hash generation function call
      const oldId = generateOldFlashcardId(card.front); 
      
      if (oldId !== card.id) {
        idMigrations.push({ oldId, newId: card.id });
      }
    }

    // 3. Re-link the orphaned review logs to the new flashcard IDs
    // If your DB wrapper supports transactions, wrap this loop in one for speed
    for (const { oldId, newId } of idMigrations) {
      await this.executeSql(
        `UPDATE review_logs 
         SET flashcard_id = ? 
         WHERE flashcard_id = ?`,
        [newId, oldId]
      );
    }

    // 4. Count how many cards we can now successfully restore
    const countRows = await this.querySql<{ count: number }>(
      `SELECT COUNT(*) as count
       FROM flashcards f
       WHERE EXISTS (SELECT 1 FROM review_logs rl WHERE rl.flashcard_id = f.id)`,
      [],
      { asObject: true }
    );
    const restored = countRows[0]?.count ?? 0;
    
    if (restored === 0) return 0;

    // 5. Rebuild the FSRS state from the newly linked logs
    await this.executeSql(
      `UPDATE flashcards
       SET state = latest.new_state,
           stability = latest.new_stability,
           difficulty = latest.new_difficulty,
           repetitions = latest.new_repetitions,
           lapses = latest.new_lapses,
           interval = latest.new_interval_minutes,
           last_reviewed = latest.reviewed_at,
           due_date = strftime('%Y-%m-%dT%H:%M:%fZ', latest.reviewed_at, '+' || latest.new_interval_minutes || ' minutes'),
           modified = ?
       FROM (
         SELECT rl.flashcard_id,
                rl.new_state, rl.new_stability, rl.new_difficulty,
                rl.new_repetitions, rl.new_lapses, rl.new_interval_minutes, rl.reviewed_at
         FROM review_logs rl
         JOIN (
           SELECT flashcard_id, MAX(reviewed_at) AS max_reviewed
           FROM review_logs
           GROUP BY flashcard_id
         ) m ON m.flashcard_id = rl.flashcard_id AND m.max_reviewed = rl.reviewed_at
       ) AS latest
       WHERE flashcards.id = latest.flashcard_id`,
      [now]
    );

    return restored;
  }

  // CARD STATE OVERLAYS (suspend, bury, reset)
  //
  // All four operations bump `modified` on the row so the existing
  // last-writer-wins flashcard merge does the right thing for FSRS state.
  // `suspended_at` and `buried_until` are intentionally excluded from the
  // bulk flashcards merge in worker-entry.ts; their cross-device convergence
  // runs entirely through the dedicated SyncLog ops emitted here.

  async suspendCard(cardId: string): Promise<void> {
    const now = this.getCurrentTimestamp();
    await this.executeSql(
      `UPDATE flashcards SET suspended_at = ?, modified = ? WHERE id = ?`,
      [now, now, cardId]
    );
    this.emitSyncOp({ o: "card_suspend", p: { c: cardId, at: now } });
  }

  async unsuspendCard(cardId: string): Promise<void> {
    const now = this.getCurrentTimestamp();
    await this.executeSql(
      `UPDATE flashcards SET suspended_at = NULL, modified = ? WHERE id = ?`,
      [now, cardId]
    );
    this.emitSyncOp({ o: "card_unsuspend", p: { c: cardId, at: now } });
  }

  async batchSuspendCards(cardIds: string[]): Promise<void> {
    if (cardIds.length === 0) return;
    const now = this.getCurrentTimestamp();
    const placeholders = cardIds.map(() => "?").join(",");
    await this.executeSql(
      `UPDATE flashcards SET suspended_at = ?, modified = ? WHERE id IN (${placeholders})`,
      [now, now, ...cardIds]
    );
    for (const cardId of cardIds) {
      this.emitSyncOp({ o: "card_suspend", p: { c: cardId, at: now } });
    }
  }

  async batchUnsuspendCards(cardIds: string[]): Promise<void> {
    if (cardIds.length === 0) return;
    const now = this.getCurrentTimestamp();
    const placeholders = cardIds.map(() => "?").join(",");
    await this.executeSql(
      `UPDATE flashcards SET suspended_at = NULL, modified = ? WHERE id IN (${placeholders})`,
      [now, ...cardIds]
    );
    for (const cardId of cardIds) {
      this.emitSyncOp({ o: "card_unsuspend", p: { c: cardId, at: now } });
    }
  }

  async buryCard(cardId: string, untilIso: string): Promise<void> {
    const now = this.getCurrentTimestamp();
    await this.executeSql(
      `UPDATE flashcards SET buried_until = ?, modified = ? WHERE id = ?`,
      [untilIso, now, cardId]
    );
    this.emitSyncOp({ o: "card_bury", p: { c: cardId, until: untilIso, at: now } });
  }

  async unburyCard(cardId: string): Promise<void> {
    const now = this.getCurrentTimestamp();
    await this.executeSql(
      `UPDATE flashcards SET buried_until = NULL, modified = ? WHERE id = ?`,
      [now, cardId]
    );
    this.emitSyncOp({ o: "card_unbury", p: { c: cardId, at: now } });
  }

  async batchBuryCards(cardIds: string[], untilIso: string): Promise<void> {
    if (cardIds.length === 0) return;
    const now = this.getCurrentTimestamp();
    const placeholders = cardIds.map(() => "?").join(",");
    await this.executeSql(
      `UPDATE flashcards SET buried_until = ?, modified = ? WHERE id IN (${placeholders})`,
      [untilIso, now, ...cardIds]
    );
    for (const cardId of cardIds) {
      this.emitSyncOp({ o: "card_bury", p: { c: cardId, until: untilIso, at: now } });
    }
  }

  async batchUnburyCards(cardIds: string[]): Promise<void> {
    if (cardIds.length === 0) return;
    const now = this.getCurrentTimestamp();
    const placeholders = cardIds.map(() => "?").join(",");
    await this.executeSql(
      `UPDATE flashcards SET buried_until = NULL, modified = ? WHERE id IN (${placeholders})`,
      [now, ...cardIds]
    );
    for (const cardId of cardIds) {
      this.emitSyncOp({ o: "card_unbury", p: { c: cardId, at: now } });
    }
  }

  // Reset is destructive: deletes review_logs for the card (mirrors
  // resetDeckProgress at a per-card granularity), then resets FSRS columns
  // to "new" defaults. Suspended/buried flags are intentionally CLEARED on
  // reset — a user resetting a card is starting it over from scratch, and
  // would not expect it to remain hidden from the queue.
  async resetCard(cardId: string): Promise<void> {
    const now = this.getCurrentTimestamp();
    await this.executeSql(
      `DELETE FROM review_logs WHERE flashcard_id = ?`,
      [cardId]
    );
    await this.executeSql(
      `UPDATE flashcards SET
         state = 'new',
         due_date = ?,
         interval = 0,
         repetitions = 0,
         difficulty = 5.0,
         stability = 0,
         lapses = 0,
         last_reviewed = NULL,
         suspended_at = NULL,
         buried_until = NULL,
         modified = ?
       WHERE id = ?`,
      [now, now, cardId]
    );
    this.emitSyncOp({ o: "card_reset", p: { c: cardId, at: now } });
  }

  async batchResetCards(cardIds: string[]): Promise<void> {
    if (cardIds.length === 0) return;
    const now = this.getCurrentTimestamp();
    const placeholders = cardIds.map(() => "?").join(",");
    await this.executeSql(
      `DELETE FROM review_logs WHERE flashcard_id IN (${placeholders})`,
      cardIds
    );
    await this.executeSql(
      `UPDATE flashcards SET
         state = 'new',
         due_date = ?,
         interval = 0,
         repetitions = 0,
         difficulty = 5.0,
         stability = 0,
         lapses = 0,
         last_reviewed = NULL,
         suspended_at = NULL,
         buried_until = NULL,
         modified = ?
       WHERE id IN (${placeholders})`,
      [now, now, ...cardIds]
    );
    for (const cardId of cardIds) {
      this.emitSyncOp({ o: "card_reset", p: { c: cardId, at: now } });
    }
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
      this.emitSyncOp({ o: "custom_deck_reset", p: { customDeckId, resetAt: now } });
      return;
    }

    await this.executeSql(SQL_QUERIES.DELETE_REVIEW_LOGS_FOR_CUSTOM_DECK, [customDeckId]);
    await this.executeSql(SQL_QUERIES.RESET_CUSTOM_DECK_FLASHCARDS, [now, customDeckId]);
    this.emitSyncOp({ o: "custom_deck_reset", p: { customDeckId, resetAt: now } });
  }

  // CUSTOM DECK OPERATIONS

  async createCustomDeck(name: string, deckType: CustomDeckType = 'manual', filterDefinition: string | null = null): Promise<string> {
    const id = generateCustomDeckId(name);
    const now = new Date().toISOString();
    await this.executeSql(SQL_QUERIES.INSERT_CUSTOM_DECK, [
      id, name, deckType, filterDefinition, null, now, now,
    ]);
    this.emitSyncOp({
      o: "custom_deck_upsert",
      p: {
        id,
        name,
        deckType,
        filterDefinition,
        lastReviewed: null,
        created: now,
        modified: now,
      },
    });
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
    const newName = updates.name ?? existing.name;
    const newFilter = updates.filterDefinition !== undefined ? updates.filterDefinition : existing.filterDefinition;
    await this.executeSql(SQL_QUERIES.UPDATE_CUSTOM_DECK, [
      newName,
      newFilter,
      now,
      id,
    ]);
    this.emitSyncOp({
      o: "custom_deck_upsert",
      p: {
        id,
        name: newName,
        deckType: existing.deckType,
        filterDefinition: newFilter,
        lastReviewed: existing.lastReviewed,
        created: existing.created,
        modified: now,
      },
    });
  }

  async updateCustomDeckLastReviewed(id: string, timestamp: string): Promise<void> {
    const now = new Date().toISOString();
    await this.executeSql(SQL_QUERIES.UPDATE_CUSTOM_DECK_LAST_REVIEWED, [
      timestamp, now, id,
    ]);
    // last_reviewed updates are user-local and high-churn; intentionally not
    // emitted on the sync log to keep log size bounded. Other devices will
    // converge on their own last_reviewed values via their own usage.
  }

  async deleteCustomDeck(id: string): Promise<void> {
    const now = this.getCurrentTimestamp();
    await this.executeSql(SQL_QUERIES.DELETE_CUSTOM_DECK, [now, now, id]);
    this.emitSyncOp({ o: "custom_deck_delete", p: { id, deletedAt: now } });
  }

  async addCardsToCustomDeck(customDeckId: string, flashcardIds: string[]): Promise<void> {
    const now = new Date().toISOString();
    for (const flashcardId of flashcardIds) {
      const id = generateCustomDeckCardId(customDeckId, flashcardId);
      await this.executeSql(SQL_QUERIES.INSERT_CUSTOM_DECK_CARD, [
        id, customDeckId, flashcardId, now,
      ]);
      // Clear any local tombstone for this pair — the user just re-added it.
      await this.executeSql(
        "DELETE FROM custom_deck_card_tombstones WHERE custom_deck_id = ? AND flashcard_id = ?",
        [customDeckId, flashcardId]
      );
      this.emitSyncOp({
        o: "custom_deck_card_add",
        p: { customDeckId, flashcardId, created: now },
      });
    }
  }

  async removeCardsFromCustomDeck(customDeckId: string, flashcardIds: string[]): Promise<void> {
    const now = new Date().toISOString();
    for (const flashcardId of flashcardIds) {
      await this.executeSql(SQL_QUERIES.DELETE_CUSTOM_DECK_CARD, [
        customDeckId, flashcardId,
      ]);
      // Local tombstone so a stale remote `_add` op can't resurrect this row.
      await this.executeSql(
        `INSERT INTO custom_deck_card_tombstones (custom_deck_id, flashcard_id, removed_at_hlc)
         VALUES (?, ?, ?)
         ON CONFLICT(custom_deck_id, flashcard_id) DO UPDATE SET
           removed_at_hlc = excluded.removed_at_hlc`,
        [customDeckId, flashcardId, now]
      );
      this.emitSyncOp({
        o: "custom_deck_card_remove",
        p: { customDeckId, flashcardId, removedAt: now },
      });
    }
  }

  async removeAllCardsFromCustomDeck(customDeckId: string): Promise<void> {
    // Read membership first so each removed pair gets a tombstone +
    // sync op, matching the per-card removeCardsFromCustomDeck pattern.
    const cardIds = await this.getFlashcardIdsForCustomDeck(customDeckId);
    await this.executeSql(SQL_QUERIES.DELETE_ALL_CUSTOM_DECK_CARDS, [customDeckId]);
    if (cardIds.length === 0) return;
    const now = new Date().toISOString();
    for (const flashcardId of cardIds) {
      await this.executeSql(
        `INSERT INTO custom_deck_card_tombstones (custom_deck_id, flashcard_id, removed_at_hlc)
         VALUES (?, ?, ?)
         ON CONFLICT(custom_deck_id, flashcard_id) DO UPDATE SET
           removed_at_hlc = excluded.removed_at_hlc`,
        [customDeckId, flashcardId, now]
      );
      this.emitSyncOp({
        o: "custom_deck_card_remove",
        p: { customDeckId, flashcardId, removedAt: now },
      });
    }
  }

  private buildFilterQuery(filterDef: string, selectClause: string, extraWhere?: string, extraParams?: SqlJsValue[]): { sql: string; params: SqlJsValue[] } {
    const definition: FilterDefinition = JSON.parse(filterDef);
    const compiled = compileFilter(definition, this.filterCompileOptions);
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
        deck.filterDefinition,
        "COUNT(*)",
        "f.state = ? AND f.due_date <= ? AND f.suspended_at IS NULL AND (f.buried_until IS NULL OR f.buried_until <= ?)",
        ["new", now, now]
      );
      const results = (await this.querySql(sql, params)) as (string | number | null)[][];
      return (results[0]?.[0] as number) ?? 0;
    }

    const results = (await this.querySql(SQL_QUERIES.COUNT_NEW_CARDS_CUSTOM_DECK, [customDeckId, now, now])) as (
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
        deck.filterDefinition,
        "COUNT(*)",
        "f.state = ? AND f.due_date <= ? AND f.suspended_at IS NULL AND (f.buried_until IS NULL OR f.buried_until <= ?)",
        ["review", now, now]
      );
      const results = (await this.querySql(sql, params)) as (string | number | null)[][];
      return (results[0]?.[0] as number) ?? 0;
    }

    const results = (await this.querySql(SQL_QUERIES.COUNT_DUE_CARDS_CUSTOM_DECK, [customDeckId, now, now])) as (
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
        deck.filterDefinition,
        "f.*",
        "f.state = ? AND f.due_date <= ? AND f.suspended_at IS NULL AND (f.buried_until IS NULL OR f.buried_until <= ?)",
        ["review", now, now]
      );
      const results = (await this.querySql(`${sql} ORDER BY f.due_date ASC`, params)) as (string | number | null)[][];
      return results.map((row) => this.rowToFlashcard(row));
    }

    const results = (await this.querySql(SQL_QUERIES.GET_DUE_CARDS_FOR_CUSTOM_DECK, [customDeckId, now, now])) as (
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
        deck.filterDefinition,
        "f.*",
        "f.state = ? AND f.due_date <= ? AND f.suspended_at IS NULL AND (f.buried_until IS NULL OR f.buried_until <= ?)",
        ["new", now, now]
      );
      const results = (await this.querySql(`${sql} ORDER BY f.due_date ASC`, params)) as (string | number | null)[][];
      return results.map((row) => this.rowToFlashcard(row));
    }

    const results = (await this.querySql(SQL_QUERIES.GET_NEW_CARDS_FOR_CUSTOM_DECK, [customDeckId, now, now])) as (
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
      params,
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

      // Restore trained weight sets (column-intersection; backups predating the table are skipped)
      try {
        const currentWeightSetColumns = new Set(
          (await this.querySql("PRAGMA table_info(fsrs_weight_sets)") as SqlJsValue[][])
            .map(row => row[1] as string)
        );

        const backupWeightSetCols = (await this.queryBackupDatabase(
          backupDb, "PRAGMA table_info(fsrs_weight_sets)"
        )).map(row => row[1] as string);

        const wsMapping: { backupIndex: number; currentName: string }[] = [];
        for (let i = 0; i < backupWeightSetCols.length; i++) {
          const col = backupWeightSetCols[i];
          if (currentWeightSetColumns.has(col)) {
            wsMapping.push({ backupIndex: i, currentName: col });
          }
        }

        if (wsMapping.length > 0) {
          const sets = await this.queryBackupDatabase(
            backupDb, "SELECT * FROM fsrs_weight_sets"
          );
          const columns = wsMapping.map(m => m.currentName);
          const placeholders = columns.map(() => "?").join(", ");
          const insertSql = `INSERT OR IGNORE INTO fsrs_weight_sets (${columns.join(", ")}) VALUES (${placeholders})`;

          for (const set of sets) {
            const values = wsMapping.map(m => set[m.backupIndex]);
            await this.executeSql(insertSql, values);
          }
        }
      } catch {
        this.debugLog("Backup does not contain fsrs_weight_sets table, skipping");
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

  // Sync log idempotency state. Local-only (never propagated cross-device).
  async getJournalState(): Promise<JournalStateRow[]> {
    const rows = (await this.querySql(
      "SELECT source_device_id, last_applied_seq, last_applied_hlc, last_applied_at FROM journal_state"
    )) as Array<[string, number, string, string]>;
    return rows.map((r) => ({
      sourceDeviceId: r[0],
      lastAppliedSeq: r[1],
      lastAppliedHlc: r[2],
      lastAppliedAt: r[3],
    }));
  }

  async upsertJournalState(row: JournalStateRow): Promise<void> {
    await this.executeSql(
      `INSERT INTO journal_state
         (source_device_id, last_applied_seq, last_applied_hlc, last_applied_at, byte_offset)
       VALUES (?, ?, ?, ?, 0)
       ON CONFLICT(source_device_id) DO UPDATE SET
         last_applied_seq = excluded.last_applied_seq,
         last_applied_hlc = excluded.last_applied_hlc,
         last_applied_at = excluded.last_applied_at`,
      [row.sourceDeviceId, row.lastAppliedSeq, row.lastAppliedHlc, row.lastAppliedAt]
    );
  }

  // mtime gate accessors. Local-per-device (excluded from cross-device merge).
  async getDeckLastSyncedMtime(deckId: string): Promise<number> {
    const rows = (await this.querySql(
      SQL_QUERIES.GET_DECK_LAST_SYNCED_MTIME,
      [deckId]
    )) as Array<[number]>;
    if (rows.length === 0) return 0;
    const value = rows[0][0];
    return typeof value === "number" ? value : 0;
  }

  // Every deck's id, filepath and last-synced mtime in one query (for the stale gate).
  async getAllDeckSyncMeta(): Promise<
    { id: string; filepath: string; lastSyncedMtime: number }[]
  > {
    const rows = (await this.querySql(
      "SELECT id, filepath, COALESCE(last_synced_mtime, 0) FROM decks",
      []
    )) as Array<[string, string, number]>;
    return rows.map((row) => ({
      id: String(row[0]),
      filepath: String(row[1]),
      lastSyncedMtime: typeof row[2] === "number" ? row[2] : 0,
    }));
  }

  async setDeckLastSyncedMtime(deckId: string, mtime: number): Promise<void> {
    await this.executeSql(SQL_QUERIES.UPDATE_DECK_LAST_SYNCED_MTIME, [mtime, deckId]);
  }

  async clearLastSyncedMtimeForProfile(profileId: string): Promise<void> {
    await this.executeSql(SQL_QUERIES.CLEAR_LAST_SYNCED_MTIME_BY_PROFILE, [profileId]);
  }
}
