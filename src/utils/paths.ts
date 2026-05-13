// Resolves user-configurable file locations into concrete vault-relative
// paths. All resolvers fall back to legacy defaults when the setting is
// empty, so existing installs keep working without migration.
//
// Vault-relative paths only — Obsidian's DataAdapter is the only portable
// I/O surface (mobile lacks Node fs). For users who want files outside the
// hidden .obsidian/ folder, putting them at the vault root or in a top-
// level folder is the right escape hatch.

import { normalizePath } from "obsidian";

const DB_FILENAME = "flashcards.db";

interface PathsSettings {
  dbFolder: string;
  backupFolder: string;
  syncLogFolder: string;
}

interface PathContext {
  manifestDir: string | null | undefined;
  manifestId: string;
  vaultConfigDir: string;
}

function pluginFolder(ctx: PathContext): string {
  return ctx.manifestDir || `${ctx.vaultConfigDir}/plugins/${ctx.manifestId}`;
}

/**
 * Normalize a user-provided folder string. Empty after trimming returns
 * empty (caller falls back to default). Leading/trailing slashes stripped.
 * normalizePath handles backslash → forward slash and consecutive slashes.
 */
function normalizeFolder(raw: string | undefined | null): string {
  if (!raw) return "";
  const trimmed = raw.trim().replace(/^\/+|\/+$/g, "");
  if (trimmed === "") return "";
  return normalizePath(trimmed);
}

/**
 * Absolute vault-relative path to the SQLite DB file. The filename
 * (flashcards.db) is fixed — only the folder is configurable.
 */
export function resolveDbPath(paths: PathsSettings, ctx: PathContext): string {
  const folder = normalizeFolder(paths.dbFolder);
  if (folder === "") return `${pluginFolder(ctx)}/${DB_FILENAME}`;
  return `${folder}/${DB_FILENAME}`;
}

/**
 * Folder containing the rolling backup files. BackupService reads this on
 * demand (`getAvailableBackups`, `createBackup`) so changes take effect
 * without a restart.
 */
export function resolveBackupFolder(paths: PathsSettings, ctx: PathContext): string {
  const folder = normalizeFolder(paths.backupFolder);
  if (folder === "") return `${pluginFolder(ctx)}/backups`;
  return folder;
}

/**
 * Folder containing the per-device `<deviceId>.deckssynclog` files. Empty
 * means vault root, which is the default and is what iCloud syncs fastest.
 */
export function resolveSyncLogFolder(paths: PathsSettings): string {
  return normalizeFolder(paths.syncLogFolder);
}

// Re-exported for tests.
export const _internalForTests = { normalizeFolder, pluginFolder };
