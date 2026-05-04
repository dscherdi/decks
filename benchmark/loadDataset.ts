import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { asyncBufferFromFile, parquetReadObjects } from "hyparquet";
import { compressors } from "hyparquet-compressors";

export interface ReviewRecord {
  cardId: string;
  dayOffset: number;
  rating: 1 | 2 | 3 | 4;
  elapsedDays: number;
}

export interface UserData {
  userId: number;
  reviews: ReviewRecord[];
}

const COLUMNS = ["card_id", "day_offset", "rating", "elapsed_days"];

export function discoverUsers(revlogsRoot: string): number[] {
  const entries = readdirSync(revlogsRoot, { withFileTypes: true });
  const ids: number[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const m = entry.name.match(/^user_id=(\d+)$/);
    if (m) ids.push(parseInt(m[1], 10));
  }
  return ids.sort((a, b) => a - b);
}

function parquetFilesUnder(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    // statSync follows symlinks (HuggingFace cache uses blob symlinks).
    const s = statSync(full);
    if (s.isDirectory()) {
      out.push(...parquetFilesUnder(full));
    } else if (s.isFile() && entry.name.endsWith(".parquet")) {
      out.push(full);
    }
  }
  return out;
}

function toNumber(value: unknown): number {
  if (typeof value === "number") return value;
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "string") return parseFloat(value);
  return Number.NaN;
}

function toCardId(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "number") return value.toString();
  return String(value);
}

function isValidRating(n: number): n is 1 | 2 | 3 | 4 {
  return n === 1 || n === 2 || n === 3 || n === 4;
}

export async function loadUser(
  revlogsRoot: string,
  userId: number
): Promise<UserData> {
  const userDir = join(revlogsRoot, `user_id=${userId}`);
  const stat = statSync(userDir);
  if (!stat.isDirectory()) {
    throw new Error(`user partition not a directory: ${userDir}`);
  }

  const reviews: ReviewRecord[] = [];
  for (const filePath of parquetFilesUnder(userDir)) {
    let rows: Record<string, unknown>[];
    try {
      const file = await asyncBufferFromFile(filePath);
      rows = await parquetReadObjects({ file, columns: COLUMNS, compressors });
    } catch (err) {
      const cause = err instanceof Error ? err : new Error(String(err));
      throw new Error(`parquet read failed: ${filePath}: ${cause.message}`, { cause });
    }
    for (const row of rows) {
      const rating = toNumber(row.rating);
      if (!isValidRating(rating)) continue;
      const dayOffset = toNumber(row.day_offset);
      const elapsedDays = toNumber(row.elapsed_days);
      const cardId = toCardId(row.card_id);
      if (!Number.isFinite(dayOffset) || !cardId) continue;
      reviews.push({ cardId, dayOffset, rating, elapsedDays });
    }
  }
  return { userId, reviews };
}
