import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { FSRS } from "../src/algorithm/fsrs";
import { discoverUsers, loadUser } from "./loadDataset";
import { replayUser } from "./replayEngine";
import { StreamingMetrics, type BenchmarkMetrics } from "./metrics";

export interface RunOptions {
  dataPath: string;
  users: number | "all";
  includeSameDay: boolean;
  outPath: string;
}

export interface RunResult {
  options: { users: number | "all"; includeSameDay: boolean; dataPath: string };
  metrics: BenchmarkMetrics;
  usersProcessed: number;
  durationMs: number;
  weightsProfile: "STANDARD";
  fsrsParameters: { requestRetention: number };
}

export async function runBenchmark(opts: RunOptions): Promise<RunResult> {
  const start = Date.now();
  const allUserIds = discoverUsers(opts.dataPath);
  if (allUserIds.length === 0) {
    throw new Error(
      `No user_id=* partitions under ${opts.dataPath}. See benchmark/README.md.`
    );
  }
  const userIds =
    opts.users === "all" ? allUserIds : allUserIds.slice(0, opts.users);

  const fsrs = new FSRS({ profile: "STANDARD", requestRetention: 0.9 });
  const metricsStream = new StreamingMetrics();

  let processed = 0;
  for (const userId of userIds) {
    try {
      const user = await loadUser(opts.dataPath, userId);
      if (user.reviews.length < 6) continue;
      const preds = replayUser(user, fsrs, {
        includeSameDay: opts.includeSameDay,
      });
      metricsStream.addMany(preds);
      processed += 1;
      if (processed % 25 === 0) {
        const heapMb = Math.round(process.memoryUsage().heapUsed / 1024 / 1024);
        process.stderr.write(
          `  processed ${processed}/${userIds.length} users (heap: ${heapMb} MB)\n`
        );
      }
    } catch (err) {
      const e = err instanceof Error ? err : new Error(String(err));
      const causeMsg =
        e.cause instanceof Error ? ` <- ${e.cause.message}` : "";
      process.stderr.write(`  user_id=${userId}: skipped (${e.message}${causeMsg})\n`);
    }
  }

  const metrics = metricsStream.finalize();
  const result: RunResult = {
    options: {
      users: opts.users,
      includeSameDay: opts.includeSameDay,
      dataPath: opts.dataPath,
    },
    metrics,
    usersProcessed: processed,
    durationMs: Date.now() - start,
    weightsProfile: "STANDARD",
    fsrsParameters: { requestRetention: 0.9 },
  };

  mkdirSync(dirname(opts.outPath), { recursive: true });
  writeFileSync(opts.outPath, JSON.stringify(result, null, 2));
  return result;
}
