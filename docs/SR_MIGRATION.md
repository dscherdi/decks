# Spaced Repetition migration

The migrator brings a vault from the legacy **Spaced Repetition** (SR) plugin into Decks: it extracts every legacy card into a standard Decks deck, rewrites each note into clean readable prose, carries the SM-2/FSRS scheduling state over to FSRS-6, and writes a review log per card so reviews resume rather than restart.

The logic is split across two layers:

- **`packages/decks-core/src/services/migration/LegacySrMigrator.ts`** — Obsidian-agnostic parsing/rendering: card extraction, de-sugaring, reverse expansion, whole-note rendering, and legacy-date parsing. Plus `SrHistoryImporter` for the review-log import.
- **`apps/obsidian-plugin/src/services/SrMigrationController.ts`** — the Obsidian wrapper: vault scanning, per-file routing, file I/O, frontmatter handling, tag-mapping creation, and history import. Driven by `apps/obsidian-plugin/src/components/migration/SrMigrationUI.svelte`.

## v1 scope

v1 ships the **target-folder, additive** path only:

- **Output goes to a target folder** you choose (mirroring the source structure). Originals are **never touched** — migration is additive. Re-running overwrites the generated files.
- The **same-folder** output mode and the **archive-originals** mode are code-complete but **hidden in the UI** (`sameFolder` and `archiveOriginals` are forced `false` in the controller). The branches stay in place, never reached, so they can be reconsidered for a v2. The backlink-safe file ops below describe what those hidden paths do.

## Per-file routing

For each candidate file (one carrying the SR base tag or review tag), `migrateSingleFile` parses it with `processFile` → `{ dbRecords, hasProse }` and routes by what the note actually contains, not just its tags:

- **A — review-only (no cards):** the note is retagged in place under the migration review profile; no deck file.
- **B — pure cards (cards, no prose):** only a deck file is written, at `<title>` with no review note and no cross-link.
- **C — mixed or review (cards + prose, or a `#review` note):** treated as a review. The **whole note is de-sugared** into a readable note (cards become `Q — A` prose, kept in the note) **and** the cards are also extracted into a separate `<title> (Flashcards)` deck file. The two files are cross-linked in frontmatter.

`hasProse` is a boolean derived from the parser's "orphan prose" detection (`flushPending` drops non-cloze paragraph blocks) — it distinguishes B from C. It is **not** prose extraction; the readable note is always the whole note de-sugared.

## De-sugaring (never strip)

`LegacySrMigrator.stripCardSyntax(text, opts)` rewrites legacy card syntax into normal prose, line by line, code-fence aware (inert spans — code, math, `==…==` — are masked via `maskInertSpans` before substitution):

- inline `::` / `:::` → ` — ` (em dash)
- multi-line `?` → space-join, `??` → newline
- `==X==` / `{{…}}` clozes → their answer text (reuses `convertClozeSyntax` + `HIGHLIGHT_CLOZE_G`)

It honors the **user-configured** separators (`inlineSep` / `multiSep` / `clozeSep` / `hintLabel`), not just the defaults, threaded through from the controller via `WholeNoteOptions`. `processWholeNote` builds the readable note as `stripCardSyntax(wholeNoteBody(content, opts), opts)` — the note is always de-sugared, **never** stripped of its cards.

## Reverse cards

`expandReverseCards` turns each `Front ::: Back` card into **two** plain cards in the **same** deck file: a forward card (`A → B`) and a swapped card (`B → A`), both `isReverse: false`. Their FSRS state is split — the forward direction takes `fsrsData`, the swapped direction takes `fsrsDataReverse` — so each direction is scheduled independently, matching how SR stored the two histories. There is no separate `(reversed)` file.

## Frontmatter cross-links + overwrite-on-duplicate

The generated files are cross-linked through frontmatter properties whose names are localized (`flashcardsProperty` = "Flashcards", `sourceProperty` = "Origin note", and their translations):

- **Review note:** a `Flashcards` property → its deck file, and an `Origin note` property → the original (full relative path, no extension — the deck shares the original's basename, so a bare `[[name]]` would be ambiguous). The `Origin note` link is only added in the additive case (`keepsOriginal`).
- **Deck file:** an `Origin note` property → the original.

**Overwrite-on-duplicate safeguard.** A user may already have a property named "Origin note" or "Flashcards". The review note carries the user's existing frontmatter forward, so naively appending the cross-links would emit a **duplicate YAML key**, which can break Obsidian's frontmatter parser. `buildReviewProperties(frontmatter, inject)` (exported from the controller, unit-tested in `src/__tests__/SrMigrationController.test.ts`) merges the injected links at the object level: any existing key matching an injected label **case-insensitively** is deleted before the injected value is set, then the result is serialized once with `stringifyYaml`. So a colliding property is replaced, never duplicated. The deck file is a fresh file with no user frontmatter, so it can't collide.

## Profile tag mappings

Migrated decks are namespaced under the migration profile tags via `createTagMapping(profileId, "#decks/migration")` and `"#decks/review/migration"`, resolved most-specific-wins. `decks.profile_id` is a cache re-derived from the mappings on each sync, so the per-deck profile lives in the mappings, not durably on the deck row.

## Backlink-safe file operations

The file ops never corrupt the vault link graph:

- **Backups always use `vault.copy`** — the original `.md` file object is never renamed or deleted to an archive, so Obsidian never recomputes incoming links.
- **Same-folder mode** (hidden in v1) reuses the original's slot with `vault.modify` in place, after taking a copy backup first.
- **Separate-folder mode** (v1) is additive: it `vault.create`s the new files and leaves the original in place. With archive mode on (hidden), it would copy the original into the archive and `trashFile` the source — never a `.md.bak` in separate-folder mode.

## Scheduling state + history

Legacy `<!--SR:-->` metadata — SM-2 (`due, interval, ease`) or already-FSRS — is mapped to a stability/difficulty/due state. `parseSrDate` accepts both ISO and `DD-MM-YYYY` (ambiguous values resolve day-first). `SrHistoryImporter` writes a review log per migrated card so cards appear already due on the right date.

## i18n

All migration-facing strings live in the `srMigration` block of `packages/decks-core/src/i18n/locales/*.ts` and are translated across all 13 locales (key parity is enforced by `tsc` and the i18n parity test). The property names (`flashcardsProperty`, `sourceProperty`) and the deck suffix (`flashcardsSuffix`) are localized, so the cross-link properties and generated filenames match the user's language. The README migration section (`README.md` and the 12 `README.<locale>.md` files) documents the feature for users.
