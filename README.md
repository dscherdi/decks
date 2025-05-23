# Obsidian Flashcards Canvas Plugin

This plugin lets you create and review flashcards directly from your canvas files in Obsidian using spaced repetition, built with TypeScript and Svelte for a reactive and type-safe UI.

## Features

- Extract flashcards from Canvas files
- Dedicated flashcards document type with Notion-like Table and Card views
- Spaced repetition algorithm (SM-2) for efficient review
- Tag-based organization and filtering
- Track review history and progress
- Modern TypeScript codebase for type safety
- Reactive UI components with Svelte

## Project Structure

```
obsidian-flashcards-plugin/
├── .github/                 # GitHub workflows
│   └── workflows/           # CI/CD configurations
├── .gitignore               # Git ignore file
├── esbuild.config.mjs       # Build configuration
├── install-dependencies.js  # Dependency installation script
├── manifest.json            # Plugin manifest
├── package.json             # Project dependencies and scripts
├── svelte.config.js         # Svelte configuration
├── tsconfig.json            # TypeScript configuration
├── out/                     # Build output directory
│   ├── main.js              # Bundled JavaScript
│   ├── styles.css           # Bundled CSS styles
│   ├── manifest.json        # Copy of plugin manifest
│   └── versions.json        # Copy of version compatibility info
├── src/                     # Source code
│   ├── components/          # Svelte components
│   │   ├── FlashcardEditor.svelte     # Card editor component
│   │   ├── FlashcardsCardView.svelte  # Card view component
│   │   ├── FlashcardsTable.svelte     # Table view component
│   │   ├── FlashcardsToolbar.svelte   # Toolbar component
│   │   └── FlashcardsView.svelte      # Main view component
│   ├── main.ts              # Plugin entry point (TypeScript)
│   ├── svelte.d.ts          # Svelte type declarations
│   ├── types.ts             # TypeScript type definitions
│   └── styles/              # CSS styles
│       └── flashcards-document.css  # Styles for document view
└── versions.json            # Version compatibility info
```

## Development

### Prerequisites

- Node.js (v14+)
- npm (v7+)

### Setup

1. Clone the repository
2. Run `npm run setup` to install dependencies and create necessary directories
3. Or simply run `npm install` which will also trigger the setup script

### Build

- Development: `npm run dev`
- Production: `npm run build`
- Type checking: `npm run check`
- Linting: `npm run lint`

### Deployment

The build process will create:
- `main.js` - The compiled plugin
- `styles/` - The compiled CSS

Copy these files to your Obsidian plugins directory.

## License

MIT