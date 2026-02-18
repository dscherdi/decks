---
name: release
description: Prepare and publish a new version of the Decks plugin
---

# Release Checklist

Prepare a release for the Decks Obsidian plugin. If a version is provided as `$ARGUMENTS`, use that version. Otherwise read the current version from `manifest.json`.

## Steps

1. **Determine version**: If `$ARGUMENTS` is provided, that is the target version. Otherwise read `manifest.json` to get the current version.

2. **Check release notes exist**: Verify `release-notes/{version}.md` exists (version with dots replaced by dashes, e.g. `1.3.9` -> `1-3-9.md`). If it does not exist, stop and ask the user to create it first.

3. **Run all tests**: Execute `npm run test:all`. If any test fails, stop and report the failures.

4. **Build**: Execute `npm run build:dev`. If the build fails, stop and report the error.

5. **Version bump** (only if `$ARGUMENTS` was provided and differs from current): Run `node version-bump.mjs {version}` to update `manifest.json`, `package.json`, and `versions.json`.

6. **Summary**: Show the user:
   - Version being released
   - Release notes file path and contents
   - Test and build status
   - Ask if they want to commit and tag with `git tag {version} && git push origin {version}`
