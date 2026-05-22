# Decks ![Downloads](https://img.shields.io/github/downloads/dscherdi/decks/total) ![Downloads Latest](https://img.shields.io/github/downloads/dscherdi/decks/latest/total?style=flat-square) ![Release](https://img.shields.io/github/v/release/dscherdi/decks)

**English** · [Deutsch](./README.de.md) · [Español](./README.es.md) · [Français](./README.fr.md) · [Italiano](./README.it.md) · [Русский](./README.ru.md) · [Türkçe](./README.tr.md) · [Shqip](./README.sq.md) · [العربية](./README.ar.md) · [हिन्दी](./README.hi.md) · [中文](./README.zh.md) · [繁體中文](./README.zh-TW.md) · [日本語](./README.ja.md)

**Turn your Obsidian notes into flashcards. No special syntax. No separate deck to build.**

Tag a file with `#decks`. Every header you wrote becomes the front of a card; every paragraph below becomes the back. Tables, image occlusion, and `==cloze==` highlights work the same way. Scheduling is handled by FSRS — the modern spaced-repetition algorithm.

![Demo](./decks_showcase.gif)

[Discord](https://discord.com/channels/686053708261228577/1497268419861418035) · [Release notes](./release-notes/) · [Buy me a coffee](https://www.buymeacoffee.com/dscherdil0)

## Why Decks

- **Your notes are already the deck.** Tag a file, every header becomes a front, every paragraph becomes a back. Coming from Anki, there's nothing to author twice.
- **Four formats, no syntax to learn.** Headers, two-column tables, image occlusion, and `==cloze==` from highlights you already use.
- **FSRS-native scheduling.** Three profiles (Standard / Intensive / Trained), per-tag retention targets, no SM-2 baggage.
- **Algorithm tuning.** One-click optimizer trains the FSRS weights on your own review history — better scheduling for your forgetting curve, all client-side.
- **Real multi-device sync.** Database merges across iCloud/Dropbox automatically — review on phone and desktop, no lost history.
- **Built for mobile.** Touch-tuned review UI, safe-area aware, tested daily on phones.

## 60-second quick start

1. Install **Decks** from Community Plugins, enable it.
2. Open any note. Add `#decks` to its frontmatter or as an inline tag.
3. Write a header, then a paragraph below it. Repeat for as many cards as you want:

   ```markdown
   ---
   tags: [decks/spanish]
   ---

   # What does "Hola" mean?

   Hello.

   # How do you say "Thank you" in Spanish?

   Gracias.
   ```

4. Click the **brain icon** in the ribbon to open the Decks panel. Click your file. Start reviewing.

The filename becomes the deck name. Cards sync automatically when you save the note.

## Card formats

Decks supports four ways to write cards. Pick whichever matches how you already write notes.

<details>
<summary><b>Header + paragraph</b> — the default. Each header is a front, the body below is the back.</summary>

```markdown
---
tags: [decks/spanish]
---

# What does "Hola" mean in English?

Hello.

# How do you say "Thank you" in Spanish?

Gracias.
```

The filename becomes the deck name. Header level is configurable per profile.

</details>

<details>
<summary><b>Tables</b> — two-column markdown tables, with an optional notes column.</summary>

```markdown
## Concepts

| Question                | Answer                                            |
| ----------------------- | ------------------------------------------------- |
| What is photosynthesis? | The process plants use to convert sunlight        |
| Define gravity          | The force that attracts objects toward each other |
```

- First column = front, second column = back. Header row is ignored.
- Tables must sit directly under a header (no other paragraphs inside).
- Add a third "Notes" column for hints/mnemonics shown via toggle (press **N**) during review.

</details>

<details>
<summary><b>Cloze deletions</b> — highlight text with <code>==text==</code> to blank it out.</summary>

```markdown
## The Solar System

The ==Sun== is the star at the center of our solar system. The closest planet to the Sun is ==Mercury==, and the largest planet is ==Jupiter==.
```

Each highlight becomes one card. During review the active blank shows as `[...]`; tap to reveal. Cloze also works inside table cells. Two context modes per profile (hide or show other clozes). Enabled by default.

</details>

<details>
<summary><b>Image occlusion</b> — an image plus a numbered list. Numbers on the image map to the list.</summary>

```markdown
## Bones of the arm

![[arm_bones.png]]

1. ==Humerus==
2. ==Radius==
3. ==Ulna==
```

Each list item is one card. The image (with its numbered labels) shows on the front; the matching item is blanked on the back. Builds on cloze, so cloze must be enabled on the profile.

</details>

<details>
<summary><b>More: title format, reverse cards, per-card tags</b></summary>

**Title format** — the filename becomes the front, the entire file becomes the back. Set "Title" as the header level in your profile.

**Reverse cards** — add `reverse: true` to a file's frontmatter to auto-generate a reversed copy of every card. Progress is tracked separately per direction.

**Per-card tags** — add `#tag` directly in headers (e.g., `## What is photosynthesis? #plants #high-school`). Tags are stripped from the displayed front, shown as chips during review, and inherited by table rows and reverse cards. Build "filter decks" that pull every card with a given tag across your vault.

</details>

### Canvas decks

Author cards on an Obsidian Canvas (`.canvas`) instead of a markdown file. Each canvas in the configured folder becomes one deck; each text node inside it is parsed for the same four card formats above (header-paragraph, table, cloze, image occlusion). One text node can hold a whole table of cards, or one cloze sentence, or a single header + paragraph — mix freely across the canvas.

Set it up in **Settings → Canvas decks**:
- **Canvas decks folder** — every `.canvas` inside this folder becomes a deck.
- **Canvas deck tag** — applied to all canvas decks for grouping in the Tags view and for profile mapping. Defaults to `#decks/canvas` (which uses the DEFAULT profile unless you map it elsewhere).

Canvas decks behave like file decks everywhere: they show up in the deck list, in the Tags view, can be included in custom decks by filter (`deckTag = #decks/canvas`), are editable from the flashcard manager, and "Go to source" from review opens the canvas and focuses the source text node.

A `Decks — Canvas getting started.canvas` is auto-created in a `Canvas decks/` folder on first install (or first upgrade) to show the formats in action.

See **[docs/CANVAS_DECKS.md](docs/CANVAS_DECKS.md)** for details.

## What you get

- Browse mode and timed review sessions with daily limits.
- Per-tag profiles (Standard / Intensive FSRS, retention target, daily quotas).
- Custom decks built from filter rules — e.g., every card tagged `#high-school`.
- Statistics: heatmap, retention, future-due forecast, intervals, hourly breakdown, answer-button stats.
- Anki export, automatic backups, multi-device merge sync.
- Keyboard shortcuts: **Space** to flip, **1–4** to rate.

## Multi-device sync

Decks syncs alongside your vault — iCloud Drive, Obsidian Sync, Dropbox, Syncthing, anything that shares the vault folder works.

The plugin uses two files:

- **`<plugin folder>/flashcards.db`** — the SQLite database holding every card's FSRS state and full review history. This is the cold-storage snapshot, persisted to disk every ~30 minutes when there's new activity (and on app background / unload).
- **`<deviceId>.deckssynclog`** — one small append-only JSONL file per device, in your vault root. Every state change you make — rating a card, editing a profile, creating a custom deck, starting/ending a review session — is recorded here as a single short line. Other devices read these files on app focus and replay the entries against their own database.

The custom `.deckssynclog` extension keeps the file out of Obsidian's file explorer; you'll see it in Finder/Files but it never shows up as a note. iCloud and other file-sync providers ship these small text files **dramatically faster** than the binary database — typically seconds instead of minutes — which is why the cross-device "I just rated this on my Mac, now I see it on my iPhone" lag is usually around 15–30 seconds rather than 1–2 minutes.

The log self-truncates to the last 30 days on plugin load. Long-running cross-device state (months or years of review history) is preserved in the binary database, which still syncs through your file-sync provider on its own slower schedule.

If your sync provider creates conflict-copy files (e.g. iCloud's `<deviceId> (Mac's conflicted copy 2026-05-13).deckssynclog`), the plugin detects them, applies any unique entries, and renames the original aside as `*.consumed-<timestamp>` so it's not re-processed.

## Personalized scheduling

FSRS ships with sensible defaults that work well out of the box. Once you've accumulated ~100 reviews, you can train the algorithm's 21 weights against your own review history and get card schedules tailored to your specific forgetting curve — the same kind of thing Anki desktop does, but client-side, no server, no telemetry.

**Settings → Algorithm tuning → Optimize parameters.** Training runs in seconds for typical decks; you'll see a before/after log-loss comparison, click Apply to use the trained weights or Discard to keep defaults. Re-train any time to refine the weights as you accumulate more reviews.

Trained weights are global but per-profile applied — pick **Trained** in any profile's FSRS profile dropdown to opt that profile in. Intensive profiles continue to use their sub-day defaults; existing card data is preserved through training.

<details>
<summary>How it works under the hood</summary>

The optimizer matches the open-spaced-repetition reference methodology: Adam optimizer over binary cross-entropy loss, cosine-annealed learning rate, parameter clipping against published FSRS-6 bounds. Step count scales with your review history (more reviews → more iterations).

The implementation has been validated against the published FSRS-6 spec (1396/1396 forward-pass cases match bit-exact) and benchmarked against 443M anonymized Anki reviews — calibration of shipped defaults agrees with empirical recall to within 0.8 percentage points. See [docs/FSRS_OPTIMIZER.md](./docs/FSRS_OPTIMIZER.md) for the full write-up: comparison with the reference benchmark, what to expect at different deck sizes, and known limitations.

</details>

## Settings

Open **Settings → Decks** for daily limits, retention targets, search paths, session duration, and backup options. Per-tag overrides via the gear icon on any deck.

<details>
<summary>All settings</summary>

**Profile settings** (Manage profiles in the deck panel):

- New cards per day, review cards per day (per deck)
- Retention target (default 90%)
- FSRS profile: Standard, Intensive, or Trained (Trained available after optimizing parameters)
- Header level for parsing (or "Title" to use the filename)
- Review order: oldest due first, or random
- Cloze deletions: enabled by default
- Cloze context: hidden or open

**Review settings:** session duration (1–60 min), next-day rollover hour (default 4 AM), keyboard shortcuts toggle.

**Parsing settings:** scan the entire vault, or restrict to a folder.

**Other:** background refresh interval, automatic backup count, debug logging.

</details>

## Release notes & support

- **Release notes** for each version are in [`release-notes/`](./release-notes/).
- **Discuss on Discord** — [join the server](https://discord.com/channels/686053708261228577/1497268419861418035).
- **Support development** — [Buy me a coffee](https://www.buymeacoffee.com/dscherdil0).
- **Translation Guide** - [Translation Guide](./docs/TRANSLATING.md).

## License

See [LICENSE](./LICENSE).
