#!/usr/bin/env node

/**
 * Simple test script to verify console functionality
 * Tests basic operations without requiring actual markdown files
 */

import { ConsoleCore } from "./core/ConsoleCore";
import * as path from "path";
import * as fs from "fs";

async function testConsoleCore() {
  console.log("🧪 Testing Console Core");
  console.log("=======================\n");

  let success = true;
  const testDir = path.join(process.cwd(), ".test-console");
  const testVault = path.join(testDir, "vault");
  const testData = path.join(testDir, "data");

  try {
    // Setup test environment
    console.log("📁 Setting up test environment...");
    await fs.promises.mkdir(testVault, { recursive: true });
    await fs.promises.mkdir(testData, { recursive: true });

    // Create test markdown file
    const testFile = path.join(testVault, "test-deck.md");
    const testContent = `---
tags: [flashcards]
---

# Test Deck

#flashcards

## What is the capital of France?
Paris

## What is 2 + 2?
4

| **Question** | **Answer** |
|--------------|------------|
| **What is the largest planet?** | Jupiter |
| **What is the smallest prime number?** | 2 |
`;

    await fs.promises.writeFile(testFile, testContent);
    console.log("✅ Created test markdown file");

    // Initialize console core
    console.log("\n🔧 Initializing ConsoleCore...");
    const core = new ConsoleCore({
      dataPath: testData,
      vaultPath: testVault,
      debug: true,
    });

    await core.initialize({
      dataPath: testData,
      vaultPath: testVault,
    });
    console.log("✅ ConsoleCore initialized");

    // Test file scanning
    console.log("\n🔍 Testing file scanning...");
    const files = await core.scanMarkdownFiles();
    const flashcardFiles = files.filter((f) => f.hasFlashcards);

    if (flashcardFiles.length === 0) {
      throw new Error("No flashcard files found");
    }
    console.log(`✅ Found ${flashcardFiles.length} flashcard file(s)`);

    // Test deck creation
    console.log("\n📚 Testing deck creation...");
    const deck = await core.createDeckFromFile("test-deck.md", "Test Deck");

    if (!deck || !deck.id) {
      throw new Error("Failed to create deck");
    }
    console.log(`✅ Created deck: ${deck.name} (${deck.id})`);

    // Test deck sync
    console.log("\n🔄 Testing deck sync...");
    await core.syncDeck(deck.id);
    console.log("✅ Synced deck");

    // Test getting flashcards
    console.log("\n🃏 Testing flashcard retrieval...");
    const flashcards = await core.getFlashcards(deck.id);

    if (flashcards.length === 0) {
      throw new Error("No flashcards found");
    }
    console.log(`✅ Retrieved ${flashcards.length} flashcards`);

    // Test deck stats
    console.log("\n📊 Testing deck statistics...");
    const stats = await core.getDeckStats(deck.id);

    if (stats.totalCount !== flashcards.length) {
      throw new Error(
        `Stats mismatch: expected ${flashcards.length}, got ${stats.totalCount}`
      );
    }
    console.log(
      `✅ Stats: ${stats.totalCount} total, ${stats.newCount} new, ${stats.dueCount} due`
    );

    // Test review session (if cards available)
    if (stats.totalCount > 0) {
      console.log("\n🎯 Testing review session...");
      const session = await core.startReviewSession(deck.id);

      if (!session.sessionId) {
        throw new Error("Failed to start review session");
      }
      console.log(`✅ Started session: ${session.sessionId}`);

      // Test getting next card
      const nextCard = await core.getNextCard(deck.id);
      if (nextCard) {
        console.log(`✅ Got next card: ${nextCard.front.substring(0, 30)}...`);

        // Test card preview
        try {
          const preview = await core.previewCard(nextCard.id);
          console.log(
            `✅ Preview: Again=${preview.again.interval}, Good=${preview.good.interval}`
          );
        } catch (error) {
          console.log(`⚠️  Preview test failed: ${error}`);
        }

        // Test card rating
        const updatedCard = await core.reviewCard(nextCard.id, 3); // Good
        console.log(
          `✅ Rated card: ${updatedCard.state}, next due: ${updatedCard.dueDate}`
        );
      }

      await core.endReviewSession();
      console.log("✅ Ended review session");
    }

    // Test overall stats
    console.log("\n📈 Testing overall statistics...");
    const overallStats = await core.getOverallStats();
    console.log(
      `✅ Overall: ${overallStats.totalDecks} decks, ${overallStats.totalCards} cards`
    );

    // Test backup
    console.log("\n💾 Testing backup...");
    const backupFile = await core.createBackup();
    console.log(`✅ Created backup: ${backupFile}`);

    const backups = await core.listBackups();
    if (backups.length === 0) {
      throw new Error("No backups found after creation");
    }
    console.log(`✅ Listed ${backups.length} backup(s)`);

    // Clean up
    await core.close();
    console.log("\n✅ ConsoleCore closed");
  } catch (error) {
    console.error("\n❌ Test failed:", error);
    success = false;
  } finally {
    // Cleanup test directory
    try {
      await fs.promises.rm(testDir, { recursive: true, force: true });
      console.log("🧹 Cleaned up test directory");
    } catch (error) {
      console.warn("⚠️  Failed to cleanup test directory:", error);
    }
  }

  console.log("\n" + "=".repeat(40));
  if (success) {
    console.log("🎉 All tests passed!");
    process.exit(0);
  } else {
    console.log("💥 Tests failed!");
    process.exit(1);
  }
}

// Run tests
if (require.main === module) {
  testConsoleCore().catch((error) => {
    console.error("Fatal error:", error);
    process.exit(1);
  });
}

export { testConsoleCore };
