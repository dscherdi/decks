#!/usr/bin/env node

import * as readline from "readline";
import * as path from "path";
import { ConsoleCore, ReviewSession } from "./core/ConsoleCore";
import { Flashcard, Deck } from "../database/types";

export interface CLIOptions {
  vaultPath?: string;
  dataPath?: string;
  debug?: boolean;
}

export class FlashcardsCLI {
  private core: ConsoleCore;
  private rl: readline.Interface;
  private currentSession: ReviewSession | null = null;

  constructor(options: CLIOptions = {}) {
    const vaultPath = options.vaultPath || process.cwd();
    const dataPath = options.dataPath || path.join(vaultPath, ".flashcards");

    this.core = new ConsoleCore({
      dataPath,
      vaultPath,
      debug: options.debug,
    });

    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
  }

  async start(): Promise<void> {
    console.log("🧠 Flashcards Console");
    console.log("====================\n");

    try {
      await this.core.initialize({
        dataPath: path.join(process.cwd(), ".flashcards"),
        vaultPath: process.cwd(),
      });

      await this.showMainMenu();
    } catch (error) {
      console.error("❌ Failed to start:", error);
      process.exit(1);
    }
  }

  private async showMainMenu(): Promise<void> {
    while (true) {
      console.log("\n📚 Main Menu:");
      console.log("1. List decks");
      console.log("2. Scan for markdown files");
      console.log("3. Create deck from file");
      console.log("4. Sync all decks");
      console.log("5. Review deck");
      console.log("6. View deck stats");
      console.log("7. Overall statistics");
      console.log("8. Backup management");
      console.log("0. Exit");

      const choice = await this.prompt("\n> ");

      switch (choice) {
        case "1":
          await this.listDecks();
          break;
        case "2":
          await this.scanFiles();
          break;
        case "3":
          await this.createDeckFromFile();
          break;
        case "4":
          await this.syncAllDecks();
          break;
        case "5":
          await this.reviewDeck();
          break;
        case "6":
          await this.viewDeckStats();
          break;
        case "7":
          await this.viewOverallStats();
          break;
        case "8":
          await this.backupMenu();
          break;
        case "0":
          await this.exit();
          return;
        default:
          console.log("❌ Invalid choice");
      }
    }
  }

  private async listDecks(): Promise<void> {
    try {
      const decks = await this.core.getDecks();

      if (decks.length === 0) {
        console.log("\n📭 No decks found. Create a deck first!");
        return;
      }

      console.log("\n📚 Your Decks:");
      console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

      for (let i = 0; i < decks.length; i++) {
        const deck = decks[i];
        const stats = await this.core.getDeckStats(deck.id);
        console.log(`${i + 1}. ${deck.name}`);
        console.log(`   📁 ${deck.filepath}`);
        console.log(`   🏷️  ${deck.tag}`);
        console.log(
          `   📊 ${stats.totalCount} cards (${stats.newCount} new, ${stats.dueCount} due, ${stats.matureCount} mature)`,
        );
        if (deck.lastReviewed) {
          const lastReviewed = new Date(deck.lastReviewed);
          console.log(
            `   📅 Last reviewed: ${lastReviewed.toLocaleDateString()}`,
          );
        }
        console.log("");
      }
    } catch (error) {
      console.error("❌ Error listing decks:", error);
    }
  }

  private async scanFiles(): Promise<void> {
    console.log("\n🔍 Scanning for markdown files...");

    try {
      const files = await this.core.scanMarkdownFiles();
      const flashcardFiles = files.filter((f) => f.hasFlashcards);

      console.log(`\n📄 Found ${files.length} markdown files`);
      console.log(
        `⚡ ${flashcardFiles.length} potentially contain flashcards:\n`,
      );

      flashcardFiles.forEach((file, i) => {
        console.log(`${i + 1}. ${file.path}`);
      });

      if (flashcardFiles.length === 0) {
        console.log("💡 No flashcards found. Make sure your files contain:");
        console.log("   • #flashcards tag");
        console.log("   • Header-paragraph format (# Question\\nAnswer)");
        console.log("   • Table format (| **Question** | Answer |)");
      }
    } catch (error) {
      console.error("❌ Error scanning files:", error);
    }
  }

  private async createDeckFromFile(): Promise<void> {
    try {
      const filePath = await this.prompt("\n📁 Enter markdown file path: ");
      const name =
        (await this.prompt(
          "📝 Enter deck name (or press Enter for filename): ",
        )) || path.basename(filePath, ".md");
      const tag =
        (await this.prompt("🏷️  Enter tag (default: #flashcards): ")) ||
        "#flashcards";

      console.log("\n⏳ Creating deck from file...");
      const deck = await this.core.createDeckFromFile(filePath, name, tag);

      console.log("\n⏳ Syncing flashcards...");
      await this.core.syncDeck(deck.id);

      const stats = await this.core.getDeckStats(deck.id);
      console.log(
        `\n✅ Created deck "${deck.name}" with ${stats.totalCount} flashcards!`,
      );
    } catch (error) {
      console.error("❌ Error creating deck:", error);
    }
  }

  private async syncAllDecks(): Promise<void> {
    try {
      console.log("\n🔄 Syncing all decks...");
      const result = await this.core.syncAllDecks();
      console.log(
        `✅ Synced ${result.totalDecks} decks with ${result.totalFlashcards} total flashcards`,
      );
    } catch (error) {
      console.error("❌ Error syncing decks:", error);
    }
  }

  private async reviewDeck(): Promise<void> {
    try {
      const decks = await this.core.getDecks();

      if (decks.length === 0) {
        console.log("\n📭 No decks available for review.");
        return;
      }

      console.log("\n📚 Select a deck to review:");
      for (let i = 0; i < decks.length; i++) {
        const deck = decks[i];
        const stats = await this.core.getDeckStats(deck.id);
        console.log(
          `${i + 1}. ${deck.name} (${stats.dueCount} due, ${stats.newCount} new)`,
        );
      }

      const choice = await this.prompt("\n> ");
      const deckIndex = parseInt(choice) - 1;

      if (deckIndex < 0 || deckIndex >= decks.length) {
        console.log("❌ Invalid deck selection");
        return;
      }

      const deck = decks[deckIndex];
      await this.startReviewSession(deck);
    } catch (error) {
      console.error("❌ Error starting review:", error);
    }
  }

  private async startReviewSession(deck: Deck): Promise<void> {
    try {
      console.log(`\n🎯 Starting review session for: ${deck.name}`);

      this.currentSession = await this.core.startReviewSession(deck.id);
      let cardCount = 0;
      const startTime = Date.now();

      while (true) {
        const card = await this.core.getNextCard(deck.id);

        if (!card) {
          console.log("\n🎉 Review session complete! No more cards due.");
          break;
        }

        cardCount++;
        console.log(`\n━━━━━━━━ Card ${cardCount} ━━━━━━━━`);
        console.log(`\n❓ ${card.front}`);

        await this.prompt("\nPress Enter to reveal answer...");

        console.log(`\n💡 ${card.back}`);

        // Show scheduling preview
        try {
          const preview = await this.core.previewCard(card.id);
          console.log("\n⏰ Next review times:");
          console.log(`1. Again (${preview.again.interval})`);
          console.log(`2. Hard  (${preview.hard.interval})`);
          console.log(`3. Good  (${preview.good.interval})`);
          console.log(`4. Easy  (${preview.easy.interval})`);
        } catch (error) {
          console.log("\n⏰ Review options: 1=Again, 2=Hard, 3=Good, 4=Easy");
        }
        console.log("q. Quit session");

        const rating = await this.prompt("\nHow was it? (1-4 or q): ");

        if (rating === "q") {
          console.log("\n👋 Ending review session...");
          break;
        }

        const ratingNum = parseInt(rating);
        if (ratingNum >= 1 && ratingNum <= 4) {
          const reviewStartTime = Date.now();
          await this.core.reviewCard(card.id, ratingNum as 1 | 2 | 3 | 4);
          const reviewTime = Date.now() - reviewStartTime;

          const ratingLabels = ["", "Again", "Hard", "Good", "Easy"];
          console.log(`✅ Rated: ${ratingLabels[ratingNum]}`);
        } else {
          console.log("❌ Invalid rating, skipping card...");
        }
      }

      await this.core.endReviewSession();

      const totalTime = Math.round((Date.now() - startTime) / 1000);
      console.log(`\n📊 Session complete: ${cardCount} cards in ${totalTime}s`);

      this.currentSession = null;
    } catch (error) {
      console.error("❌ Error during review session:", error);
      this.currentSession = null;
    }
  }

  private async viewDeckStats(): Promise<void> {
    try {
      const decks = await this.core.getDecks();

      if (decks.length === 0) {
        console.log("\n📭 No decks found.");
        return;
      }

      console.log("\n📊 Deck Statistics:");
      console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

      for (const deck of decks) {
        const stats = await this.core.getDeckStats(deck.id);
        const recentHistory = await this.core.getReviewHistory(deck.id, 5);

        console.log(`\n📚 ${deck.name}`);
        console.log(`   Total Cards: ${stats.totalCount}`);
        console.log(
          `   New: ${stats.newCount} | Due: ${stats.dueCount} | Mature: ${stats.matureCount}`,
        );
        console.log(`   Recent Reviews: ${recentHistory.length}`);

        if (deck.lastReviewed) {
          const lastReviewed = new Date(deck.lastReviewed);
          console.log(`   Last Reviewed: ${lastReviewed.toLocaleDateString()}`);
        }
      }
    } catch (error) {
      console.error("❌ Error viewing stats:", error);
    }
  }

  private async viewOverallStats(): Promise<void> {
    try {
      console.log("\n📈 Overall Statistics:");
      console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━");

      const stats = await this.core.getOverallStats();
      const recentHistory = await this.core.getReviewHistory(undefined, 10);

      console.log(`📚 Total Decks: ${stats.totalDecks}`);
      console.log(`🃏 Total Cards: ${stats.totalCards}`);
      console.log(`🆕 New Cards: ${stats.newCards}`);
      console.log(`⏰ Due Cards: ${stats.dueCards}`);
      console.log(`🎓 Mature Cards: ${stats.matureCards}`);
      console.log(`📝 Recent Reviews: ${recentHistory.length}`);

      if (stats.totalCards > 0) {
        const maturityRate = (
          (stats.matureCards / stats.totalCards) *
          100
        ).toFixed(1);
        console.log(`📊 Maturity Rate: ${maturityRate}%`);
      }

      if (recentHistory.length > 0) {
        const correctReviews = recentHistory.filter(
          (r) => r.rating >= 3,
        ).length;
        const accuracy = (
          (correctReviews / recentHistory.length) *
          100
        ).toFixed(1);
        console.log(`🎯 Recent Accuracy: ${accuracy}%`);
      }
    } catch (error) {
      console.error("❌ Error viewing overall stats:", error);
    }
  }

  private async backupMenu(): Promise<void> {
    while (true) {
      console.log("\n💾 Backup Management:");
      console.log("1. Create backup");
      console.log("2. List backups");
      console.log("3. Restore backup");
      console.log("0. Back to main menu");

      const choice = await this.prompt("\n> ");

      switch (choice) {
        case "1":
          await this.createBackup();
          break;
        case "2":
          await this.listBackups();
          break;
        case "3":
          await this.restoreBackup();
          break;
        case "0":
          return;
        default:
          console.log("❌ Invalid choice");
      }
    }
  }

  private async createBackup(): Promise<void> {
    try {
      console.log("\n⏳ Creating backup...");
      const filename = await this.core.createBackup();
      console.log(`✅ Backup created: ${filename}`);
    } catch (error) {
      console.error("❌ Error creating backup:", error);
    }
  }

  private async listBackups(): Promise<void> {
    try {
      const backups = await this.core.listBackups();

      if (backups.length === 0) {
        console.log("\n📭 No backups found.");
        return;
      }

      console.log("\n💾 Available Backups:");
      backups.forEach((backup, i) => {
        const size = (backup.size / 1024).toFixed(1);
        console.log(
          `${i + 1}. ${backup.filename} (${size} KB) - ${backup.created.toLocaleDateString()}`,
        );
      });
    } catch (error) {
      console.error("❌ Error listing backups:", error);
    }
  }

  private async restoreBackup(): Promise<void> {
    try {
      const backups = await this.core.listBackups();

      if (backups.length === 0) {
        console.log("\n📭 No backups available.");
        return;
      }

      console.log("\n💾 Select backup to restore:");
      backups.forEach((backup, i) => {
        console.log(
          `${i + 1}. ${backup.filename} - ${backup.created.toLocaleDateString()}`,
        );
      });

      const choice = await this.prompt("\n> ");
      const backupIndex = parseInt(choice) - 1;

      if (backupIndex < 0 || backupIndex >= backups.length) {
        console.log("❌ Invalid backup selection");
        return;
      }

      const confirm = await this.prompt(
        "\n⚠️  This will restore data from backup. Continue? (y/N): ",
      );
      if (confirm.toLowerCase() !== "y") {
        console.log("❌ Restore cancelled");
        return;
      }

      console.log("\n⏳ Restoring backup...");
      await this.core.restoreBackup(backups[backupIndex].filename);
      console.log("✅ Backup restored successfully!");
    } catch (error) {
      console.error("❌ Error restoring backup:", error);
    }
  }

  private async exit(): Promise<void> {
    console.log("\n👋 Goodbye!");
    await this.core.close();
    this.rl.close();
    process.exit(0);
  }

  private prompt(question: string): Promise<string> {
    return new Promise((resolve) => {
      this.rl.question(question, resolve);
    });
  }
}

// CLI Entry Point
export async function runCLI(options: CLIOptions = {}): Promise<void> {
  const cli = new FlashcardsCLI(options);
  await cli.start();
}

// Direct execution
if (require.main === module) {
  const args = process.argv.slice(2);
  const options: CLIOptions = {};

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case "--vault":
      case "-v":
        options.vaultPath = args[++i];
        break;
      case "--data":
      case "-d":
        options.dataPath = args[++i];
        break;
      case "--debug":
        options.debug = true;
        break;
      case "--help":
      case "-h":
        console.log("Flashcards CLI Usage:");
        console.log(
          "  --vault, -v <path>   Vault directory (default: current)",
        );
        console.log(
          "  --data, -d <path>    Data directory (default: .flashcards)",
        );
        console.log("  --debug              Enable debug logging");
        console.log("  --help, -h           Show this help");
        process.exit(0);
    }
  }

  runCLI(options).catch(console.error);
}
