/** Obsidian hands a plugin nothing (or an empty object) until it has saved settings once. */
export function isFreshInstall(loadedData: unknown): boolean {
  if (loadedData === null || loadedData === undefined) return true;
  return typeof loadedData === "object" && Object.keys(loadedData).length === 0;
}
