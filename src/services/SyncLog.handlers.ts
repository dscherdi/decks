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

// Internal: dispatch table. Day 5 ships only the `rate` handler; remaining
// op types arrive in Day 6 with the rest of the wire-up.
const HANDLERS: Partial<Record<SyncLogEntry["o"], OpHandler>> = {
  rate: handleRate,
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
