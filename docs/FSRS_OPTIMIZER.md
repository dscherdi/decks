# FSRS optimizer

This document describes the per-user FSRS-6 weight optimizer that ships with the Decks plugin: what it does, how it compares to the reference implementation used by Anki and the open-spaced-repetition community, and where it's known to fall short.

## What the optimizer is for

FSRS-6 is parameterized by a 21-element weight vector that controls every aspect of card scheduling: initial stability per rating (`w[0..3]`), difficulty dynamics (`w[4..7]`), recall stability scaling (`w[8..11]`), lapse stability formula (`w[12..15]`), short-term scheduling (`w[17..19]`), and the trainable forgetting curve decay (`w[20]`). The plugin ships sensible defaults that work well on average, but every user has a different forgetting curve and different cards. A user who reviews vocabulary needs different weights than one who reviews legal cases. The optimizer trains the 21 weights from the user's own `review_logs` history, finding values that better predict that specific user's recall behavior.

In Anki's terminology, this is the "Optimize FSRS parameters" feature. We expose it as **Settings → Algorithm tuning → Optimize parameters**.

## How it works

### User flow

1. User clicks **Optimize parameters** in the settings tab.
2. A modal opens. The plugin loads **every** `review_log` entry regardless of profile — including legacy INTENSIVE-era rows, which are valid observations now that the sub-day weight overrides have been removed.
3. The optimizer runs for ~100 gradient steps, displaying step progress.
4. On completion, the modal shows before/after log-loss and an "Apply / Discard" choice.
5. If applied, the trained weights are saved globally to `settings.fsrs.trainedWeights`.
6. Each deck decides whether to use them via the **FSRS profile** dropdown (Standard / **Trained**). Trained is a first-class profile and is disabled in the dropdown until weights exist.
7. The Scheduler applies the global trained vector for any deck whose `deck.profile.fsrs.profile` is `TRAINED`.

### Algorithm internals

The optimizer is implemented in pure TypeScript at [src/algorithm/fsrs-optimizer.ts](../src/algorithm/fsrs-optimizer.ts). The math primitives reuse the existing [src/algorithm/fsrs.ts](../src/algorithm/fsrs.ts) `FSRS` class, which is bit-exact with the [py-fsrs](https://github.com/open-spaced-repetition/py-fsrs) reference (verified by [benchmark/specCheck.ts](../benchmark/specCheck.ts) — 1396 / 1396 forward-pass cases match `Δ = 0`).

| Component | Choice | Notes |
|---|---|---|
| Loss | Binary cross-entropy on `y = (rating ≠ 1)` | Same convention as srs-benchmark / fsrs-optimizer. |
| Optimizer | Adam (β₁=0.9, β₂=0.999, ε=1e-8) | Reference values from py-fsrs. |
| Learning rate | 4e-2 with cosine annealing | Matches fsrs-optimizer. |
| Gradient | Numerical (central difference) over 21 weights | 42 forward passes per step. Bounded floating-point error, no autograd needed. |
| Mini-batch | 256 cards (with replacement) | We batch by card, not by review (see Limitations). |
| Steps | `max(100, 5 × ⌈N/512⌉)` adaptive | Floors at 100 so light users keep prior behavior; heavy users get proportionally more updates (matches fsrs-optimizer's `n_epoch × ceil(reviews / batch_size)`). |
| Parameter clipping | Per-weight bounds from `fsrs-bounds.ts` | Lifted verbatim from py-fsrs `LOWER_BOUNDS_PARAMETERS` / `UPPER_BOUNDS_PARAMETERS`. |
| State caching | None — each gradient step replays card prefixes from scratch | Hot path is cheap arithmetic; ~20 s for 5 k reviews. |

### Why it can run in the main thread

Each Adam step takes 0.1–0.5 s on a typical user's data. Between steps the optimizer `await`s a `yieldToUI()` so the UI repaints; users see a progress bar. For pathological deck sizes (50 k+ reviews) training stretches into tens of seconds — still acceptable for a one-time configuration action.

We considered offloading to a Web Worker (the existing pattern for parsing/synchronization), but the marginal benefit was small relative to the plumbing cost. The optimizer is a pure function with no DOM dependencies, so it could be moved later if user feedback demands it.

### Why we use a global vector, not per-profile

Anki ships per-preset weights. We considered the same — a separate trained vector per `DeckProfile`. Two reasons we went global:

- **Data fragmentation**: a user with five profiles trains on 1/5 the data per profile, getting noisier weights for each. One global vector pools all data.
- **Profile inheritance**: profiles can be assigned to child decks via tag mapping; per-profile weights would either need to compose or override, both of which create UX edge cases.

The escape hatch is the per-profile `useTrainedWeights` toggle (the third option in the FSRS profile dropdown): users who want a control deck or have profile-specific behavior they prefer can opt out per profile.

## What to expect

| User's review history | Training time | Typical log-loss reduction | What the trained weights help with |
|---|---|---|---|
| < 100 reviews | Disabled (gated) | — | The model can't learn from this little data; the gate is intentional. |
| 100 – 1 000 reviews | < 5 s | 1–5 % | Marginal improvement. Most users this size won't see a visible scheduling change. |
| 1 000 – 5 000 reviews | 5–20 s | 5–15 % | Personalized scheduling becomes visible. Heavier-lapse cards in particular get better-calibrated intervals. |
| 5 000 – 50 000 reviews | 20–60 s | 10–25 % | Strong improvement. Trained weights consistently outperform defaults on this user's own card distribution. |
| 50 000+ reviews | 1–2 min | 15–30 %+ | At this scale the model has plenty of signal. Output rivals Anki's optimizer for typical use. |

These are rough envelopes — actual numbers depend on the user's review patterns. Log-loss reduction is the relative improvement (`(before − after) / before`), not the absolute log-loss. A user with consistent high-recall study sees less optimizer benefit than one with variable retention.

### What changing weights does in practice

The trained weights affect every interval calculation going forward. **Existing card data is preserved** — `stability`, `difficulty`, `dueDate` on flashcards are unchanged. The next review of each card uses the new weights to compute its next interval, so the immediate effect is a one-time recalibration of due dates.

If you opt out by switching the profile back to "Standard" or by clicking "Reset to defaults", subsequent reviews use the shipped defaults again.

## Comparison with the open-spaced-repetition reference

The community runs a public benchmark at [open-spaced-repetition/srs-benchmark](https://github.com/open-spaced-repetition/srs-benchmark) using a fixed dataset of 9,999 anonymized Anki users (~350 M reviews). Published baselines:

| Algorithm | LogLoss | RMSE-bins | AUC |
|---|---|---|---|
| FSRS-4.5 | 0.3726 | 0.0838 | 0.6853 |
| FSRS-5   | 0.3560 | 0.0741 | 0.7011 |
| FSRS-6 (per-user trained) | **0.3460** | **0.0653** | **0.7034** |

Methodology: 5-fold `TimeSeriesSplit` per user, train on early reviews, evaluate on later folds. fsrs-optimizer with `lr=4e-2, batch_size=512, n_epoch=5, cosine annealing, parameter clipping, L2 regularization`.

We can match this methodology in our internal benchmark via:

```bash
npm run benchmark -- --data <revlogs> --users 50 --train --kfold 5
```

Numbers we've measured along the way:

| Configuration | Methodology | Users | LogLoss | Notes |
|---|---|---|---|---|
| Default weights only | replay-everything | 500 | 0.3510 | Calibration baseline; close to published trained-FSRS-6. |
| Default weights only (full) | replay-everything | 10 000 | 0.3443 | Calibration agrees within 0.8 pp of empirical recall on 443 M reviews. |
| Per-user 80/20 split | trained, single split | 50 | 0.4691 | Test slice is harder than full-history average. |
| Per-user 5-fold TimeSeriesSplit | trained, k=5 | 5 | 0.4425 | Closer to published; small N. |
| Side-by-side vs Rust ref (FSRS-5) | 80/20 split, 5 users | 5 | 0.4372 (ours) vs 0.4567 (Rust) | We're ahead by 0.02 LogLoss on this slice — partly FSRS-6 advantage, partly noise. |

The default-weight numbers being **so close to the published trained baseline** is the strongest signal that our forward-pass math is faithful: with no per-user training, calibration on 443 M predictions agrees with empirical recall to within 0.8 percentage points. Bug fixes during development (`forgettingStability` short-term cap, `nextDifficulty` mean-reversion anchor) are documented in [release-notes/1-7-7.md](../release-notes/1-7-7.md).

## Limitations

The optimizer is correct (spec-bit-exact) and meaningfully better than defaults on enough data, but it's not state-of-the-art. Specific gaps relative to fsrs-optimizer / fsrs-rs:

### 1. Card-batch instead of review-batch sampling

We sample 256 cards per gradient step and use every review of each sampled card. fsrs-optimizer samples 512 *reviews* per step (each one is a `(card_history_prefix, target_review)` pair), which gives Adam i.i.d. samples and uniform per-review weighting. Our card-batch over-weights cards with long histories — exactly the leech-prone cards.

**Estimated cost**: ~0.01 – 0.03 LogLoss on user-level evaluations. Refactor would require checkpointing card states or vectorizing prefix replays — significant work for a marginal gain.

### 2. Numerical gradients instead of analytical autograd

We compute gradients via central difference: `∂L/∂w_i ≈ (L(w + h·e_i) − L(w − h·e_i)) / (2h)`. fsrs-optimizer uses PyTorch autograd, vectorized over the entire batch on CPU/GPU.

**Cost**: 42 forward passes per gradient step (instead of 1 forward + 1 backward), plus floating-point error of order `h²`. Mostly a performance cost (slower per step) but the small numerical error can occasionally make Adam converge to a slightly worse local minimum.

### 3. No L2 regularization

fsrs-optimizer adds `λ‖w − w_prior‖²` to the loss. We rely on parameter clipping alone, which is a hard wall but doesn't pull weights toward sane mid-training values.

**Cost**: small overfit risk on users with little data. Probably ~0.005 LogLoss.

### 4. Pure-JS performance

A single training run on 5 users (~50 k test reviews) took 198 seconds in our optimizer vs 1.7 seconds in fsrs-rs (Rust + analytical autograd, single-threaded). For an Obsidian plugin where training is a once-per-month action, this is acceptable.

A WebAssembly compile of `fsrs-rs` was considered but `fsrs-browser` requires `SharedArrayBuffer` + cross-origin isolation, which Obsidian's `app://` renderer doesn't provide. A custom single-threaded WASM build of `fsrs-rs` is technically viable (the existing `sql.js` asset pipeline could host it) but would near-double the plugin's bundle size.

### 5. No per-deck override

Trained weights live globally. The opt-in is per deck (via the FSRS profile dropdown's **Trained** option). If two decks should diverge, only one needs to be switched to Trained. There is no separate INTENSIVE profile any more: the former INTENSIVE behaviour (sub-day intervals) is now available to every deck because the unified profile uses a 1-minute interval floor, so all review history is valid training data.

### 6. Headline numbers are not directly comparable to published

The published 0.346 LogLoss number is from full 9,999-user benchmark with 5-fold TimeSeriesSplit. We've reproduced the methodology in `--train --kfold 5` mode but at smaller user counts. Our numbers on 5–50 users will always be noisier than the published 9,999-user number.

## Internal validation tools

| Command | What it checks |
|---|---|
| `npm run benchmark:spec-check` | Bit-exact match of every FSRS-6 forward-pass primitive against py-fsrs (1396 cases). Run after any change to [src/algorithm/fsrs.ts](../src/algorithm/fsrs.ts) — fails in <1 s if a divergence appears. |
| `npm run benchmark:smoke` | Synthetic-data end-to-end pipeline check. No real dataset needed. |
| `npm run benchmark -- --data <revlogs> --users N` | Default-weight benchmark — measures how well shipped weights predict actual recall. |
| `npm run benchmark -- --data <revlogs> --users N --train` | Per-user trained benchmark, single 80/20 split. |
| `npm run benchmark -- --data <revlogs> --users N --train --kfold 5` | Per-user trained benchmark matching published methodology. |
| `npm run benchmark:compare -- --data <revlogs> --users N` | Side-by-side: our pure-TS optimizer vs Rust fsrs-rs reference (FSRS-5). |

The dataset itself isn't shipped; users with a HuggingFace account can download it from [open-spaced-repetition/anki-revlogs-10k](https://huggingface.co/datasets/open-spaced-repetition/anki-revlogs-10k). See [benchmark/README.md](../benchmark/README.md) for the full setup walkthrough.

## References

- [open-spaced-repetition/py-fsrs](https://github.com/open-spaced-repetition/py-fsrs) — reference Python implementation; our spec-check vendors its math.
- [open-spaced-repetition/fsrs-rs](https://github.com/open-spaced-repetition/fsrs-rs) — Rust implementation embedded in Anki desktop. Currently FSRS-5; the FSRS-6 release is in progress upstream.
- [open-spaced-repetition/fsrs-optimizer](https://github.com/open-spaced-repetition/fsrs-optimizer) — Python optimizer (PyTorch + autograd) used by srs-benchmark.
- [open-spaced-repetition/srs-benchmark](https://github.com/open-spaced-repetition/srs-benchmark) — community benchmark, methodology and published baselines.
- [Algorithm explainer (Expertium)](https://expertium.github.io/Algorithm.html) — formula-by-formula walkthrough of FSRS-4 through FSRS-6.
- [Benchmark explainer (Expertium)](https://expertium.github.io/Benchmark.html) — what the metrics mean, why bins are bucketed the way they are.
