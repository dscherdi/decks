import { App, Modal, Notice, Setting } from "obsidian";
import type { IDatabaseService } from "../../database/DatabaseFactory";
import type { DecksSettings } from "../../settings";
import { FsrsOptimizationService } from "../../services/FsrsOptimizationService";
import type { TrainingResult } from "../../algorithm/fsrs-optimizer";
import type { Logger } from "../../utils/logging";

/**
 * Train-then-confirm FSRS weight optimization modal.
 * 1) Loads review history for STANDARD-profile decks
 * 2) Runs Adam over BCE for ~100 steps
 * 3) Shows before/after LogLoss + review count, Apply / Discard buttons
 */
export class OptimizeFsrsModal extends Modal {
  private settings: DecksSettings;
  private db: IDatabaseService;
  private saveSettings: () => Promise<void>;
  private onApplied?: () => void;
  private logger?: Logger;

  private result: TrainingResult | null = null;
  private aborted = false;

  constructor(
    app: App,
    db: IDatabaseService,
    settings: DecksSettings,
    saveSettings: () => Promise<void>,
    logger?: Logger,
    onApplied?: () => void
  ) {
    super(app);
    this.db = db;
    this.settings = settings;
    this.saveSettings = saveSettings;
    this.logger = logger;
    this.onApplied = onApplied;
  }

  onOpen(): void {
    this.titleEl.setText("Optimize parameters");
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
    this.renderProgress(0, 0, "Loading review history…");
    const service = new FsrsOptimizationService(this.db, this.logger);

    const result = await service.run((p) => {
      if (this.aborted) return;
      this.renderProgress(p.step, p.totalSteps, `Training step ${p.step} / ${p.totalSteps}`);
    });

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
      text:
        result.reason ??
        "Not enough review history yet to train. Keep reviewing and try again later.",
    });
    c.createEl("p", {
      cls: "decks-fsrs-muted",
      text: `Reviews available on STANDARD-profile decks: ${result.reviewsTrained}.`,
    });
    new Setting(c).addButton((b) =>
      b.setButtonText("Close").onClick(() => this.close())
    );
  }

  private renderResult(result: TrainingResult): void {
    const c = this.contentEl;
    c.empty();

    const before = result.beforeLogLoss;
    const after = result.afterLogLoss;
    const improvedPct = before > 0 ? ((before - after) / before) * 100 : 0;

    c.createEl("p", {
      text: `Trained on ${result.reviewsTrained.toLocaleString()} reviews across ${result.cardsTrained.toLocaleString()} cards in ${(
        result.durationMs / 1000
      ).toFixed(1)} s.`,
    });

    const stats = c.createDiv({ cls: "decks-fsrs-stats" });
    this.renderStat(stats, "Log-loss before", before.toFixed(4));
    this.renderStat(stats, "Log-loss after", after.toFixed(4));
    this.renderStat(stats, "Improvement", `${improvedPct.toFixed(2)} %`);

    if (improvedPct < 0.01) {
      c.createEl("p", {
        cls: "decks-fsrs-muted",
        text:
          "Training did not meaningfully improve log-loss — current weights are already a good fit. You can safely discard.",
      });
    }

    const buttons = new Setting(c);
    buttons.addButton((b) =>
      b.setButtonText("Discard").onClick(() => this.close())
    );
    buttons.addButton((b) =>
      b
        .setButtonText("Apply")
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
    c.createEl("p", { text: "Optimization failed:" });
    c.createEl("pre", { text: message, cls: "decks-fsrs-error" });
    new Setting(c).addButton((b) =>
      b.setButtonText("Close").onClick(() => this.close())
    );
  }

  private async applyResult(result: TrainingResult): Promise<void> {
    this.settings.fsrs.trainedWeights = result.weights;
    this.settings.fsrs.lastTrainedAt = new Date().toISOString();
    this.settings.fsrs.lastTrainedReviewCount = result.reviewsTrained;
    this.settings.fsrs.lastBeforeLogLoss = result.beforeLogLoss;
    this.settings.fsrs.lastAfterLogLoss = result.afterLogLoss;
    await this.saveSettings();
    new Notice("Trained parameters applied.");
    this.onApplied?.();
    this.close();
  }
}
