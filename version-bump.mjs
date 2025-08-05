import { readFileSync, writeFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const targetVersion = process.argv[2];
if (!targetVersion) {
  console.error(
    "❌ Please specify a target version (e.g., npm run version 1.0.1)",
  );
  process.exit(1);
}

// Validate version format
const versionRegex = /^\d+\.\d+\.\d+$/;
if (!versionRegex.test(targetVersion)) {
  console.error(
    "❌ Invalid version format. Use semantic versioning (e.g., 1.0.1)",
  );
  process.exit(1);
}

// Get the directory where this script is located
const __dirname = dirname(fileURLToPath(import.meta.url));

console.log(`🔄 Updating Decks plugin to version ${targetVersion}...`);

// Read manifest.json
const manifestPath = join(__dirname, "manifest.json");
if (!existsSync(manifestPath)) {
  console.error("❌ manifest.json not found!");
  process.exit(1);
}

let manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const currentVersion = manifest.version;

if (currentVersion === targetVersion) {
  console.log(`⚠️  Version ${targetVersion} is already set`);
  process.exit(0);
}

manifest.version = targetVersion;
writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
console.log(`✅ Updated manifest.json: ${currentVersion} → ${targetVersion}`);

// Read package.json
const packageJsonPath = join(__dirname, "package.json");
if (!existsSync(packageJsonPath)) {
  console.error("❌ package.json not found!");
  process.exit(1);
}

let packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8"));
packageJson.version = targetVersion;
writeFileSync(packageJsonPath, JSON.stringify(packageJson, null, 2));
console.log(`✅ Updated package.json: ${currentVersion} → ${targetVersion}`);

// Create or update versions.json
const versionsPath = join(__dirname, "versions.json");
let versions = {};
try {
  versions = JSON.parse(readFileSync(versionsPath, "utf8"));
} catch (e) {
  console.log("📝 Creating versions.json");
}

// Update versions.json with min app version
versions[targetVersion] = manifest.minAppVersion;
writeFileSync(versionsPath, JSON.stringify(versions, null, 2));
console.log(
  `✅ Updated versions.json with Obsidian compatibility: ${manifest.minAppVersion}`,
);

console.log(`\n🎉 Version bump completed successfully!`);
console.log(`📦 Ready to build and release v${targetVersion}`);
console.log(`\n📋 Next steps:`);
console.log(`   1. Run: npm run build:release`);
console.log(
  `   2. Commit changes: git add . && git commit -m "Bump version to ${targetVersion}"`,
);
console.log(`   3. Create tag: git tag v${targetVersion}`);
console.log(`   4. Push: git push && git push --tags`);
