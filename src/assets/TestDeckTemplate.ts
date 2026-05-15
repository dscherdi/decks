export function getTestDeckContent(deckTag: string): string {
  const tag = deckTag.replace("#", "");
  return `---
tags:
  - ${tag}
---
# Getting started with Decks

Welcome to Decks! To turn this file (or any file) into a flashcard deck, simply add the \`#decks\` tag to your frontmatter or anywhere in the body.

Decks supports four main formats. Pick the one that fits your notes best.

---

## 1. Header-paragraph format

By default, Decks uses **H2 headings (\`##\`)** as the front of the card, and the paragraph directly below it as the back. *(You can change this header level in the deck settings).*

## What is spaced repetition?

A learning technique that schedules reviews at increasing intervals based on recall strength.

## What tag marks a file as a flashcard deck?

The \`#decks\` tag. Add it to the frontmatter \`tags\` list or anywhere in the body.

---

## 2. Table format

You can use two-column markdown tables to generate cards in bulk. 
**Crucial Rule:** The table *must* sit directly under a heading. That heading acts as the container for those cards. 

## FSRS Concepts

| Front                             | Back                                                   | Notes                                                  |
| --------------------------------- | ------------------------------------------------------ | ------------------------------------------------------ |
| What does FSRS stand for?         | Free Spaced Repetition Scheduler                       | The algorithm Decks uses to schedule cards             |
| What are the four review ratings? | Again, Hard, Good, Easy                                | Again resets the card; Easy gives the longest interval |

*(Note: The first column is the Front, the second is the Back. The optional third column is for Notes/Hints).*

---

## 3. Cloze deletions

Use \`==highlight==\` syntax to create fill-in-the-blank cards. Every highlight becomes its own card.

## The solar system

The ==Sun== is the star at the center of our solar system. The closest planet is ==Mercury==, and the largest planet is ==Jupiter==.

---

## 4. Image occlusion

Combine an image with a numbered list. The image shows the labeled regions, and each list item becomes a separate card. 

## Bones of the arm

![[arm_bones.png]]

1. ==Humerus==
2. ==Radius==
3. ==Ulna==

---
`;
}
