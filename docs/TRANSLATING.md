# Translating Decks

Decks ships with translations for 13 languages. Native-speaker pull requests are very welcome — every existing locale is marked as a draft until reviewed.

## How it's wired

- All UI strings live in [`src/i18n/locales/`](../src/i18n/locales/), one file per language code (`en.ts`, `de.ts`, `ja.ts`, …).
- [`en.ts`](../src/i18n/locales/en.ts) is the **canonical source**. Every other locale must mirror its shape exactly — TypeScript catches missing or extra keys at build time. If `en.ts` has `notices.backupCreated`, your locale must have `notices.backupCreated` too.
- The [`Translations`](../src/i18n/locales/en.ts) type is derived from `en.ts` via a `Widen<>` utility that loosens string-literal types so other locales can supply translated strings.
- Resolution happens once at plugin load via [`I18n.init(settings)`](../src/i18n/I18n.ts). `settings.i18n.language` is `"auto"` by default — Obsidian's `getLanguage()` chooses the active locale, falling back to English for unsupported codes.

## Updating an existing translation

1. Open `src/i18n/locales/<code>.ts`.
2. Replace the English-fallback or draft strings with proper translations. Keep keys, placeholders, and structure identical.
3. If everything in the locale has been reviewed by a native speaker, remove the `// DRAFT — review with a native … speaker before release.` header comment.
4. Run `npm run build:dev` and `npm test` — type errors flag any missing keys.

### Placeholders

Strings use `{name}` curly-brace placeholders. Translate the surrounding prose but **leave the `{name}` tokens intact** — the runtime substitutes them via `I18n.format()`.

```ts
// en.ts
customDeckCreated: "Created custom deck \"{name}\" with {count} cards",

// de.ts — placeholders unchanged, words reordered naturally
customDeckCreated: "Benutzerdefinierten Stapel \"{name}\" mit {count} Karten erstellt",
```

If a translation reads more naturally with the placeholders in a different order, that's fine — just keep all of them present.

### Special strings

- **`testDeck.filename`** — the auto-generated welcome file. The name appears in the user's vault. Keep the `.md` extension; you can localize the rest, e.g. `"Decks — Erste Schritte.md"`.
- **`testDeck.bone1`/`bone2`/`bone3`** — these go inside `==cloze==` syntax in the generated note. Translate them; the cloze still works.
- **`testDeck.solarBody`** — keep the `==Sun==`/`==Mercury==`/`==Jupiter==` markers around the localized words so they render as clozes.
- **Newlines** — some `notices.*` keys start with `\n\n`. Preserve them; they control formatting when notices are concatenated.
- **Markdown** — backticks, asterisks, and code fences inside strings must stay; they render in Obsidian Notice and Setting components.

### What not to translate

- Anything inside `` `code spans` `` (e.g. `` `#decks` ``, `` `==highlight==` ``).
- File paths, URLs, command IDs.
- Brand names (FSRS, Anki, Obsidian, Decks itself).
- Number-only placeholders (`"25"`, `"500"`, `"#decks"`).

## Adding a new language

1. **Pick a language code.** Use the lowercase ISO 639-1 code (`pt`, `ko`, `nl`). For regional variants, use BCP 47 with a hyphen (`zh-TW`, `pt-BR`).
2. **Create the locale file.** Copy `src/i18n/locales/en.ts` to `src/i18n/locales/<code>.ts`. Change the export name:

   ```ts
   import type { Translations } from "./en";

   // DRAFT — review with a native <Language> speaker before release.
   export const <code>: Translations = {
     views: { ... },
     // ...translate every value
   };
   ```

3. **Register it** in [`src/i18n/locales/index.ts`](../src/i18n/locales/index.ts):

   - Add `import { <code> } from "./<code>";`
   - Add `"<code>"` to the `LanguageCode` union.
   - Add `<code>,` to the `LOCALES` map.
   - Add `{ code: "<code>", label: "<NativeName>" }` to `SUPPORTED_LANGUAGES`. The label appears in the language dropdown — use the language's native name in its own script (e.g. `"日本語"`, `"العربية"`).

4. **Translate.** Replace every English value while keeping keys identical. Don't skip keys — the build will refuse to compile until the locale is complete.

5. **Verify** with `npm run build:dev`, `npm test`, and `npm run lint`. If anything's missing, TypeScript reports exactly which keys.

### Starting from a stub

If you want to commit a placeholder while translation is in progress, point at English:

```ts
import { en, type Translations } from "./en";

// STUB — <Language> translation pending. Currently falls back to English.
export const <code>: Translations = en;
```

The language appears in the dropdown but renders in English. Replace with a real object literal once translation begins.

## Translating the README

The repo also ships translated READMEs as `README.<code>.md` next to the English one, with a language switcher line near the top. To add a new README:

1. Copy `README.md` to `README.<code>.md`.
2. Update the language-switcher line to bold the new language and link to the others.
3. Translate everything except code blocks, URLs, and badge image links.
4. Add the new language to the switcher line in **all other** README files so users can navigate between them.

## Testing your changes

1. `npm run build:dev` — bundles to `demo_vault/.obsidian/plugins/decks/` for live testing.
2. Open the demo vault in Obsidian, go to **Settings → Decks → Language**, pick your language, reload the plugin (disable + re-enable, or restart Obsidian).
3. Walk through: deck list, review modal, settings tab, statistics, profile manager, flashcard manager. Anything that reads in English is either a missed key (open an issue with the screenshot) or a string still in code (a migration gap — also worth flagging).

## Submitting a PR

- One PR per language, ideally.
- Title format: `i18n: improve <language> translations` or `i18n: add <language> support`.
- If you replaced more than half the strings with native-speaker-reviewed translations, drop the `// DRAFT —` comment at the top of the locale file.
- Native speakers reviewing existing translations: keep the file's draft header until the entire locale is reviewed; partial reviews can be noted in the PR description.

## Where the strings come from

If you're curious which UI surface a key drives, the rough grouping in `en.ts` mirrors the codebase:

- `views`, `ribbon`, `commands` — main plugin entry points ([`main.ts`](../src/main.ts), view classes).
- `notices` — `new Notice()` calls across the plugin.
- `deckList` — the deck-list side panel.
- `review` — the flashcard review modal.
- `manager` — the flashcard manager.
- `config`, `profiles` — deck config and profile management modals.
- `statistics` — every chart and the overall stats UI.
- `ankiExport`, `filterBuilder` — their respective modals.
- `modals` — small confirmation and utility modals.
- `settings` — the Decks settings tab.
- `testDeck` — the auto-generated "Getting started" note.

Inside each section, key names are descriptive (`saveTooltip`, `noCardsFoundInDeck`, `cardLeechAndDense`) — usually enough context to translate without opening the UI.
