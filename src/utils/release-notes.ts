/**
 * Whether to show the release notes for this run.
 *
 * True on a version change in either direction — a downgrade is still a
 * different build from the one the user was last shown — and on a first
 * install, where nothing has been seen yet.
 */
export function shouldShowReleaseNotes(
  currentVersion: string | undefined,
  lastSeenVersion: string | undefined,
): boolean {
  // No manifest version is not an update; showing on every launch would be
  // worse than never showing.
  if (!currentVersion) return false;
  return currentVersion !== lastSeenVersion;
}
