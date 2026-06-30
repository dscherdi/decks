# Anki import

The importer brings an Anki `.apkg` export into Decks: it reads the embedded Anki collection, converts every note into clean Decks markdown, copies the referenced media into the vault, carries the card scheduling state over to FSRS-6, and writes a review log per card so reviews resume rather than restart.

It is **additive and non-destructive**: imported decks are written into a target folder you choose, nested under the `#decks/anki` subtag; the source `.apkg` is never modified, and re-importing simply overwrites what it previously generated.

## Using it

1. In Anki: **File → Export**, format **Anki Deck Package (`.apkg`)**, with **Include media** and **Include scheduling information** checked. Export a single deck or the whole collection.
2. In Obsidian: open the importer from the **Decks panel toolbar** (the import icon, next to the SR-migrator) — on a narrow panel it lives in the "…" overflow menu — or run the **Import from Anki (.apkg)** command.
3. In the dialog, choose the `.apkg` file, a **target folder**, and a **profile** (its header level + FSRS scheduling apply to the imported decks). Optionally **Scan** first for a preview of deck/card/media counts. Then **Import**.

## Architecture

The logic is split across two layers:

- **`packages/decks-core/src/services/migration/anki/`** — Obsidian-agnostic parsing/rendering (reusable by the mobile app, no DOM/vault access):
  - `AnkiCollectionParser` — reads the SQLite collection and turns notes/cards into `AnkiParsedCard`s.
  - `AnkiSanitizer` + `AnkiLatex` — convert Anki field HTML and `[latex]`/`[$]…[/$]` markup to markdown.
  - `AnkiDeckRenderer` — renders cards into Decks markdown files (and decides splitting).
  - `AnkiHistoryImporter` — translates scheduling + review log to FSRS-6.
  - `AnkiMediaManifest` / `pickAnkiCollection` — collection selection + media-name mapping (incl. zstd).
- **`apps/obsidian-plugin/src/services/AnkiImportController.ts`** — the Obsidian wrapper: unzip, SQL.js loading, media file I/O, and the injected platform callbacks `htmlToMarkdown` (turndown), `getMediaSize` (intrinsic image dimensions), and `getMediaText`. Drives deck sync + history import. UI is `apps/obsidian-plugin/src/components/migration/AnkiImportUI.svelte` (hosted by `AnkiImportModalWrapper`).

## Pipeline

`AnkiImportController.import()` runs these phases (each reports progress to the modal — see *Progress*):

1. **Unzip** the `.apkg` in memory (`fflate`).
2. **`pickAnkiCollection`** chooses the real collection DB: it prefers the modern `collection.anki21b` (zstd-compressed, schema 18), falls back to `collection.anki21`, then legacy `collection.anki2` (schema 11). A modern package ships a tiny legacy *stub* alongside the real DB, so the stub must never be used directly (it would yield a near-empty import).
3. **`AnkiCollectionParser.parse`** reads `notes` / `cards` / `col` (models + decks), maps each note's fields, classifies each card (below), and produces `AnkiParsedCard[]` + a media-file list + any generated template files.
4. **`AnkiDeckRenderer.render`** groups cards by Anki deck and renders one (or more — see *Large decks*) markdown file per deck.
5. **Write** each markdown file (create-or-overwrite), **copy media** into a `media/` subfolder, then write generated **templates** into the template folder.
6. **`deckSynchronizer.sync`** re-parses the written files into the SQL.js database (in the worker), registering the new decks/cards.
7. **`AnkiHistoryImporter.importHistory`** injects FSRS state + review logs for every card so schedules resume.

## Collection formats

Legacy (`collection.anki2`, schema 11) and modern (`collection.anki21b`, zstd, schema 18) are both supported. zstd payloads — including the media manifest — are detected by magic bytes (`isZstd`) and decompressed (`decompressZstd`). The `media` manifest maps numeric zip entries → real filenames and may be **legacy JSON** or the **newer protobuf** form; `readAnkiMediaMap` handles both.

## Note types → Decks cards

`AnkiCollectionParser` classifies each card by its note model (in this order):

| Anki model | Detection | Becomes |
| --- | --- | --- |
| Image occlusion | `isImageOcclusion(model)` | native `decks-occlusion` block (one per base image, all masks) |
| Cloze | `model.type === 1` | positional `==…==` highlights (one Decks card per cloze) |
| Multi-field w/ rich CSS | `model.flds.length > 2 && hasRichCss(model.css)` | an HTML-template-bound table row (per-model template generated) |
| Everything else | fallback | **basic** card (header-paragraph or aggregated table) |

`AnkiDeckRenderer` then groups parsed cards by kind and renders each into a section:

- **Basic** — defaults to a header-paragraph layout; compact cards (single-paragraph back/notes) escalate to an aggregated **table** grouped by column shape (`| Front | Back |` or `| Front | Back | Notes |`). Fields the card template doesn't reference become the card's **Notes**.
- **Cloze** — Anki `{{c1::answer::hint}}` → `==answer== (hint: hint)`; a multi-line answer becomes one highlight per line. Card order derives from each highlight's **document position**. Clozes written inside `$…$` MathJax are rewritten by `prepareClozeMath` so the tested blank renders as `\boxed{?}`, other hidden clozes as `\boxed{\cdots}`, and revealed answers inline. Cloze notes render once (deduped by note); each cloze ord becomes its own scheduled card.
- **Template / multi-field** — rich-CSS models emit one generated HTML template per model and render their cards as a markdown table whose columns are the model fields; a tag on the section header binds the template at render time.
- **Image occlusion** — one `decks-occlusion` code block per base image, carrying all mask rectangles.

### Field conversion

- HTML → markdown via the injected turndown (`<b>`→`**`, lists, tables kept, `<script>`/`<style>` dropped). Sub/sup/mark/etc. are kept as inline HTML where markdown can't express them.
- `[sound:file.mp3]` and `<img src="…">` → `![[file]]` embeds; the referenced filenames are collected for copying. `<img>` embeds get an intrinsic-size width hint (`![[name|width]]`) so small images aren't upscaled; external `http(s)` images stay plain markdown images.
- MathJax `\(…\)` → `$…$`, `\[…\]` → `$$…$$`; Anki `[latex]`/`[$]…[/$]` markup is converted too.
- Anki note **tags** are grouped by tag-set and each set gets its own section whose header carries those tags (cards inherit their header's tags in Decks); sections are sorted by tag then header.
- `[[…]]` sequences from Anki add-ons (e.g. Closet `[[tag::content]]`) are **neutralized** so Obsidian doesn't render them as broken wikilinks.

## Media + re-import

Referenced media is copied into `<target>/media/`. The copy is **idempotent and overwriting**: re-importing the same `.apkg` overwrites both the markdown and the media (changed media is refreshed). The destination folder is ensured **once** per directory, and UI yields are **batched** (`yieldEvery`) so a deck with thousands of audio files copies quickly instead of stalling on per-file frame waits.

Because deck file paths are deterministic, `generateDeckId(filepath)` is stable across re-imports — a re-import **updates the same decks** rather than creating duplicates. Flashcard ids fold in the deckId, so as long as a note's cards always land in the same file (guaranteed below), re-import keeps every card's identity and history.

## Large decks

A deck is split into subfoldered part-files (`<deck>/<leaf> 01.md`, `02.md`, …, zero-padded) when it exceeds **either** cap, whichever is hit first (`AnkiDeckRenderer`):

- `CARDS_PER_FILE = 1000` — keeps the table/row count manageable.
- `MEDIA_PER_FILE = 500` — caps rendered media embeds, because a file with thousands of audio/image players lags Obsidian's reading view even at a modest row count. (`card.media.length` is summed per file.)

Splitting **never splits a note**: cards are chunked by `noteId`, and the note-groups are ordered by their smallest `cardId`, so chunk membership is deterministic and re-import-stable — each note's cards always land in the same file → the same `deckId` → consistent history ids. A single note larger than a cap forms its own file. Smaller decks stay a single, unsuffixed file. This also keeps every file well under Decks' per-deck sync limit (`MAX_FLASHCARDS_PER_DECK = 50000`).

## Scheduling + review history → FSRS-6

`AnkiHistoryImporter.importHistory` rebuilds each card's memory state and timeline:

- **State (`buildFsrsState`).** Cards that never graduated (new/learning, no interval, `reps === 0`) return `null` and stay **new** in Decks. Otherwise:
  - **Native FSRS** — if Anki's `cards.data` blob has FSRS values (`{"s":…,"d":…}`), stability/difficulty are taken directly.
  - **SM-2 → FSRS-6 approximation** — otherwise stability ≈ the card's interval (in days, min 1) and difficulty is bucketed from the SM-2 ease `factor`. `reps`/`lapses` carry over; difficulty is clamped to [1, 10].
  - The **due date** is reconstructed from Anki's day-offset scheduling using the collection creation time (falls back to now + interval). Anki's `ivl` is days when positive, seconds when negative (learning steps).
- **Migration log.** A synthetic review log is written per card so Decks' smart-restoration shows it already due on the right date with the right interval — you **resume, not restart**.
- **Real timeline.** When `revlog` rows are present, each is imported as a review log (rating from the Anki `ease`, intervals from `ivl`/`lastIvl`, difficulty from `factor`), idempotent by row id.

The import is idempotent: re-running skips review logs that already exist.

## Profiles & tag mapping

Imported decks nest under the `#decks/anki` subtag, and `createTagMapping(profileId, ankiSubtag)` maps the chosen import profile (header level + FSRS retention/scheduling) to that subtree only — never the user's own decks. The profile's header level determines the heading depth of rendered sections.

## Progress

Progress is reported per phase so the modal's bar advances continuously even on huge imports: **reading** the collection, **writing** decks (per deck), **copying media** (`copying media {done}/{total}`), **syncing**, and **importing** review history (per ~200 cards). Each phase fills the bar in turn.

## Entry points

- Command: **Import from Anki (.apkg)** (`commands.importFromAnki`).
- Decks panel toolbar button (import icon) / overflow menu — both call the same `openAnkiImportModal()`.

## i18n

All importer UI strings live in the `anki` namespace (and the `deckList.ankiImport` button label) of `packages/decks-core/src/i18n/locales/*` and are localized across every supported language; placeholder tokens (`{deck}`, `{done}/{total}`, `{cards}`, …) are preserved per locale.

## Known limitations

- **Repeated cloze numbers.** Decks derives cloze order from document position and has no cloze-group syntax, so a note that reuses the same `{{c1::}}` number for several deletions becomes several separate Decks cards rather than one card with multiple blanks.
- **Interactive "JS app" templates.** Some premium shared decks bake a `<script>` into the card template that renders one item (e.g. a single example sentence) from a field holding many. Decks strips the script but keeps the field content, so such cards can be verbose (the full field lands on the card).
- **Note types.** Only the kinds above are specially handled; any other model falls back to a basic card built from the fields its template references (unreferenced fields → Notes).
- **History import cost.** Review-log injection is per card (one DB write each), so very large histories take proportionally longer (still bounded and progress-tracked).
