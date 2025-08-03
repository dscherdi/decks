# Obsidian Flashcards Plugin Demo Vault

This demo vault demonstrates the Obsidian Flashcards Plugin functionality.

## Plugin Features

- **Automatic Deck Detection**: Any markdown file tagged with `#flashcards` or its subtags (e.g., `#flashcards/math`, `#flashcards/spanish/vocabulary`) is automatically detected as a flashcard deck.

- **Two Flashcard Formats**:
  1. **Header + Paragraph**: Headers become the front of cards, and the content below becomes the back
  2. **Table Format**: Two-column tables where the first column is the front and second column is the back

- **FSRS Algorithm**: Uses the Free Spaced Repetition Scheduler for optimal learning intervals

- **Side Panel View**: Access all your flashcard decks from a convenient side panel

## Getting Started

1. **Open the Flashcards Panel**: Click the cards icon in the ribbon or use the command palette to "Show Flashcards Panel"

2. **Review Cards**: Click on any deck in the panel to start reviewing due cards

3. **Difficulty Options**: After revealing an answer, choose from:
   - **Again**: Card will be shown again soon (1 minute)
   - **Hard**: Shorter interval than normal
   - **Good**: Normal interval progression
   - **Easy**: Longer interval for well-known cards

## Sample Decks Included

### Math Basics (`#flashcards/math`)
- 6 cards covering fundamental math concepts
- Uses Header + Paragraph format
- Topics: Pythagorean theorem, quadratic formula, derivatives, etc.

### Spanish Vocabulary (`#flashcards/spanish/vocabulary`)
- 35 cards with common Spanish words and phrases
- Uses Table format
- Categories: Greetings, numbers, verbs, family, days of the week

### Programming Concepts (`#flashcards/programming/concepts`)
- 8 cards mixing both formats
- Covers data structures, algorithms, and programming principles
- Demonstrates how both formats can be used in the same file

## Creating Your Own Flashcards

1. Create a new markdown file
2. Add a `#flashcards` tag (or subtag like `#flashcards/topic`)
3. Write your content using either format:

### Header + Paragraph Format
```markdown
## Question goes here?

Answer goes here. Can include multiple paragraphs,
lists, code blocks, or any markdown formatting.

## Another question?

Another answer.
```

### Table Format
```markdown
| Front | Back |
|-------|------|
| Question 1 | Answer 1 |
| Question 2 | Answer 2 |
| Question 3 | Answer 3 |
```

## Keyboard Shortcuts

During review:
- **Space**: Show answer (when hidden) or mark as Good (when shown)
- **1**: Mark as Again
- **2**: Mark as Hard
- **3**: Mark as Good
- **4**: Mark as Easy

## Database Location

The plugin stores review data in a SQLite database at:
`.obsidian/plugins/obsidian-flashcards-plugin/flashcards.db`

## Tips

- Use descriptive tag hierarchies like `#flashcards/subject/topic` for better organization
- Mix both formats in the same file when appropriate
- Include images, code blocks, and other markdown formatting in your answers
- Review cards daily for best retention
- The plugin automatically syncs when you modify tagged files

## Troubleshooting

- **Decks not showing**: Ensure files have the `#flashcards` tag
- **Cards not updating**: Click the refresh button in the panel
- **Database errors**: Check the console (Ctrl+Shift+I) for detailed error messages

Enjoy learning with spaced repetition!