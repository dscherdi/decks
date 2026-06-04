import { App, Modal, Notice, Setting } from "obsidian";
import type { IDatabaseService } from "../../database/DatabaseFactory";
import { FsrsOptimizationService } from "@decks/core";
import type { TrainingResult } from "@decks/core";
import type { Logger } from "../../utils/logging";
import { I18n } from "@decks/core";

/**
 * Train-then-confirm FSRS weight optimization modal.
 * 1) Loads review history for STANDARD-profile decks
 * 2) Runs Adam over BCE for ~100 steps
 * 3) Shows before/after LogLoss + review count, Apply / Discard buttons
 */
export class OptimizeFsrsModal extends Modal {
  private db: IDatabaseService;
  private onApplied?: () => void;
  private logger?: Logger;

  private result: TrainingResult | null = null;
  private aborted = false;

  constructor(
    app: App,
    db: IDatabaseService,
    logger?: Logger,
    onApplied?: () => void
  ) {
    super(app);
    this.db = db;
    this.logger = logger;
    this.onApplied = onApplied;
  }

  onOpen(): void {
    this.titleEl.setText(I18n.t.modals.optimizeFsrs.title);
    this.runTraining().catch((err) => {
      this.logger?.error?.("FSRS optimization failed", err);
      this.renderError(err instanceof Error ? err.message : String(err));
    });
  }

  onClose(): void {
    this.aborted = true;
    this.contentEl.empty();
  }

  private async runTraining(): Promise<void> {
    this.renderProgress(0, 0, I18n.t.modals.optimizeFsrs.loadingHistory);
    const service = new FsrsOptimizationService(this.db, this.logger);

    // Warm-start from the active trained weight set when present. This makes
    // "before LogLoss" reflect the user's actual current scheduling (not shipped
    // defaults) and avoids re-discovering the same optimum on every retrain.
    const active = await this.db.getActiveTrainedWeightSet();
    const startOptions = active ? { initial: active.weights.slice() } : undefined;

    const result = await service.run((p) => {
      if (this.aborted) return;
      this.renderProgress(
        p.step,
        p.totalSteps,
        I18n.format(I18n.t.modals.optimizeFsrs.trainingStep, {
          step: p.step,
          total: p.totalSteps,
        })
      );
    }, startOptions);

    if (this.aborted) return;
    this.result = result;

    if (!result.ok) {
      this.renderInsufficientData(result);
      return;
    }
    this.renderResult(result);
  }

  private renderProgress(step: number, total: number, label: string): void {
    if (this.aborted) return;
    const c = this.contentEl;
    c.empty();
    c.createEl("p", { text: label });
    if (total > 0) {
      const wrap = c.createDiv({ cls: "decks-fsrs-progress" });
      const bar = wrap.createDiv({ cls: "decks-fsrs-progress-bar" });
      const pct = Math.min(100, Math.round((step / total) * 100));
      bar.setCssProps({ "--decks-fsrs-progress-pct": `${pct}%` });
      bar.addClass("decks-fsrs-progress-bar-fill");
    }
  }

  private renderInsufficientData(result: TrainingResult): void {
    const c = this.contentEl;
    c.empty();
    c.createEl("p", {
      text: result.reason ?? I18n.t.modals.optimizeFsrs.notEnough,
    });
    c.createEl("p", {
      cls: "decks-fsrs-muted",
      text: I18n.format(I18n.t.modals.optimizeFsrs.reviewsAvailable, {
        count: result.reviewsTrained,
      }),
    });
    new Setting(c).addButton((b) =>
      b.setButtonText(I18n.t.modals.optimizeFsrs.close).onClick(() => this.close())
    );
  }

  private renderResult(result: TrainingResult): void {
    const c = this.contentEl;
    c.empty();

    const before = result.beforeLogLoss;
    const after = result.afterLogLoss;
    const improvedPct = before > 0 ? ((before - after) / before) * 100 : 0;

    c.createEl("p", {
      text: I18n.format(I18n.t.modals.optimizeFsrs.trainedSummary, {
        reviews: result.reviewsTrained.toLocaleString(),
        cards: result.cardsTrained.toLocaleString(),
        seconds: (result.durationMs / 1000).toFixed(1),
      }),
    });

    const stats = c.createDiv({ cls: "decks-fsrs-stats" });
    this.renderStat(stats, I18n.t.modals.optimizeFsrs.logLossBefore, before.toFixed(4));
    this.renderStat(stats, I18n.t.modals.optimizeFsrs.logLossAfter, after.toFixed(4));
    this.renderStat(stats, I18n.t.modals.optimizeFsrs.improvement, `${improvedPct.toFixed(2)} %`);

    if (improvedPct < 0.01) {
      c.createEl("p", {
        cls: "decks-fsrs-muted",
        text: I18n.t.modals.optimizeFsrs.noImprovement,
      });
    }

    const buttons = new Setting(c);
    buttons.addButton((b) =>
      b.setButtonText(I18n.t.modals.optimizeFsrs.discard).onClick(() => this.close())
    );
    buttons.addButton((b) =>
      b
        .setButtonText(I18n.t.modals.optimizeFsrs.apply)
        .setCta()
        .onClick(async () => {
          await this.applyResult(result);
        })
    );
  }

  private renderStat(parent: HTMLElement, label: string, value: string): void {
    const row = parent.createDiv({ cls: "decks-fsrs-stat-row" });
    row.createSpan({ cls: "decks-fsrs-stat-label", text: label });
    row.createSpan({ cls: "decks-fsrs-stat-value", text: value });
  }

  private renderError(message: string): void {
    const c = this.contentEl;
    c.empty();
    c.createEl("p", { text: I18n.t.modals.optimizeFsrs.failedHeader });
    c.createEl("pre", { text: message, cls: "decks-fsrs-error" });
    new Setting(c).addButton((b) =>
      b.setButtonText(I18n.t.modals.optimizeFsrs.close).onClick(() => this.close())
    );
  }

  private async applyResult(result: TrainingResult): Promise<void> {
    await this.db.saveTrainedWeightSet({
      weights: result.weights,
      trainedAt: new Date().toISOString(),
      reviewsTrained: result.reviewsTrained,
      cardsTrained: result.cardsTrained,
      beforeLogLoss: result.beforeLogLoss,
      afterLogLoss: result.afterLogLoss,
      steps: result.steps,
      durationMs: result.durationMs,
      weightsVersion: "fsrs-6",
    });
    new Notice(I18n.t.modals.optimizeFsrs.applied);
    this.onApplied?.();
    this.close();
  }
}
