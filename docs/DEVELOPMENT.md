# Development Guide

This guide covers building, testing, and releasing the Decks plugin for Obsidian.

## Prerequisites

- Node.js (v18+)
- npm (v9+)
- Git

## Setup

1. Clone the repository:
```bash
git clone <repository-url>
cd obsidian-flashcards-plugin
```

2. Install dependencies:
```bash
npm install
```

3. Build the plugin:
```bash
npm run build
```

## Development Commands

### Building

- `npm run build` - Production build (outputs to demo_vault)
- `npm run build:dev` - Development build with sourcemaps
- `npm run build:release` - Full release build (creates dist/ directory)

### Testing

- `npm test` - Run all tests
- `npm run test:watch` - Run tests in watch mode

### Code Quality

- `npm run lint` - Check TypeScript and Svelte code
- `npm run check` - Svelte type checking

### Release

- `npm run version <version>` - Bump version (e.g., `npm run version 1.0.1`)
- `npm run release-notes` - Generate release notes
- `npm run clean` - Clean build artifacts

## File Structure

```
obsidian-flashcards-plugin/
├── src/                     # Source code
│   ├── components/          # Svelte UI components
│   ├── database/           # SQLite database layer
│   ├── services/           # Business logic
│   ├── algorithm/          # FSRS algorithm
│   └── main.ts            # Plugin entry point
├── scripts/               # Build and release scripts
├── demo_vault/           # Test Obsidian vault
├── dist/                # Production build output
└── .github/workflows/   # CI/CD automation
```

## Development Workflow

### 1. Making Changes

1. Create a feature branch
2. Make your changes in `src/`
3. Test with `npm test`
4. Build with `npm run build`
5. Test in Obsidian using the demo_vault

### 2. Testing

The plugin includes comprehensive tests:

- **Unit Tests**: Core functionality (DatabaseService, DeckManager)
- **Integration Tests**: Component interactions
- **Type Checking**: TypeScript validation

Run tests before committing:
```bash
npm test
```

### 3. Building

For development builds:
```bash
npm run build:dev
```

For production builds:
```bash
npm run build:release
```

This creates optimized files in `dist/` ready for GitHub releases.

## Release Process

### 1. Version Bump

Update version numbers across all files:
```bash
npm run version 1.0.1
```

This updates:
- `package.json`
- `manifest.json`
- `versions.json`

### 2. Generate Release Notes

Create release documentation:
```bash
npm run release-notes
```

This generates:
- `RELEASE_NOTES.md` - Full release notes
- `GITHUB_RELEASE_NOTES.md` - Condensed GitHub format

### 3. Build for Release

Create production build:
```bash
npm run build:release
```

Output files in `dist/`:
- `main.js` - Minified plugin code (~202KB)
- `manifest.json` - Plugin manifest
- `styles.css` - Plugin styles
- `README.md` - Documentation
- `LICENSE` - MIT license
- `versions.json` - Obsidian compatibility

### 4. Manual Release

1. Commit and push changes:
```bash
git add .
git commit -m "Bump version to 1.0.1"
git push
```

2. Create and push tag:
```bash
git tag v1.0.1
git push --tags
```

3. Create GitHub release:
   - Go to GitHub repository
   - Create new release with tag `v1.0.1`
   - Upload files from `dist/` directory
   - Use content from `GITHUB_RELEASE_NOTES.md`

### 5. Automated Release (GitHub Actions)

The repository includes automated release workflow:

1. Push a version tag:
```bash
git tag v1.0.1
git push --tags
```

2. GitHub Actions automatically:
   - Runs tests
   - Builds production version
   - Creates GitHub release
   - Uploads release assets

## Code Style

### TypeScript

- Use strict TypeScript settings
- Prefer interfaces over types
- Use async/await over Promises
- Include proper error handling

### Svelte

- Use TypeScript in Svelte components
- Follow reactive patterns
- Use stores for shared state
- Keep components focused and small

### Database

- Use prepared statements
- Handle migrations safely
- Preserve user data during updates
- Include proper indexes

## Architecture

### Core Components

1. **DatabaseService** - SQLite operations and schema management
2. **DeckManager** - Business logic for deck and flashcard operations
3. **FSRS** - Spaced repetition algorithm implementation
4. **UI Components** - Svelte-based user interface

### Data Flow

1. User interaction triggers UI component
2. Component calls plugin method
3. Plugin delegates to service layer
4. Service updates database
5. UI refreshes with new data

### Plugin Integration

- Extends Obsidian's Plugin class
- Registers custom view types
- Handles file system events
- Integrates with workspace API

## Debugging

### Console Logging

Enable debug logging in plugin settings:
```typescript
this.plugin.settings.debug.enableLogging = true;
```

### Database Inspection

Access SQLite database directly:
```bash
sqlite3 demo_vault/.obsidian/plugins/decks/flashcards.db
```

### Development Tools

- Use Obsidian Developer Tools (F12)
- Check Network tab for database operations
- Monitor Console for debug output
- Use Svelte DevTools browser extension

## Performance

### Build Optimization

- Production builds use minification
- Tree shaking removes unused code
- Sourcemaps disabled in production
- Bundle size optimized (~202KB)

### Runtime Performance

- Database operations use prepared statements
- UI updates are batched
- Background refresh every 5 seconds
- Efficient deck statistics calculation

## Contributing

1. Fork the repository
2. Create feature branch
3. Follow development workflow
4. Add tests for new functionality
5. Update documentation
6. Submit pull request

## Troubleshooting

### Build Issues

- Clear node_modules and reinstall
- Check Node.js version compatibility
- Verify all dependencies are installed

### Plugin Issues

- Check Obsidian console for errors
- Verify plugin is enabled in settings
- Test with fresh vault
- Check database file permissions

### Release Issues

- Verify version numbers match
- Check git tags are pushed
- Confirm GitHub Actions permissions
- Validate release file contents