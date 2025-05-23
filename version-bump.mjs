import { readFileSync, writeFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const targetVersion = process.argv[2];
if (!targetVersion) {
  console.error("Please specify a target version");
  process.exit(1);
}

// Get the directory where this script is located
const __dirname = dirname(fileURLToPath(import.meta.url));

// Read manifest.json
const manifestPath = join(__dirname, "manifest.json");
let manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const currentVersion = manifest.version;
manifest.version = targetVersion;
writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

// Read package.json
const packageJsonPath = join(__dirname, "package.json");
let packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8"));
packageJson.version = targetVersion;
writeFileSync(packageJsonPath, JSON.stringify(packageJson, null, 2));

// Create versions.json if it doesn't exist yet
const versionsPath = join(__dirname, "versions.json");
let versions = {};
try {
  versions = JSON.parse(readFileSync(versionsPath, "utf8"));
} catch (e) {
  console.log("Creating versions.json");
}

// Update versions.json with min app version
versions[targetVersion] = manifest.minAppVersion;
writeFileSync(versionsPath, JSON.stringify(versions, null, 2));

console.log(`Updated from ${currentVersion} to ${targetVersion}`);