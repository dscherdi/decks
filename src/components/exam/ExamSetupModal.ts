import { App, Modal, Setting } from "obsidian";
import {
  I18n,
  type ExamFeedbackTiming,
  type ExamOptionLabels,
  type ExamSelectionMode,
  type ExamSettings,
  type TypedGradingMode,
} from "@decks/core";

/**
 * Pre-attempt configuration dialog. Pre-filled from the selection's profile
 * (or global defaults); the confirmed values are what get snapshotted into
 * the attempt's config_json.
 */
export class ExamSetupModal extends Modal {
  private values: ExamSettings;

  constructor(
    app: App,
    private deckName: string,
    private eligibleCount: number,
    private skippedCount: number,
    initial: ExamSettings,
    private onStart: (settings: ExamSettings) => void
  ) {
    super(app);
    this.values = { ...initial };
  }

  onOpen() {
    const t = I18n.t.exam;
    const { contentEl } = this;
    contentEl.empty();
    this.setTitle(`${t.setupTitle} — ${this.deckName}`);

    contentEl.createEl("p", {
      text: I18n.format(t.eligibleCount, { count: String(this.eligibleCount) }),
    });
    if (this.skippedCount > 0) {
      const skipped = contentEl.createEl("p", {
        text: I18n.format(t.skippedCount, { count: String(this.skippedCount) }),
      });
      skipped.addClass("decks-exam-setup-skipped");
      contentEl.createEl("p", { text: t.skippedHint, cls: "decks-exam-setup-hint" });
    }

    new Setting(contentEl)
      .setName(t.questionCountSetting)
      .setDesc(t.questionCountAll)
      .addText((text) =>
        text
          .setValue(String(this.values.questionCount))
          .onChange((value) => {
            const parsed = parseInt(value, 10);
            this.values.questionCount = Number.isFinite(parsed)
              ? Math.max(0, Math.min(parsed, this.eligibleCount))
              : 0;
          })
      );

    new Setting(contentEl)
      .setName(t.timeLimitSetting)
      .setDesc(t.timeLimitOff)
      .addText((text) =>
        text.setValue(String(this.values.timeLimitMinutes)).onChange((value) => {
          const parsed = parseInt(value, 10);
          this.values.timeLimitMinutes = Number.isFinite(parsed)
            ? Math.max(0, parsed)
            : 0;
        })
      );

    new Setting(contentEl).setName(t.passScoreSetting).addText((text) =>
      text.setValue(String(this.values.passScorePct)).onChange((value) => {
        const parsed = parseInt(value, 10);
        this.values.passScorePct = Number.isFinite(parsed)
          ? Math.max(0, Math.min(100, parsed))
          : 60;
      })
    );

    new Setting(contentEl).setName(t.shuffleQuestionsSetting).addToggle((toggle) =>
      toggle.setValue(this.values.shuffleQuestions).onChange((value) => {
        this.values.shuffleQuestions = value;
      })
    );

    new Setting(contentEl).setName(t.shuffleOptionsSetting).addToggle((toggle) =>
      toggle.setValue(this.values.shuffleOptions).onChange((value) => {
        this.values.shuffleOptions = value;
      })
    );

    new Setting(contentEl).setName(t.feedbackTimingSetting).addDropdown((dropdown) =>
      dropdown
        .addOption("end", t.feedbackEnd)
        .addOption("immediate", t.feedbackImmediate)
        .setValue(this.values.feedbackTiming)
        .onChange((value) => {
          this.values.feedbackTiming = value as ExamFeedbackTiming;
        })
    );

    new Setting(contentEl).setName(t.selectionModeSetting).addDropdown((dropdown) =>
      dropdown
        .addOption("random", t.selectionRandom)
        .addOption("sequential", t.selectionSequential)
        .setValue(this.values.selectionMode)
        .onChange((value) => {
          this.values.selectionMode = value as ExamSelectionMode;
        })
    );

    new Setting(contentEl).setName(t.typedGradingSetting).addDropdown((dropdown) =>
      dropdown
        .addOption("exact", t.gradingExact)
        .addOption("tolerant", t.gradingTolerant)
        .addOption("self", t.gradingSelf)
        .setValue(this.values.typedGrading)
        .onChange((value) => {
          this.values.typedGrading = value as TypedGradingMode;
        })
    );

    new Setting(contentEl).setName(t.optionLabelsSetting).addDropdown((dropdown) =>
      dropdown
        .addOption("letters", t.optionLabelsLetters)
        .addOption("numbers", t.optionLabelsNumbers)
        .setValue(this.values.optionLabels)
        .onChange((value) => {
          this.values.optionLabels = value as ExamOptionLabels;
        })
    );

    const buttons = contentEl.createDiv({ cls: "decks-modal-button-container" });
    const cancel = buttons.createEl("button", { text: t.cancel });
    cancel.onclick = () => this.close();
    const start = buttons.createEl("button", { text: t.start, cls: "mod-cta" });
    start.onclick = () => {
      this.close();
      this.onStart({ ...this.values });
    };
  }

  onClose() {
    this.contentEl.empty();
  }
}
