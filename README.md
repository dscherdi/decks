# Decks

**Turn your Obsidian notes into flashcards. No separate deck to build.**

Tag a file with `#decks`. Every header you wrote becomes the front of a card; every paragraph below becomes the back. Tables, image occlusion, and `==cloze==` highlights work the same way. Scheduling is handled by FSRS — the modern spaced-repetition algorithm.

![Demo](./decks_showcase.gif)

[Discord](https://discord.com/channels/686053708261228577/1497268419861418035) · [Release notes](./release-notes/) · [Buy me a coffee](https://www.buymeacoffee.com/dscherdil0)

## Why Decks

- **Your notes are already the deck.** Tag a file, every header becomes a front, every paragraph becomes a back. Coming from Anki, there's nothing to author twice.
- **Four formats, no syntax to learn.** Headers, two-column tables, image occlusion, and `==cloze==` from highlights you already use.
- **FSRS-native scheduling.** Two profiles (Standard / Intensive), per-tag retention targets, no SM-2 baggage.
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

## What you get

- Browse mode and timed review sessions with daily limits.
- Per-tag profiles (Standard / Intensive FSRS, retention target, daily quotas).
- Custom decks built from filter rules — e.g., every card tagged `#high-school`.
- Statistics: heatmap, retention, future-due forecast, intervals, hourly breakdown, answer-button stats.
- Anki export, automatic backups, multi-device merge sync.
- Keyboard shortcuts: **Space** to flip, **1–4** to rate.

## Settings

Open **Settings → Decks** for daily limits, retention targets, search paths, session duration, and backup options. Per-tag overrides via the gear icon on any deck.

<details>
<summary>All settings</summary>

**Profile settings** (Manage profiles in the deck panel):
- New cards per day, review cards per day (per deck)
- Retention target (default 90%)
- FSRS profile: Standard or Intensive
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

## License

See [LICENSE](./LICENSE).
