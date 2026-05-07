import type { IDatabaseService } from "../database/DatabaseFactory";
import type { Logger } from "../utils/logging";
import { yieldToUI } from "../utils/ui";
import {
  optimizeWeights,
  type TrainingOptions,
  type TrainingProgress,
  type TrainingResult,
} from "../algorithm/fsrs-optimizer";

/**
 * Orchestrates a global FSRS weight optimization run:
 * - loads review_logs filtered to STANDARD-profile decks via the database service
 * - delegates training to the pure-function optimizer
 * - returns the result for the caller to display + apply
 *
 * This service is read-only with respect to settings — applying trained
 * weights is the caller's responsibility (UI shows before/after, user clicks
 * Apply, caller writes to settings.fsrs.trainedWeights).
 */
export class FsrsOptimizationService {
  constructor(
    private readonly db: IDatabaseService,
    private readonly logger?: Logger
  ) {}

  async run(
    onProgress?: (p: TrainingProgress) => void,
    options?: Partial<TrainingOptions>
  ): Promise<TrainingResult> {
    this.logger?.debug?.("FsrsOptimizationService.run: loading review logs");
    const logs = await this.db.getReviewLogsForStandardProfile();
    this.logger?.debug?.(
      `FsrsOptimizationService.run: ${logs.length} review logs loaded`
    );

    return optimizeWeights(logs, {
      yieldFn: yieldToUI,
      ...options,
      onProgress,
    });
  }
}
