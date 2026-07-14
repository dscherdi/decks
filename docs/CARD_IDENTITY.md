# Decks — Flashcard Identity Specification (v3)

The problem this solves: a flashcard needs an identity that is **stable across edits**
(editing a card must not orphan its review history) but **distinguishes genuinely
different cards** (two different cards must not collide into one). Content hashing fails
the first; pure position fails the second. The scheme below gives each card an explicit
anchor token, and uses content hashing only as the bootstrap identity for cards that
have never been reviewed.

Revision history:

- **v1** — anchored identity via Obsidian `^block-id`s + table `rowIndex` + hash recovery.
- **v2** — added the identity/locator split, deterministic minting, multi-device
  invariants, coverage of all nine card formats, two-stage rollout.
- **v3 (this document)** — replaces `^block-id` anchors with a Decks-owned,
  role-tagged comment token (`%%dk:<role>:<id>%%`). Obsidian block-ID recognition
  rules made line-level anchors unreliable (mid-paragraph IDs render literally in
  reading view; fixes broke lists); a comment token works on any line and inside table
  cells, which also deletes the entire table `rowIndex + hash-recovery` machinery.

---

## Core principle: identity ≠ location

Two separate concepts, stored separately:

- **Identity** (`flashcards.id`): minted once when the card is first created, immutable
  forever. Review logs, sync-log ops (`rate`, `card_suspend`, …), and the
  merge-before-save all key on it. Because it never changes, none of them ever dangle
  and `review_logs` is never re-pointed.
- **Locator** (mutable `anchor` column, plus the cloze index): how the synchronizer
  finds the card's source in the file on each parse. Updating a locator is not an
  identity event and needs no cross-device coordination.

Matching on parse: read the anchor token from the file → look up the card **by anchor
column** → found means same card, regardless of what its content now says. Content
comparison then only decides whether an UPDATE is needed.

Consequences that fall out for free:

- **Existing vaults need no ID migration.** Legacy `card_${hash(front)}` IDs stay as
  the immutable ID forever; the anchor is bolted on as a locator when stamped.
- **Unreviewed cards need nothing.** They keep today's content-derived identity; if an
  edit churns them, no history existed to lose.
- The Levenshtein rename-detection subsystem and its threshold are retired.

## The anchor: a role-tagged Decks comment token

```
%%dk:<role>:<id>%%     e.g.  %%dk:h:x7f2%%
```

- `%%…%%` is Obsidian's comment syntax: invisible in reading mode natively, where
  cosmetics matter most. It needs no block-recognition rules, so it works at the end of
  **any** line — mid-paragraph, list items, blockquotes — and **inside table cells**.
  No blank-line insertion, no per-block special cases, one uniform stamping rule:
  append the token to the anchored line.
- `<role>` tags what the token anchors: `h` = header/body card, `c` = cloze line,
  `t` = table row, `o` = occlusion-v1 item. Reverse cards carry no token of their own —
  their identity derives from the base card's anchor. Role tags exist so tokens can
  never be re-interpreted across card-type changes: an `h:` token sitting on a line
  that later gains a `==cloze==` is inert for the cloze cards (never adopted as their
  anchor), so a type flip cannot hand one card's history to a different kind of card.
  They also make multi-token bodies unambiguous, and they make type flips partially
  self-healing: flip a reviewed plain card to cloze and back, and the dormant `h:`
  token restores its identity and history.
- `<id>` is minted **deterministically** from content (hash-derived, salted with an
  occurrence counter on collision within the file). Two devices that independently
  reach "first review" for the same not-yet-anchored card write identical bytes — no
  sync conflict, no split identity. (Exported/distributed decks are the exception: they
  are pre-anchored by tooling, which mints high-entropy IDs instead — see below.)
- Tokens the parser reads are **stripped at one chokepoint before any processing** —
  hashing, tag extraction, cloze scanning, template binding, display. `dk:`-prefixed
  comments are anchors, never card notes: they are excluded from the body-comment →
  notes extraction.
- Loss vs `^block-id`: linkability only. Identity tokens are read, never linked to;
  headings remain linkable by text.

### Stamping model

Users edit heavily *before* reviews accumulate, then stabilise. Protection is applied
lazily:

- **Personal decks**: the anchor is written at **first review** — one small
  `vault.process` edit at a moment the user is actively using the plugin. No vault-wide
  bootstrap pass, no upgrade rewrite, no sync storm. After a self-write, the deck's
  `last_synced_mtime` is stamped so the write does not retrigger a sync loop.
- **Exported/shared decks**: fully anchored at export time by the exporting tooling
  (see "Distributed decks & updates").

---

## Identity by format

| Format | Anchor | Survives (no history loss) | Loses history on | Phase |
|---|---|---|---|---|
| **Header + paragraph** | `h:` token on its **own line after the body**; located by scanning the body | Editing question, editing answer, moving card to another heading or file, appending paragraphs, reordering | Deleting the entire body (removes the token); retyping a card without carrying its token | 1 |
| **Header-only / title-mode** | `decks-id` property in frontmatter | Renaming the file, editing the body, moving | Deleting the note | 1 |
| **Cloze (prose, lists, quotes)** | `c:` token at end of the cloze line; identity = token + cloze index within the line | Editing the deleted word, same-word duplicates, inserting cloze lines above, moving the line | Reordering clozes **within the same line** (rare) | 1 |
| **Reverse card** (deck setting) | Derived from the base card's anchor (ID = base ID + `:rev`) | Everything the base card survives | Whatever the base card loses on | 1 |
| **Canvas spatial / standalone** | Native canvas `edgeId` / `nodeId` — no token needed | **Editing either node's text** (churns identity today), moving nodes | Deleting the edge/node | 1 |
| **Table row** | `t:` token, **written into cell 0**, **located by scanning the row's cells** | Editing any cell, adding/reordering columns, inserting/reordering/moving rows | Deleting the row (token with it) | 1 |
| **Cloze inside a table cell** | Row's `t:` token + cloze index within the cell | Same as table row, plus cloze-cell changing columns | Same as table row | 1 |
| **Image occlusion v1** | `o:` token per numbered list item (one card per item, no index needed — reorder-proof) | Editing item text, reordering items, editing other items | Deleting the item | 1 |
| **Image occlusion v2** | maskId inside the `decks-occlusion` block (unchanged) | Already stable | Deleting the mask | — |

Placement rules and their reasons:

- **Header card token goes in the body, not on the heading line.** On pre-token parser
  versions, body comments are stripped into card notes *before* the front is derived,
  so a body token leaves the old parsers' IDs unchanged; a heading token would flow
  into the front text and change them. The token is *stamped* on its own line directly
  after the last body line (keeping the user's text lines untouched) but *located* by
  scanning the whole body for the `h:` token, so paragraphs appended after it never
  orphan the card. Once the token-aware release is universal, moving the token to the
  heading line (closing the deleted-body hole) can be revisited.
- **Table tokens: write to cell 0, find by scan.** Cell 0 is the only cell guaranteed
  to exist in every table shape (1-column, 2-column, templated), so the write rule is
  uniform — but identity is located by scanning the row's cells for the token, never by
  column index, so column additions and reorders can never orphan a row. The stripping
  chokepoint sits directly after the row is split into cells, ahead of hashing, cloze
  scanning, template binding, and display.
- **All formats ship in one release** (decision: no staged rollout). Header bodies,
  title-mode, and prose clozes are provably identity-stable on old parsers (see
  "Version skew"); table and occlusion-v1 tokens are not — a cell-0 token lands inside
  old parsers' front-cell hash — so a not-yet-updated install parsing a tokened table
  computes divergent identities until it updates. Accepted; the mobile app ships the
  same core simultaneously to minimize the window.

---

## Token visibility: hidden in reading, visible while editing (by design)

The split is deliberate: **reading mode** (consumption) hides the token natively via
Obsidian's comment rendering — clean cards, clean notes. **Live Preview / source mode**
(editing) shows the token, and that visibility is a feature, not a gap: the token is
the card's identity, and seeing it while editing is what lets users carry it through
edits and avoid deleting it — the direct mitigation for the gesture-triggered reset
hole below. No default-on hiding extension is built.

Open question (see "To prototype"): if Obsidian natively hides `%%…%%` comments in
Live Preview outside the cursor line, the marker won't show during editing on its own —
then decide whether a subtle Decks reveal (e.g. a dimmed badge via editor decorations)
is worth building, or whether cursor-line reveal is marker enough. An opt-in "hide
anchors in Live Preview" toggle can be offered later for users who prefer a clean
editing view; it is not v0 scope.

## The `clozeEnabled` flag

The flag currently gates cloze expansion **and both image-occlusion formats**. It
shrinks to exactly one meaning: **"`==highlight==` creates cloze cards"** — a pure
intent switch for the dual-use highlight syntax (default stays on). Image occlusion v1
and v2 parse unconditionally; their syntax is unambiguous and cannot be accidental.
Documented behavior change: decks with the flag off that contain image+numbered-list
bodies convert from one plain card to N occlusion cards (a reviewed plain card there is
orphaned) — a one-time change affecting a small population.

---

## Multi-device correctness

1. **IDs never change**, so `rate` / suspend / bury ops and the ID-keyed
   merge-before-save can never dangle on an edit, a move, or a locator update.
2. **Anchors live in the note file**, which the user's file sync replicates. Any device
   parsing the file resolves the same token → the same card row (matched by anchor
   column, merged by immutable ID).
3. **Minting is deterministic** for lazily-stamped personal cards, so concurrent
   first-review stamping on two devices writes identical bytes.
4. **No recovery machinery exists to converge** — locator state is read directly from
   the file, which is itself the synced artifact.

### Version skew

Pre-token parser versions strip all `%%…%%` body comments into card *notes* before
deriving fronts or expanding clozes, and title-mode strips frontmatter. So for phase-1
formats (header bodies, title-mode, prose clozes), a stamped token leaves old versions'
computed identities **unchanged** — the only artifact is cosmetic: old versions display
the token text as a card note. A prep release that teaches all parsers (plugin and
mobile, via decks-core) to read and strip `dk:` tokens is still shipped first so even
that artifact disappears; phase-2 stamping (tables, occlusion v1) and any future
heading-line placement remain gated on that release being widely deployed.

---

## Distributed decks & updates

Shared decks that receive updates from their author are a hard functional dependency
for stable identity: an update is, by definition, an edit to cards that carry the
recipient's review history — content-derived identity cannot support that at all.

- **Recipients adopt the shipped anchors as card IDs directly** — no translation
  table. Distributed decks arrive **fully pre-anchored at export**, so there is no
  recipient-side bootstrap and no mint race; export tooling therefore mints
  **high-entropy token IDs**, avoiding collisions with the recipient's own
  content-hash-derived tokens and with other decks.
- **An update is just: replace the file, re-sync.** The synchronizer's anchor matching
  is the update mechanism — surviving cards match by token (history preserved through
  any content edit), new cards create, removed cards follow the existing deletion
  rules.
- **Token preservation across author edits is a publishing-tool guarantee.** The
  intended-reset principle is learner-relative: an author's delete-and-rewrite gesture
  must not silently reset a recipient's scheduling — the recipient's recall may be
  entirely unaffected by a typo fix or rephrasing, and the affected party isn't the
  one who could have read a warning. The publishing/update tooling therefore
  content-diffs each new version against the **previously published version** and
  re-attaches existing tokens to matched cards; only genuinely new cards get fresh
  tokens. Content-matching is acceptable here, unlike in runtime sync: it runs once,
  author-side, against a known prior artifact, and can ask the author interactively
  when a rewrite is ambiguous ("same card or new?"). No publishing tooling exists yet;
  this is a design requirement on it from day one.
- **Deferred**: conflict policy when the recipient edited a card the author also
  updated. Identity only guarantees the two versions are recognized as the same card;
  which content wins is an update-mechanism question.

Importers follow the same model: the Anki and legacy-SR renderers emit tokens into the
markdown they write and key the injected review history to the token-derived IDs (for
Anki, the imported `noteId` is the natural token value). Imported decks arrive
pre-anchored — lazy first-review stamping never applies to them.

---

## Intended reset semantics

FSRS state is a memory model of *specific content*: the stability and difficulty
learned for one phrasing do not validly predict recall of a different phrasing. When a
user **deletes a card's body / row / item and writes substantively different content**,
the token goes with the deleted content and the new content starts fresh — and that is
*correct*, not a hole: preserving the history would carry a memory model onto content
it was never trained on. A substantive rewrite changes what is being learned;
scheduling resets with it.

This principle is **learner-relative** — it justifies resetting *your* scheduling when
*you* rewrite *your* card. It deliberately does not extend to a deck author rewriting a
card that other people are studying; that case is handled by tooling, not by reset (see
"Distributed decks & updates").

## Accepted holes (known, deterministic, documented)

| Case | Why it can't be closed | Severity |
|---|---|---|
| **Gesture-triggered reset of unchanged content** — clearing a line/body and retyping the same (or trivially changed) text, without the token | The mechanism fires on the *gesture* (token lost), not on semantic change; the memory model was still valid, but distinguishing "real rewrite" from "retype" would require content-diffing every delete — exactly the fuzzy matching this spec deletes. Determinism over precision. | Documented, minor: cut/paste carries tokens; delete-and-retype of reviewed content verbatim is rare. |
| Reordering clozes **within one line** | The within-line index shifts; the line token can't distinguish them. | Rare edit. |
| Type flip (adding the first `==cloze==` to a reviewed plain card, or removing the last) | The body switches between producing one plain card and N cloze cards — different cards. True under today's hash scheme as well. | Partially self-healing: the dormant `h:` token restores the plain card's identity if the flip is reverted. |
| Editing an **unreviewed** card's identity-bearing content | Unreviewed cards have no token yet (lazy stamping); content edits re-derive identity. Includes losing a suspension applied to an unreviewed card. | Harmless by design — no history exists; exists today too. |

Future note: an explicit visible ID column for table rows was considered and dropped —
the in-cell token gives explicit row identity with no visible column.

---

## To prototype before building

1. `%%…%%` behavior **inside table cells** — reading mode (must hide) AND the Live
   Preview table editor (cells render as widgets; behavior unverified).
2. Native Live Preview treatment of `%%…%%` on plain / cloze / list lines. Desired
   outcome: token visible (or at least discoverable) while editing, since it serves as
   the identity marker; if Obsidian hides it entirely outside the cursor line, decide
   whether a subtle reveal decoration is warranted.
3. (Phase 2, code-level) image-embed and numbered-list detection tolerance of trailing
   tokens in occlusion-v1 bodies.

## Release shape (implemented)

Everything ships in a single release — parsing/stripping, the locator schema and
anchor-first matching, stamping for every format (`h:`, `c:`, `t:`, `o:`, title-mode
frontmatter, canvas native ids), the one-time migrator that anchors all reviewed
cards on upgrade, token preservation in the in-place card editor, and importer token
emission (Anki keyed on `noteId:ord` so re-imports are byte-stable; legacy-SR
equivalents). `clozeEnabled` is un-gated from occlusion. The Levenshtein rename pass
survives one more release as a fallback for cards the migrator could not stamp
(missing files, ambiguous fronts); its deletion is a later cleanup. No Live Preview
editor extension — token visibility while editing is intentional.
