import { DataAdapter, Notice } from "obsidian";
import { DatabaseService } from "../database/DatabaseService";
import { ReviewLog, ReviewSession } from "../database/types";
import { BACKUP_TABLES_SQL } from "../database/schemas";
import initSqlJs, { Database } from "sql.js";
import { yieldToUI } from "@/utils/ui";

interface BackupMetadata {
  filename: string;
  timestamp: Date;
}

export class BackupService {
  private adapter: DataAdapter;
  private backupDir: string;
  private maxBackups: number = 5;
  private debugLog: (message: string, ...args: any[]) => void;

  constructor(
    adapter: DataAdapter,
    vaultConfigDir: string,
    debugLog: (message: string, ...args: any[]) => void,
  ) {
    this.adapter = adapter;
    this.backupDir = `${vaultConfigDir}/plugins/decks/backups`;
    this.debugLog = debugLog;
  }

  /**
   * Create a backup of review_logs and review_sessions tables
   */
  async createBackup(db: DatabaseService): Promise<void> {
    try {
      // Ensure backup directory exists
      await this.ensureBackupDir();

      // Initialize sql.js for backup database
      const SQL = await initSqlJs({
        locateFile: (file) => `https://sql.js.org/dist/${file}`,
      });

      // Create temporary backup database
      const backupDb = new SQL.Database();

      // Create backup tables with same schema
      backupDb.exec(BACKUP_TABLES_SQL);

      // Get data from source database
      const reviewLogs = await db.getAllReviewLogs();
      const reviewSessions = await db.getAllReviewSessions();

      // Insert review logs into backup database
      const reviewLogStmt = backupDb.prepare(`
        INSERT INTO review_logs VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      for (const log of reviewLogs) {
        reviewLogStmt.run([
          log.id,
          log.flashcardId,
          log.sessionId || null,
          log.lastReviewedAt,
          log.shownAt || null,
          log.reviewedAt,
          log.rating,
          log.ratingLabel,
          log.timeElapsedMs || null,
          log.oldState,
          log.oldRepetitions,
          log.oldLapses,
          log.oldStability,
          log.oldDifficulty,
          log.newState,
          log.newRepetitions,
          log.newLapses,
          log.newStability,
          log.newDifficulty,
          log.oldIntervalMinutes,
          log.newIntervalMinutes,
          log.oldDueAt,
          log.newDueAt,
          log.elapsedDays,
          log.retrievability,
          log.requestRetention,
          log.profile,
          log.maximumIntervalDays,
          log.minMinutes,
          log.fsrsWeightsVersion,
          log.schedulerVersion,
          log.noteModelId || null,
          log.cardTemplateId || null,
          log.contentHash || null,
          log.client || null,
        ]);
      }
      reviewLogStmt.free();

      await yieldToUI();

      // Insert review sessions into backup database
      const reviewSessionStmt = backupDb.prepare(`
        INSERT INTO review_sessions VALUES (?, ?, ?, ?, ?, ?)
      `);

      for (const session of reviewSessions) {
        reviewSessionStmt.run([
          session.id,
          session.deckId,
          session.startedAt,
          session.endedAt,
          session.goalTotal,
          session.doneUnique,
        ]);
      }
      reviewSessionStmt.free();

      await yieldToUI();

      // Generate filename with date only (one backup per day)
      const now = new Date();
      const dateString = now.toISOString().split("T")[0]; // YYYY-MM-DD
      const filename = `backup-${dateString}.db`;
      const filepath = `${this.backupDir}/${filename}`;

      // Export backup database to file
      const backupBuffer = backupDb.export();
      await this.adapter.writeBinary(filepath, backupBuffer);

      await yieldToUI();

      backupDb.close();
      this.debugLog(`Backup created: ${filename}`);

      // Clean up old backups
      await this.cleanupOldBackups();
    } catch (error) {
      this.debugLog("Failed to create backup:", error);
    }
  }

  /**
   * Get list of available backups
   */
  async getAvailableBackups(): Promise<BackupMetadata[]> {
    try {
      this.debugLog(`Checking backup directory: ${this.backupDir}`);
      await this.ensureBackupDir();

      const files = await this.adapter.list(this.backupDir);
      this.debugLog(`Listed files in backup directory:`, files);
      const backups: BackupMetadata[] = [];

      this.debugLog(`Found ${files.files.length} files to check`);
      for (const file of files.files) {
        this.debugLog(`Checking file: ${file}`);
        // Extract just the filename from the path for pattern matching
        const filename = file.split("/").pop() || file;
        if (filename.endsWith(".db") && filename.startsWith("backup-")) {
          this.debugLog(`File matches backup pattern: ${file}`);

          // Parse date from filename: backup-YYYY-MM-DD.db
          const dateMatch = filename.match(/^backup-(\d{4}-\d{2}-\d{2})\.db$/);
          this.debugLog(`Filename extracted: ${filename}`);
          this.debugLog(`Date match for ${filename}:`, dateMatch);
          if (dateMatch) {
            const timestamp = new Date(dateMatch[1] + "T00:00:00");
            this.debugLog(`Parsed timestamp for ${filename}:`, timestamp);
            backups.push({
              filename: filename,
              timestamp,
            });
          } else {
            this.debugLog(
              `Date pattern did not match for filename: ${filename}`,
            );
          }
        } else {
          this.debugLog(`File does not match backup pattern: ${file}`);
        }
      }

      // Sort by timestamp (newest first)
      backups.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());

      return backups;
    } catch (error) {
      this.debugLog("Failed to list backups:", error);
      return [];
    }
  }

  /**
   * Restore backup data to database
   */
  async restoreBackup(
    filename: string,
    db: DatabaseService,
    onProgress?: (current: number, total: number) => void,
  ): Promise<void> {
    try {
      const filepath = `${this.backupDir}/${filename}`;

      // Check if backup file exists
      if (!(await this.adapter.exists(filepath))) {
        throw new Error(`Backup file not found: ${filename}`);
      }

      // Initialize sql.js for reading backup database
      const SQL = await initSqlJs({
        locateFile: (file) => `https://sql.js.org/dist/${file}`,
      });

      // Read backup database file
      const backupBuffer = await this.adapter.readBinary(filepath);
      const backupDb = new SQL.Database(new Uint8Array(backupBuffer));

      // Get data from backup database
      const reviewLogs: ReviewLog[] = [];
      const reviewSessions: ReviewSession[] = [];

      // Read review logs from backup
      const reviewLogStmt = backupDb.prepare(`
        SELECT id, flashcard_id, session_id, last_reviewed_at, shown_at, reviewed_at,
               rating, rating_label, time_elapsed_ms, old_state, old_repetitions,
               old_lapses, old_stability, old_difficulty, new_state, new_repetitions,
               new_lapses, new_stability, new_difficulty, old_interval_minutes,
               new_interval_minutes, old_due_at, new_due_at, elapsed_days,
               retrievability, request_retention, profile, maximum_interval_days,
               min_minutes, fsrs_weights_version, scheduler_version, note_model_id,
               card_template_id, content_hash, client
        FROM review_logs
      `);

      while (reviewLogStmt.step()) {
        const row = reviewLogStmt.get();
        reviewLogs.push({
          id: row[0] as string,
          flashcardId: row[1] as string,
          sessionId: row[2] as string | undefined,
          lastReviewedAt: row[3] as string,
          shownAt: row[4] as string | undefined,
          reviewedAt: row[5] as string,
          rating: row[6] as 1 | 2 | 3 | 4,
          ratingLabel: row[7] as "again" | "hard" | "good" | "easy",
          timeElapsedMs: row[8] as number | undefined,
          oldState: row[9] as "new" | "review",
          oldRepetitions: row[10] as number,
          oldLapses: row[11] as number,
          oldStability: row[12] as number,
          oldDifficulty: row[13] as number,
          newState: row[14] as "new" | "review",
          newRepetitions: row[15] as number,
          newLapses: row[16] as number,
          newStability: row[17] as number,
          newDifficulty: row[18] as number,
          oldIntervalMinutes: row[19] as number,
          newIntervalMinutes: row[20] as number,
          oldDueAt: row[21] as string,
          newDueAt: row[22] as string,
          elapsedDays: row[23] as number,
          retrievability: row[24] as number,
          requestRetention: row[25] as number,
          profile: row[26] as "INTENSIVE" | "STANDARD",
          maximumIntervalDays: row[27] as number,
          minMinutes: row[28] as number,
          fsrsWeightsVersion: row[29] as string,
          schedulerVersion: row[30] as string,
          noteModelId: row[31] as string | undefined,
          cardTemplateId: row[32] as string | undefined,
          contentHash: row[33] as string | undefined,
          client: row[34] as "web" | "desktop" | "mobile" | undefined,
        });
      }
      reviewLogStmt.free();

      await yieldToUI();

      // Read review sessions from backup
      const reviewSessionStmt = backupDb.prepare(`
        SELECT id, deck_id, started_at, ended_at, goal_total, done_unique
        FROM review_sessions
      `);

      while (reviewSessionStmt.step()) {
        const row = reviewSessionStmt.get();
        reviewSessions.push({
          id: row[0] as string,
          deckId: row[1] as string,
          startedAt: row[2] as string,
          endedAt: row[3] as string | null,
          goalTotal: row[4] as number,
          doneUnique: row[5] as number,
        });
      }
      reviewSessionStmt.free();

      await yieldToUI();

      backupDb.close();

      let restored = 0;
      const total = reviewLogs.length + reviewSessions.length;

      // Restore review_logs (skip duplicates)
      for (const log of reviewLogs) {
        try {
          // Check if review log already exists
          const exists = await db.reviewLogExists(log.id);
          if (!exists) {
            await db.insertReviewLog(log);
          }
          restored++;
          onProgress?.(restored, total);
        } catch (error) {
          this.debugLog(`Failed to restore review log ${log.id}:`, error);
        }
      }

      // Restore review_sessions (skip duplicates)
      for (const session of reviewSessions) {
        try {
          // Check if session already exists
          const exists = await db.reviewSessionExists(session.id);
          if (!exists) {
            await db.insertReviewSession(session);
          }
          restored++;
          onProgress?.(restored, total);
        } catch (error) {
          this.debugLog(
            `Failed to restore review session ${session.id}:`,
            error,
          );
        }
      }

      await yieldToUI();

      this.debugLog(
        `Backup restored: ${filename}, ${restored}/${total} records processed`,
      );
    } catch (error) {
      this.debugLog("Failed to restore backup:", error);
      throw error;
    }
  }

  /**
   * Ensure backup directory exists
   */
  private async ensureBackupDir(): Promise<void> {
    try {
      if (!(await this.adapter.exists(this.backupDir))) {
        await this.adapter.mkdir(this.backupDir);
        this.debugLog(`Created backup directory: ${this.backupDir}`);
      }
    } catch (error) {
      this.debugLog("Failed to create backup directory:", error);
      throw error;
    }
  }

  /**
   * Clean up old backups, keeping only the most recent ones
   */
  private async cleanupOldBackups(): Promise<void> {
    try {
      const backups = await this.getAvailableBackups();

      // Keep only the most recent backups
      if (backups.length > this.maxBackups) {
        const toDelete = backups.slice(this.maxBackups);

        for (const backup of toDelete) {
          try {
            const filepath = `${this.backupDir}/${backup.filename}`;
            await this.adapter.remove(filepath);
            this.debugLog(`Deleted old backup: ${backup.filename}`);
          } catch (error) {
            this.debugLog(
              `Failed to delete old backup ${backup.filename}:`,
              error,
            );
          }
        }
      }
    } catch (error) {
      this.debugLog("Failed to cleanup old backups:", error);
    }
  }

  /**
   * Format timestamp for display
   */
  static formatTimestamp(timestamp: Date): string {
    return timestamp.toLocaleString();
  }
}
