# Test Data Files

This directory contains markdown files with flashcard data for performance and integration testing.

## Files

### Large German Language Files (thousands of flashcards)
- **10000 German nouns.md** (461 KB) - 3,722 German noun flashcards ⚠️ Tagged as `notflashcards` to prevent accidental loading
- **4200 German Adjectives.md** (786 KB) - 4,200 German adjective flashcards
- **2000 German verbs.md** (850 KB) - 2,018 German verb flashcards
- **1200 Deutsche Redewendungen.md** (397 KB) - 1,200 German idioms/phrases
- **500 Nomen-Verb Verbindungen.md** (69 KB) - 501 German noun-verb combinations

### Small Test Files (dozens of flashcards)
- **Spanish-Vocabulary.md** (1.6 KB) - Spanish vocabulary flashcards
- **Programming-Concepts.md** (3.9 KB) - Programming concept flashcards
- **Math-Basics.md** (1.7 KB) - Basic math flashcards
- **test.md** (313 B) - Minimal test file

## Purpose

These files are used for:
- **Performance testing**: Large files test parsing and sync performance with thousands of cards
- **Integration testing**: Realistic deck data for end-to-end workflow validation
- **Stress testing**: Validate system handles large decks (up to 50,000 card limit)

## Usage

Integration tests can load these files to test real-world scenarios:

```typescript
const fileContent = await vault.adapter.read('path/to/test-data/10000 German nouns.md');
const flashcards = FlashcardParser.parseFlashcardsFromContent(fileContent, deckConfig);
```

## Total Size

Total: ~2.6 MB across 9 files
