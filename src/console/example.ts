#!/usr/bin/env node

/**
 * Example script demonstrating console usage of flashcards plugin
 * Shows how to use existing business logic without UI dependencies
 */

import { createFlashcardsConsole, runCLI } from "./console";
import * as path from "path";

async function basicExample() {
  console.log("📚 Basic Console Example");
  console.log("========================\n");

  try {
    // Initialize with current directory as vault
    const flashcards = await createFlashcardsConsole(
      process.cwd(), // vault path
      path.join(process.cwd(), ".flashcards-console") // data path
    );

    console.log("✅ Flashcards console initialized");

    // Scan for markdown files
    console.log("\n🔍 Scanning for flashcard files...");
    const files = await flashcards.scanMarkdownFiles();
    const flashcardFiles = files.filter(
      (f: { hasFlashcards: boolean }) => f.hasFlashcards
    );

    console.log(`📄 Found ${files.length} markdown files`);
    console.log(`⚡ ${flashcardFiles.length} contain flashcards`);

    if (flashcardFiles.length > 0) {
      console.log("\nFiles with flashcards:");
      flashcardFiles.forEach((file: { path: string }, i: number) => {
        console.log(`  ${i + 1}. ${file.path}`);
      });

      // Create deck from first flashcard file
      const firstFile = flashcardFiles[0];
      console.log(`\n📚 Creating deck from: ${firstFile.path}`);

      const deck = await flashcards.createDeckFromFile(
        firstFile.path,
        path.basename(firstFile.path, ".md")
      );

      console.log(`✅ Created deck: ${deck.name} (${deck.id})`);

      // Sync flashcards
      console.log("\n🔄 Syncing flashcards...");
      await flashcards.syncDeck(deck.id);

      // Get deck statistics
      const stats = await flashcards.getDeckStats(deck.id);
      console.log(
        `📊 Deck stats: ${stats.totalCount} total, ${stats.newCount} new, ${stats.dueCount} due`
      );

      // Try a review session
      if (stats.totalCount > 0) {
        console.log("\n🎯 Starting mini review session...");
        await flashcards.startReviewSession(deck.id);

        let reviewCount = 0;
        const maxReviews = 3;

        while (reviewCount < maxReviews) {
          const card = await flashcards.getNextCard(deck.id);
          if (!card) {
            console.log("No more cards available");
            break;
          }

          console.log(`\n━━━ Card ${reviewCount + 1} ━━━`);
          console.log(`❓ ${card.front}`);
          console.log(`💡 ${card.back}`);

          // Auto-rate as "Good" for demo
          const rating = 3;
          await flashcards.reviewCard(card.id, rating);
          console.log(`✅ Rated: Good`);

          reviewCount++;
        }

        await flashcards.endReviewSession();
        console.log(
          `\n🎉 Mini session complete! Reviewed ${reviewCount} cards`
        );
      }

      // Show overall statistics
      console.log("\n📈 Overall Statistics:");
      const overallStats = await flashcards.getOverallStats();
      console.log(`  📚 Total Decks: ${overallStats.totalDecks}`);
      console.log(`  🃏 Total Cards: ${overallStats.totalCards}`);
      console.log(`  🆕 New Cards: ${overallStats.newCards}`);
      console.log(`  ⏰ Due Cards: ${overallStats.dueCards}`);
      console.log(`  🎓 Mature Cards: ${overallStats.matureCards}`);

      // Create backup
      console.log("\n💾 Creating backup...");
      const backupFile = await flashcards.createBackup();
      console.log(`✅ Backup created: ${backupFile}`);
    } else {
      console.log("\n💡 No flashcards found. Create a markdown file with:");
      console.log("   • #flashcards tag");
      console.log("   • Header-paragraph format: # Question\\nAnswer");
      console.log("   • Table format: | **Question** | Answer |");
    }

    // Clean up
    await flashcards.close();
    console.log("\n👋 Example complete!");
  } catch (error) {
    console.error("❌ Error:", error);
    process.exit(1);
  }
}

async function cliExample() {
  console.log("🖥️  Starting Interactive CLI...\n");

  await runCLI({
    vaultPath: process.cwd(),
    dataPath: path.join(process.cwd(), ".flashcards-cli"),
    debug: false,
  });
}

async function programmaticExample() {
  console.log("🤖 Programmatic Review Example");
  console.log("===============================\n");

  try {
    const flashcards = await createFlashcardsConsole();

    // Get all decks
    const decks = await flashcards.getDecks();

    if (decks.length === 0) {
      console.log("No decks found. Run basic example first.");
      return;
    }

    for (const deck of decks) {
      console.log(`\n📚 Processing deck: ${deck.name}`);

      const stats = await flashcards.getDeckStats(deck.id);
      console.log(`📊 ${stats.totalCount} cards (${stats.dueCount} due)`);

      if (stats.dueCount > 0) {
        await flashcards.startReviewSession(deck.id);

        let card;
        let count = 0;
        const maxCards = 5; // Limit for demo

        while (
          (card = await flashcards.getNextCard(deck.id)) &&
          count < maxCards
        ) {
          console.log(`\n${count + 1}. ${card.front.substring(0, 50)}...`);

          // Simulate thinking time
          await new Promise((resolve) => setTimeout(resolve, 100));

          // Auto-rate with some randomness
          const ratings = [2, 3, 3, 4]; // Mostly good/easy
          const rating = ratings[Math.floor(Math.random() * ratings.length)];
          const labels = ["", "Again", "Hard", "Good", "Easy"];

          await flashcards.reviewCard(card.id, rating as 1 | 2 | 3 | 4);
          console.log(`   ✅ ${labels[rating]}`);

          count++;
        }

        await flashcards.endReviewSession();
        console.log(`   🎯 Completed ${count} reviews`);
      }
    }

    // Show final stats
    const finalStats = await flashcards.getOverallStats();
    console.log("\n📈 Final Statistics:");
    console.log(
      `   📚 ${finalStats.totalDecks} decks, ${finalStats.totalCards} cards`
    );
    console.log(`   🎓 ${finalStats.matureCards} mature cards`);

    await flashcards.close();
    console.log("\n🤖 Programmatic example complete!");
  } catch (error) {
    console.error("❌ Error:", error);
  }
}

// Main execution
async function main() {
  const args = process.argv.slice(2);
  const command = args[0] || "basic";

  switch (command) {
    case "basic":
      await basicExample();
      break;
    case "cli":
      await cliExample();
      break;
    case "auto":
      await programmaticExample();
      break;
    case "help":
    default:
      console.log("📚 Flashcards Console Examples");
      console.log("==============================");
      console.log("");
      console.log("Usage: node example.js [command]");
      console.log("");
      console.log("Commands:");
      console.log(
        "  basic    Run basic example with file scanning and deck creation"
      );
      console.log("  cli      Start interactive command-line interface");
      console.log("  auto     Run programmatic review session");
      console.log("  help     Show this help message");
      console.log("");
      console.log("Examples:");
      console.log("  node example.js basic");
      console.log("  node example.js cli");
      console.log("  node example.js auto");
      break;
  }
}

if (require.main === module) {
  main().catch(console.error);
}

export { basicExample, cliExample, programmaticExample };
