# Development Guide

Building, testing and releasing the Decks plugin.

## Prerequisites

- **Node.js 22** — what CI runs. Older majors may work; nothing checks.
- **pnpm** — this is a pnpm workspace. npm will not resolve the workspace links.
- Git.

## Layout

The plugin does not build alone. It consumes `@decks/core`, which lives in its own
repository and is expected as a sibling package in the workspace:

```
<workspace>/
├── apps/obsidian-plugin/     # this repository
├── packages/decks-core/      # dscherdi/decks-core
└── pnpm-workspace.yaml
```

CI reconstructs exactly that: it checks out both repositories side by side and writes a
`pnpm-workspace.yaml` covering `apps/*` and `packages/*` before installing. See
`.github/workflows/release.yml` if you need the canonical version.

Inside this repository:

```
apps/obsidian-plugin/
├── src/
│   ├── components/     # Svelte UI
│   ├── database/       # SQL.js layer and the worker
│   ├── services/       # plugin-side logic and adapters
│   ├── editor/         # CodeMirror extensions
│   └── main.ts         # entry point
├── docs/               # this directory
├── release-notes/      # one file per released version
├── demo_vault/         # a vault to test against
└── dist/               # release build output
```

## Commands

Run these **inside `apps/obsidian-plugin`**. `packages/decks-core` has its own.

### Build

| Command | Does |
| --- | --- |
| `pnpm build` | Production build into `dist/`, minified |
| `pnpm build:dev` | Development build into `demo_vault/.obsidian/plugins/decks`, with inline sourcemaps |
| `pnpm build:release` | `clean` then `build` — what the release workflow runs |
| `pnpm clean` | Remove `dist/` |

`build:dev` is the one to use while working: point Obsidian at `demo_vault` and rebuild.

### Test

| Command | Does |
| --- | --- |
| `pnpm test` | Everything jest picks up |
| `pnpm test:unit` | Unit tests only — skips `integration/` |
| `pnpm test:integration` | Integration tests, real SQL.js, serial, 30s timeout |
| `pnpm test:all` | Unit then integration. **This is what CI gates on** |

Integration tests use `MainDatabaseService` rather than the worker, because Node has no
Web Worker. A failure there is a SQL or business-logic problem; a failure only in the app
is a worker-transport problem.

### Quality

| Command | Does |
| --- | --- |
| `pnpm lint` / `pnpm lint:fix` | ESLint over `src/` |
| `pnpm check` | `svelte-check` against `tsconfig.json` |
| `pnpm format` / `pnpm format:check` | Prettier |

`pnpm check` reports pre-existing errors, so it is not a clean gate — compare against the
count on `main` rather than expecting zero.

## Releasing

1. **Bump the version.** `pnpm version 2.9.3` updates `package.json`, `manifest.json` and
   `versions.json` together.
2. **Write the notes.** `release-notes/<version with dashes>.md` — `2.9.3` becomes
   `release-notes/2-9-3.md`. The workflow reads the version out of `manifest.json`,
   derives that filename, and **fails the release if the file is missing**. There is no
   fallback.
3. **Commit, then tag.** Tags are bare — `2.9.3`, no `v` prefix. The workflow triggers on
   `*.*.*`; the `v1.0.x` tags in the history are legacy.

```bash
git tag 2.9.3 && git push origin main --tags
```

The workflow then checks out `decks-core`, runs `test:all`, runs `build:release`, verifies
the built files exist, and publishes a release whose body is that notes file. A second job
pings the website to rebuild so the changelog picks the release up.

Only the latest *minor* series is bundled into the plugin's own release-notes view. Older
files stay — they are the release body on GitHub.

## Related

- [CONTRIBUTING.md](../CONTRIBUTING.md) — how to propose a change
- [INTEGRATION_TESTING_GUIDE.md](./INTEGRATION_TESTING_GUIDE.md) — testing strategy
- [TRANSLATING.md](./TRANSLATING.md) — adding or fixing a locale
