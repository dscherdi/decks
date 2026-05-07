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

    // Step count scales with data size (matches fsrs-optimizer's
    // n_epoch=5, batch_size=512), but floored at 100 so lightweight users
    // keep their current behavior. Heavy users get proportionally more
    // gradient updates — measurably better convergence on 5k+ reviews.
    const steps = Math.max(100, 5 * Math.ceil(logs.length / 512));

    return optimizeWeights(logs, {
      yieldFn: yieldToUI,
      steps,
      ...options,
      onProgress,
    });
  }
}
