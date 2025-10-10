#!/usr/bin/env node

/**
 * Simple standalone test for console functionality
 * Tests core concepts without complex dependencies
 */

const fs = require("fs").promises;
const path = require("path");

// Mock implementations for testing
class MockDatabase {
  constructor() {
    this.decks = new Map();
    this.flashcards = new Map();
    this.reviewLogs = [];
    this.sessions = new Map();
  }

  async createDeck(deck) {
    const id = `deck_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const fullDeck = {
      id,
      ...deck,
      created: new Date().toISOString(),
      modified: new Date().toISOString(),
    };
    this.decks.set(id, fullDeck);
    return id;
  }

  async getDeckById(id) {
    return this.decks.get(id) || null;
  }

  async getDeckByFilepath(filepath) {
    for (const deck of this.decks.values()) {
      if (deck.filepath === filepath) {
        return deck;
      }
    }
    return null;
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
      modified: new Date().toISOString(),
    };
    this.flashcards.set(id, fullCard);
    return id;
  }

  async getFlashcardsByDeck(deckId) {
    return Array.from(this.flashcards.values()).filter(
      (card) => card.deckId === deckId,
    );
  }

  async getFlashcardById(id) {
    return this.flashcards.get(id) || null;
  }

  getDeckStats(deckId) {
    const cards = Array.from(this.flashcards.values()).filter(
      (card) => card.deckId === deckId,
    );
    const now = new Date();

    return {
      deckId,
      totalCount: cards.length,
      newCount: cards.filter((card) => card.state === "new").length,
      dueCount: cards.filter((card) => new Date(card.dueDate) <= now).length,
      matureCount: cards.filter((card) => card.interval > 30240).length, // > 21 days
    };
  }
}

class MockFlashcardParser {
  parseFlashcards(content, deckId, filePath, headerLevel = 2) {
    const flashcards = [];

    // Parse header-paragraph format
    const headerRegex = new RegExp(`^#{${headerLevel}}\\s+(.+)$`, "gm");
    const lines = content.split("\n");

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // Check if line matches header pattern
      if (line.startsWith("#".repeat(headerLevel) + " ")) {
        const question = line.substring(headerLevel + 1).trim();
        let answer = "";

        // Get the next non-empty line as answer
        for (let j = i + 1; j < lines.length; j++) {
          if (lines[j].trim() && !lines[j].startsWith("#")) {
            answer = lines[j].trim();
            break;
          }
        }

        if (answer) {
          flashcards.push({
            deckId,
            front: question,
            back: answer,
            type: "header-paragraph",
            sourceFile: filePath,
            contentHash: this.hashContent(answer),
            state: "new",
            dueDate: new Date().toISOString(),
            interval: 0,
            repetitions: 0,
            difficulty: 2.5,
            stability: 1,
            lapses: 0,
            lastReviewed: null,
          });
        }
      }
    }

    // Parse table format
    const tableRows = lines.filter(
      (line) => line.includes("| **") && line.includes("** |"),
    );
    for (const row of tableRows) {
      const cells = row.split("|").map((cell) => cell.trim());
      if (cells.length >= 3) {
        const question = cells[1].replace(/\*\*/g, "").trim();
        const answer = cells[2].replace(/\*\*/g, "").trim();

        if (question && answer) {
          flashcards.push({
            deckId,
            front: question,
            back: answer,
            type: "table",
            sourceFile: filePath,
            contentHash: this.hashContent(answer),
            state: "new",
            dueDate: new Date().toISOString(),
            interval: 0,
            repetitions: 0,
            difficulty: 2.5,
            stability: 1,
            lapses: 0,
            lastReviewed: null,
          });
        }
      }
    }

    return flashcards;
  }

  hashContent(content) {
    let hash = 0;
    for (let i = 0; i < content.length; i++) {
      const char = content.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return Math.abs(hash).toString(36);
  }
}

// Simple console implementation
class SimpleConsoleFlashcards {
  constructor(vaultPath, dataPath) {
    this.vaultPath = vaultPath;
    this.dataPath = dataPath;
    this.db = new MockDatabase();
    this.parser = new MockFlashcardParser();
    this.initialized = false;
  }

  async initialize() {
    await fs.mkdir(this.dataPath, { recursive: true });
    this.initialized = true;
    console.log("✅ SimpleConsoleFlashcards initialized");
  }

  async scanMarkdownFiles() {
    if (!this.initialized) throw new Error("Not initialized");

    const files = [];

    async function scanDir(dir) {
      try {
        const entries = await fs.readdir(dir, { withFileTypes: true });
        for (const entry of entries) {
          const fullPath = path.join(dir, entry.name);
          const relativePath = path.relative(this.vaultPath, fullPath);

          if (entry.isDirectory()) {
            await scanDir.call(this, fullPath);
          } else if (entry.isFile() && entry.name.endsWith(".md")) {
            try {
              const content = await fs.readFile(fullPath, "utf-8");
              const hasFlashcards =
                content.includes("#flashcards") ||
                content.includes("| **") ||
                /^#{1,6}\s+/.test(content);
              files.push({ path: relativePath, hasFlashcards });
            } catch (error) {
              console.warn(`Could not read ${relativePath}:`, error.message);
              files.push({ path: relativePath, hasFlashcards: false });
            }
          }
        }
      } catch (error) {
        console.warn(`Could not scan directory ${dir}:`, error.message);
      }
    }

    await scanDir.call(this, this.vaultPath);
    return files;
  }

  async createDeckFromFile(filePath, name, tag = "#flashcards") {
    if (!this.initialized) throw new Error("Not initialized");

    const fullPath = path.resolve(this.vaultPath, filePath);
    const content = await fs.readFile(fullPath, "utf-8");

    const deckName = name || path.basename(filePath, ".md");
    const deckId = await this.db.createDeck({
      name: deckName,
      filepath: filePath,
      tag,
      lastReviewed: null,
      config: {
        hasNewCardsLimitEnabled: false,
        newCardsPerDay: 20,
        hasReviewCardsLimitEnabled: false,
        reviewCardsPerDay: 100,
        headerLevel: 2,
        reviewOrder: "due-date",
        fsrs: {
          requestRetention: 0.9,
          profile: "STANDARD",
        },
      },
    });

    return this.db.getDeckById(deckId);
  }

  async syncDeck(deckId) {
    if (!this.initialized) throw new Error("Not initialized");

    const deck = await this.db.getDeckById(deckId);
    if (!deck) throw new Error(`Deck not found: ${deckId}`);

    const fullPath = path.resolve(this.vaultPath, deck.filepath);
    const content = await fs.readFile(fullPath, "utf-8");

    const flashcards = this.parser.parseFlashcards(
      content,
      deckId,
      deck.filepath,
      deck.config.headerLevel,
    );

    for (const flashcard of flashcards) {
      await this.db.createFlashcard(flashcard);
    }

    console.log(
      `🔄 Synced ${flashcards.length} flashcards for deck ${deck.name}`,
    );
    return flashcards.length;
  }

  async getDecks() {
    if (!this.initialized) throw new Error("Not initialized");
    return this.db.getAllDecks();
  }

  async getDeckStats(deckId) {
    if (!this.initialized) throw new Error("Not initialized");
    return this.db.getDeckStats(deckId);
  }

  async getFlashcards(deckId) {
    if (!this.initialized) throw new Error("Not initialized");
    return this.db.getFlashcardsByDeck(deckId);
  }

  async reviewCard(cardId, rating) {
    if (!this.initialized) throw new Error("Not initialized");

    const card = await this.db.getFlashcardById(cardId);
    if (!card) throw new Error(`Card not found: ${cardId}`);

    // Simple FSRS-like update
    const ratingLabels = ["Again", "Hard", "Good", "Easy"];
    const intervals = [1, 6, 1440, 4320]; // 1min, 6min, 1day, 3days

    card.repetitions += 1;
    card.interval = intervals[rating - 1] || 1440;
    card.dueDate = new Date(
      Date.now() + card.interval * 60 * 1000,
    ).toISOString();
    card.state = "review";
    card.lastReviewed = new Date().toISOString();

    if (rating === 1) {
      card.lapses += 1;
    }

    console.log(
      `📝 Rated "${card.front.substring(0, 30)}..." as ${ratingLabels[rating - 1]}`,
    );
    return card;
  }

  async close() {
    console.log("👋 SimpleConsoleFlashcards closed");
  }
}

// Test function
async function runTest() {
  console.log("🧪 Simple Console Test");
  console.log("======================\n");

  const testDir = path.join(process.cwd(), ".simple-test");
  const vaultPath = path.join(testDir, "vault");
  const dataPath = path.join(testDir, "data");

  try {
    // Setup
    await fs.mkdir(vaultPath, { recursive: true });

    // Create test file
    const testFile = path.join(vaultPath, "test-deck.md");
    const content = `---
tags: [flashcards]
---

# Test Flashcards

#flashcards

## What is the capital of France?
Paris is the capital and largest city of France.

## What is 2 + 2?
Four (4)

| **Question** | **Answer** |
|--------------|------------|
| **What is the largest planet?** | Jupiter |
| **What is H2O?** | Water |
`;

    await fs.writeFile(testFile, content);
    console.log("📁 Created test file");

    // Initialize console
    const flashcards = new SimpleConsoleFlashcards(vaultPath, dataPath);
    await flashcards.initialize();

    // Test scanning
    console.log("\n🔍 Scanning files...");
    const files = await flashcards.scanMarkdownFiles();
    const flashcardFiles = files.filter((f) => f.hasFlashcards);
    console.log(`Found ${flashcardFiles.length} files with flashcards:`);
    flashcardFiles.forEach((file, i) =>
      console.log(`  ${i + 1}. ${file.path}`),
    );

    // Create deck
    console.log("\n📚 Creating deck...");
    const deck = await flashcards.createDeckFromFile(
      "test-deck.md",
      "Test Deck",
    );
    console.log(`Created: ${deck.name} (${deck.id})`);

    // Sync flashcards
    console.log("\n🔄 Syncing flashcards...");
    const syncCount = await flashcards.syncDeck(deck.id);

    // Get stats
    console.log("\n📊 Getting statistics...");
    const stats = await flashcards.getDeckStats(deck.id);
    console.log(
      `Stats: ${stats.totalCount} total, ${stats.newCount} new, ${stats.dueCount} due`,
    );

    // Get flashcards
    const cards = await flashcards.getFlashcards(deck.id);
    console.log(`\n🃏 Retrieved ${cards.length} flashcards:`);
    cards.forEach((card, i) => {
      console.log(`  ${i + 1}. Q: ${card.front}`);
      console.log(`     A: ${card.back}`);
      console.log(`     Type: ${card.type}, State: ${card.state}`);
    });

    // Test reviewing cards
    if (cards.length > 0) {
      console.log("\n🎯 Testing card review...");
      for (let i = 0; i < Math.min(2, cards.length); i++) {
        const card = cards[i];
        const rating = Math.floor(Math.random() * 4) + 1; // Random 1-4
        await flashcards.reviewCard(card.id, rating);
      }
    }

    // Final stats
    console.log("\n📈 Final statistics...");
    const finalStats = await flashcards.getDeckStats(deck.id);
    console.log(
      `Final: ${finalStats.totalCount} total, ${finalStats.newCount} new, ${finalStats.dueCount} due`,
    );

    await flashcards.close();

    console.log("\n🎉 Test completed successfully!");
  } catch (error) {
    console.error("\n❌ Test failed:", error);
    process.exit(1);
  } finally {
    // Cleanup
    try {
      await fs.rm(testDir, { recursive: true, force: true });
      console.log("🧹 Cleaned up test directory");
    } catch (error) {
      console.warn("⚠️  Cleanup warning:", error.message);
    }
  }
}

// Run the test
if (require.main === module) {
  runTest().catch((error) => {
    console.error("Fatal error:", error);
    process.exit(1);
  });
}
