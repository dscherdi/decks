import { DataAdapter, Notice } from "obsidian";
import { IDatabaseService } from "../database/DatabaseFactory";
import { yieldToUI } from "@/utils/ui";

interface BackupMetadata {
  filename: string;
  timestamp: Date;
  size: number;
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
   * Create a backup of the database in SQLite format
   * Uses native SQLite database format for perfect data integrity
   */
  async createBackup(db: IDatabaseService): Promise<string> {
    try {
      // Ensure backup directory exists
      await this.ensureBackupDir();

      // Generate filename with today's date (one backup per day)
      const today = new Date().toISOString().slice(0, 10);
      const filename = `backup-${today}.db`;
      const backupPath = `${this.backupDir}/${filename}`;

      // Create SQLite backup using database service
      await db.createBackupDatabase(backupPath);

      await yieldToUI();

      this.debugLog(`SQLite backup created: ${filename}`);

      // Cleanup old backups
      await this.cleanupOldBackups();

      return filename;
    } catch (error) {
      console.error("Failed to create backup:", error);
      throw error;
    }
  }

  /**
   * Get list of available SQLite backups
   */
  async getAvailableBackups(): Promise<BackupMetadata[]> {
    try {
      if (!(await this.adapter.exists(this.backupDir))) {
        return [];
      }

      const files = await this.adapter.list(this.backupDir);
      const backups: BackupMetadata[] = [];

      for (const file of files.files) {
        if (file.endsWith(".db") && file.startsWith("backup-")) {
          const filepath = `${this.backupDir}/${file}`;
          try {
            const stat = await this.adapter.stat(filepath);
            const timestamp = stat?.mtime ? new Date(stat.mtime) : new Date();

            backups.push({
              filename: file,
              timestamp,
              size: stat?.size || 0,
            });
          } catch (error) {
            this.debugLog(`Failed to stat backup file ${file}:`, error);
          }
        }
      }

      // Sort by timestamp descending (newest first)
      return backups.sort(
        (a, b) => b.timestamp.getTime() - a.timestamp.getTime(),
      );
    } catch (error) {
      console.error("Failed to get available backups:", error);
      return [];
    }
  }

  /**
   * Restore from a SQLite backup file
   */
  async restoreFromBackup(
    filename: string,
    db: IDatabaseService,
    onProgress?: (progress: number, total: number) => void,
  ): Promise<void> {
    try {
      const backupPath = `${this.backupDir}/${filename}`;

      if (!(await this.adapter.exists(backupPath))) {
        throw new Error(`Backup file not found: ${filename}`);
      }

      this.debugLog(`Starting restore from SQLite backup: ${filename}`);

      // Show initial progress
      onProgress?.(0, 100);

      // Restore database from SQLite backup
      await db.restoreFromBackupDatabase(backupPath);

      await yieldToUI();

      // Show completion
      onProgress?.(100, 100);

      this.debugLog(`Restore completed from SQLite backup: ${filename}`);

      new Notice(`✅ Backup restored successfully from ${filename}!`, 5000);
    } catch (error) {
      console.error("Failed to restore from backup:", error);
      new Notice(`❌ Restore failed: ${error.message}`, 8000);
      throw error;
    }
  }

  /**
   * Set maximum number of backups to keep
   */
  setMaxBackups(max: number): void {
    this.maxBackups = Math.max(1, max);
  }

  /**
   * Clean up old backup files beyond the maximum limit
   */
  private async cleanupOldBackups(): Promise<void> {
    try {
      const backups = await this.getAvailableBackups();

      if (backups.length <= this.maxBackups) {
        return;
      }

      // Remove oldest backups beyond the limit
      const toDelete = backups.slice(this.maxBackups);

      for (const backup of toDelete) {
        try {
          const filepath = `${this.backupDir}/${backup.filename}`;
          await this.adapter.remove(filepath);
          this.debugLog(`Cleaned up old backup: ${backup.filename}`);
        } catch (error) {
          console.error(`Failed to delete backup ${backup.filename}:`, error);
        }
      }
    } catch (error) {
      console.error("Failed to cleanup old backups:", error);
    }
  }

  /**
   * Ensure backup directory exists
   */
  private async ensureBackupDir(): Promise<void> {
    if (!(await this.adapter.exists(this.backupDir))) {
      await this.adapter.mkdir(this.backupDir);
      this.debugLog(`Created backup directory: ${this.backupDir}`);
    }
  }

  /**
   * Format file size for display
   */
  formatFileSize(bytes: number): string {
    if (bytes === 0) return "0 B";

    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));

    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
  }
}
