// Adapter helpers that defend against platform-specific transient errors.

import type { DataAdapter } from "obsidian";

/**
 * Wrap adapter.rename in a retry loop. On Windows, iCloud Drive, OneDrive,
 * Defender, and antivirus tools all briefly lock files mid-scan, surfacing
 * as EPERM/EBUSY/ENOENT on rename. Native rename is fast (<1ms), so a
 * three-shot retry with linear backoff resolves nearly every transient
 * collision without affecting hot paths.
 *
 * macOS and Linux don't typically hit this, but the retry is harmless there.
 */
export async function safeRename(
  adapter: DataAdapter,
  from: string,
  to: string,
  retries = 3
): Promise<void> {
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      await adapter.rename(from, to);
      return;
    } catch (error) {
      if (attempt === retries - 1) throw error;
      const msg = (error as Error)?.message ?? "";
      // Only retry on known-transient errors. Anything else (e.g. EACCES on
      // a missing parent directory) bubbles immediately so we don't mask
      // genuine bugs as flakiness.
      if (!/EPERM|EBUSY|ENOENT|locked|in use/i.test(msg)) throw error;
      await new Promise((resolve) => window.setTimeout(resolve, 50 * (attempt + 1)));
    }
  }
}
