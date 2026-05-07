import { resolve } from "node:path";
import { runBenchmark } from "./runBenchmark";

interface ParsedArgs {
  data: string;
  users: number | "all";
  includeSameDay: boolean;
  train: boolean;
  kfold: number;
  out: string;
}

function parseArgs(argv: string[]): ParsedArgs {
  const args: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--include-same-day") {
      args.includeSameDay = true;
    } else if (a === "--train") {
      args.train = true;
    } else if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith("--")) {
        args[key] = next;
        i++;
      } else {
        args[key] = true;
      }
    }
  }

  if (typeof args.data !== "string") {
    process.stderr.write(usage());
    throw new Error("--data <path> is required");
  }

  let users: number | "all" = 50;
  if (typeof args.users === "string") {
    if (args.users === "all") users = "all";
    else {
      const n = parseInt(args.users, 10);
      if (!Number.isFinite(n) || n <= 0) {
        throw new Error(`--users must be a positive integer or "all", got "${args.users}"`);
      }
      users = n;
    }
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const out =
    typeof args.out === "string"
      ? args.out
      : resolve("benchmark", "results", `${stamp}.json`);

  let kfold = 1;
  if (typeof args.kfold === "string") {
    const k = parseInt(args.kfold, 10);
    if (!Number.isFinite(k) || k < 1) {
      throw new Error(`--kfold must be >= 1, got "${args.kfold}"`);
    }
    kfold = k;
  }

  return {
    data: resolve(args.data),
    users,
    includeSameDay: args.includeSameDay === true,
    train: args.train === true,
    kfold,
    out,
  };
}

function usage(): string {
  return `Usage: npm run benchmark -- --data <path> [--users N|all] [--include-same-day] [--train] [--kfold N] [--out <path>]

  --data <path>          Path to revlogs/ root (containing user_id=N/ subdirs)
  --users N|all          Number of users to evaluate (default 50)
  --include-same-day     Include reviews with elapsed_days=0 in metrics
  --train                Per-user training. Default: 80/20 chronological split.
                         Combined with --kfold N, uses TimeSeriesSplit (matches
                         the published srs-benchmark methodology).
  --kfold N              Number of TimeSeriesSplit folds (default 1 = simple 80/20).
                         Use 5 to match published FSRS-6 baseline methodology.
                         Only meaningful with --train.
  --out <path>           Output JSON path (default benchmark/results/<timestamp>.json)
`;
}

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2));
  let mode = "FSRS-6 (STANDARD default weights)";
  if (opts.train) {
    mode = opts.kfold >= 2
      ? `FSRS-6 (per-user trained weights, ${opts.kfold}-fold TimeSeriesSplit)`
      : "FSRS-6 (per-user trained weights, 80/20 split)";
  }
  process.stderr.write(
    `Benchmarking ${mode} on ${opts.users} users from ${opts.data}\n`
  );
  const result = await runBenchmark({
    dataPath: opts.data,
    users: opts.users,
    includeSameDay: opts.includeSameDay,
    train: opts.train,
    trainOptions: opts.kfold >= 2 ? { kfold: opts.kfold } : undefined,
    outPath: opts.out,
  });

  const m = result.metrics;
  process.stdout.write(
    [
      "",
      `users processed:  ${result.usersProcessed}`,
      `predictions:      ${m.count}`,
      `mean predicted R: ${m.meanPredicted.toFixed(4)}`,
      `mean actual recall: ${m.meanActual.toFixed(4)}`,
      `LogLoss:          ${m.logLoss.toFixed(4)}`,
      `RMSE(bins):       ${m.rmseBins.toFixed(4)}`,
      `AUC:              ${m.auc.toFixed(4)}`,
      `runtime:          ${(result.durationMs / 1000).toFixed(1)}s`,
      `output:           ${opts.out}`,
      "",
    ].join("\n")
  );
}

main().catch((err) => {
  process.stderr.write(`${err instanceof Error ? err.stack ?? err.message : String(err)}\n`);
  process.exit(1);
});
