# Contributing to Decks

Thank you for your interest! We actively encourage and welcome community
involvement through **bug reports, feature requests, and discussions** in the
[issue tracker](https://github.com/dscherdi/decks/issues). Start by skimming it
to see what's open or already discussed.

## Pull requests

To maintain strict copyright ownership over the core logic (for future
dual-licensing purposes), we **do not accept external pull requests**.

You are, however, completely free to **fork the repository, modify the code, and
experiment on your own** under the terms of the AGPLv3 — see [LICENSE](./LICENSE).

The setup, scripts, code-style, and testing notes below are here to help you
work in your own fork.

## Prerequisites

- Node.js 18+
- npm 9+
- Git
- Obsidian (desktop) for in-app testing

## Set up

```bash
git clone https://github.com/dscherdi/decks.git
cd decks
npm install
npm run build:dev
```

`build:dev` writes the plugin into `demo_vault/.obsidian/plugins/decks` so you
can open the bundled `demo_vault/` folder in Obsidian and have the plugin
loaded without any extra wiring. Re-run `build:dev` after each change, or run
it once if you prefer a clean rebuild loop.

## Scripts you'll actually use

| Script | What it does |
| --- | --- |
| `npm run build:dev` | Dev build into `demo_vault/.obsidian/plugins/decks` (with sourcemaps) |
| `npm run build` | Production build into `dist/` |
| `npm run lint` / `npm run lint:fix` | ESLint over `src/` |
| `npm run format` / `npm run format:check` | Prettier |
| `npm run check` | Svelte + TypeScript type-check |
| `npm test` | Unit tests (Jest, mocked DB) |
| `npm run test:integration` | Integration tests (real SQL.js, serial, ~30s) |
| `npm run test:all` | Unit + integration |

## Code style

A handful of project conventions and Obsidian plugin store requirements that
the linter enforces — keep these in mind when you write new code:

- **No `any` / `unknown`.** Reach for an existing type first; introduce a
  named type if you really need a cast.
- **CSS classes must be prefixed `decks-`.** Anything plain risks colliding
  with Obsidian or other plugins.
- **Comments are minimal.** Explain *why* when it's non-obvious. Don't
  reference prompts, task IDs, or PR numbers in code.
- **Logging via the `Logger` class** when available, otherwise
  `console.debug` / `console.warn` / `console.error` only — never
  `console.log` or `console.info` (Obsidian plugin-store linter rejects them).
- **Modal / ItemView `onOpen` / `onClose` are not `async`.** Wrap async work
  in a separate method and call it with `.catch(console.error)`.
- **UI text is sentence case** ("Review sessions", not "Review Sessions").

## Tests

- **Unit tests** live in `src/__tests__/*.test.ts` and mock the database
  layer. These are fast and what `npm test` runs.
- **Integration tests** live in `src/__tests__/integration/*.test.ts` and
  run against a real SQL.js database with `maxWorkers: 1` (serial) and a
  30s timeout. Use these when behavior depends on actual SQL semantics
  (migrations, the merge-before-save sync, query correctness).

Add a unit test for new logic; reach for an integration test when the
change touches schema, sync, or query SQL.

## Checks (for your fork)

Working in your own fork? The same gate the project uses before a release is:

```bash
npm run lint && npm run check && npm run test:all
```

Running it keeps your fork green and makes it easy to rebase on future upstream
releases.

## Translations

i18n is in `src/i18n/locales/`. The `Translations` type widens from `en.ts`,
so every locale must satisfy the same shape — adding a new English key fails
the build until you add it (in some form) to all 13 other locales. The
[Translation Guide](./docs/TRANSLATING.md) walks through the workflow for your
fork. To request a new or corrected language upstream, please open an issue
(we don't accept external pull requests — see [Pull requests](#pull-requests)).

## Release process (maintainers)

1. Bump the version with the helper script:
   ```bash
   npm run version 1.12.8
   ```
   This updates `package.json`, `manifest.json`, and `versions.json` consistently.
2. Add a release-notes file at `release-notes/<dotted-version>.md`
   (e.g. `release-notes/1-12-8.md`). The release workflow requires it —
   it's used as the GitHub release body.
3. Commit the version bump + release notes.
4. Tag (no `v` prefix) and push:
   ```bash
   git tag 1.12.8
   git push origin 1.12.8
   ```
5. GitHub Actions ([.github/workflows/release.yml](./.github/workflows/release.yml))
   runs `npm test`, `npm run build:release`, and publishes a GitHub release
   with the contents of `dist/` (`main.js`, `styles.css`, `manifest.json`,
   `database-worker.js`, `assets/sql-wasm.{js,wasm}`, `README.md`, `LICENSE`).

## Where to go next

- [docs/DEVELOPMENT.md](./docs/DEVELOPMENT.md) — extended setup, file layout, debugging
- [docs/INTEGRATION_TESTING_GUIDE.md](./docs/INTEGRATION_TESTING_GUIDE.md) — testing strategy & patterns
- [docs/CANVAS_DECKS.md](./docs/CANVAS_DECKS.md), [docs/CLOZE.md](./docs/CLOZE.md), [docs/IMAGE_OCCLUSION.md](./docs/IMAGE_OCCLUSION.md), [docs/TEMPLATES.md](./docs/TEMPLATES.md) — feature docs
- [docs/FSRS_OPTIMIZER.md](./docs/FSRS_OPTIMIZER.md) — algorithm validation & benchmarking
- [docs/TRANSLATING.md](./docs/TRANSLATING.md) — i18n contribution guide
- [CLAUDE.md](./CLAUDE.md) — comprehensive architectural overview
  (written for AI assistants but a fine deep-dive for humans)

---

Copyright (C) 2026 Xherdi Lika. Licensed under the GNU Affero General Public
License v3.0 or later (AGPL-3.0-or-later). See [LICENSE](./LICENSE).
