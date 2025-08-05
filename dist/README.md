# Decks

Decks is a powerful spaced repetition flashcard plugin for Obsidian that helps you learn and memorize information efficiently using the FSRS algorithm, built with TypeScript and Svelte for a reactive and type-safe UI.

## Features

- Extract flashcards from markdown files using various formats
- Advanced FSRS algorithm for optimal spaced repetition
- Tag-based deck organization and filtering
- Comprehensive statistics and progress tracking
- Real-time review heatmaps and analytics
- Configurable deck settings and daily limits
- Modern TypeScript codebase for type safety
- Reactive UI components with Svelte

## Project Structure

```
decks/
├── src/                     # Source code
│   ├── components/          # Svelte UI components
│   │   ├── DeckListPanel.svelte       # Main deck list view
│   │   ├── FlashcardReviewModal.svelte # Review interface
│   │   ├── StatisticsModal.svelte     # Statistics and analytics
│   │   ├── ReviewHeatmap.svelte       # Activity heatmap
│   │   └── DeckConfigModal.svelte     # Deck configuration
│   ├── database/            # Database layer
│   │   ├── DatabaseService.ts         # SQLite operations
│   │   └── types.ts                   # Database schemas
│   ├── services/            # Business logic
│   │   └── DeckManager.ts             # Deck management
│   ├── algorithm/           # FSRS implementation
│   │   └── fsrs.ts                    # Spaced repetition algorithm
│   ├── main.ts              # Plugin entry point
│   └── settings.ts          # Plugin settings
├── demo_vault/              # Test vault for development
├── manifest.json            # Plugin manifest
├── package.json             # Dependencies and scripts
├── esbuild.config.mjs       # Build configuration
└── tsconfig.json            # TypeScript configuration
```

## Development

### Prerequisites

- Node.js (v14+)
- npm (v7+)

### Setup

1. Clone the repository
2. Run `npm install` to install dependencies
3. Build with `npm run build`

### Build

- Production: `npm run build`
- Type checking: `npm run check`
- Linting: `npm run lint`
- Testing: `npm test`

### Installation

1. Build the plugin using `npm run build`
2. Copy the generated files to your Obsidian vault's plugins directory:
   - `main.js` - The compiled plugin
   - `manifest.json` - Plugin manifest
3. Enable the plugin in Obsidian settings

### Features

- **Smart Parsing**: Automatically extracts flashcards from markdown headers and paragraphs
- **FSRS Algorithm**: Uses the latest Free Spaced Repetition Scheduler for optimal learning
- **Rich Statistics**: Track your learning progress with detailed analytics
- **Deck Management**: Organize flashcards by tags and configure review limits
- **Review Heatmap**: Visualize your review activity over time
- **Time Tracking**: Monitor your review pace and efficiency

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

MIT License - Copyright (c) 2024 Decks

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.