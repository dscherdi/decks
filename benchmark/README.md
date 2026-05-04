# FSRS benchmark harness

Internal validation of [src/algorithm/fsrs.ts](../src/algorithm/fsrs.ts) against real Anki review-history data using the methodology of [open-spaced-repetition/srs-benchmark](https://github.com/open-spaced-repetition/srs-benchmark). This is **not** shipped with the plugin — it exists only to detect FSRS-math regressions when we touch the algorithm.

## What it does

For each user in the dataset, group reviews by card and walk them chronologically. Before each (non-first) review, ask our `FSRS` instance to predict retrievability `p`. Compare to the actual outcome `y = (rating != 1)`. Aggregate across all reviews and report:

- **LogLoss** — `-mean(y log p + (1-y) log(1-p))`
- **RMSE(bins)** — calibration error binned by `(elapsed_days, review_count, lapses)`
- **AUC** — discrimination

Weights are the shipped `STANDARD` defaults — no per-user training. Numbers will be worse than the published per-user-trained FSRS-6 baselines (LogLoss 0.346) — that is expected. The check is whether our default-weight numbers stay in a sane range across runs.

## Getting the data

The dataset is **gated** — you must accept license terms on HuggingFace before downloading.

1. Visit https://huggingface.co/datasets/open-spaced-repetition/anki-revlogs-10k and accept the license.
2. Authenticate (`huggingface-cli login` or set `HF_TOKEN` env var).
3. Download the `revlogs/` subtree. The dataset is Hive-partitioned per user (`user_id=N/`), so you can grab a small slice instead of the full 15.7 GB.

Tiny slice (50 users, single-digit MB):

```bash
mkdir -p benchmark/data
huggingface-cli download open-spaced-repetition/anki-revlogs-10k \
  --repo-type dataset \
  --include "revlogs/user_id=1/**" "revlogs/user_id=2/**" ... "revlogs/user_id=50/**" \
  --local-dir benchmark/data
```

Or download everything (15.7 GB):

```bash
huggingface-cli download open-spaced-repetition/anki-revlogs-10k \
  --repo-type dataset --include "revlogs/**" \
  --local-dir benchmark/data
```

Resulting layout:

```
benchmark/data/revlogs/
  user_id=1/
    <some>.parquet
  user_id=2/
    ...
```

`benchmark/data/` is gitignored.

## Running

```bash
# Synthetic-data smoke test (no dataset needed; validates the pipeline)
npm run benchmark:smoke

# Tiny slice (real data)
npm run benchmark -- --data benchmark/data/revlogs --users 50

# Full dataset
npm run benchmark -- --data benchmark/data/revlogs --users all

# Include same-day reviews (exercises the FSRS-6 short-term scheduling formula)
npm run benchmark -- --data benchmark/data/revlogs --users 50 --include-same-day
```

Output is written to `benchmark/results/<timestamp>.json` (also gitignored except `.gitkeep`).

## Interpreting results

Sanity envelope for default-weight FSRS-6:

| Metric    | Bad        | OK           | Suspicious |
|-----------|------------|--------------|------------|
| LogLoss   | > 0.50     | 0.38–0.45    | < 0.30     |
| AUC       | < 0.60     | 0.65–0.72    | > 0.80     |
| RMSE-bins | > 0.20     | 0.05–0.15    | < 0.03     |

A "Suspicious" result usually means the math accidentally got information about the future (peeking at the rating before predicting). Investigate the replay loop.

A "Bad" result means our impl diverges from FSRS-6 math. Compare against [py-fsrs](https://github.com/open-spaced-repetition/py-fsrs) running on the same slice with default weights to localize the bug.

## Files

- [cli.ts](cli.ts) — argument parsing, entrypoint
- [loadDataset.ts](loadDataset.ts) — discovers user partitions, reads revlogs via hyparquet
- [replayEngine.ts](replayEngine.ts) — per-card chronological replay through `FSRS`
- [metrics.ts](metrics.ts) — LogLoss, RMSE-bins, AUC
- [runBenchmark.ts](runBenchmark.ts) — orchestrates load → replay → metrics → results.json
- [smoke.ts](smoke.ts) — synthetic-data smoke test for the replay+metrics pipeline (no dataset needed)
- [build.mjs](build.mjs) — esbuild bundle step (produces `.bundle/cli.cjs` and `.bundle/smoke.cjs`)

## Methodology references

- y label definition: [features/base.py L217](https://github.com/open-spaced-repetition/srs-benchmark/blob/main/features/base.py) — `y = (rating != 1) ? 1 : 0`
- RMSE-bins formula: [utils.py rmse_matrix](https://github.com/open-spaced-repetition/srs-benchmark/blob/main/utils.py)
- Dataset schema: https://huggingface.co/datasets/open-spaced-repetition/anki-revlogs-10k
