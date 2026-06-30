# Anki import

The importer brings an Anki `.apkg` export into Decks: it reads the embedded Anki collection, converts every note into clean Decks markdown, copies the referenced media into the vault, carries the card scheduling state over to FSRS-6, and writes a review log per card so reviews resume rather than restart.

The logic is split across two layers:

- **`packages/decks-core/src/services/migration/anki/`** — Obsidian-agnostic parsing/rendering. `AnkiCollectionParser` reads the SQLite collection and turns notes/cards into `AnkiParsedCard`s; `AnkiSanitizer` / `AnkiLatex` convert Anki field HTML + markup to markdown; `AnkiDeckRenderer` renders cards into Decks files; `AnkiHistoryImporter` translates scheduling + revlog to FSRS-6.
- **`apps/obsidian-plugin/src/services/AnkiImportController.ts`** — the Obsidian wrapper: unzip, SQL.js loading, media I/O, the injected `htmlToMarkdown` (turndown) and `getMediaSize`/`getMediaText` callbacks, deck sync, and history import. Driven by `apps/obsidian-plugin/src/components/migration/AnkiImportUI.svelte`.

It is **additive and non-destructive**: imported decks are written into a target folder and nested under the `#decks/anki` subtag; the source `.apkg` is never modified.

## Pipeline

`AnkiImportController.import()`:

1. **Unzip** the `.apkg` in memory (`fflate`).
2. **`pickAnkiCollection`** chooses the real collection: it prefers the modern `collection.anki21b` (zstd-compressed, schema 18), falls back to `collection.anki21`, then legacy `collection.anki2` (schema 11). A modern package ships a legacy *stub* alongside the real DB, so the stub must not be used directly.
3. **`AnkiCollectionParser.parse`** reads notes/cards/models/decks, injecting platform callbacks: `htmlToMarkdown` (turndown), `getMediaText` (e.g. for `[latex]`), and `getMediaSize` (intrinsic image dimensions). Output: `AnkiParsedCard[]` + media list + template files.
4. **`AnkiDeckRenderer.render`** groups cards by deck and renders one (or more — see *Large decks*) markdown file per deck.
5. **Write** each file (create-or-overwrite), then **copy media** into a `media/` subfolder, then write any generated **templates**.
6. **`deckSynchronizer.sync`** re-parses the new files into the database.
7. **`AnkiHistoryImporter.importHistory`** injects FSRS state + review logs per card.

## Collection formats

Legacy (`collection.anki2`, schema 11) and modern (`collection.anki21b`, zstd, schema 18) are both supported. zstd payloads — including the media manifest — are detected by magic bytes (`isZstd`) and decompressed (`decompressZstd`). The media manifest may be legacy JSON or the newer protobuf form; `readAnkiMediaMap` handles both and maps numeric zip entries → filenames.

## Note types → layout

`AnkiDeckRenderer` segregates cards by kind and renders each into a section:

- **Basic** — defaults to header-paragraph; compact cards escalate to an aggregated **table** grouped by column shape (`| Front | Back |` / `| … | Notes |`).
- **Cloze** — Anki `{{c1::…}}` becomes positional `==…==` highlights; clozes inside `$…$` MathJax are rewritten via `prepareClozeMath` (`\boxed{?}` for the active blank, etc.). Deduped to one entry per note; card order derives from document position.
- **Template / multi-field** — models with rich layout emit a per-model HTML template, and cards become a table whose columns are the model fields (a tag on the header binds the template).
- **Image occlusion** — rendered as native `decks-occlusion` blocks (one per base image).

Anki tags are grouped by tag-set and sorted; `<img>` embeds carry an intrinsic-size width hint (`![[name|width]]`) so small images aren't upscaled; `[sound:…]` and `<img>` become `![[…]]` embeds; `[[…]]` wikilink collisions from Anki add-ons are neutralized.

## Media + re-import

Referenced media is copied into `<target>/media/`. The copy is **idempotent and overwriting**: re-importing the same `.apkg` overwrites both the markdown and the media (changed media is refreshed). The parent folder is ensured once per directory, and UI yields are batched (`yieldEvery`) so large media sets copy quickly. Because deck file paths are stable, `generateDeckId(filepath)` is stable across re-imports — re-import updates the same decks rather than duplicating them.

## Large decks

A deck is split into subfoldered part-files (`<deck>/<leaf> 01.md`, `02.md`, …) when it exceeds either cap, whichever is hit first:

- `CARDS_PER_FILE = 1000` — keeps the table/row count manageable.
- `MEDIA_PER_FILE = 500` — caps rendered media embeds, since a file with thousands of audio/image players lags Obsidian's reading view even with a modest row count.

Splitting **never splits a note**: cards are chunked by `noteId` and the note-groups are ordered by their smallest `cardId`, so chunk membership is deterministic and re-import-stable (each note's cards always land in the same file → the same `deckId` → consistent history ids). A single note larger than a cap forms its own file. Smaller decks stay a single, unsuffixed file.

## Scheduling + history → FSRS-6

`AnkiHistoryImporter.importHistory` reads each card's scheduling (`cards` row + `cards.data` blob) and maps it to an FSRS stability/difficulty/due state, then writes a synthetic migration review log so the card's smart-restoration state is correct. When real Anki review rows (`revlog`) are present, they're imported as a per-card timeline. Cards therefore appear already due on the right date with the right interval. Progress is reported back to the modal as `(done, total)`.

## Profile tag mapping

Imported decks nest under the `#decks/anki` subtag (`createTagMapping(profileId, ankiSubtag)`), so the chosen import profile (header level + FSRS scheduling) maps to the migrated decks only — never the user's own decks.

## i18n

All importer UI strings live in the `anki` namespace of `packages/decks-core/src/i18n/locales/*` and are localized across every supported language.
