import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.join(__dirname, "..");
const distDir = path.join(rootDir, "dist");

// Read package.json and manifest.json for version info
const packageJson = JSON.parse(
  fs.readFileSync(path.join(rootDir, "package.json"), "utf8")
);
const manifest = JSON.parse(
  fs.readFileSync(path.join(rootDir, "manifest.json"), "utf8")
);

console.log(`Packaging Decks v${manifest.version} for release...`);

// Create dist directory
if (!fs.existsSync(distDir)) {
  fs.mkdirSync(distDir, { recursive: true });
}

// Files to include in the release package
const releaseFiles = [
  {
    src: path.join(rootDir, "demo_vault/.obsidian/plugins/decks/main.js"),
    dest: path.join(distDir, "main.js"),
  },
  {
    src: path.join(rootDir, "manifest.json"),
    dest: path.join(distDir, "manifest.json"),
  },
  {
    src: path.join(rootDir, "versions.json"),
    dest: path.join(distDir, "versions.json"),
  },
  {
    src: path.join(rootDir, "README.md"),
    dest: path.join(distDir, "README.md"),
  },
  {
    src: path.join(rootDir, "LICENSE"),
    dest: path.join(distDir, "LICENSE"),
  },
];

// Copy files to dist directory
console.log("Copying release files...");
for (const file of releaseFiles) {
  if (fs.existsSync(file.src)) {
    fs.copyFileSync(file.src, file.dest);
    console.log(`  ✓ ${path.basename(file.dest)}`);
  } else {
    console.warn(`  ⚠ Warning: ${file.src} not found, skipping...`);
  }
}

// Create a styles.css file (even if empty, some users expect it)
const stylesPath = path.join(distDir, "styles.css");
if (!fs.existsSync(stylesPath)) {
  fs.writeFileSync(stylesPath, "/* Decks plugin styles are injected via main.js */\n");
  console.log("  ✓ styles.css (placeholder)");
}

// Verify main.js exists and has content
const mainJsPath = path.join(distDir, "main.js");
if (fs.existsSync(mainJsPath)) {
  const stats = fs.statSync(mainJsPath);
  console.log(`  ✓ main.js (${(stats.size / 1024).toFixed(1)} KB)`);
} else {
  console.error("  ✗ main.js not found! Run 'npm run build' first.");
  process.exit(1);
}

// Create release info
const releaseInfo = {
  name: manifest.name,
  version: manifest.version,
  description: manifest.description,
  author: manifest.author,
  minAppVersion: manifest.minAppVersion,
  files: fs.readdirSync(distDir),
  buildDate: new Date().toISOString(),
  buildSize: fs.readdirSync(distDir).reduce((total, file) => {
    const filePath = path.join(distDir, file);
    return total + fs.statSync(filePath).size;
  }, 0),
};

// Write release info
fs.writeFileSync(
  path.join(distDir, "release-info.json"),
  JSON.stringify(releaseInfo, null, 2)
);

console.log("\n📦 Release package created successfully!");
console.log(`📁 Location: ${distDir}`);
console.log(`📊 Total size: ${(releaseInfo.buildSize / 1024).toFixed(1)} KB`);
console.log(`📋 Files included:`);
releaseInfo.files.forEach(file => console.log(`   - ${file}`));

console.log("\n🚀 Ready for GitHub release!");
console.log("📝 Next steps:");
console.log("   1. Create a new GitHub release");
console.log("   2. Upload the files from the dist/ directory");
console.log("   3. Set the tag version to: v" + manifest.version);
console.log("   4. Include release notes describing new features");

// Verify version consistency
if (packageJson.version !== manifest.version) {
  console.warn("\n⚠️  Warning: package.json and manifest.json versions don't match!");
  console.warn(`   package.json: ${packageJson.version}`);
  console.warn(`   manifest.json: ${manifest.version}`);
  console.warn("   Consider running 'npm run version' to sync versions.");
}
