import { readFileSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { execSync } from "child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, "..");

// Get version from manifest
const manifest = JSON.parse(
  readFileSync(join(rootDir, "manifest.json"), "utf8")
);
const version = manifest.version;

console.log(`📝 Generating release notes for Decks v${version}...`);

// Get git information
let gitCommits = "";
let gitTag = "";
try {
  // Get commits since last tag
  const lastTag = execSync("git describe --tags --abbrev=0 HEAD^", {
    encoding: "utf8",
    cwd: rootDir,
  }).trim();

  gitCommits = execSync(
    `git log ${lastTag}..HEAD --oneline --pretty=format:"- %s"`,
    { encoding: "utf8", cwd: rootDir }
  ).trim();

  gitTag = lastTag;
} catch (error) {
  // If no previous tags, get all commits
  try {
    gitCommits = execSync(
      'git log --oneline --pretty=format:"- %s"',
      { encoding: "utf8", cwd: rootDir }
    ).trim();
  } catch (e) {
    gitCommits = "- Initial release";
  }
}

// Parse PROGRESS.md for recent enhancements
let recentFeatures = "";
try {
  const progressContent = readFileSync(join(rootDir, "PROGRESS.md"), "utf8");
  const lines = progressContent.split("\n");

  let inRecentSection = false;
  let featuresList = [];

  for (const line of lines) {
    if (line.includes("## ✅ Recent Enhancements")) {
      inRecentSection = true;
      continue;
    }

    if (inRecentSection && line.startsWith("## ")) {
      break; // End of recent enhancements section
    }

    if (inRecentSection && line.startsWith("### ✅")) {
      const feature = line.replace("### ✅", "").trim();
      featuresList.push(`- **${feature}**`);
    }
  }

  if (featuresList.length > 0) {
    recentFeatures = featuresList.slice(0, 10).join("\n"); // Limit to last 10 features
  }
} catch (error) {
  console.warn("⚠️  Could not read PROGRESS.md for feature extraction");
}

// Generate release notes
const releaseNotes = `# Decks v${version}

**Decks** is a powerful spaced repetition flashcard plugin for Obsidian that helps you learn and memorize information efficiently using the FSRS algorithm.

## 🚀 Installation

### Manual Installation
1. Download the release files below
2. Extract to your Obsidian plugins folder: \`.obsidian/plugins/decks/\`
3. Enable the plugin in Obsidian settings → Community plugins

### From Obsidian
*(When available in community plugins)*
1. Open Settings → Community plugins
2. Search for "Decks"
3. Install and enable

## 📦 Release Files

- \`main.js\` - Plugin code (${(readFileSync(join(rootDir, "demo_vault/.obsidian/plugins/decks/main.js")).length / 1024).toFixed(1)} KB)
- \`manifest.json\` - Plugin manifest
- \`styles.css\` - Plugin styles

## ✨ Key Features

- **Smart Flashcard Creation**: Extract flashcards from markdown headers and paragraphs
- **FSRS Algorithm**: Advanced spaced repetition for optimal learning
- **Rich Statistics**: Track your progress with detailed analytics and heatmaps
- **Deck Management**: Organize flashcards by tags with configurable review limits
- **Time Tracking**: Monitor your review pace and efficiency
- **Anki-Style Reviews**: Familiar review interface with learning/review/new card ordering

${recentFeatures ? `## 🆕 What's New in v${version}

${recentFeatures}

` : ""}## 📋 Changes in This Release

${gitCommits || "- Initial release"}

${gitTag ? `\n**Full Changelog**: [${gitTag}...v${version}](../../compare/${gitTag}...v${version})` : ""}

## 🐛 Issues & Support

- **Bug Reports**: [Open an issue](../../issues/new)
- **Feature Requests**: [Start a discussion](../../discussions)
- **Documentation**: See [README.md](../../blob/main/README.md)

## 📄 License

MIT License - see [LICENSE](../../blob/main/LICENSE) for details.

---

**Minimum Obsidian Version**: ${manifest.minAppVersion}
**Plugin Version**: ${version}
**Build Date**: ${new Date().toISOString().split('T')[0]}
`;

// Write release notes to file
const releaseNotesPath = join(rootDir, "RELEASE_NOTES.md");
writeFileSync(releaseNotesPath, releaseNotes);

console.log(`✅ Release notes generated: ${releaseNotesPath}`);
console.log(`📊 Content length: ${releaseNotes.length} characters`);

// Also output to console for GitHub release body
console.log("\n" + "=".repeat(50));
console.log("📋 RELEASE NOTES (for GitHub release body):");
console.log("=".repeat(50));
console.log(releaseNotes);
console.log("=".repeat(50));

// Save a condensed version for GitHub
const condensedNotes = `## Decks v${version}

**Spaced repetition flashcards for Obsidian with FSRS algorithm**

### Installation
1. Download the release files below
2. Extract to \`.obsidian/plugins/decks/\`
3. Enable in Obsidian settings

### What's New
${recentFeatures || "See commit history for changes"}

### Changes
${gitCommits.split('\n').slice(0, 10).join('\n') || "- Initial release"}

**Minimum Obsidian Version**: ${manifest.minAppVersion}`;

writeFileSync(join(rootDir, "GITHUB_RELEASE_NOTES.md"), condensedNotes);
console.log(`📝 GitHub release notes saved to: GITHUB_RELEASE_NOTES.md`);
