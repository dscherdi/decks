// Moved to @decks/core: the app needs it for anchor stamping, and it was always
// pure logic — no Obsidian import, no DOM. Re-exported so the plugin's existing
// importers keep working.
export * from "@decks/core";
