// Exam results store: commit-marker persistence, idempotency, two-device
// merge union, sync-op replay parity, and backup restore.

import { MainDatabaseService } from "../../database/MainDatabaseService";
import { InMemoryAdapter } from "./database-test-utils";
import { setupTestDatabase, teardownTestDatabase } from "./database-test-utils";
import { Logger } from "../../utils/logging";
import {
  applyOp,
  type ExamAnswer,
  type ExamSession,
  type ExamSessionCompleteOp,
  type HLCValue,
  type SyncLogEntry,
} from "@decks/core";

const HLC: HLCValue = [1_000_000, 0, "remote-dev"];

class MtimeAdapter extends InMemoryAdapter {
  public mtimeValue = 0;
  async stat(
    _path: string
  ): Promise<{ type: string; size: number; mtime: number; ctime: number }> {
    return { type: "file", size: 0, mtime: this.mtimeValue, ctime: 0 };
  }
}

function makeLogger(adapter: InMemoryAdapter): Logger {
  return new Logger(
    { debug: { enableLogging: false, performanceLogs: false } } as never,
    adapter,
    ".obsidian",
    "decks"
  );
}

const SESSION: Omit<ExamSession, "created"> = {
  id: "exam_test_1",
  deckKey: "deck_chem",
  deckKind: "file",
  startedAt: "2030-01-01T10:00:00Z",
  endedAt: "2030-01-01T10:20:00Z",
  configJson: '{"passScorePct":60}',
  questionCount: 2,
  correctCount: 1,
  scorePct: 50,
  passed: false,
  durationMs: 1_200_000,
};

const ANSWERS: Array<Omit<ExamAnswer, "id" | "sessionId" | "created">> = [
  {
    flashcardId: "card_a",
    ordinal: 0,
    questionType: "multiple-choice",
    gradingMethod: "options",
    prompt: "Which element is a noble gas?",
    correctAnswer: "Argon",
    givenAnswer: "Argon",
    isCorrect: true,
    timeMs: 5000,
  },
  {
    flashcardId: "card_b",
    ordinal: 1,
    questionType: "type-in",
    gradingMethod: "tolerant",
    prompt: "Powerhouse of the cell?",
    correctAnswer: "The mitochondrion.",
    givenAnswer: "",
    isCorrect: false,
    timeMs: null,
  },
];

describe("Exam results store", () => {
  let db: MainDatabaseService;

  beforeEach(async () => {
    db = await setupTestDatabase();
  });

  afterEach(async () => {
    await teardownTestDatabase();
  });

  it("round-trips a completed attempt with derived answer ids", async () => {
    await db.completeExamSession(SESSION, ANSWERS);

    const sessions = await db.getExamSessionsForDeckKey("deck_chem");
    expect(sessions).toHaveLength(1);
    expect(sessions[0].scorePct).toBe(50);
    expect(sessions[0].passed).toBe(false);

    const answers = await db.getExamAnswersForSession("exam_test_1");
    expect(answers.map((a) => a.id)).toEqual(["exam_test_1:0", "exam_test_1:1"]);
    expect(answers[0].isCorrect).toBe(true);
    expect(answers[1].givenAnswer).toBe("");
    expect(answers[1].timeMs).toBeNull();
  });

  it("is idempotent on re-completion", async () => {
    await db.completeExamSession(SESSION, ANSWERS);
    await db.completeExamSession(SESSION, ANSWERS);

    expect(await db.getExamSessionsForDeckKey("deck_chem")).toHaveLength(1);
    expect(await db.getExamAnswersForSession("exam_test_1")).toHaveLength(2);
  });

  it("keeps partial answer writes invisible until the session row lands", async () => {
    // Simulate a crash between the answer loop and the session insert.
    await db.executeSql(
      `INSERT OR IGNORE INTO exam_answers
         (id, session_id, flashcard_id, ordinal, question_type, grading_method,
          prompt, correct_answer, given_answer, is_correct, time_ms, created)
       VALUES ('orphan:0', 'orphan', 'card_x', 0, 'type-in', 'exact', 'p', 'c', 'g', 1, NULL, '2030-01-01T00:00:00Z')`,
      []
    );
    expect(await db.getExamSessionsForDeckKey("deck_chem")).toHaveLength(0);

    // The retried completion re-ignores and the attempt becomes visible.
    await db.completeExamSession(SESSION, ANSWERS);
    expect(await db.getExamSessionsForDeckKey("deck_chem")).toHaveLength(1);
  });

  it("unions attempts from two devices through the binary merge", async () => {
    await db.completeExamSession(SESSION, ANSWERS);
    await db.save();

    const adapterB = new MtimeAdapter();
    const dbB = new MainDatabaseService("test.db", adapterB, jest.fn());
    await dbB.initialize();
    try {
      await dbB.completeExamSession(
        { ...SESSION, id: "exam_test_2", scorePct: 100, passed: true },
        ANSWERS.map((a) => ({ ...a, isCorrect: true }))
      );

      const snapshot = await db.exportDatabaseToBuffer();
      await adapterB.writeBinary(
        "test.db",
        snapshot.buffer.slice(
          snapshot.byteOffset,
          snapshot.byteOffset + snapshot.byteLength
        ) as ArrayBuffer
      );
      adapterB.mtimeValue = 1;
      await dbB.syncWithDisk();

      const merged = await dbB.getExamSessionsForDeckKey("deck_chem");
      expect(merged.map((s) => s.id).sort()).toEqual(["exam_test_1", "exam_test_2"]);
      expect(await dbB.getExamAnswersForSession("exam_test_1")).toHaveLength(2);
      expect(await dbB.getExamAnswersForSession("exam_test_2")).toHaveLength(2);

      // Re-merge is idempotent.
      adapterB.mtimeValue = 2;
      await dbB.syncWithDisk();
      expect(await dbB.getExamSessionsForDeckKey("deck_chem")).toHaveLength(2);
    } finally {
      await dbB.close();
    }
  });

  it("replays the exam_session_complete op into identical rows", async () => {
    await db.completeExamSession(SESSION, ANSWERS);
    const localSession = (await db.getExamSessionsForDeckKey("deck_chem"))[0];

    const adapterB = new InMemoryAdapter();
    const dbB = new MainDatabaseService("/b.db", adapterB, jest.fn());
    await dbB.initialize();
    try {
      const op: ExamSessionCompleteOp = {
        o: "exam_session_complete",
        p: { session: localSession, answers: ANSWERS },
      };
      const entry = { hlc: HLC, s: 1, v: 1, o: op.o, p: op.p } as SyncLogEntry;
      await applyOp(dbB, "remote-dev", entry, makeLogger(adapterB));
      // Applying twice must not duplicate.
      await applyOp(dbB, "remote-dev", entry, makeLogger(adapterB));

      const remoteSessions = await dbB.getExamSessionsForDeckKey("deck_chem");
      expect(remoteSessions).toEqual([localSession]);
      expect(await dbB.getExamAnswersForSession("exam_test_1")).toEqual(
        await db.getExamAnswersForSession("exam_test_1")
      );
    } finally {
      await dbB.close();
    }
  });

  it("restores exam attempts from a backup", async () => {
    await db.completeExamSession(SESSION, ANSWERS);
    const backup = await db.exportDatabaseToBuffer();

    const adapterB = new InMemoryAdapter();
    const dbB = new MainDatabaseService("/b.db", adapterB, jest.fn());
    await dbB.initialize();
    try {
      await dbB.restoreFromBackupData(backup);
      expect(await dbB.getExamSessionsForDeckKey("deck_chem")).toHaveLength(1);
      expect(await dbB.getExamAnswersForSession("exam_test_1")).toHaveLength(2);
    } finally {
      await dbB.close();
    }
  });
});
