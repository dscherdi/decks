#!/usr/bin/env node

/**
 * Automated Console Demo for Decks Plugin
 * Shows all features without requiring user input
 */

const fs = require('fs').promises;
const path = require('path');

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

// Auto Demo Class
class AutoDemo {
  constructor() {
    this.db = new MockDatabase();
    this.parser = new FlashcardParser();
  }

  async delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  async typeEffect(text, delayMs = 50) {
    for (const char of text) {
      process.stdout.write(char);
      await this.delay(delayMs);
    }
    console.log();
  }

  async showHeader() {
    console.clear();
    console.log('🎴 '.repeat(20));
    console.log('🚀 DECKS PLUGIN - AUTOMATED DEMO');
    console.log('🎴 '.repeat(20));
    console.log();
    await this.delay(1000);
  }

  async step1_CreateDeck() {
    console.log('📚 STEP 1: Creating Sample Deck');
    console.log('='.repeat(40));
    await this.delay(500);

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
| **What is a Promise?** | An object representing eventual completion of an async operation |
`;

    console.log('📝 Parsing markdown content...');
    await this.delay(1000);

    const deckName = 'JavaScript Fundamentals';
    const deckId = await this.db.createDeck({
      name: deckName,
      filepath: 'javascript-fundamentals.md',
      tag: '#flashcards',
      config: {
        headerLevel: 2,
        newCardsPerDay: 20,
        reviewCardsPerDay: 100
      }
    });

    const flashcards = this.parser.parseFlashcards(sampleContent, deckId, 'javascript-fundamentals.md');

    for (const flashcard of flashcards) {
      await this.db.createFlashcard(flashcard);
    }

    console.log(`✅ Created deck "${deckName}"`);
    console.log(`📊 Parsed ${flashcards.length} flashcards:`);
    console.log(`   • ${flashcards.filter(c => c.type === 'header-paragraph').length} header-paragraph cards`);
    console.log(`   • ${flashcards.filter(c => c.type === 'table').length} table format cards`);

    await this.delay(2000);
    return deckId;
  }

  async step2_ShowDeckStats(deckId) {
    console.log('\n📊 STEP 2: Deck Statistics');
    console.log('='.repeat(40));
    await this.delay(500);

    const stats = this.db.getDeckStats(deckId);
    const cards = await this.db.getFlashcardsByDeck(deckId);

    console.log(`📚 Total Cards: ${stats.totalCount}`);
    console.log(`🆕 New Cards: ${stats.newCount}`);
    console.log(`⏰ Due for Review: ${stats.dueCount}`);
    console.log(`🎓 Mature Cards: ${stats.matureCount}`);

    console.log('\n🃏 Sample Cards:');
    cards.slice(0, 3).forEach((card, i) => {
      const typeIcon = card.type === 'table' ? '📋' : '📄';
      console.log(`  ${i + 1}. ${typeIcon} ${card.front.substring(0, 50)}...`);
    });

    await this.delay(2000);
  }

  async step3_ReviewSession(deckId) {
    console.log('\n🎯 STEP 3: Review Session Simulation');
    console.log('='.repeat(40));
    await this.delay(500);

    const cards = await this.db.getFlashcardsByDeck(deckId);
    const reviewCards = cards.slice(0, 3); // Review first 3 cards

    console.log(`🚀 Starting review session with ${reviewCards.length} cards...\n`);

    for (let i = 0; i < reviewCards.length; i++) {
      const card = reviewCards[i];

      console.log('─'.repeat(60));
      console.log(`📝 Card ${i + 1} of ${reviewCards.length}`);
      console.log('─'.repeat(60));

      await this.typeEffect(`❓ ${card.front}`, 30);
      console.log();

      console.log('💭 Thinking...');
      await this.delay(1500);

      console.log('💡 Answer revealed:');
      await this.typeEffect(`${card.back}`, 20);
      console.log();

      // Simulate rating
      const ratings = [2, 3, 4]; // Hard, Good, Easy
      const ratingLabels = ['Again', 'Hard', 'Good', 'Easy'];
      const intervals = [1, 6, 1440, 4320]; // 1min, 6min, 1day, 3days

      const rating = ratings[Math.floor(Math.random() * ratings.length)];

      console.log(`🎯 Auto-rating: ${rating} (${ratingLabels[rating]})`);

      // Update card
      card.repetitions += 1;
      card.interval = intervals[rating - 1];
      card.dueDate = new Date(Date.now() + card.interval * 60 * 1000).toISOString();
      card.state = 'review';
      card.lastReviewed = new Date().toISOString();

      if (rating === 1) {
        card.lapses += 1;
      }

      this.db.updateFlashcard(card.id, card);

      const nextReview = new Date(card.dueDate);
      console.log(`📅 Next review: ${nextReview.toLocaleString()}`);
      console.log();

      await this.delay(1000);
    }

    console.log('🎉 Review session complete!');
    await this.delay(1500);
  }

  async step4_UpdatedStats(deckId) {
    console.log('\n📈 STEP 4: Updated Statistics');
    console.log('='.repeat(40));
    await this.delay(500);

    const stats = this.db.getDeckStats(deckId);
    const cards = await this.db.getFlashcardsByDeck(deckId);

    console.log('📊 After review session:');
    console.log(`📚 Total Cards: ${stats.totalCount}`);
    console.log(`🆕 New Cards: ${stats.newCount}`);
    console.log(`⏰ Due for Review: ${stats.dueCount}`);
    console.log(`🔄 Reviewed Cards: ${cards.filter(c => c.state === 'review').length}`);

    console.log('\n📝 Card States:');
    const stateCounts = {};
    cards.forEach(card => {
      stateCounts[card.state] = (stateCounts[card.state] || 0) + 1;
    });

    Object.entries(stateCounts).forEach(([state, count]) => {
      const icon = state === 'new' ? '🆕' : '🔄';
      console.log(`  ${icon} ${state}: ${count} cards`);
    });

    await this.delay(2000);
  }

  async step5_MultipleDecks() {
    console.log('\n🗂️  STEP 5: Multiple Decks Demo');
    console.log('='.repeat(40));
    await this.delay(500);

    // Create second deck
    const pythonContent = `# Python Basics

#flashcards

## What is a list comprehension?
A concise way to create lists using a single line of code with optional filtering.

## What does PEP 8 define?
The style guide for Python code formatting and conventions.

| **Question** | **Answer** |
|--------------|------------|
| **What is the difference between list and tuple?** | Lists are mutable, tuples are immutable |
| **What is __init__?** | Constructor method called when object is created |
`;

    const pythonDeckId = await this.db.createDeck({
      name: 'Python Basics',
      filepath: 'python-basics.md',
      tag: '#flashcards'
    });

    const pythonCards = this.parser.parseFlashcards(pythonContent, pythonDeckId, 'python-basics.md');
    for (const card of pythonCards) {
      await this.db.createFlashcard(card);
    }

    console.log('✅ Created second deck: Python Basics');

    // Show all decks
    const allDecks = await this.db.getAllDecks();
    console.log('\n📚 All Decks:');
    allDecks.forEach((deck, index) => {
      const stats = this.db.getDeckStats(deck.id);
      console.log(`  ${index + 1}. ${deck.name}`);
      console.log(`     📊 ${stats.totalCount} cards (${stats.newCount} new, ${stats.dueCount} due)`);
    });

    await this.delay(2000);
  }

  async step6_Summary() {
    console.log('\n🎊 STEP 6: Demo Summary');
    console.log('='.repeat(40));
    await this.delay(500);

    const allDecks = await this.db.getAllDecks();
    const allCards = [];
    for (const deck of allDecks) {
      const cards = await this.db.getFlashcardsByDeck(deck.id);
      allCards.push(...cards);
    }

    console.log('🏆 Demo Complete! Here\'s what we demonstrated:');
    console.log();
    console.log('✅ Markdown File Parsing:');
    console.log('   • Header-paragraph format (## Question \\n Answer)');
    console.log('   • Table format (| **Question** | Answer |)');
    console.log();
    console.log('✅ Deck Management:');
    console.log(`   • Created ${allDecks.length} decks`);
    console.log(`   • Parsed ${allCards.length} total flashcards`);
    console.log();
    console.log('✅ Review System:');
    console.log('   • FSRS-style spaced repetition');
    console.log('   • 4-point rating system (Again/Hard/Good/Easy)');
    console.log('   • Automatic scheduling');
    console.log();
    console.log('✅ Statistics Tracking:');
    console.log('   • Card states (new/review/mature)');
    console.log('   • Due dates and intervals');
    console.log('   • Review history');
    console.log();
    console.log('🚀 Features Available in Full Plugin:');
    console.log('   • Obsidian integration');
    console.log('   • Advanced FSRS-4.5 algorithm');
    console.log('   • Progress tracking and analytics');
    console.log('   • Backup and restore');
    console.log('   • Custom deck settings');
    console.log('   • Interactive review sessions');

    await this.delay(3000);
  }

  async run() {
    try {
      await this.showHeader();

      const deckId = await this.step1_CreateDeck();
      await this.step2_ShowDeckStats(deckId);
      await this.step3_ReviewSession(deckId);
      await this.step4_UpdatedStats(deckId);
      await this.step5_MultipleDecks();
      await this.step6_Summary();

      console.log('\n👋 Thank you for watching the Decks Plugin demo!');
      console.log('💡 Try the interactive version with: node console-demo.js');

    } catch (error) {
      console.error('\n❌ Demo error:', error.message);
    }
  }
}

// Run the automated demo
if (require.main === module) {
  const demo = new AutoDemo();
  demo.run().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}

module.exports = { AutoDemo };
