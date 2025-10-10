#!/usr/bin/env node

/**
 * Interactive Console Demo for Decks Plugin
 * Simple demo showcasing flashcard functionality
 */

const fs = require('fs').promises;
const path = require('path');
const readline = require('readline');

// Mock Database Implementation
class MockDatabase {
  constructor() {
    this.decks = new Map();
    this.flashcards = new Map();
    this.reviewLogs = [];
  }

  async createDeck(deck) {
    const id = `deck_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const fullDeck = {
      id,
      ...deck,
      created: new Date().toISOString(),
      modified: new Date().toISOString()
    };
    this.decks.set(id, fullDeck);
    return id;
  }

  async getDeckById(id) {
    return this.decks.get(id) || null;
  }

  async getAllDecks() {
    return Array.from(this.decks.values());
  }

  async createFlashcard(flashcard) {
    const id = `card_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const fullCard = {
      id,
      ...flashcard,
      created: new Date().toISOString(),
      modified: new Date().toISOString()
    };
    this.flashcards.set(id, fullCard);
    return id;
  }

  async getFlashcardsByDeck(deckId) {
    return Array.from(this.flashcards.values()).filter(card => card.deckId === deckId);
  }

  async getFlashcardById(id) {
    return this.flashcards.get(id) || null;
  }

  getDeckStats(deckId) {
    const cards = Array.from(this.flashcards.values()).filter(card => card.deckId === deckId);
    const now = new Date();

    return {
      deckId,
      totalCount: cards.length,
      newCount: cards.filter(card => card.state === 'new').length,
      dueCount: cards.filter(card => new Date(card.dueDate) <= now).length,
      matureCount: cards.filter(card => card.interval > 30240).length
    };
  }

  updateFlashcard(id, updates) {
    const card = this.flashcards.get(id);
    if (card) {
      Object.assign(card, updates);
    }
  }
}

// Flashcard Parser
class FlashcardParser {
  parseFlashcards(content, deckId, filePath, headerLevel = 2) {
    const flashcards = [];
    const lines = content.split('\n');

    // Parse header-paragraph format
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      if (line.startsWith('#'.repeat(headerLevel) + ' ')) {
        const question = line.substring(headerLevel + 1).trim();
        let answer = '';

        // Get the next non-empty line as answer
        for (let j = i + 1; j < lines.length; j++) {
          if (lines[j].trim() && !lines[j].startsWith('#')) {
            answer = lines[j].trim();
            break;
          }
        }

        if (answer) {
          flashcards.push({
            deckId,
            front: question,
            back: answer,
            type: 'header-paragraph',
            sourceFile: filePath,
            state: 'new',
            dueDate: new Date().toISOString(),
            interval: 0,
            repetitions: 0,
            difficulty: 2.5,
            lapses: 0,
            lastReviewed: null
          });
        }
      }
    }

    // Parse table format
    const tableRows = lines.filter(line => line.includes('| **') && line.includes('** |'));
    for (const row of tableRows) {
      const cells = row.split('|').map(cell => cell.trim());
      if (cells.length >= 3) {
        const question = cells[1].replace(/\*\*/g, '').trim();
        const answer = cells[2].replace(/\*\*/g, '').trim();

        if (question && answer) {
          flashcards.push({
            deckId,
            front: question,
            back: answer,
            type: 'table',
            sourceFile: filePath,
            state: 'new',
            dueDate: new Date().toISOString(),
            interval: 0,
            repetitions: 0,
            difficulty: 2.5,
            lapses: 0,
            lastReviewed: null
          });
        }
      }
    }

    return flashcards;
  }
}

// Main Console Demo Class
class ConsoleFlashcardsDemo {
  constructor() {
    this.db = new MockDatabase();
    this.parser = new FlashcardParser();
    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });
    this.currentDeck = null;
    this.currentSession = null;
  }

  async question(prompt) {
    return new Promise(resolve => {
      this.rl.question(prompt, resolve);
    });
  }

  async showMenu() {
    console.log('\n' + '='.repeat(50));
    console.log('🎴 DECKS PLUGIN - CONSOLE DEMO');
    console.log('='.repeat(50));
    console.log('1. Create sample deck');
    console.log('2. List decks');
    console.log('3. Review flashcards');
    console.log('4. Show deck statistics');
    console.log('5. Exit');
    console.log('='.repeat(50));

    const choice = await this.question('Choose an option (1-5): ');
    return choice.trim();
  }

  async createSampleDeck() {
    console.log('\n📚 Creating Sample Deck...');

    const sampleContent = `---
tags: [flashcards]
---

# JavaScript Fundamentals

#flashcards

## What is a closure in JavaScript?
A closure is a function that has access to variables in its outer (enclosing) scope even after the outer function has returned.

## What does "hoisting" mean in JavaScript?
Hoisting is JavaScript's behavior of moving variable and function declarations to the top of their scope during compilation.

## What is the difference between == and === in JavaScript?
== performs type coercion and compares values, while === compares both value and type without coercion.

| **Question** | **Answer** |
|--------------|------------|
| **What is the keyword to declare a variable in ES6?** | let or const |
| **What is an arrow function?** | A shorter way to write functions using => syntax |
| **What is destructuring?** | A way to extract values from arrays or objects into variables |
`;

    const deckName = 'JavaScript Fundamentals';
    const deckId = await this.db.createDeck({
      name: deckName,
      filepath: 'sample-deck.md',
      tag: '#flashcards',
      config: {
        headerLevel: 2,
        newCardsPerDay: 20,
        reviewCardsPerDay: 100
      }
    });

    const flashcards = this.parser.parseFlashcards(sampleContent, deckId, 'sample-deck.md');

    for (const flashcard of flashcards) {
      await this.db.createFlashcard(flashcard);
    }

    console.log(`✅ Created deck "${deckName}" with ${flashcards.length} flashcards`);
    this.currentDeck = await this.db.getDeckById(deckId);
  }

  async listDecks() {
    console.log('\n📚 Available Decks:');
    const decks = await this.db.getAllDecks();

    if (decks.length === 0) {
      console.log('No decks available. Create a sample deck first!');
      return;
    }

    decks.forEach((deck, index) => {
      const stats = this.db.getDeckStats(deck.id);
      console.log(`${index + 1}. ${deck.name} (${stats.totalCount} cards, ${stats.dueCount} due)`);
    });

    const choice = await this.question('\nSelect a deck (number) or press Enter to continue: ');
    const deckIndex = parseInt(choice) - 1;

    if (!isNaN(deckIndex) && deckIndex >= 0 && deckIndex < decks.length) {
      this.currentDeck = decks[deckIndex];
      console.log(`✅ Selected deck: ${this.currentDeck.name}`);
    }
  }

  async reviewFlashcards() {
    if (!this.currentDeck) {
      console.log('\n❌ No deck selected. Please select a deck first.');
      return;
    }

    const stats = this.db.getDeckStats(this.currentDeck.id);

    if (stats.totalCount === 0) {
      console.log('\n📭 No flashcards in this deck.');
      return;
    }

    if (stats.dueCount === 0) {
      console.log('\n🎉 All cards are up to date! No reviews needed.');
      return;
    }

    console.log(`\n🎯 Starting review session for "${this.currentDeck.name}"`);
    console.log(`📊 ${stats.dueCount} cards due for review`);
    console.log('');

    const cards = await this.db.getFlashcardsByDeck(this.currentDeck.id);
    const dueCards = cards.filter(card => new Date(card.dueDate) <= new Date());

    let reviewCount = 0;
    const maxReviews = Math.min(5, dueCards.length); // Limit to 5 for demo

    for (let i = 0; i < maxReviews; i++) {
      const card = dueCards[i];

      console.log('\n' + '─'.repeat(60));
      console.log(`📝 Card ${i + 1} of ${maxReviews}`);
      console.log('─'.repeat(60));
      console.log(`❓ ${card.front}`);
      console.log('');

      await this.question('Press Enter to reveal answer...');

      console.log(`💡 ${card.back}`);
      console.log('');
      console.log('Rate your recall:');
      console.log('1. Again (forgot completely)');
      console.log('2. Hard (remembered with difficulty)');
      console.log('3. Good (remembered easily)');
      console.log('4. Easy (too easy)');

      let rating;
      do {
        const input = await this.question('Your rating (1-4): ');
        rating = parseInt(input);
      } while (rating < 1 || rating > 4);

      // Update card based on rating
      const intervals = [1, 6, 1440, 4320]; // 1min, 6min, 1day, 3days
      const ratingLabels = ['Again', 'Hard', 'Good', 'Easy'];

      card.repetitions += 1;
      card.interval = intervals[rating - 1];
      card.dueDate = new Date(Date.now() + card.interval * 60 * 1000).toISOString();
      card.state = 'review';
      card.lastReviewed = new Date().toISOString();

      if (rating === 1) {
        card.lapses += 1;
      }

      this.db.updateFlashcard(card.id, card);

      console.log(`✅ Rated as: ${ratingLabels[rating - 1]}`);
      console.log(`📅 Next review: ${new Date(card.dueDate).toLocaleString()}`);

      reviewCount++;
    }

    console.log('\n' + '='.repeat(50));
    console.log(`🎉 Review session complete! Reviewed ${reviewCount} cards.`);

    if (dueCards.length > maxReviews) {
      console.log(`📝 ${dueCards.length - maxReviews} more cards available for review.`);
    }
  }

  async showStatistics() {
    if (!this.currentDeck) {
      console.log('\n❌ No deck selected. Please select a deck first.');
      return;
    }

    const stats = this.db.getDeckStats(this.currentDeck.id);
    const cards = await this.db.getFlashcardsByDeck(this.currentDeck.id);

    console.log(`\n📊 Statistics for "${this.currentDeck.name}":`);
    console.log('='.repeat(40));
    console.log(`📚 Total Cards: ${stats.totalCount}`);
    console.log(`🆕 New Cards: ${stats.newCount}`);
    console.log(`⏰ Due for Review: ${stats.dueCount}`);
    console.log(`🎓 Mature Cards: ${stats.matureCount}`);

    if (cards.length > 0) {
      console.log('\n📝 Recent Cards:');
      cards.slice(0, 3).forEach((card, i) => {
        const typeIcon = card.type === 'table' ? '📋' : '📄';
        console.log(`  ${i + 1}. ${typeIcon} ${card.front.substring(0, 40)}...`);
        console.log(`     State: ${card.state}, Reviews: ${card.repetitions}`);
      });
    }
  }

  async run() {
    console.log('🚀 Welcome to Decks Plugin Console Demo!');
    console.log('This demo shows the core flashcard functionality.');

    try {
      while (true) {
        const choice = await this.showMenu();

        switch (choice) {
          case '1':
            await this.createSampleDeck();
            break;
          case '2':
            await this.listDecks();
            break;
          case '3':
            await this.reviewFlashcards();
            break;
          case '4':
            await this.showStatistics();
            break;
          case '5':
            console.log('\n👋 Thanks for trying Decks Plugin!');
            console.log('Visit the full plugin in Obsidian for more features.');
            return;
          default:
            console.log('\n❌ Invalid choice. Please select 1-5.');
        }

        await this.question('\nPress Enter to continue...');
      }
    } catch (error) {
      console.error('\n❌ Error:', error.message);
    } finally {
      this.rl.close();
    }
  }
}

// Run the demo
if (require.main === module) {
  const demo = new ConsoleFlashcardsDemo();
  demo.run().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}

module.exports = { ConsoleFlashcardsDemo };
