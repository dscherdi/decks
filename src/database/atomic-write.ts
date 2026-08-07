/**
 * Crash-safe file replacement for the SQLite database.
 *
 * The database is persisted by rewriting the whole file — 11 MB for a mature
 * vault. Written straight over the live path, an interrupted write (quit, sleep,
 * or a cloud client swapping the file underneath) leaves a truncated file and no
 * intact copy: SQLite then reports "database disk image is malformed" and the
 * user's entire scheduling history is gone. Observed in the wild, truncated to
 * exactly 6 MiB with the header still claiming 2,878 pages.
 *
 * Writing to a temporary sibling and renaming over the destination means the
 * destination is only ever replaced by a file that was written in full.
 */

/** The slice of Obsidian's DataAdapter this needs — narrowed so it can be tested. */
export interface AtomicWriteAdapter {
  writeBinary(path: string, data: ArrayBuffer): Promise<void>;
  exists(path: string): Promise<boolean>;
  remove(path: string): Promise<void>;
  rename(from: string, to: string): Promise<void>;
  stat(path: string): Promise<{ size?: number } | null>;
}

/** Suffix of the in-progress file. Sits beside the target, so same filesystem. */
export const WRITING_SUFFIX = ".writing";

export function writingPathFor(path: string): string {
  return `${path}${WRITING_SUFFIX}`;
}

/**
 * Write `data` to `path` without ever leaving `path` partially written.
 *
 * Throws if the temporary file did not reach the expected size, so a short write
 * surfaces as a failed save with the previous database intact — rather than
 * silently replacing it with a truncated one.
 */
export async function writeBinaryAtomic(
  adapter: AtomicWriteAdapter,
  path: string,
  data: ArrayBuffer,
): Promise<void> {
  const writing = writingPathFor(path);

  await adapter.writeBinary(writing, data);

  // Verify before it is allowed to replace anything.
  //
  // Only a positive size smaller than expected proves a short write — which is
  // the observed failure, 6 MiB of 11.2 MB. A zero or absent size means the
  // adapter does not report one, and treating that as failure would refuse every
  // save on such a platform: far worse than the case it guards against, and the
  // rename below is still safer than writing over the destination directly.
  const stat = await adapter.stat(writing).catch(() => null);
  const written = stat?.size;
  if (typeof written === "number" && written > 0 && written < data.byteLength) {
    await adapter.remove(writing).catch(() => {});
    throw new Error(
      `Refusing to save: wrote ${written} of ${data.byteLength} bytes`,
    );
  }

  try {
    await adapter.rename(writing, path);
  } catch {
    // Some platforms refuse to rename onto an existing file. The gap between
    // these two calls moves no data, unlike the multi-megabyte write above, and
    // recoverInterruptedWrite() adopts the temporary file if we die inside it.
    if (await adapter.exists(path)) await adapter.remove(path);
    await adapter.rename(writing, path);
  }
}

/**
 * Complete or clean up a write that was interrupted, before the file is read.
 *
 * Returns true when a temporary file was promoted, which only happens if the
 * destination is absent — the one case where the temporary file is the newer and
 * only complete copy.
 */
export async function recoverInterruptedWrite(
  adapter: AtomicWriteAdapter,
  path: string,
): Promise<boolean> {
  const writing = writingPathFor(path);
  if (!(await adapter.exists(writing))) return false;

  if (await adapter.exists(path)) {
    // Destination is intact, so the temporary file is debris from a failed
    // attempt and must not overwrite anything.
    await adapter.remove(writing).catch(() => {});
    return false;
  }

  await adapter.rename(writing, path);
  return true;
}
