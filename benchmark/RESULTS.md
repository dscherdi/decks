# Benchmark results

Headline numbers from running [the harness](README.md) against the [open-spaced-repetition/anki-revlogs-10k](https://huggingface.co/datasets/open-spaced-repetition/anki-revlogs-10k) dataset. Methodology: replay each user's review history through our `FSRS` class with shipped STANDARD default weights, no per-user training, same-day reviews filtered.

This file is documentation only — re-run the harness yourself for fresh numbers; the JSON outputs are gitignored.

## Spec conformance

`npm run benchmark:spec-check` validates each FSRS-6 primitive against the [py-fsrs](https://github.com/open-spaced-repetition/py-fsrs) reference math on a grid of inputs.

| Status | Date | Notes |
|--------|------|-------|
| ✅ 1396/1396 cases bit-exact (Δ = 0) | 2026-05-04 | After fixes to `forgettingStability` (added FSRS-6 short-term cap) and `nextDifficulty` (use unclamped D₀(Easy) as mean-reversion anchor) |

If a future change to [src/algorithm/fsrs.ts](../src/algorithm/fsrs.ts) breaks any primitive, spec-check fails in <1 second. This is the primary regression-detection mechanism — stronger than aggregate metrics, which can hide formula-level bugs.

## Aggregate metrics

| Run | Date | Users | Predictions | LogLoss | RMSE-bins | AUC | Mean p | Mean y |
|-----|------|-------|-------------|---------|-----------|-----|--------|--------|
| Pre-fix full | 2026-05-04 | 10,000 | 443,279,950 | 0.3443 | 0.0350 | 0.7609 | 0.8542 | 0.8622 |
| Post-fix 500 | 2026-05-04 | 500 | 20,408,022 | 0.3510 | 0.0339 | 0.7588 | 0.8528 | 0.8589 |

Reference: per-user-trained FSRS-6 from the [srs-benchmark](https://github.com/open-spaced-repetition/srs-benchmark) README reports LogLoss 0.346 / RMSE-bins 0.065 / AUC 0.703. Our default-weight numbers are competitive on a different methodology (no train/test split, all reviews evaluated). Calibration agrees with empirical recall to within 1 percentage point on 443M predictions.

## Bug fixes 2026-05-04

The cross-check turned up two real divergences from the FSRS-6 spec, both fixed:

1. **`forgettingStability`** missed the FSRS-6 short-term cap. Now: `min(long_term_formula, S / e^(w[17]·w[18]))` — bounds post-lapse stability at ~0.952·S so a lapse can never increase stability. Worst-case per-call delta from spec was 0.468 (95% relative).
2. **`nextDifficulty`** used clamped `D₀(Easy) = 1` as the mean-reversion anchor. Spec uses unclamped `D₀(Easy) ≈ -4.807`. Per-call delta ~5.77e-3.

Aggregate-metric impact was small (sub-0.001 on LogLoss/AUC at 500-user slice) because both bugs only matter at edge inputs. The fix is about correctness, not headline numbers.

## Re-running

```bash
DS=~/.cache/huggingface/hub/datasets--open-spaced-repetition--anki-revlogs-10k/snapshots/<hash>/revlogs

# Spec-check (always run before/after FSRS edits)
npm run benchmark:spec-check

# Tiny smoke (no dataset)
npm run benchmark:smoke

# 500 users (~3 min)
npm run benchmark -- --data "$DS" --users 500

# Full 10k (~70 min, ~328 MB peak heap)
npm run benchmark -- --data "$DS" --users all
```
