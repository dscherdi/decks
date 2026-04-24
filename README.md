# Decks

Decks is a spaced repetition flashcard plugin for Obsidian that helps you learn and memorize information using the FSRS algorithm.

If you like this plugin, consider buying me a coffee and I will add more features.
<a href="https://www.buymeacoffee.com/dscherdil0">
<img src="https://cdn.buymeacoffee.com/buttons/v2/default-yellow.png" alt="Buy Me A Coffee" height="40">
</a>

[Join the discussion](https://discord.com/channels/686053708261228577/1497268419861418035)

## Demo

![Watch the demo](./decks_showcase.gif)

## Quick start

1. **Install the plugin**: Download and enable Decks in your Obsidian plugins
2. **Open the panel**: Click the brain icon in the ribbon or use the command palette
3. **Create your first deck**: Follow the guide below to create flashcards
4. **Start learning**: Click on any deck to begin reviewing flashcards

## Creating flashcards

### Header + paragraph format

Create a markdown file and tag it with `#decks` or a custom tag set in the settings:

```markdown
---
tags: [decks/spanish-basics]
---

# What does "Hola" mean in English?

Hello

# How do you say "Thank you" in Spanish?

Gracias

# What is the Spanish word for "water"?

Agua
```

- Each header becomes the **front** of a flashcard
- All content until the next header becomes the **back**
- The filename becomes your deck name
- Cards are automatically extracted and synced

### Table format

Create flashcards using a two-column table:

```markdown
---
tags: [decks/vocabulary]
---

## Concepts

| Question                | Answer                                                   |
| ----------------------- | -------------------------------------------------------- |
| What is photosynthesis? | The process by which plants convert sunlight into energy |
| Define gravity          | The force that attracts objects toward each other        |
| What is DNA?            | Deoxyribonucleic acid - carries genetic information      |
```

- First column = **front** of flashcard
- Second column = **back** of flashcard
- Header row is ignored
- Tables need to be inside a header with header level specified in the settings to be parsed.
- There should not be any other paragraphs in the header together with the table, because then it will be parsed as a Header+Paragraph Block

#### Optional notes column

You can add a third column for notes that provide extra context, hints, or mnemonics. Notes are shown during review via a toggle button on the back of the card.

```markdown
## Spanish vocabulary

| Front        | Back         | Notes                                  |
| ------------ | ------------ | -------------------------------------- |
| Hola         | Hello        | Informal greeting, used with friends   |
| Buenos días  | Good morning | Literally "good days", used until noon |
| Gracias      | Thank you    | Add "muchas" for "thank you very much" |
| ¿Cómo estás? | How are you? |                                        |
```

- The notes column is optional — tables without it work the same as before
- Empty notes cells are allowed
- During review, a small info icon appears on the back card when notes are available
- Press **N** to toggle notes visibility

### Title format

Use the filename itself as the front of a single card. Enable "Title" in the header level setting of your profile, then the entire file content becomes the back:

```markdown
---
tags: [decks/capitals]
---

The capital of France is Paris. It is located in northern France along the Seine river.
```

With the filename `What is the capital of France?.md`, this produces one card:

- **Front**: What is the capital of France?
- **Back**: The full file content

This format is useful for atomic notes where the filename is already the question.

### Cloze deletions

Use `==highlight==` syntax to create cloze deletion flashcards. Each highlighted word or phrase becomes a separate card where that text is blanked out during review.

```markdown
---
tags: [decks/science]
---

## The Solar System

The ==Sun== is the star at the center of our solar system. The closest planet to the Sun is ==Mercury==, and the largest planet is ==Jupiter==.
```

This creates three cloze cards from a single paragraph — one for each highlight. During review:

1. You see the front (header) and tap "Show answer"
2. The paragraph appears with the active cloze as a clickable `[...]` blank
3. Tap the blank to reveal the answer, then rate the card

Cloze also works in table format — highlights in the Back column generate cloze cards:

```markdown
## Chemistry

| Front | Back                                                    |
| ----- | ------------------------------------------------------- |
| H2O   | ==Water== — the most common molecule on Earth's surface |
| NaCl  | ==Sodium chloride==, commonly known as ==table salt==   |
```

Two context modes are available per profile:

- **Hidden** (default): All other clozes are also blanked out. The active blank has a distinct accent color so you know which one to answer.
- **Open**: Other clozes show their text in muted style. Only the active one is blanked.

Cards without any `==highlights==` remain normal flashcards even with cloze enabled. Cloze is enabled by default on new profiles and can be toggled in **Manage profiles**.

### Image occlusion

Create image occlusion flashcards by combining an image with a numbered list. The image should contain numbered indexes (labels) that correspond to the numbered list entries below it — each index on the image maps to the matching list item.

```markdown
---
tags: [decks/anatomy]
---

## Bones of the arm

![[arm_bones.png]]

1. ==Humerus==
2. ==Radius==
3. ==Ulna==
```

In this example, the image `arm_bones.png` has labels "1", "2", and "3" pointing to different bones. Each numbered list item provides the answer for that label.

This creates three cards — one for each numbered item. During review:

- The **front** shows the image (with its numbered labels)
- The **back** shows the numbered list with the active item blanked as `[...]`
- Tap the blank to reveal the answer, then rate the card

Image occlusion builds on the cloze feature and requires cloze to be enabled on the profile. Each list item is one card regardless of how many `==highlights==` it contains — all highlights in the active item are blanked and revealed together.

Items without `==highlights==` still generate cards — the full item text is treated as the answer.

### Reverse cards

Add `reverse: true` to the frontmatter of any deck file to automatically generate a reversed version of every card. Each card will produce two entries: the original (front → back) and a reversed copy (back → front), so you practice recall in both directions.

```markdown
---
tags: [decks/vocabulary]
reverse: true
---

## Bonjour

Hello

## Merci

Thank you
```

This creates four cards total:

- "Bonjour" → "Hello"
- "Hello" → "Bonjour"
- "Merci" → "Thank you"
- "Thank you" → "Merci"

Works with all card formats (header-paragraph, table, and title). Review progress is tracked separately for each direction. To stop generating reverse cards, remove `reverse: true` from the frontmatter — the reversed cards will be deleted on the next sync while the original cards remain untouched.

### Tips

- **Use descriptive tags**: `#decks/spanish-verbs` instead of `#decks/deck1`
- **Keep cards atomic**: One concept per card
- **Use images and formatting**: Markdown formatting is fully supported
- **Organize by topic**: Group related concepts in the same deck

## Key concepts

### Learning states

- **New**: Cards you have never seen before
- **Learning**: Cards in short-term review cycle with short intervals
- **Due**: Cards scheduled for long-term spaced repetition review
- **Mature**: Cards with an interval of 21 days or more

### FSRS algorithm

Decks uses the Free Spaced Repetition Scheduler (FSRS 6), a modern algorithm that adapts to your performance, optimizes retention, and predicts when you are about to forget. Two built-in profiles are available:

- **Standard**: Balanced scheduling for everyday learning
- **Intensive**: Shorter intervals for aggressive memorization

### Review ratings

When reviewing flashcards you rate each card:

- **Again**: I don't remember this at all. Resets the card to learning state.
- **Hard**: I struggled but got it eventually. Shorter than normal spacing.
- **Good**: I remembered it correctly. Normal interval increase.
- **Easy**: Too easy, I know this well. Longer interval increase.

## Features

### Deck profiles

Create custom profiles with configurable daily limits for new and review cards, retention targets, and FSRS algorithm selection. Profiles are assigned to tags so all decks under a tag share the same settings. Each deck in a tag group enforces its own daily quota.

### Browse mode

Browse all cards in a deck or tag group without affecting their scheduling state. Navigate forward and backward through the full card list.

### Review sessions

Timed review sessions with a configurable duration (default 25 minutes). A progress bar tracks how many cards you have reviewed toward the session goal, which respects your daily limits.

### Keyboard shortcuts

During review:

- **Space**: Show answer or move to next card
- **1**: Again
- **2**: Hard
- **3**: Good
- **4**: Easy

### Statistics

Track your learning with detailed analytics:

- Study time (today, this week, this month, all time)
- Card state breakdown (new, learning, review, mature)
- Review heatmap calendar
- Charts: reviews over time, stability distribution, future due forecast, maturity progression, hourly breakdown, answer button stats
- Per-deck and overall statistics

### Anki export

Export flashcards to Anki-compatible format with configurable deck names and note types.

### Multi-device sync

Works with Dropbox, iCloud, or any file sync service. When the database is modified on multiple devices, Decks merges the changes automatically — review history is preserved from both sides and cards use the most recently modified version.

### Mobile support

Fully responsive design for Obsidian mobile with touch-friendly buttons and safe-area handling.

## Configuration

Access settings from Obsidian Settings > Decks.

### Profiles

Open the Profiles Manager from the deck list panel to create and edit profiles. Each profile controls:

- **New cards per day**: Limit how many new cards are introduced daily (per deck)
- **Review cards per day**: Limit how many review cards are shown daily (per deck)
- **Retention target**: How well you want to remember cards (default 90%)
- **FSRS profile**: Standard or Intensive algorithm weights
- **Header level**: Which header level to use for parsing flashcards, or "Title" to use the filename as the card front
- **Review order**: Oldest due first or random
- **Cloze deletions**: Enable cloze cards from `==highlighted==` text (on by default)
- **Cloze context**: Show or hide non-active clozes during review

Assign a profile to a tag from the gear icon on any deck or tag group in the deck list.

### Review settings

- **Session duration**: How long each review session lasts (1-60 minutes)
- **Next day starts at**: When the study day rolls over (default 4:00 AM)
- **Keyboard shortcuts**: Enable or disable keyboard shortcuts during review

### Parsing settings

- **Search path**: Scan the entire vault or restrict to a specific folder

### Other settings

- **Background refresh**: Automatically refresh the deck list on an interval
- **Automatic backups**: Keep up to N database backups
- **Debug logging**: Enable detailed logging for troubleshooting

## Release notes

Release notes for each version are in the `release-notes/` folder.
