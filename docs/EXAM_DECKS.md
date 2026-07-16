# Decks — Exam Decks Specification (v2)

The problem this solves: reviews measure memory over time; exams measure mastery on
demand. Students preparing for a test need objective, scored, timed practice — multiple
choice, multi-select, true/false, short answer — and they need it **without learning an
authoring notation**. Decks' thesis is that the note already contains the card; the exam
must fall out of structure the user already writes.

**Design summary:** exactly one new structural rule (a task list under a heading is a
multiple-choice card), one new parse flag on the deck profile (`examEnabled`, default
off), one new anchor role (`q:`), a type-in presentation for short answers, and a
results subsystem (the only substantial new machinery). Scheduling is untouched.

Revision history:

- **v1** — issue-thread draft: the task-list rule, "Test" profiles, results store,
  `q:` role, open questions.
- **v2 (this document)** — grounded against the codebase. Corrections: the profile
  framing is rewritten around `DeckProfile` (v1's "fourth profile type alongside
  Standard/Intensive/Trained" conflated deck-config profiles with the FSRS weight-set
  enum, which is `STANDARD | TRAINED` and carries no parse flags); v1's "short answer
  works free via existing type-in" was wrong — no type-in mode exists, so it is
  specified here as new work over an existing grading utility; v1's "a file could map
  to two profiles" is impossible (tag→profile mappings are unique and a deck has one
  profile), so dual use is realized as *an exam is a session over any selection*
  instead; the open questions of v1 §9 are resolved, including the old-parser behavior
  of a `q:` token (answered from code, see "Version skew"); naming is locked to
  **Exam** throughout ("test deck" already means the onboarding sample deck —
  `TestDeckService`, i18n `testDeck`/`testDeckCanvas`).

---

## Core principles

1. **One structural rule, no notation.** Of every native markdown element, the task
   list is the only one whose semantics are already boolean marking: "check the right
   answer" is guessable without being told. This is the same design move as
   headings→cards and `==highlight==`→cloze — reuse structure that already implies the
   meaning.
2. **An exam is a session over a selection, not a file format.** Any exam-enabled
   file deck, tag group, or filter-based custom deck drawing from exam-enabled decks
   can be examined; a different exam is a different filter, never a re-authoring.
   (This is also forced by the architecture: a deck has exactly one profile, so
   "exam-ness" cannot live in dual profile membership.)
3. **Exam results are not reviews.** Attempts are graded at answer time — objectively
   in the option and string modes, by the taker's own recorded verdict in the judged
   typed mode — immutable once ended, and stored apart (`exam_sessions` /
   `exam_answers`), never in `review_logs`, never touching FSRS state. Subjective
   recall and graded performance are tracked separately over the same cards.
4. **Dual use is legal.** The same card can be FSRS-reviewed and exam-tested. The
   results stores never collide, and a multiple-choice card has a defined presentation
   inside an ordinary review session (see "Presentation").

---

## Authoring: the multiple-choice rule

> A heading whose body is a **task list** produces one multiple-choice card.
> Each top-level list item is an option. `- [x]` marks a correct option.

```markdown
## Which element is a noble gas?

- [ ] Oxygen
- [x] Argon
- [ ] Nitrogen
- [ ] Chlorine
```

- **One box checked** → single-answer question, radio presentation.
- **Multiple boxes checked** → multi-select, checkbox presentation. No marker needed —
  the count of checked boxes *is* the signal. Grading is all-or-nothing in v1 (the
  session's config snapshot keeps partial credit open later).
- **True/false** is not a card type — it is a degenerate two-option question. The user
  writes `- [x] True` / `- [ ] False`. Nothing to implement.
- **Stem** = the heading (tags stripped as usual) plus any non-list body content above
  the list — so an image embed or a math block above the options is part of the
  question. Options are markdown: math, bold, images, and multi-line continuation
  (indented non-task lines belong to their option) all render through the normal
  pipeline.
- **Notes/explanations** reuse the existing mechanisms unchanged — `%%comment%%` in the
  body or a trailing `---` divider. Shown on demand during review; shown per question
  in the exam results review.
- **Per-card tags** on the heading work exactly as today.

### Body shapes and outcomes

One rule generates all edge-case behavior: **if the body does not classify as a valid
question, the card falls back to today's header-paragraph parse and is flagged.**
Silent question creation from malformed input never happens; silent data loss never
happens — an invalid body still produces a reviewable plain card.

| Body under an `examEnabled` profile | Outcome |
|---|---|
| ≥2 top-level task items, ≥1 checked, homogeneous list | Multiple-choice card (1 checked = radio, >1 = multi-select; **all** checked is legal) |
| Task list with no box checked | Fallback + flag: *no correct answer* |
| Single task item | Fallback + flag: *needs at least two options* |
| Mixed top-level list (task items + plain bullets) | Fallback + flag: *mixed list* |
| Nested task items under an option | Fallback + flag: *nested task lists unsupported* (indented non-task continuation lines are fine — they are the option's markdown) |
| Empty option text | Fallback + flag: *empty option* |
| Task list not under a parsed heading | Not a card (same rule as every format) |
| `examEnabled` off | Task list parses as today: body of a header-paragraph card |

Flagged cards are **visible**: a "Invalid exam question" health badge in the flashcard
manager (with the reason in the tooltip) and a skipped-count in the exam setup dialog —
a student who wrote 40 questions and forgot to check one answer needs to find that one.

### Deliberately unsupported

| Thing | Why not |
|---|---|
| Cloze inside options | Two card types fighting over one body. When a body qualifies as multiple-choice, that wins outright; `==highlight==` in an option renders literally. |
| Questions from tables | Markdown table cells cannot contain task lists, so the checkbox rule cannot apply there even in principle — and tables already mean row-per-card. (Table rows participate in exams as type-in, and as fill-in-the-blank when a cell holds a cloze.) |
| Nested task lists | Sub-items have no meaning here. Flagged, not silently ignored. |
| Ordering/matching questions | No native structure implies them; would require notation. |
| Auto-generated MCQ (sibling backs as distractors) | Considered and rejected: distractor quality is uncontrollable outside authored options. |

---

## Card model & storage

**A new `FlashcardType` value: `multiple-choice`.** The options and the correct-set are
**not** stored structurally — the raw task-list markdown stays in `back`, exactly as
authored, and is interpreted at use time by one shared pure classifier in decks-core:

```
classifyExamBody(back) →
    { kind: "mcq", stem, options: [{ text, correct }] }
  | { kind: "invalid", reason }
  | { kind: "plain" }
```

The classifier serves all four consumers — parser gating, exam rendering, FSRS-review
rendering, and card-health validation — so the definition of "a valid question" exists
in exactly one place.

Why raw-markdown-in-back and not an options JSON column: this is the codebase's uniform
pattern already (cloze re-derives its segments each sync; occlusion v1 keeps its
numbered list in `back` and expands at parse). Files are the synced artifact and every
device re-parses them; a structured column would be a second source of truth that must
be kept converged for zero benefit. Consequences:

- Checking/unchecking a box or editing an option is a content **update**, never an
  identity event (once the card carries its `q:` anchor).
- The `flashcards.type` CHECK constraint must be widened to admit `multiple-choice` in
  both DDL paths — and that is the whole change: the migration already drops and
  recreates `flashcards` on every version bump (the vault repopulates it; FSRS state
  restores via `review_logs`), so the widening is just editing the CREATE TABLE text
  in the fresh DDL and the migration DDL. The rebuild cannot cascade into
  `review_logs`: both DDL paths already run inside the existing
  `PRAGMA foreign_keys = OFF … ON` bracket.
- Parse order inside the header finalizer: image occlusion → multiple-choice (gated on
  `examEnabled`) → cloze → plain.
- **Editable in the flashcard editor exactly like any card.** Because the back *is*
  the raw task list, the existing in-place editor applies unchanged — no
  question-specific editing UI. Two provisos: the editor's token-preservation
  guarantee extends to `q:` tokens, and an edit that stops the body classifying as a
  valid question follows the standard fallback + flag path on the next sync (the
  dormant `q:` token stays inert and self-heals, per "Identity").

---

## Profiles & gating

### The dual-use collision and `examEnabled`

A task list under a heading currently parses as the body of a header-paragraph card.
Enabling the question rule *reinterprets existing content* — a `#decks`-tagged note
containing an innocent todo list must not silently become a nonsense exam question, and
for a reviewed card the reinterpretation is a type flip. This is exactly the
`==highlight==`/cloze problem, and it takes the same fix: an intent flag.

**`examEnabled: boolean` on the deck profile (`DeckProfile`), default off.** It means
precisely: *"a task list under a heading creates a multiple-choice card."* It is a real
profile column (not part of the settings JSON below) because it participates in the
`parsingAffected` re-parse gate exactly like `clozeEnabled`, and it is plumbed along
the identical chain (profile types → schema/queries → profile sync op → profiles UI →
synchronizer → parser).

`examEnabled` gates **parsing and exam availability**. The question rule fires only
under the flag, and exam entry points appear only where the flag is set — a deck
whose profile lacks it offers no "Start exam" anywhere. Within an exam-enabled deck
the pool is not question-cards-only: header-paragraph, table, and cloze cards
participate as type-in, so an exam is meaningful with zero multiple-choice cards in
it.

**Type-flip warning:** enabling `examEnabled` on a profile whose decks contain
*reviewed* header-paragraph cards that would classify as questions shows a confirm
dialog with the affected count. The plain card's history parks on its dormant `h:`
token and self-heals if the flag is turned back off (see "Identity").

### Exam settings

Session defaults live in a single `exam_settings` JSON column on the profile
(precedent: custom decks store `filterDefinition` as JSON). None of these affect
parsing; they pre-fill the exam setup dialog, and the dialog's final values are what
get snapshotted into the attempt.

| Setting | Default | Notes |
|---|---|---|
| `questionCount` | 0 (= all) | draw N from the eligible pool |
| `timeLimitMinutes` | 0 (= off) | countdown reuses the session-timer pattern |
| `passScorePct` | 60 | shown on the results screen |
| `shuffleQuestions` | on | presentation-only; file untouched |
| `shuffleOptions` | on | presentation-only; file untouched |
| `feedbackTiming` | `"end"` | or `"immediate"` (verdict after each submit) |
| `selectionMode` | `"random"` | or `"sequential"` (file order); weakest-first is Phase 2 |
| `typedGrading` | `"tolerant"` | or `"exact"` or `"self"` (judged by the taker) — see "Type-in" |
| `optionLabels` | `"letters"` | or `"numbers"` — option prefix style, a)–i) vs 1)–9) |

Selections without a profile of their own (custom decks) fall back to global defaults.

### The Exams preset profile

A new preinstalled preset **"Exams"** (`profile_exams`), seeded through the existing
preset mechanism alongside Default, Heading 1–6, and Review notes: heading level 2,
`clozeEnabled` off, `examEnabled` on — and **new-cards limit enabled with
`newCardsPerDay: 0`**. No preset tag mappings are seeded today (they depend on the
user's configured base tag), so the **`<base>/exams`** mapping (e.g. `#decks/exams`)
is created once at plugin startup behind a settings flag — a user who deletes the
mapping keeps it gone. Base-tag renames migrate it together with every other
mapping. Tag→profile resolution already prefix-matches with most-specific-wins, so
`#decks/exams/chemistry` resolves to the preset automatically — tagging a note is
the entire setup. Like every preset, it is editable; it is a starting point, not a
mode.

The zeroed new-cards limit is how "exam cards don't enter the FSRS queue" is
achieved: not a new scheduling flag, but an existing, visible setting. The scheduler
simply never serves the deck's cards as new, so nothing is ever due. A user who
*wants* dual use raises one familiar limit.
(A real `schedulingDisabled` flag was considered and rejected: it would touch
scheduler queries, statistics, the deck panel, and the sync op surface to express a
default that daily limits already express.)

Honest note: the zeroed limit is a soft default, not an enforcement. Nothing prevents
reviewing an exam deck; that is deliberate.

### Deck panel

Exam decks are listed as **normal decks** — file-view and tag-view rows show the same
New/Due/total columns as every other deck, with no special columns. The interactions
differ by profile:

- **Exam-enabled deck**: row click opens the **exam setup dialog** — taking an exam
  is the deck's primary action, and under the Exams preset (new-cards limit 0)
  row-click review would serve nothing. Its ⋮ menu carries **Start exam** (the same
  action, kept for discoverability the way cram keeps a redundant entry) and
  **Start review** (the escape hatch, since row click no longer reviews).
- **Normal deck** (profile without `examEnabled`): row click opens review as today,
  and the ⋮ menu carries **no exam entry** — exams are an exam-deck capability, not
  ambient UI on every deck.
- **Tag groups** follow their resolved profile. **Custom decks** show Start exam only
  when the selection contains cards from at least one exam-enabled deck; an exam's
  draw pool is always restricted to cards whose deck's profile has `examEnabled`, and
  the setup dialog's eligible/skipped counts reflect that.

One honest note stands: under the Exams preset an exam deck's cards stay New forever,
so its row shows a growing New count and Due 0 — the columns report FSRS state
truthfully; exam activity lives on the results screen (previous attempts).

---

## Exam sessions

### Eligibility

| Card type | In an exam draw | Presented as |
|---|---|---|
| `multiple-choice` | yes | radio / checkbox question |
| `header-paragraph` | yes, if gradable (below) | type-in |
| `table` | yes, if gradable (below) | type-in |
| reverse cards | yes (as their own cards) | type-in |
| `cloze` (incl. cloze in table cells) | yes | fill-in-the-blank type-in |
| `image-occlusion`, `image-occlusion-v2`, `spatial` | **no** (v1) | — no exam presentation defined |

Type-in gradability depends on the deck's grading mode (see "Type-in"). Under the
string modes (`exact`/`tolerant`), the answer is the **first non-empty line of `back`**
(after notes extraction and anchor stripping; for cloze questions, the target
segment's text), reduced to plain text — and a card whose
answer line is embed/image-only or longer than ~120 characters after normalization is
**flagged, not silently dropped**: an *"answer too long to string-grade"* health flag
(the same class as "no box checked"), skipped in the draw, counted in the setup dialog.
The fix is the author's choice — shorten the answer, or switch the deck's grading mode.
Grading a typed string against a three-paragraph body with edit distance would be
theater; the ceiling is a property of the string graders, not of the cards. Under the
judged mode there is **no ceiling**: any card with a body is eligible, because the
rendered body — not a string — is the judgment reference.

### The attempt

1. **Start exam** (row click on an exam-enabled deck, or its ⋮ menu) → gather the
   selection's cards eagerly (the cram pattern).
2. **Setup dialog** — pre-filled from the profile's `exam_settings`; shows the eligible
   count and "N skipped (invalid or not gradable)" with a pointer to the flashcard
   manager; question count is capped at the eligible count.
3. **Draw** — random sample without replacement, or sequential, per `selectionMode`;
   then optional shuffle. (A small sampling/shuffle utility in decks-core — none exists
   in the review path today.)
4. **Question screens with free navigation** — one question per screen, "Question i
   of N", countdown in the header if a time limit is set. Previous/Next buttons plus a
   **numbered navigator strip** (chips 1..N: answered = filled, current = highlighted;
   click to jump). In end-feedback mode, selecting or typing *is* answering, and every
   answer stays editable until submission; in immediate mode an answer locks the
   moment it is submitted (verdict + correct answer shown), while navigation stays
   free.
5. **Submit exam** (explicit button; timer expiry auto-submits) → if unanswered
   questions remain, a confirm states the count — they grade incorrect with an empty
   given-answer → results screen. **Quit** (header button or Esc, with confirmation)
   abandons the attempt entirely — no row, no sync op.

Scoring: `score = correct / total`, all-or-nothing per question. Multi-select is
graded by **option index** (file order — stable within one presentation; the shuffle
is display-only): correct iff the selected index set equals the correct index set.
Text is never compared for grading — duplicate or identically-normalizing option
texts would make a text-set comparison misbehave silently. Pass/fail against the
snapshotted `passScorePct`.

### Lifecycle: in memory until ended

**An attempt lives only in memory until it ends; at exam end the answers are
inserted first and the session row last — the session row is the commit marker.**
No multi-statement transaction crosses the worker transport, so atomicity is
replaced by ordering plus idempotency: every query keys off `exam_sessions`, so
partial answer writes are invisible, and `INSERT OR IGNORE` with deterministic ids
makes a retried completion re-ignore cleanly. The in-memory rule is the correctness
argument: the database file is itself a synced artifact (merge-before-save), and the
results tables merge by append-only `INSERT OR IGNORE` union. If in-progress rows
were persisted, a merge could fossilize another device's half-finished copy forever —
the ignore would block the later "ended" version from ever landing. Writing only
ended sessions makes union-by-id trivially correct and directly implements "an
in-progress exam is local-only and never synced." Taking an exam on two devices at
once produces two independent attempts, which is correct.

Cost, accepted and documented: closing Obsidian mid-exam loses the attempt (guarded by
a confirm dialog). Resumable in-progress attempts are Phase 2 and require a local-state
design, not a schema change.

### Results store

Added to both DDL paths (fresh `CREATE_TABLES_SQL` and `CREATE TABLE IF NOT EXISTS` in
`buildMigrationSQL`, per the cram-tables template):

```sql
CREATE TABLE IF NOT EXISTS exam_sessions (
  id             TEXT PRIMARY KEY,
  deck_key       TEXT NOT NULL,      -- file deck id / group tag / custom deck id
  deck_kind      TEXT NOT NULL,      -- 'file' | 'group' | 'custom' (no CHECK: table persists, see notes)
  started_at     TEXT NOT NULL,
  ended_at       TEXT NOT NULL,      -- always set: only ended attempts are persisted
  config_json    TEXT NOT NULL,      -- settings snapshot at attempt time
  question_count INTEGER NOT NULL,
  correct_count  INTEGER NOT NULL,
  score_pct      REAL NOT NULL,
  passed         INTEGER NOT NULL,
  duration_ms    INTEGER NOT NULL,
  created        TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS exam_answers (
  id             TEXT PRIMARY KEY,   -- deterministic: sessionId || ':' || ordinal
  session_id     TEXT NOT NULL,      -- no FK: answers are written BEFORE their session row
  flashcard_id   TEXT NOT NULL,      -- immutable card ID; deliberately NO foreign key
  ordinal        INTEGER NOT NULL,
  question_type  TEXT NOT NULL,      -- 'multiple-choice' | 'type-in' (no CHECK: table persists, see notes)
  grading_method TEXT NOT NULL,      -- verdict provenance: 'options'|'exact'|'tolerant'|'self'
  prompt         TEXT NOT NULL,      -- truncated snapshot (~200 chars)
  correct_answer TEXT NOT NULL,      -- snapshot: correct option texts / expected line
  given_answer   TEXT NOT NULL,      -- snapshot: selected texts / typed text; '' = unanswered
  is_correct     INTEGER NOT NULL,
  time_ms        INTEGER,
  created        TEXT NOT NULL
);
```

Design notes:

- `flashcard_id` keys on the **immutable card ID** from the identity spec — an attempt
  record never dangles when content is edited or the locator moves. It carries no
  foreign key on purpose: exam history outlives card deletion (the `review_logs`
  semantics, not the cram-cards CASCADE).
- Answer snapshots are **texts, for display only** — grading never compares them
  (multi-select grades by index in memory; see Scoring). Options have no cross-edit
  identity in v1, so *stored* indices would go stale the moment the card is edited;
  text snapshots keep history readable instead.
- `grading_method` records the grader that actually produced each verdict — `options`
  (index-set equality), `exact`, `tolerant`, `self` — so self-graded verdicts stay
  distinguishable from string-graded ones in any later analytics, regardless of how
  the profile's grading mode changes over time. New values (e.g. a future automatic
  grader) extend it without migration.
- `config_json` matters: if the pass score or grading mode changes later, historical
  attempts remain interpretable against the rules they were taken under. It is also
  what makes partial credit a Phase-2 config change instead of a migration.
- `time_ms` is the question's cumulative on-screen time until its final answer — free
  navigation means revisits accumulate rather than reset.
- **Persistent exam tables carry no enum CHECKs.** They are `CREATE TABLE IF NOT
  EXISTS` and live across versions, so a CHECK on `deck_kind`, `question_type`, or
  `grading_method` would force a table rebuild the day a new value lands; the writer
  enforces values instead. (`flashcards.type` keeps its CHECK only because that table
  is rebuilt on every version bump anyway.)
- No `modified` columns — rows are immutable by construction.

### Sync

- **One new sync-log op, `exam_session_complete`,** carrying the session and its
  answers as a single unit. The handler is idempotent `INSERT OR IGNORE` for both
  tables. Added to the known-ops set (older clients skip unknown ops with a warning —
  the established safe-evolution path) and to the prompt-flush list (a finished exam is
  a natural immediate-durability unit).
- Payload note: this op is far larger than the typical record — a 40-question attempt
  with snapshots is 10–20 KB. Prompt truncation bounds it, and attempts are rare
  relative to ratings.
- **File-level merge:** both tables join the generic append-only merge
  (`INSERT OR IGNORE … SELECT *`) used by `review_logs`/`review_sessions`/
  `anchor_bindings`, in the worker merge and the in-process test mirror, plus the
  backup-restore path. Union by id; no conflict resolution exists because none is
  needed.

### Statistics scope (v1)

Exam results surface in exactly one place in v1: the **previous attempts** list on
the results screen. No existing FSRS statistic changes, and deck rows carry no exam
columns. A score-over-time chart, per-question accuracy analytics, and any deck-row
score surfacing are Phase 2 — the schema above is designed to feed them, and raw
score history answers most of what a student wants before any smoothing is worth
discussing.

---

## Presentation

### The exam surface

Exams get their **own component** (`ExamModal` + wrapper, plus a fullscreen tab
host), not a third mode inside the review modal. Cram earned its mode-boolean by sharing the entire reveal/rate skeleton —
only the button bar and the scheduler calls differ. An exam shares almost none of that
skeleton: a pre-drawn fixed question list instead of scheduler pulls, submit/next
instead of reveal/rate, no rating bar, per-question verdicts, a results screen the
review modal has no concept of, and timer expiry that means "auto-finish and grade,"
not "end review." Grafting that in as conditionals would tax every future edit of an
already very large component. The small duplication (modal chrome, progress display,
the markdown-render prop pattern, the countdown) is paid by extracting leaf helpers,
not by merging flows.

Hosting mirrors review's dual mode: one Svelte exam component, hosted by a modal
wrapper or by a fullscreen workspace tab (ItemView) — the same pattern as the review
modal/tab pair, honoring the existing display-mode setting. The header carries the
selection name, the countdown, and **Quit**. A header "Show answer" control (seen in
CBT-style plugins) is deliberately not adopted: `feedbackTiming: "immediate"` is the
same capability per question, without a mid-exam reveal that bypasses grading.

The shell's shape follows established CBT-exam interfaces (cf. the obsidian-cbt-exam
plugin): free navigation with a question-navigator strip, editable answers, and an
explicit submit — an exam is a *paper you fill in and hand in*, not a one-way card
queue. Matching questions, which such interfaces also offer, remain deliberately
unsupported here: no native markdown structure implies them.

The **results screen** (new UI, nothing like it exists): score %, pass/fail against the
snapshotted threshold, time used, a per-question list (prompt, your answer, correct
answer, verdict, notes on demand), previous attempts for this selection, and
Retake/Close. Persistence and the sync op fire when this screen is shown — never
earlier.

### Option rendering and the strikethrough problem

Obsidian renders `- [x]` with a checked box and strikethrough — which reads as
"done/cancelled," the opposite of "correct." In Decks' own views options are therefore
**never rendered as native task-list checkboxes**: each option is rendered as its own
markdown row with a prefix per the profile's `optionLabels` setting — letters a)–i)
(the CBT convention, and the default) or numbers 1)–9) — and custom
`decks-exam-option` styling — selected,
correct, wrong, and missed-correct states (chosen-correct green, chosen-wrong red,
missed-correct outlined). In the raw note's reading view the checked option shows as
Obsidian's struck-through item; accepted — the answer is visible in the source for
every other Decks format too (`==cloze==`, table back cell, paragraph body). Not a new
leak.

### Keyboard

Own modal, own handler — no conflicts with review bindings by construction.

| Key | Action |
|---|---|
| `1`–`9` and `a`–`i` | select (radio) / toggle (multi-select) the option, positionally — both key sets always work, whichever label style is set |
| `←` / `→` | previous / next question |
| `Enter` / `Space` | end mode: next question; immediate mode: submit (lock + verdict), then next |
| `Esc` | quit (with confirmation) |
| `N` | toggle notes (results review; and on a locked verdict in immediate mode) |

While a type-in input is focused, single-key shortcuts are suppressed; `Enter` commits
the answer and advances. Navigator chips are clickable jumps.

### Type-in (short answer)

Short answer is a **presentation mode over existing cards** — header-paragraph,
table, and cloze cards need no new syntax and no new card type. It exists only inside
exam sessions in v1; ordinary FSRS review of these cards is unchanged.

**Cloze cards present as fill-in-the-blank.** Each cloze sibling is already its own
card, so each blank is its own question. The context renders with **every** cloze
segment blanked — only the target blank is being asked; the others are inert. The
target is never ambiguous: it renders as the answer input itself — the visually
active blank — while inert siblings render as plain placeholders. None of them are
revealed, deliberately: siblings from the same body can be drawn into the same
exam, and a revealed sibling is another question's answer. `clozeShowContext` governs
surrounding context exactly as in review. The grading target is the target segment's
text; the deck's grading mode applies unchanged (cloze answers are naturally short,
so the string ceiling rarely bites). Clozes inside table cells come free — they
already parse as cloze cards.

**Grading is a deck-level mode** (`typedGrading` on the profile). The profile is where
parse-and-present configuration lives, and a deck is a coherent body of content —
"this is a short-recall deck" vs "this is a written-answer deck" is a property of the
deck, not of individual cards. Three modes:

- **`exact`** — normalized equality.
- **`tolerant`** (default) — normalized comparison with typo tolerance. Ratio
  thresholds are harshest exactly where short answers live ("Argon" is five
  characters; one typo is 80% similarity), so tolerance is floored: answers shorter
  than 4 characters require an exact match; from 4 characters up, correct iff the
  edit distance is ≤ 1 **or** similarity exceeds 85% — via the existing
  `levenshteinSimilarityAbove` utility in decks-core. (The synchronizer's historical
  80% was a rename-detection threshold; answer grading is deliberately stricter.)
  Coordination note: the identity spec retires the Levenshtein *rename-detection
  subsystem* — the *utility* in `utils/string.ts` must survive that cleanup, and
  `levenshteinSimilarityAbove` still needs adding to the package export barrel.
- **`self`** — the judged slot: the taker types an answer, the authoritative answer
  is revealed, and the taker marks themselves correct or incorrect. UI label:
  "Self-graded". Verdicts in this mode are subjective by design and are marked `self`
  in `grading_method`, so they stay distinguishable from string-graded verdicts
  forever. This slot is also where a future automatic grader would sit (Phase 2 —
  deliberately not part of this implementation): shipping self-grade first means
  written answers accumulate in `exam_answers` from day one, so any future grader
  calibrates against real data instead of starting cold.

**Normalization** (always, both sides, in both string modes): trim, collapse internal
whitespace, casefold, Unicode-decompose and strip combining marks
(diacritics-insensitive).

**Reveal**: verdict (or the self-grade prompt, in the judged mode), "your answer" /
"correct answer," and the full card body rendered below as the authoritative answer.
No diff highlighting in v1. String-mode verdicts cannot be overridden — for `exact`
and `tolerant`, objective and immutable means exactly that; a user who wants judgment
in the loop switches the deck to the judged mode rather than second-guessing the
string grader.

### Multiple-choice inside an ordinary FSRS review

The dual-use consequence: a `multiple-choice` card can appear in a normal review
session. Presentation: options shown interactively (shuffled per the profile) →
select with `1`–`9` (number keys only here — letter keys would clash with the review
modal's B/S/R meta bindings) → submit with `Space`/`Enter` → objective reveal with the same
correct/wrong/missed styling → the **normal self-rating buttons**. Submitting with
nothing selected acts as a plain reveal, preserving the pure self-grade path. The
objective result is **not persisted anywhere** in v1 — review logs record the rating
exactly as for any card. Deriving a suggested rating from correctness is future work,
listed deliberately, not implied.

---

## Identity: the `q:` role

Per the identity spec (v3), multiple-choice needs **one new role tag and no new
placement machinery**: role `q`, token `%%dk:q:<id>%%`.

- **Granularity**: heading + task list = **one** card, not one per option. Options have
  no identity in v1; shuffle is presentation-only, so option order in the file is
  irrelevant. (Per-option distractor analytics would require option indices — Phase 2
  at the earliest.)
- **Placement**: the `h:` placement rule with one deliberate refinement — the token is
  *stamped* as its **own paragraph after the list, separated by a blank line**, and
  *located* by scanning the whole body for the `q:` role. Not on an option's line:
  deleting a single distractor is an ordinary edit and must never orphan the card. Not
  merely on "the next line" either: per CommonMark, a non-blank line directly after a
  list item is a **lazy continuation** of that item's paragraph — a token spliced
  straight after the last option lands *inside* that option (in Live Preview the
  merged paragraph makes select-and-delete of the option take the token with it),
  which is exactly the placement just rejected. The blank line makes the token its own
  block; CommonMark list looseness requires blank lines *between* items, so this
  should not flip the list's rendering (verified in the prototype step, since
  Obsidian's renderer is the authority). Honest aside: shipped `h:` stamping splices
  with no blank line today, so list-ending `h:` bodies already lazy-continue —
  harmlessly so far, because Decks' own parser is line-based; aligning `h:` is out of
  scope here, noted as a follow-up. Not on the heading, for the same reason `h:`
  isn't: old parsers derive the front before stripping body comments, so a body token
  leaves old-version identities unchanged, while a heading token would churn them.
  Anchors are stripped at the one chokepoint before any processing, so the token (and
  its blank line) is invisible to the classifier — the body still reads as a
  homogeneous task list. Options edited, reordered, or appended after the token never
  orphan the card; only deleting the entire body does (the header-card rule).
- **No token until there is history to protect.** Stamping is lazy (below), so an
  unattempted, unreviewed question carries no token at all — its bootstrap identity is
  the front hash, i.e. the heading. The token exists solely so that rephrasing the
  question after attempts exist does not orphan them.
- **Role separation is the point.** A heading with a plain list is an `h:` card; add
  checkboxes and it becomes a `q:` card. The dormant `h:` token is **inert** for the
  question (never adopted as its anchor) and vice versa — so a type flip cannot hand
  one card's history to a different kind of card, and flips are partially
  self-healing: remove the checkboxes and the dormant `h:` token restores the plain
  card's identity and history. Verbatim extension of the identity spec's role-tag
  principle.
- **Stamping moments**: first review (the existing lazy rule, applies via dual use)
  **or first persisted exam answer** — at exam completion, answered not-yet-anchored
  cards are stamped in one batched pass per file. Same philosophy: protection arrives
  exactly when history starts existing.
- The synchronizer needs no role-specific changes — anchor keys are opaque to it;
  anchor-first matching and the adopt-only binding rule work unchanged.
- **Distributed decks carry over unchanged**: exported/shared exam decks arrive
  pre-anchored (high-entropy `q:` ids minted at export, per the identity spec's
  distributed-decks model), so a recipient's attempt history survives author updates
  exactly as review history does; the publishing tooling's token-preservation
  guarantee extends to `q:` tokens with no new rules.

### Version skew (verified against the current token grammar)

Current clients' anchor recognition is hardwired to roles `[hcto]` in both the token
pattern and the anchor-comment test. A `%%dk:q:…%%` token in a file read by such a
client is therefore **not recognized as an anchor**: it is swept into the card's
*notes* by the body-comment extraction (cosmetic), and it is **not stripped** from the
body — so the plain card's content hash churns, flapping updates between mixed-version
devices sharing a database until all update. Crucially there is **no identity churn**:
card IDs are front-hash-based, and the token never sits on the heading line.

A second skew artifact is the **card type itself**: old clients have no `examEnabled`
(the column doesn't exist until their migration runs) and parse a task-list body as
`header-paragraph`, while new clients parse `multiple-choice`. The bootstrap ID (front
hash) and the `back` (the raw markdown, either way) are identical — so **only the
`type` column flaps** between mixed-version devices sharing a database, and the card
genuinely renders as two different things depending on which device last synced.
Structural rather than cosmetic, but identity- and history-safe (exam answers key on
the immutable ID), and it self-resolves once every device runs the exam-aware release.

**Release ordering:** ship the role-class widening `[hcto]` → `[hctoq]` (token
pattern, anchor-comment pattern, the tests that hardcode the class, plus the `q`
binding-key builder) as an **inert prep change in the next plugin and mobile release
(N)**, before the exam feature exists. The exam release (N+1) enables `q:` stamping.
Because the leak is identity-safe by construction, N+1 does not hard-block on N's
deployment saturation — the prep release just minimizes the cosmetic/churn window.
This mirrors the identity spec's prep-release pattern exactly.

---

## Accepted holes / non-goals (v1)

| Case | Why accepted | Severity |
|---|---|---|
| Closing Obsidian mid-exam loses the attempt | In-memory-until-ended is what makes append-only merge trivially correct; resume needs a local-state design (Phase 2) | Confirm-on-close guards it; exams are short |
| Unanswered questions grade as incorrect | Any other rule makes "Submit exam" ambiguous and scores incomparable | Confirm dialog states the unanswered count before submitting |
| No override of string-graded type-in verdicts | Objective and immutable means exactly that; judgment-in-the-loop is what the judged grading mode is for | Switch the deck's grading mode instead |
| No partial credit for multi-select | All-or-nothing keeps scores comparable and grading trivial | `config_json` snapshot keeps the door open |
| Occlusion/spatial cards excluded from exams | No exam presentation defined for them | Eligibility table is explicit; setup dialog shows skipped counts |
| Mixed-version `q:` token churn window | Old clients can't recognize a role they predate; identity is safe, churn is cosmetic | Bounded by the prep release |
| Mixed-version `type` flapping on task-list bodies | Old clients predate `examEnabled` and parse header-paragraph; same ID, same `back`, only `type` differs | Identity- and history-safe; self-resolves when all devices update |
| Answers stored as text snapshots, not option references | Options have no identity in v1 | Re-evaluate only if per-option analytics land |

---

## What this touches

Shared logic goes in `packages/decks-core` behind the existing interfaces; only
Obsidian-coupled UI and adapters live in the plugin. Server side: nothing — this
feature has no backend surface.

| Subsystem | Files (representative) | Change |
|---|---|---|
| Classifier + parsing | `decks-core/src/services/FlashcardParser.ts`, new `classifyExamBody` module | multiple-choice branch in the header finalizer, gated on `examEnabled`; fallback + flag behavior |
| Card model | `decks-core/src/database/types.ts` (`FlashcardType`), `decks-core/src/database/schemas.ts` | `multiple-choice` type; CHECK widening via detection-gated rebuild in `buildMigrationSQL`; version bump |
| Profile | `types.ts` (`DeckProfile`), `schemas.ts` (column + preset seed), `BaseDatabaseService` profile row/CRUD, `SyncLog.types`/`SyncLog.handlers` (profile op), `ProfilesManagerUI.svelte` | `examEnabled` column + `exam_settings` JSON, mirroring the `clozeEnabled` chain end-to-end (including the preview-worker parse path, which today omits `clozeEnabled` — close that gap for both flags); Exams preset + `<base>/exams` mapping |
| Results store | `schemas.ts` (both DDL paths), `worker-entry.ts` + `MainDatabaseService` merge, `BaseDatabaseService` backup-restore | `exam_sessions` / `exam_answers`, append-only merge hooks |
| Sync op | `decks-core/src/services/SyncLog.types.ts`, `SyncLog.handlers.ts`, plugin `SyncLog.ts` | `exam_session_complete` (known-ops set, idempotent handler, prompt-flush list) |
| Identity | `decks-core/src/utils/anchors.ts` (role union, both patterns, binding-key builder), `AnchorStamper` (plan/apply/mint/rekey), parser role mapping, two tests hardcoding `[hcto]` | role `q`; prep-release subset is the pattern widening + builder + tests |
| Exam UI | new exam Svelte component + modal wrapper + fullscreen tab host (the review modal/tab pattern), new `ExamSetupModal`, `DeckListPanel.svelte` (three ⋮ builders + props; entries and row-click branch conditional on `examEnabled`), `DecksView.ts` wiring | setup → draw → free-navigation question screens + navigator strip → submit → results screen; sampling/shuffle utility in decks-core |
| FSRS review | `FlashcardReviewModal.svelte` | `multiple-choice` presentation branch (interactive → reveal → self-rate) |
| Card health | `decks-core/src/services/CardHealth.ts`, `FlashcardManagerPanel.svelte` | invalid-question reasons + badge |
| Card editor | `FlashcardEditModal.svelte` | no question-specific UI — the raw task-list back edits like any card; verify token preservation covers `q:` |
| i18n | `decks-core/src/i18n/locales/` | new `exam` section in `en.ts` and all 12 other locales (compile-enforced parity); sentence case |

---

## Phasing

| Release | Contents |
|---|---|
| **N (prep, inert)** | `[hcto]` → `[hctoq]` widening in the token patterns, the `q` binding-key builder, the two hardcoded-class tests. Plugin and mobile (via decks-core) simultaneously. |
| **N+1 (the feature)** | Schema (results tables, CHECK widening, profile columns), the Exams preset + seeded `<base>/exams` mapping, `examEnabled`/`exam_settings` plumbing end-to-end, the classifier + multiple-choice parsing with fallback/flags, card-health badge, results store + merge + backup + sync op, setup dialog + exam surface (modal + tab hosts; multiple-choice + type-in incl. cloze blanks; free navigation + navigator strip; timer; both feedback modes; results screen), exam entry points on exam-enabled selections (row click + ⋮ Start exam / Start review), the multiple-choice branch in FSRS review, `q:` stamping, i18n. |
| **Phase 2 (explicitly out)** | Partial credit (config change, no migration); score-over-time chart; deck-row exam surfacing (question count / last score); weakest-first selection (needs per-card accuracy aggregation); resumable in-progress exams; option identity / distractor analytics; retake-incorrect-only; AI grading (automatic verdicts in the judged typed-grading slot); ordering/matching; rating suggestions from correctness in FSRS review. |

---

## To prototype before building

1. **Blank line + token paragraph after a task list in Live Preview.** Stamping
   inserts a blank line and then the `%%dk:q:…%%` comment as its own paragraph. Verify
   in Obsidian (renderer is the authority, CommonMark only the prediction): the list
   stays tightly rendered (looseness requires blank lines *between* items — confirm
   Obsidian agrees), the comment stays invisible outside the cursor line, and the
   token paragraph interacts sanely with a trailing `---` notes divider.
2. **Checkbox-free option rendering.** Render each option row through the markdown
   pipeline (math, images, formatting intact) while suppressing the native task-list
   checkbox — confirm per-option rendering doesn't fight Obsidian's post-processors.
3. **Timer-expiry auto-finish.** The countdown reaching zero mid-question must grade
   cleanly (current question unanswered → incorrect) and land on the results screen
   without racing the user's in-flight input.
