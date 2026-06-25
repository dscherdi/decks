# Table Templates

## Overview

Templates let you render the rows of a markdown table through a card design you author once. You write the
design in HTML/CSS or Markdown, mark where each column's value should appear with `{{...}}` placeholders, and
bind it to your tables with a tag. One template applies to every row of every table it matches — a one-to-many
relationship — so a long table becomes many cards that all share the same look.

Templates are **opt-in** and **non-destructive**: they change only how cards are *rendered* during review;
your notes and table data are untouched. A table with no matching template falls back to the normal
Front / Back / Notes column parsing.

## Quick start

1. **Pick a template folder.** Open **Settings → Templates → Template folder** and choose a folder in your
   vault (templates are disabled until you do). Every `.md` file inside that folder is treated as a template.
2. **Create a template file** in that folder, give it a binding tag, and add the card faces as code blocks:

   ````markdown
   ---
   tags:
     - vocab
   ---

   ```decks-html-front
   <ruby>{{Word}}<rt>{{Reading}}</rt></ruby>
   ```

   ```decks-md-back
   **{{Meaning}}**
   ```
   ````

3. **Tag a table** with the same tag, on the heading that contains it:

   ```markdown
   ## Kanji vocabulary #vocab

   | Word | Reading | Meaning |
   | ---- | ------- | ------- |
   | 火   | ひ      | fire    |
   | 水   | みず    | water   |
   ```

Now each row renders through the template: the front shows the kanji with furigana, the back shows the bold
meaning.

## Authoring templates

A template is a markdown file whose card faces are written as fenced code blocks. The block language encodes
both the **engine** and the **face**:

```
decks-<engine>-<face>
```

- **engine** — `html` (full HTML/CSS, sandboxed) or `md` (Markdown, rendered by Obsidian).
- **face** — `front`, `back`, or `notes`.

So the six block languages are:

| Block | Renders |
| --- | --- |
| `decks-html-front` / `decks-md-front` | the question side |
| `decks-html-back` / `decks-md-back` | the answer side |
| `decks-html-notes` / `decks-md-notes` | the optional notes panel |

You can mix engines per face (e.g. an HTML front and a Markdown back). Faces you don't define are simply not
shown. The code blocks also render a **live preview** right inside the template file as you edit it.

### Fallback: no code blocks

If a template file contains no `decks-*` code blocks, it's split on the first horizontal rule (`---`, `***`,
or `___` on its own line): everything **above** the rule is the Markdown front, everything **below** is the
Markdown back. (No notes face is produced this way.)

## Where templates live

- The **Template folder** setting (Settings → Templates) selects the folder; it's empty/disabled by default.
- Any `.md` file at or under that folder is a template. Other notes are unaffected.
- Changing the folder rebuilds the template cache immediately — no reload needed.

## Binding by tag

A table binds to a template when their tags match. Matching happens in two tiers:

1. **Heading tag (Tier 1)** — a tag on the heading that contains the table, e.g.
   `## Kanji vocabulary #vocab`. This is the most specific and is preferred.
2. **Deck frontmatter tag (Tier 2)** — a tag in the deck file's YAML frontmatter (`tags:`). Use this to apply
   one template to every table in a file.

The template with the **most matching tags** wins; if nothing matches, the table uses the default
Front/Back/Notes columns.

A template **declares its own tag** the same way any note does — via frontmatter `tags:` or an inline `#tag`
on a heading inside the template file. For example a template file containing `## Vocabulary card #vocab`
binds to tables tagged `#vocab`.

> Note: an inline `#tag` on one section of a deck does **not** turn the whole deck into that tag — it only
> tags that section's table. Use frontmatter `tags:` when you want a deck-wide binding.

## Variable merging

Inside any face, `{{...}}` placeholders are replaced with the row's cell values:

- **By name** — `{{Meaning}}` inserts the cell under the `Meaning` column. Names are **case-insensitive**
  and trimmed (`{{meaning}}` works too).
- **By position** — `{{1}}`, `{{2}}`, `{{3}}` insert the 1st, 2nd, 3rd cell. Positional placeholders are handy
  when your column headers are localized or you want the template to be header-agnostic.
- **Unmatched** placeholders (a name with no column, or an out-of-range number) resolve to an empty string.

You can mix both styles: `{{Word}} ({{2}})`.

## HTML templates

HTML faces give you complete control over layout and styling. They render inside an **isolated, sanitized
Shadow DOM**:

- **Sanitization** — HTML is cleaned with DOMPurify. `<style>` blocks are allowed; `<script>` tags and inline
  event handlers (`onclick`, …) are removed.
- **Encapsulation** — your template's CSS can't leak into Obsidian and Obsidian's CSS can't leak into your
  card, so designs are predictable.
- **Theme aware** — the card inherits Obsidian's theme variables and `theme-dark` / `theme-light` class, so
  it matches the active theme and updates live when you switch.

### The CSS variable API

By default a card gets a premium frame: a centered canvas with comfortable padding inside a bordered, rounded,
shadowed shell. The canvas exposes CSS variables on `:host` that your template can override from its own
`<style>` block:

| Variable | Default | Controls |
| --- | --- | --- |
| `--padding` | `2rem` | inner padding of the card canvas |
| `--align` | `center` | horizontal alignment (`align-items`) |
| `--justify` | `center` | vertical alignment (`justify-content`) |
| `--bg` | `transparent` | canvas background (the themed card shows through by default) |

```html
<div class="card">…</div>
<style>
  :host { --padding: 0; --align: flex-start; --bg: #1e1e1e; }  /* edge-to-edge, top-left, dark */
  .card { font-weight: 600; }
</style>
```

Obsidian theme variables are available too — e.g. `var(--text-normal)`, `var(--text-muted)`,
`var(--background-primary)`, `var(--font-text)`, `var(--font-text-size)`, `var(--line-height-normal)`.

### Images

Image references render as real images inside HTML templates:

- Obsidian wikilink embeds — `![[diagram.png]]`
- Markdown image links — `![alt](path/to/img.png)`
- External URLs — `![alt](https://example.com/img.png)`

Images are scaled to fit the card (`max-width: 100%`). Non-image embeds (e.g. `![[some note]]`) are left as-is.

## Editing template cards

When you edit a card that's bound to a template, the editor shows **one labeled text input per table column**
instead of raw Front/Back/Notes boxes — you edit the row's data, and the template handles presentation. (AI
refactoring is hidden for template-bound cards, since the content is structured table data.)

## Full example

**`Templates/Vocabulary.md`** (inside your template folder):

````markdown
---
tags:
  - vocab
---

```decks-html-front
<div class="decks-vocab-card">
  <ruby>{{Word}}<rt>{{Reading}}</rt></ruby>
</div>
<style>
  :host { --padding: 1rem; }
  .decks-vocab-card { font-size: 2.6em; text-align: center; }
  .decks-vocab-card rt { font-size: 0.35em; color: var(--text-muted); }
</style>
```

```decks-md-back
**{{Meaning}}**
```
````

**Your deck note** (tag the heading with the same tag):

```markdown
## Kanji vocabulary #vocab

| Word | Reading | Meaning |
| ---- | ------- | ------- |
| 火   | ひ      | fire    |
| 水   | みず    | water   |
```

Result, per row:

- **火 / ひ / fire** → front renders 火 with ひ as furigana above it; back renders a bold **fire**.
- **水 / みず / water** → front renders 水 with みず above it; back renders a bold **water**.

> Tip: the placeholders above use column names (`{{Word}}`), which read clearly. If your headers are
> localized or you'd rather not depend on them, use positional placeholders instead — `{{1}}`, `{{2}}`,
> `{{3}}` — which map to the columns left-to-right.

## See also

- [Cloze deletions](./CLOZE.md)
- [Image occlusion](./IMAGE_OCCLUSION.md)
- [Canvas decks](./CANVAS_DECKS.md)
