export function getTestDeckContent(deckTag: string): string {
  const tag = deckTag.replace("#", "");
  return `---
tags:
  - ${tag}
---

# Getting started with Decks

Welcome to Decks! This file shows the two ways to create flashcards.

- Header-Paragraph format
- Use a markdown table with **Front** and **Back** columns. An optional **Notes** column adds extra context shown during review.

## Header-paragraph format

Use a heading as the question and the paragraph below as the answer.

## Table format

| Front | Back | Notes |
|---|---|---|
| What is spaced repetition? | A learning technique that schedules reviews at increasing intervals based on recall strength | Used by Anki, Decks, and other apps |
| What does FSRS stand for? | Free Spaced Repetition Scheduler | The algorithm Decks uses to schedule cards |
| What are the four review ratings? | Again, Hard, Good, Easy | Again resets the card; Easy gives the longest interval |

## What tag marks a file as a flashcard deck?

The \`${deckTag}\` tag marks a file as a deck. Add it to the frontmatter \`tags\` list or anywhere in the body.

## How do I limit how many cards I review per day?

Open the deck settings (the ⚙ icon next to a deck) and set the **New cards per day** and **Review cards per day** limits.

## Can I sync Decks across devices?

Yes. Decks uses a SQLite database stored in your vault. Syncing via iCloud, Dropbox, or Obsidian Sync will keep your progress in sync across devices.
`;
}
