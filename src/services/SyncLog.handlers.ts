// Sync log op handlers.
//
// Each handler applies a remote device's op to the local DB. Three rules:
//
//   1. IDEMPOTENT: applying the same op twice must produce the same end state.
//      The journal_state table already gives us (deviceId, seq) uniqueness, so
//      the dispatch layer suppresses duplicates before we get here. Handlers
//      MUST still tolerate re-entry — partial failures can re-fire ops.
//
//   2. NEWER-WINS: for fields with cross-device contention (FSRS state,
//      profile config), compare the op's timestamp to local state and apply
//      only if the op is newer. review_logs are append-only and never compete.
//
//   3. NO BACKTRACKING: never undo a local op based on a stale remote op.
//      Out-of-order delivery is the common case; the wrong order must just
//      converge to the same final state across devices.

import type { IDatabaseService } from "../database/DatabaseFactory";
import type { Logger } from "../utils/logging";
import type { SyncLogEntry } from "./SyncLog.types";
import type { ReviewLog } from "../database/types";

export type OpHandler = (
  db: IDatabaseService,
  sourceDeviceId: string,
  entry: SyncLogEntry,
  logger: Logger
) => Promise<void>;

/**
 * Apply a single op to the local DB. Unknown op types are skipped with a
 * warning so a newer plugin version's ops don't break older clients.
 */
export async function applyOp(
  db: IDatabaseService,
  sourceDeviceId: string,
  entry: SyncLogEntry,
  logger: Logger
): Promise<void> {
  const handler = HANDLERS[entry.o];
  if (!handler) {
    logger.debug(
      `SyncLog: no handler for op type "${entry.o}" from ${sourceDeviceId}; skipping`
    );
    return;
  }
  await handler(db, sourceDeviceId, entry, logger);
}

// Internal: dispatch table.
const HANDLERS: Partial<Record<SyncLogEntry["o"], OpHandler>> = {
  rate: handleRate,
  rate_undo: handleRateUndo,
  deck_reset: handleDeckReset,
  profile_upsert: handleProfileUpsert,
  profile_delete: handleProfileDelete,
  tag_mapping_upsert: handleTagMappingUpsert,
  tag_mapping_delete: handleTagMappingDelete,
  custom_deck_upsert: handleCustomDeckUpsert,
  custom_deck_delete: handleCustomDeckDelete,
  custom_deck_reset: handleCustomDeckReset,
  custom_deck_card_add: handleCustomDeckCardAdd,
  custom_deck_card_remove: handleCustomDeckCardRemove,
  session_start: handleSessionStart,
  session_progress: handleSessionProgress,
  session_end: handleSessionEnd,
};

/**
 * Apply a remote `rate` op:
 *   1. Insert the review_log row. The row's `id` is a UUID generated at the
 *      origin device, so duplicate inserts are impossible across devices and
 *      INSERT OR IGNORE semantics handle the rare same-device replay.
 *   2. Update the card's FSRS state IFF the remote review is newer than the
 *      local card's `modified`. Otherwise our local state already reflects a
 *      later op for this card (which we trust over the remote).
 *   3. If the card doesn't exist locally yet (likely: markdown not yet synced
 *      via vault), we still keep the review_log row — it will retroactively
 *      restore FSRS state via FlashcardSynchronizer's smart-restore path when
 *      the card materializes.
 */
async function handleRate(
  db: IDatabaseService,
  sourceDeviceId: string,
  entry: SyncLogEntry,
  logger: Logger
): Promise<void> {
  if (entry.o !== "rate") return;
  const p = entry.p;

  const reviewLog: ReviewLog = {
    id: p.log.id,
    flashcardId: p.log.flashcardId,
    sessionId: p.log.sessionId ?? undefined,
    lastReviewedAt: p.log.lastReviewedAt,
    shownAt: p.log.shownAt ?? undefined,
    reviewedAt: p.log.reviewedAt,
    rating: p.log.rating as 1 | 2 | 3 | 4,
    ratingLabel: p.log.ratingLabel,
    timeElapsedMs: p.log.timeElapsedMs ?? undefined,
    oldState: p.log.oldState,
    oldRepetitions: p.log.oldRepetitions,
    oldLapses: p.log.oldLapses,
    oldStability: p.log.oldStability,
    oldDifficulty: p.log.oldDifficulty,
    newState: p.log.newState,
    newRepetitions: p.log.newRepetitions,
    newLapses: p.log.newLapses,
    newStability: p.log.newStability,
    newDifficulty: p.log.newDifficulty,
    oldIntervalMinutes: p.log.oldIntervalMinutes,
    newIntervalMinutes: p.log.newIntervalMinutes,
    oldDueAt: p.log.oldDueAt,
    newDueAt: p.log.newDueAt,
    elapsedDays: p.log.elapsedDays,
    retrievability: p.log.retrievability,
    requestRetention: p.log.requestRetention,
    profile: p.log.profile,
    maximumIntervalDays: p.log.maximumIntervalDays,
    minMinutes: p.log.minMinutes,
    fsrsWeightsVersion: p.log.fsrsWeightsVersion,
    schedulerVersion: p.log.schedulerVersion,
    noteModelId: p.log.noteModelId ?? undefined,
    cardTemplateId: p.log.cardTemplateId ?? undefined,
    contentHash: p.log.contentHash ?? undefined,
    client: p.log.client ?? undefined,
  };

  // Step 1: log row. insertReviewLog uses INSERT INTO with the caller's id;
  // a same-id replay will throw (PRIMARY KEY conflict). Wrap to swallow.
  try {
    const exists = await db.reviewLogExists(reviewLog.id);
    if (!exists) {
      await db.insertReviewLog(reviewLog);
    }
  } catch (error) {
    logger.debug(
      `SyncLog rate: insertReviewLog failed for ${reviewLog.id}; likely duplicate, continuing`,
      error as object
    );
  }

  // Step 2: card FSRS state, only if remote is newer than local.
  const localCard = await db.getFlashcardById(p.c);
  if (!localCard) {
    logger.debug(
      `SyncLog rate from ${sourceDeviceId}: card ${p.c} not yet on this device; log row preserved for later restore`
    );
    return;
  }
  if (localCard.modified >= p.log.reviewedAt) {
    logger.debug(
      `SyncLog rate from ${sourceDeviceId}: local card ${p.c} modified ${localCard.modified} >= remote reviewedAt ${p.log.reviewedAt}; keeping local`
    );
    return;
  }

  await db.updateFlashcard(p.c, {
    state: p.state,
    dueDate: p.due,
    interval: p.interval,
    repetitions: p.rep,
    difficulty: p.d,
    stability: p.st,
    lapses: p.lap,
    lastReviewed: p.lastReviewed,
    modified: p.log.reviewedAt,
  });
}

/**
 * Apply a remote `rate_undo` op:
 *   1. Look up the referenced review_log row locally.
 *   2. If the card still exists AND its `modified` matches the log's
 *      `reviewedAt`, revert the FSRS state from oldState/oldDueAt/etc.
 *      The modified-match guard prevents trampling a CONCURRENT rate that
 *      a different device did against the same card after the original
 *      rate but before the undo arrived — that newer rate's state is
 *      still the right answer.
 *   3. Delete the log row.
 *
 * Tolerates "log not found locally" silently: this happens when the
 * original `rate` op was cancelled before flushing on the source device
 * (cleanest outcome — nothing leaked out) or hasn't reached us yet.
 * The seq-ordered apply within a single source guarantees the matching
 * rate is processed first when it WAS flushed, so this is rare in practice.
 */
async function handleRateUndo(
  db: IDatabaseService,
  sourceDeviceId: string,
  entry: SyncLogEntry,
  logger: Logger
): Promise<void> {
  if (entry.o !== "rate_undo") return;
  const { logId } = entry.p;

  const log = await db.getReviewLogById(logId);
  if (!log) {
    logger.debug(
      `SyncLog rate_undo from ${sourceDeviceId}: log ${logId} not found locally; nothing to revert`
    );
    return;
  }

  const card = await db.getFlashcardById(log.flashcardId);
  if (card && card.modified === log.reviewedAt) {
    await db.updateFlashcard(card.id, {
      state: log.oldState,
      dueDate: log.oldDueAt,
      interval: log.oldIntervalMinutes,
      repetitions: log.oldRepetitions,
      difficulty: log.oldDifficulty,
      stability: log.oldStability,
      lapses: log.oldLapses,
      lastReviewed: log.lastReviewedAt || null,
      // Reuse reviewedAt as the new modified. Same value as before — no
      // false "newer" signal for cross-device merge. The next sync only
      // touches this card if someone explicitly modifies it after.
      modified: log.reviewedAt,
    });
  } else if (card) {
    logger.debug(
      `SyncLog rate_undo from ${sourceDeviceId}: card ${log.flashcardId} modified ${card.modified} no longer matches log ${log.reviewedAt}; keeping newer state, just deleting log row`
    );
  }

  await db.deleteReviewLogById(logId);
}

/**
 * Apply a remote `deck_reset` op: bulk-wipe progress for every card in the
 * deck the user reset. The resetAt timestamp serves as a wall-clock cutoff
 * so a concurrent-rate scenario survives correctly:
 *   - Logs / sessions with timestamp <= resetAt are deleted.
 *   - Cards whose `modified` <= resetAt are reset to "new" state.
 *   - Cards modified AFTER resetAt are left alone (someone else's newer
 *     rate from a different device beat the reset).
 *
 * The receiver doesn't need a card-id list — it looks up its own
 * flashcards-for-deck and applies the cutoff filter locally.
 */
async function handleDeckReset(
  db: IDatabaseService,
  _sourceDeviceId: string,
  entry: SyncLogEntry,
  logger: Logger
): Promise<void> {
  if (entry.o !== "deck_reset") return;
  const { deckId, resetAt } = entry.p;

  // Wipe logs whose review predates the reset.
  await db.executeSql(
    `DELETE FROM review_logs
     WHERE flashcard_id IN (SELECT id FROM flashcards WHERE deck_id = ?)
       AND reviewed_at <= ?`,
    [deckId, resetAt]
  );

  // Wipe sessions started before the reset.
  await db.executeSql(
    `DELETE FROM review_sessions
     WHERE deck_id = ? AND started_at <= ?`,
    [deckId, resetAt]
  );

  // Reset cards whose state hasn't been touched by a newer rate.
  await db.executeSql(
    `UPDATE flashcards
     SET state = 'new',
         due_date = ?,
         interval = 0,
         repetitions = 0,
         difficulty = 5.0,
         stability = 0,
         lapses = 0,
         last_reviewed = NULL,
         modified = ?
     WHERE deck_id = ? AND modified <= ?`,
    [resetAt, resetAt, deckId, resetAt]
  );

  logger.debug(`SyncLog deck_reset: deck=${deckId} cutoff=${resetAt} applied`);
}

/**
 * Apply a remote `custom_deck_reset` op. Same cutoff semantics as
 * deck_reset, but the card set is derived from the custom deck's
 * membership (manual type) or its filter definition (filter type).
 *
 * For filter-type custom decks, the cards reset are whatever the filter
 * matches on THIS device at apply time — same logical scope as
 * BaseDatabaseService.resetCustomDeckProgress.
 */
async function handleCustomDeckReset(
  db: IDatabaseService,
  _sourceDeviceId: string,
  entry: SyncLogEntry,
  logger: Logger
): Promise<void> {
  if (entry.o !== "custom_deck_reset") return;
  const { customDeckId, resetAt } = entry.p;

  // If the custom deck doesn't exist locally (e.g. tombstoned, or its
  // upsert op hasn't arrived yet), there's nothing to reset. The op was
  // applied per journal_state, so we move on — if the deck materializes
  // later via a custom_deck_upsert op, it'll arrive in its post-reset
  // state from the source device anyway.
  const deck = await db.getCustomDeckById(customDeckId);
  if (!deck) {
    logger.debug(
      `SyncLog custom_deck_reset: deck ${customDeckId} not present locally; skipping`
    );
    return;
  }

  // Identify the card set the same way the local resetCustomDeckProgress
  // does it: filter decks evaluate the filter; manual decks read the
  // junction table.
  let cardIds: string[];
  if (deck.deckType === "filter" && deck.filterDefinition) {
    cardIds = await db.getFlashcardIdsForCustomDeck(customDeckId);
  } else {
    cardIds = await db.getFlashcardIdsForCustomDeck(customDeckId);
  }
  if (cardIds.length === 0) return;

  // Bulk-delete logs and reset cards in scope, both gated by the cutoff.
  const placeholders = cardIds.map(() => "?").join(", ");

  await db.executeSql(
    `DELETE FROM review_logs
     WHERE flashcard_id IN (${placeholders})
       AND reviewed_at <= ?`,
    [...cardIds, resetAt]
  );

  await db.executeSql(
    `UPDATE flashcards
     SET state = 'new',
         due_date = ?,
         interval = 0,
         repetitions = 0,
         difficulty = 5.0,
         stability = 0,
         lapses = 0,
         last_reviewed = NULL,
         modified = ?
     WHERE id IN (${placeholders}) AND modified <= ?`,
    [resetAt, resetAt, ...cardIds, resetAt]
  );

  logger.debug(
    `SyncLog custom_deck_reset: deck=${customDeckId} cutoff=${resetAt} cards=${cardIds.length} applied`
  );
}

// ---------- Profiles ------------------------------------------------------

/**
 * Upsert a profile (create or update). Newer-wins by effective timestamp
 * COALESCE(deleted_at, modified). Direct SQL because the public createProfile
 * throws on duplicate id/name — sync-log replay is a different domain than
 * user-driven CRUD.
 */
async function handleProfileUpsert(
  db: IDatabaseService,
  _sourceDeviceId: string,
  entry: SyncLogEntry,
  _logger: Logger
): Promise<void> {
  if (entry.o !== "profile_upsert") return;
  const p = entry.p;
  await db.executeSql(
    `INSERT INTO deckprofiles (
       id, name,
       has_new_cards_limit_enabled, new_cards_per_day,
       has_review_cards_limit_enabled, review_cards_per_day,
       header_level, review_order,
       learning_steps, relearning_steps,
       fsrs_request_retention, fsrs_profile, fsrs_use_trained,
       cloze_enabled, cloze_show_context,
       is_default, created, modified, deleted_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
     ON CONFLICT(id) DO UPDATE SET
       name = excluded.name,
       has_new_cards_limit_enabled = excluded.has_new_cards_limit_enabled,
       new_cards_per_day = excluded.new_cards_per_day,
       has_review_cards_limit_enabled = excluded.has_review_cards_limit_enabled,
       review_cards_per_day = excluded.review_cards_per_day,
       header_level = excluded.header_level,
       review_order = excluded.review_order,
       learning_steps = excluded.learning_steps,
       relearning_steps = excluded.relearning_steps,
       fsrs_request_retention = excluded.fsrs_request_retention,
       fsrs_profile = excluded.fsrs_profile,
       fsrs_use_trained = excluded.fsrs_use_trained,
       cloze_enabled = excluded.cloze_enabled,
       cloze_show_context = excluded.cloze_show_context,
       is_default = excluded.is_default,
       modified = excluded.modified,
       deleted_at = NULL
     WHERE excluded.modified > COALESCE(deckprofiles.deleted_at, deckprofiles.modified)`,
    [
      p.id,
      p.name,
      p.hasNewCardsLimitEnabled ? 1 : 0,
      p.newCardsPerDay,
      p.hasReviewCardsLimitEnabled ? 1 : 0,
      p.reviewCardsPerDay,
      p.headerLevel,
      p.reviewOrder,
      p.learningSteps,
      p.relearningSteps,
      p.fsrsRequestRetention,
      p.fsrsProfile,
      p.fsrsUseTrained ? 1 : 0,
      p.clozeEnabled ? 1 : 0,
      p.clozeShowContext,
      p.isDefault ? 1 : 0,
      p.created,
      p.modified,
    ]
  );
}

async function handleProfileDelete(
  db: IDatabaseService,
  _sourceDeviceId: string,
  entry: SyncLogEntry,
  _logger: Logger
): Promise<void> {
  if (entry.o !== "profile_delete") return;
  // is_default = 0 guard mirrors the public deleteProfile rule: the DEFAULT
  // profile is never tombstoned, even if a remote op claims to delete it.
  await db.executeSql(
    `UPDATE deckprofiles
     SET deleted_at = ?, modified = ?
     WHERE id = ?
       AND is_default = 0
       AND (deleted_at IS NULL OR deleted_at < ?)`,
    [entry.p.deletedAt, entry.p.deletedAt, entry.p.id, entry.p.deletedAt]
  );
}

// ---------- Tag mappings -------------------------------------------------

async function handleTagMappingUpsert(
  db: IDatabaseService,
  _sourceDeviceId: string,
  entry: SyncLogEntry,
  _logger: Logger
): Promise<void> {
  if (entry.o !== "tag_mapping_upsert") return;
  const { id, profileId, tag, created } = entry.p;

  // Conflicts can arise on PK (id) or UNIQUE(tag) — at most two rows. Both
  // ON CONFLICT(id) and ON CONFLICT(tag) cannot coexist in one UPSERT, so we
  // resolve them in JS with a single SELECT, then DELETE+INSERT under the
  // outer transaction (see SyncLog.applyPending). Effective timestamp uses
  // deleted_at if present (tombstone) else created.
  const conflicts = await db.querySql<{
    id: string;
    created: string;
    deleted_at: string | null;
  }>(
    `SELECT id, created, deleted_at FROM profile_tag_mappings WHERE id = ? OR tag = ?`,
    [id, tag],
    { asObject: true }
  );

  for (const row of conflicts) {
    const effective = row.deleted_at ?? row.created;
    if (created <= effective) return;
  }

  if (conflicts.length > 0) {
    await db.executeSql(
      `DELETE FROM profile_tag_mappings WHERE id = ? OR tag = ?`,
      [id, tag]
    );
  }
  await db.executeSql(
    `INSERT INTO profile_tag_mappings (id, profile_id, tag, created, deleted_at)
     VALUES (?, ?, ?, ?, NULL)`,
    [id, profileId, tag, created]
  );
}

async function handleTagMappingDelete(
  db: IDatabaseService,
  _sourceDeviceId: string,
  entry: SyncLogEntry,
  _logger: Logger
): Promise<void> {
  if (entry.o !== "tag_mapping_delete") return;
  await db.executeSql(
    `UPDATE profile_tag_mappings
     SET deleted_at = ?
     WHERE id = ?
       AND (deleted_at IS NULL OR deleted_at < ?)`,
    [entry.p.deletedAt, entry.p.id, entry.p.deletedAt]
  );
}

// ---------- Custom decks --------------------------------------------------

async function handleCustomDeckUpsert(
  db: IDatabaseService,
  _sourceDeviceId: string,
  entry: SyncLogEntry,
  _logger: Logger
): Promise<void> {
  if (entry.o !== "custom_deck_upsert") return;
  const p = entry.p;
  await db.executeSql(
    `INSERT INTO custom_decks (id, name, deck_type, filter_definition, last_reviewed, created, modified, deleted_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, NULL)
     ON CONFLICT(id) DO UPDATE SET
       name = excluded.name,
       deck_type = excluded.deck_type,
       filter_definition = excluded.filter_definition,
       last_reviewed = excluded.last_reviewed,
       modified = excluded.modified,
       deleted_at = NULL
     WHERE excluded.modified > COALESCE(custom_decks.deleted_at, custom_decks.modified)`,
    [p.id, p.name, p.deckType, p.filterDefinition, p.lastReviewed, p.created, p.modified]
  );
}

async function handleCustomDeckDelete(
  db: IDatabaseService,
  _sourceDeviceId: string,
  entry: SyncLogEntry,
  _logger: Logger
): Promise<void> {
  if (entry.o !== "custom_deck_delete") return;
  await db.executeSql(
    `UPDATE custom_decks
     SET deleted_at = ?, modified = ?
     WHERE id = ?
       AND (deleted_at IS NULL OR deleted_at < ?)`,
    [entry.p.deletedAt, entry.p.deletedAt, entry.p.id, entry.p.deletedAt]
  );
}

// ---------- Custom deck card memberships ----------------------------------

/**
 * Add a card to a custom deck. Honors local tombstones — if the pair was
 * previously removed and that tombstone's HLC dominates this op's HLC, we
 * silently no-op so a stale "add" can't undo a recent "remove".
 *
 * The op's HLC isn't carried inside the payload, but applyPending updates
 * the journal_state high-water mark with the op's HLC; here we compare the
 * created timestamp against any tombstone's removed_at_hlc serialized form.
 * For Day 6 we use a simpler heuristic: if the tombstone exists, skip the
 * insert. Day 7 polish: parse HLC tuples and pick the genuinely-later one.
 */
async function handleCustomDeckCardAdd(
  db: IDatabaseService,
  _sourceDeviceId: string,
  entry: SyncLogEntry,
  logger: Logger
): Promise<void> {
  if (entry.o !== "custom_deck_card_add") return;
  const p = entry.p;

  const tombstoneRows = (await db.querySql(
    "SELECT 1 FROM custom_deck_card_tombstones WHERE custom_deck_id = ? AND flashcard_id = ?",
    [p.customDeckId, p.flashcardId]
  )) as Array<[number]>;
  if (tombstoneRows.length > 0) return;

  // FK precheck: the junction table requires both rows to exist. Vault sync
  // (markdown) is independent of the sync log (DB-only state), so the
  // flashcard may not yet be in our local DB when this op arrives. Skip
  // silently — the user can re-add the card after the markdown materializes,
  // and the next applyPending replay (if any) will fire idempotently.
  const cardExists = (await db.querySql(
    "SELECT 1 FROM flashcards WHERE id = ?",
    [p.flashcardId]
  )) as Array<[number]>;
  if (cardExists.length === 0) {
    logger.debug(
      `SyncLog custom_deck_card_add: flashcard ${p.flashcardId} not yet on this device; skipping`
    );
    return;
  }
  const deckExists = (await db.querySql(
    "SELECT 1 FROM custom_decks WHERE id = ? AND deleted_at IS NULL",
    [p.customDeckId]
  )) as Array<[number]>;
  if (deckExists.length === 0) {
    logger.debug(
      `SyncLog custom_deck_card_add: custom deck ${p.customDeckId} missing or tombstoned; skipping`
    );
    return;
  }

  await db.executeSql(
    `INSERT OR IGNORE INTO custom_deck_cards (id, custom_deck_id, flashcard_id, created)
     VALUES (?, ?, ?, ?)`,
    [`${p.customDeckId}::${p.flashcardId}`, p.customDeckId, p.flashcardId, p.created]
  );
}

async function handleCustomDeckCardRemove(
  db: IDatabaseService,
  _sourceDeviceId: string,
  entry: SyncLogEntry,
  _logger: Logger
): Promise<void> {
  if (entry.o !== "custom_deck_card_remove") return;
  const p = entry.p;
  // Record the tombstone first so a concurrent add from another source
  // is filtered out on apply.
  await db.executeSql(
    `INSERT INTO custom_deck_card_tombstones (custom_deck_id, flashcard_id, removed_at_hlc)
     VALUES (?, ?, ?)
     ON CONFLICT(custom_deck_id, flashcard_id) DO UPDATE SET
       removed_at_hlc = excluded.removed_at_hlc
     WHERE excluded.removed_at_hlc > custom_deck_card_tombstones.removed_at_hlc`,
    [p.customDeckId, p.flashcardId, p.removedAt]
  );
  await db.executeSql(
    `DELETE FROM custom_deck_cards
     WHERE custom_deck_id = ? AND flashcard_id = ?`,
    [p.customDeckId, p.flashcardId]
  );
}

// ---------- Sessions ------------------------------------------------------

/**
 * Start a session. INSERT OR IGNORE — replay is a no-op since session ids
 * are UUIDs that don't collide across devices.
 */
async function handleSessionStart(
  db: IDatabaseService,
  _sourceDeviceId: string,
  entry: SyncLogEntry,
  _logger: Logger
): Promise<void> {
  if (entry.o !== "session_start") return;
  const p = entry.p;
  await db.executeSql(
    `INSERT OR IGNORE INTO review_sessions
       (id, deck_id, started_at, ended_at, goal_total, done_unique)
     VALUES (?, ?, ?, NULL, ?, 0)`,
    [p.id, p.deckId, p.startedAt, p.goalTotal]
  );
}

/**
 * Update a session's progress. Newer-wins: only bump doneUnique if the
 * incoming count is higher (a session's progress only ever monotonically
 * grows; this also guards against stale ops replayed out of order).
 */
async function handleSessionProgress(
  db: IDatabaseService,
  _sourceDeviceId: string,
  entry: SyncLogEntry,
  _logger: Logger
): Promise<void> {
  if (entry.o !== "session_progress") return;
  await db.executeSql(
    `UPDATE review_sessions
     SET done_unique = ?
     WHERE id = ? AND done_unique < ?`,
    [entry.p.doneUnique, entry.p.id, entry.p.doneUnique]
  );
}

async function handleSessionEnd(
  db: IDatabaseService,
  _sourceDeviceId: string,
  entry: SyncLogEntry,
  _logger: Logger
): Promise<void> {
  if (entry.o !== "session_end") return;
  await db.executeSql(
    `UPDATE review_sessions
     SET ended_at = ?
     WHERE id = ? AND (ended_at IS NULL OR ended_at < ?)`,
    [entry.p.endedAt, entry.p.id, entry.p.endedAt]
  );
}
