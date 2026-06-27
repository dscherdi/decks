# Card Types & Templates — Reference

A single, self-contained reference for **every flashcard type Decks supports**, the **template
system**, and **how each card flows** from authoring → parse → database → review render. Deep dives
on individual subsystems live in the sibling docs ([CLOZE.md](CLOZE.md),
[IMAGE_OCCLUSION.md](IMAGE_OCCLUSION.md), [CANVAS_DECKS.md](CANVAS_DECKS.md),
[SR_MIGRATION.md](SR_MIGRATION.md)).

Citations point at the source of truth so this doc stays verifiable. Core logic lives in
`packages/decks-core`; render logic in `apps/obsidian-plugin`.

---

## 1. Pipeline overview

```
 Authoring                 Parse / extract              Persisted card                 Review render
 ─────────                 ───────────────              ──────────────                 ─────────────
 Markdown note    ─┐   FlashcardParser.parse...   ┐  Flashcard row:               ┐  resolveCardTemplate(card)
   (#flashcards)   ├─▶   (header-paragraph,        ├─▶  { type, front, back,        ├─▶   ├─ match → ResolvedRender
 .canvas file     ─┘     tables, cloze, occlusion) │    notes, tags,              │     │     (front/back/notes faces)
   (edges/nodes)         OcclusionV2Parser         │    templateRow?, clozeText?, │     └─ no match → raw columns
                         CanvasFlashcardExtractor  ┘    maskId? ... }             ┘
                                │                          │                            │
                                ▼                          ▼                            ▼
                         FlashcardSynchronizer        SQLite flashcards          FlashcardReviewModal
                         (CREATE/UPDATE/DELETE,         table (+ deck_templates    decides per face:
                          reverse-card twins)           cache for templates)       html shadow-DOM vs markdown,
                                                                                   cloze blanking, occlusion masks
```

- **Parse** turns authored content into `ParsedFlashcard`s. Entry point:
  `FlashcardParser.parseFlashcardsFromContent(content, headerLevel = 2, fileTitle?, clozeEnabled = false)`
  — [FlashcardParser.ts](../../../packages/decks-core/src/services/FlashcardParser.ts).
- **Sync** reconciles parsed cards with the DB and generates reverse twins —
  [FlashcardSynchronizer.ts](../../../packages/decks-core/src/services/FlashcardSynchronizer.ts).
- **Templates** are loaded from a watched folder into the `deck_templates` cache and bound by tag at
  render time — `packages/decks-core/src/services/templates/` + `TemplateSyncService.ts`.
- **Render** picks faces and rendering engines per card —
  [FlashcardReviewModal.svelte](../src/components/review/FlashcardReviewModal.svelte).

---

## 2. Card type catalog

The persisted `type` is one of six values
([database/types.ts:226](../../../packages/decks-core/src/database/types.ts#L226)):

| `type` | Authored as | Front | Back | Extra fields | Renders as |
| --- | --- | --- | --- | --- | --- |
| `header-paragraph` | `## Q` + paragraph | header text | paragraph | `notes` | md (or bound template) |
| `table` | `\| Front \| Back \| [Notes] \|` | cell 0 | cell 1 | `notes` (col 3), `templateRow` | md (or bound template) |
| `cloze` | `==highlight==` (HP or table) | sentence/header | sentence or empty | `clozeText`, `clozeOrder`, `templateRow?` | **always markdown** |
| `image-occlusion` | image + numbered list (legacy) | `![[img]]` | empty | `clozeText`, `clozeOrder` | image + active item |
| `image-occlusion-v2` | ` ```decks-occlusion ` YAML | `![[img]]` | JSON model | `maskId`, `imagePath`, `clozeText` | image + masks (**markdown**) |
| `spatial` | canvas edge/node | from-node | to-node | `hint`, `edgeId`, `sourceNodeId` | md (or bound template) |

`ParsedFlashcard` shape (parser output):
[FlashcardParser.ts:5](../../../packages/decks-core/src/services/FlashcardParser.ts#L5).
`TemplateRow = { headers: string[]; cells: string[] }`:
[database/types.ts:118](../../../packages/decks-core/src/database/types.ts#L118).

> **Cloze is a `type`, not a flag.** A `==highlight==` source becomes one or more cards whose
> `type` is `cloze` (or `image-occlusion`/`-v2` for the occlusion paths). `isClozeType()` treats all
> three as "cloze-like" for rendering
> ([FlashcardReviewModal.svelte:79](../src/components/review/FlashcardReviewModal.svelte#L79)).

---

## 3. Per-type detail

### 3.1 Header-paragraph (default)

```markdown
## Capital of France #geo

Paris. %%European city%%

---

Fun fact: City of Light
```

→ `{ type: "header-paragraph", front: "Capital of France", back: "Paris.",
notes: "European city\n\nFun fact: City of Light", tags: ["geo"] }`.

- Header level is configurable (1–6; `0` = title mode). Tags come from `#tag` on the header and are
  stripped from the front text.
- **Notes** are extracted from Obsidian comments `%%…%%` and from a **trailing** thematic break
  (`---`/`***`/`___`) followed by content; the two combine with `\n\n`.

### 3.2 Table (2-col / 3-col / 1-col)

A table must sit directly under a header at the configured level. The header row + separator row are
skipped; each data row with a non-empty front cell becomes a card.

```markdown
## Vocabulary

| Front   | Back     | Notes        |
| ------- | -------- | ------------ |
| Hello   | Bonjour  | greeting     |
| Goodbye | Au revoir |             |
```

- **2-col** → `front` = cell 0, `back` = cell 1. **3-col** → adds `notes` = cell 2.
- **1-col / missing back** rows are silently skipped (no card).
- Cells escape pipes as `\|` and newlines as `<br>`; both are un-escaped on parse
  (`markdown-table.ts`).
- **Every table row also carries `templateRow { headers, cells }`** so the row can bind a template
  (see §4). `front`/`back`/`notes` are the fallback when no template matches.

### 3.3 Cloze (`clozeEnabled` must be on)

Cloze markers are `==highlight==` (regex `/==((?:(?!==).)+)==/g`). **Each highlight yields its own
card** (`clozeOrder` 0..N), sharing the same sentence; the others stay visible as context. There are
three authoring contexts:

**(a) Header-paragraph cloze** — cloze lives in the paragraph (the `back`):

```markdown
## Capitals

The capital of ==France== is ==Paris==.
```

→ two cards: `{ type:"cloze", front:"Capitals", back:"The capital of ==France== is ==Paris==.",
clozeText:"France", clozeOrder:0 }` and `…clozeText:"Paris", clozeOrder:1`.

**(b) Table front-only cloze** — cloze is in the **first** column → **front-only cloze** (empty
back) that still carries `templateRow`:

```markdown
## Deck #vocab

| Text                          | Extra        |
| ----------------------------- | ------------ |
| Du trinkst ==jeden Tag== Bier.| ![[bier.jpg]]|
```

→ `{ type:"cloze", front:"Du trinkst ==jeden Tag== Bier.", back:"", notes:"![[bier.jpg]]",
clozeText:"jeden Tag", templateRow:{headers:["Text","Extra"], cells:[…]} }`.

**(c) Table back cloze** — cloze is in the **second** column → normal front + cloze back:

```markdown
| Word           | Definition                              |
| -------------- | --------------------------------------- |
| Photosynthesis | Plants convert ==light to energy==      |
```

→ `{ type:"cloze", front:"Photosynthesis", back:"Plants convert ==light to energy==",
clozeText:"light to energy", templateRow:{…} }`.

Notes:
- **`clozeContent(card)`** drives which text gets blanked: `card.back` if non-empty, else
  `card.front` ([FlashcardReviewModal.svelte:85](../src/components/review/FlashcardReviewModal.svelte#L85)).
  So front-only clozes blank the **front**.
- **Cloze groups**: the N cards from one sentence are reviewed as a group in the modal.
- Multi-line clozes need one `==…==` per line (the cloze regex does not span newlines) — see
  [CLOZE.md](CLOZE.md).
- See §5 for how the **Extra** of a front-only cloze surfaces (post-reveal Notes button).

### 3.4 Image occlusion v1 (legacy)

Image embed followed by a numbered list, inside a cloze-enabled header:

```markdown
## Anatomy

![[heart.png]]

1. Aorta
2. Left ventricle
```

→ one `{ type:"image-occlusion", front:"![[heart.png]]", back:"", clozeText:"Aorta", clozeOrder:0 }`
per list item. Superseded by v2; kept for backward compatibility.

### 3.5 Image occlusion v2 (`decks-occlusion` codeblock)

````markdown
## Anatomy

```decks-occlusion
image: "[[anatomy/heart.png]]"
version: 2
masks:
  - id: m1
    x: 12.5
    y: 30
    w: 18
    h: 9.5
    answer: "Left ventricle ($V_L$)"
  - id: m2
    x: 55
    y: 22
    w: 14
    h: 8
    answer: ""
```
````

- One card **per mask** (`clozeOrder` = mask index, `maskId` = stable id). Mask geometry is
  percentages (0–100) of the image; the whole occlusion model is serialized as JSON into `back`, so
  any card can reconstruct the full mask set. `OcclusionV2Parser` + `OcclusionV2.ts`.
- A mask with `answer: ""` is **deletion-only** (reveal-in-place, no answer panel); a mask with text
  shows that answer on the back. Full reference: [IMAGE_OCCLUSION.md](IMAGE_OCCLUSION.md).

### 3.6 Spatial (canvas)

Extracted from `.canvas` files by `CanvasFlashcardExtractor`, not `FlashcardParser`:
- **Text→text edge** → `{ type:"spatial", front: from-node, back: to-node, hint: edge label,
  edgeId, sourceNodeId }`.
- **Standalone node** → parsed through `FlashcardParser` like a normal note.
- If `clozeEnabled` and the back contains `==…==`, it expands into `cloze` cards (carrying `edgeId`
  + `hint`). Full reference: [CANVAS_DECKS.md](CANVAS_DECKS.md).

### 3.7 Reverse cards (deck toggle)

Not a parser shape — generated during sync when `reverseCards: true`
([FlashcardSynchronizer.ts](../../../packages/decks-core/src/services/FlashcardSynchronizer.ts)).
For each card with a non-empty back **and** type `header-paragraph` or `table` only, a twin is
created with front/back **swapped**, same notes/tags, `isReverse: true`, and a deterministic reverse
id. **Excluded**: cloze, image-occlusion, image-occlusion-v2, spatial.

### 3.8 Title mode (`headerLevel = 0`)

The whole file is one card: `front` = file title, `back` = all content (minus frontmatter). With
`clozeEnabled`, the body's `==…==` expand into cloze cards.

---

## 4. Templates

Templates let a table row render through a custom layout instead of plain front/back columns. They
are **markdown files in a watched folder**, bound to cards **by tag**.

### 4.1 Template file format — six faces

A template file defines up to six faces via fenced codeblocks whose info string matches
`decks-(html|md)-(front|back|notes)`
([CodeblockTemplateParser.ts:16](../../../packages/decks-core/src/services/templates/CodeblockTemplateParser.ts#L16)):

`decks-html-front`, `decks-html-back`, `decks-html-notes`, `decks-md-front`, `decks-md-back`,
`decks-md-notes`. First definition for a side wins. If **no** codeblocks exist, the file falls back
to a single horizontal-rule split: everything above the first `---` is the (markdown) front, below is
the back ([TemplateFileParser.ts](../../../packages/decks-core/src/services/templates/TemplateFileParser.ts)).

Real example (mirrors
[TestDeckTemplate.ts:95](../src/assets/TestDeckTemplate.ts#L95)):

````markdown
---
tags:
  - vocab
---

```decks-html-front
<div class="decks-vocab-card">
  <ruby>{{1}}<rt>{{2}}</rt></ruby>
</div>
<style>
  .decks-vocab-card { font-size: 2.6em; text-align: center; }
  .decks-vocab-card rt { font-size: 0.35em; color: var(--text-muted); }
</style>
```

```decks-md-back
**{{3}}**
```
````

- **`html` faces** render sanitized HTML in a Shadow DOM (allows `<style>`, strips `<script>`).
- **`md` faces** render through Obsidian's markdown renderer.
- Template binding tags come from the file's frontmatter `tags:` plus inline `#tags` (code fences are
  stripped first so CSS hex like `#fff` isn't mistaken for a tag) —
  [TemplateSyncService.ts](../src/services/TemplateSyncService.ts).

### 4.2 Binding — 3-tier tag match

`resolveCardTemplate(headerTags, fileTags, row, templates)`
([TemplateBinding.ts:67](../../../packages/decks-core/src/services/templates/TemplateBinding.ts#L67)):

1. **Tier 1** — a tag on the header(s) over the table (`card.tags`) matches a template.
2. **Tier 2** — a tag in the deck file's frontmatter (`file_tags`) matches.
3. **Tier 3** — no match → `null`; the card renders its default columns.

Best match = the template sharing the **most** tags, ties broken alphabetically by source file
([TemplateBinding.ts:36](../../../packages/decks-core/src/services/templates/TemplateBinding.ts#L36)).
The result is a `ResolvedRender { front, frontType, back, backType, notes?, notesType? }`
([TemplateBinding.ts:9](../../../packages/decks-core/src/services/templates/TemplateBinding.ts#L9)).

### 4.3 Merging — fields & conditionals

`mergeTemplate(template, cells, headers)`
([TemplateMerger.ts:53](../../../packages/decks-core/src/services/templates/TemplateMerger.ts#L53)):

- **Substitution** inside `{{…}}`: positional `{{1}}`/`{{2}}` (1-based) or named `{{ColumnName}}`
  (case-insensitive). Unknown → empty string.
- **Conditional sections**: `{{#Field}}…{{/Field}}` (kept when the field is non-empty),
  `{{^Field}}…{{/Field}}` (kept when empty); resolved innermost-first so nesting works
  ([TemplateMerger.ts:35](../../../packages/decks-core/src/services/templates/TemplateMerger.ts#L35)).
- `templateIsSatisfied()` decides whether a row should use a template at all: the front must
  reference ≥1 variable and every referenced front variable must resolve non-empty (back/notes may
  reference missing columns) —
  [TemplateMerger.ts:88](../../../packages/decks-core/src/services/templates/TemplateMerger.ts#L88).

### 4.4 Sync & cache

`TemplateSyncService` watches `settings.templates.templateFolder`, parses each file, and upserts into
the `deck_templates` table (id, source_file, tags, the three template bodies + their types). At
review start, `loadTemplateCache()` + `makeTemplateResolver()` build a per-card resolver from that
cache plus each deck's file tags
([utils/template-resolver.ts](../src/utils/template-resolver.ts)).

### 4.5 HTML rendering (Shadow DOM)

`renderCardSide()` routes `html` faces to `renderHtmlIntoShadow()`
([utils/html-template-render.ts](../src/utils/html-template-render.ts)):
- DOMPurify sanitizes (all tags except `<script>`; `<style>` explicitly allowed; inline handlers
  stripped).
- `![[img]]` / `![alt](path)` embeds resolve to vault URLs; external `http(s)/data/app/capacitor`
  URLs pass through.
- Mounted in an open Shadow root with a baseline reset and Obsidian theme variables mirrored in, so
  template CSS is encapsulated yet theme-aware.

---

## 5. Render decision logic

For each card the modal computes (
[FlashcardReviewModal.svelte:206–270](../src/components/review/FlashcardReviewModal.svelte#L206)):

- `currentResolved = resolveCardTemplate(card)` — `null` ⇒ use the card's own columns.
- `frontIsHtml` / `backIsHtml` = the resolved face type is `"html"` **and the card is not cloze-like**
  ([:211](../src/components/review/FlashcardReviewModal.svelte#L211),
  [:214](../src/components/review/FlashcardReviewModal.svelte#L214)). **Cloze and occlusion always
  render markdown, even when a bound template's face is `html`.**
- `hasNotes` = `currentResolved?.notes` if a template bound, else `card.notes`
  ([:206](../src/components/review/FlashcardReviewModal.svelte#L206)).
- `frontOnlyClozeCard` = cloze-like with an empty back
  ([:89](../src/components/review/FlashcardReviewModal.svelte#L89),
  [:251](../src/components/review/FlashcardReviewModal.svelte#L251)).
- `answerSectionHidden` ([:267](../src/components/review/FlashcardReviewModal.svelte#L267)):
  - front-only cloze → hidden **unless** `showAnswer && hasNotes` (so the Extra's Notes button can
    appear after reveal);
  - occlusion-v2 with a deletion-only active mask → hidden (no answer panel);
  - otherwise → hidden until `showAnswer` (cloze-with-back reveals in place).

Per-card render summary:

| Card state | Front source / engine | Back source / engine | Notes (Notes button) |
| --- | --- | --- | --- |
| Basic, no template | `card.front` / md | `card.back` / md, on reveal | `card.notes` / md |
| Basic, bound template | `resolved.front` / html or md | `resolved.back` / html or md | `resolved.notes` / html or md |
| Cloze (with back) | `clozeContent` blanked / **md** | same text revealed / **md** | `resolved.notes ?? card.notes` |
| **Front-only cloze** | front blanked / **md** | none (empty) | Extra via a Notes button **on the front card** (bottom-right), shown after reveal ([:1533](../src/components/review/FlashcardReviewModal.svelte#L1533)); toggling it opens the Extra panel below |
| Occlusion v2, answer mask | image+masks / **md** | mask answer / md, on reveal | `resolved.notes ?? card.notes` |
| Occlusion v2, deletion-only | image+masks / **md** | none (reveal in place) | as above |

The **Notes button** toggles `currentResolved.notes` (or `card.notes`) into a separate panel
([toggleNotes :619](../src/components/review/FlashcardReviewModal.svelte#L619)). A shared
`notesButton` snippet ([:1487](../src/components/review/FlashcardReviewModal.svelte#L1487)) renders
it. On normal cards it sits at the bottom-right of the **back** card; for front-only clozes (which
have no back) it is rendered at the bottom-right of the **front** card after reveal
([:1533](../src/components/review/FlashcardReviewModal.svelte#L1533)), and toggling it reveals the
Extra panel below — this is how an imported Anki cloze's **Extra** shows.

---

## 6. Combination matrix

Card type × binding × format → what the learner sees:

| Type | Default columns | Tag-bound template |
| --- | --- | --- |
| header-paragraph | `## front` then `back` (+ notes button) | template faces merged from `templateRow` (HP rows have no `templateRow`, so binding is table-only in practice) |
| table | `front`/`back`/`notes` columns | template faces from row cells (`{{1}}`/`{{Header}}`), html or md |
| cloze | blanked sentence; back optional | cloze still renders raw (md); template's **notes** face supplies the Extra |
| image-occlusion-v2 | image + masks; mask answers | template faces **ignored for front/back** (forced md); notes face still usable |
| spatial | front/back (+ hint chip) | template faces if the canvas-derived row binds a tag |

Invalid / no-op combinations to remember:
- **Reverse cards** are generated only for `header-paragraph` and `table`; never cloze/occlusion/spatial.
- **HTML template faces are ignored for cloze & occlusion** front/back (always markdown); only their
  **notes** face benefits from a template.
- A table row only uses a template when `templateIsSatisfied` (front references ≥1 non-empty cell);
  otherwise it falls back to plain columns.

---

## Appendix A — Anki import mapping

The Anki importer (`packages/decks-core/src/services/migration/anki/`) maps Anki's model/note/card
trinity onto the types above (see [SR_MIGRATION.md](SR_MIGRATION.md) for the sibling SR importer):

There is **no user-facing layout choice** — the importer auto-picks the best fit per card (an
escalation from a safe header-paragraph default).

| Anki source | Decks result |
| --- | --- |
| **Basic** model (≤ 2 fields) | Default `header-paragraph`; **escalates to a table** when the answer is *compact* — single paragraph, ≤ 4 lines, ≤ 300 chars, and no `$$…$$` math block / code block (and any notes are compact too) — or when the note has no real front (the front media becomes the front cell instead of a `## Card <id>` header). As a volume fallback, a deck with **≥ 50** header-paragraph basics collapses them all into the table (even non-compact ones; empty-back cards stay header-paragraph since a table row needs a back). Table-routed basics aggregate into one table per deck **per column structure** (a 2-col and/or a 3-col table) — `AnkiCollectionParser.buildBasicCard` (`fitsTable` → `tableLayout`) + `AnkiDeckRenderer.renderFile`/`renderTableSections` |
| **Multi-field** standard model (> 2 fields) | `template` (table) card bound by tag + a generated **`decks-html-front/back`** template; the model's CSS becomes a `<style>` block — `buildTemplateCards` + `AnkiTemplateExporter.build` |
| **Cloze** model with extra fields | **front-only cloze** card + a generated **`decks-md-front` / `decks-md-notes`** template; the Extra shows via the Notes button — `buildClozeCard` + `AnkiTemplateExporter.buildCloze` |
| **Cloze** model, no extras | plain 1-col cloze (no template) |
| **Image Occlusion** note | `image-occlusion-v2` card + a `decks-occlusion` block; masks parsed from the Original-Mask SVG — `buildOcclusionCards` + `AnkiOcclusionExtractor` |

The modern `.apkg` decode (zstd `collection.anki21b` + protobuf media manifest) is handled in
`AnkiMediaManifest` + the plugin's `utils/zstd.ts`; tier/model routing and response parsing live in
the importer/backend, not here.

---

## See also

- [CLOZE.md](CLOZE.md) — cloze syntax, multi-line, groups, blanking modes.
- [IMAGE_OCCLUSION.md](IMAGE_OCCLUSION.md) — occlusion v2 model, masks, editor.
- [CANVAS_DECKS.md](CANVAS_DECKS.md) — spatial cards from canvas.
- [SR_MIGRATION.md](SR_MIGRATION.md) — Spaced Repetition plugin importer.
- [FLASHCARD_MANAGER.md](FLASHCARD_MANAGER.md) — editing cards in the manager UI.
