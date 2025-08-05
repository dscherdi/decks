import { App, PluginSettingTab, Setting } from "obsidian";
import FlashcardsPlugin from "../main";
import { FlashcardsSettings } from "../settings";

export class FlashcardsSettingTab extends PluginSettingTab {
  plugin: FlashcardsPlugin;

  constructor(app: App, plugin: FlashcardsPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    containerEl.createEl("h2", { text: "Flashcards Plugin Settings" });

    // FSRS Algorithm Settings
    this.addFSRSSettings(containerEl);

    // Database Settings
    this.addDatabaseSettings(containerEl);

    // Review Session Settings
    this.addReviewSettings(containerEl);

    // UI Settings
    this.addUISettings(containerEl);

    // Debug Settings
    this.addDebugSettings(containerEl);
  }

  private addFSRSSettings(containerEl: HTMLElement): void {
    containerEl.createEl("h3", { text: "FSRS Algorithm" });
    containerEl.createEl("p", {
      text: "Configure the Free Spaced Repetition Scheduler algorithm parameters.",
      cls: "setting-item-description",
    });

    new Setting(containerEl)
      .setName("Target Retention")
      .setDesc("Desired retention rate for flashcards (0.8 = 80%)")
      .addSlider((slider) =>
        slider
          .setLimits(0.7, 0.98, 0.01)
          .setValue(this.plugin.settings.fsrs.requestRetention)
          .setDynamicTooltip()
          .onChange(async (value) => {
            this.plugin.settings.fsrs.requestRetention = value;
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName("Maximum Interval")
      .setDesc("Maximum number of days between reviews")
      .addText((text) =>
        text
          .setPlaceholder("36500")
          .setValue(this.plugin.settings.fsrs.maximumInterval.toString())
          .onChange(async (value) => {
            const num = parseInt(value);
            if (!isNaN(num) && num > 0) {
              this.plugin.settings.fsrs.maximumInterval = num;
              await this.plugin.saveSettings();
            }
          }),
      );

    new Setting(containerEl)
      .setName("Easy Bonus")
      .setDesc("Multiplier for easy cards (higher = longer intervals)")
      .addSlider((slider) =>
        slider
          .setLimits(1.1, 2.0, 0.1)
          .setValue(this.plugin.settings.fsrs.easyBonus)
          .setDynamicTooltip()
          .onChange(async (value) => {
            this.plugin.settings.fsrs.easyBonus = value;
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName("Hard Interval")
      .setDesc("Multiplier for hard cards in learning phase")
      .addSlider((slider) =>
        slider
          .setLimits(1.0, 2.0, 0.1)
          .setValue(this.plugin.settings.fsrs.hardInterval)
          .setDynamicTooltip()
          .onChange(async (value) => {
            this.plugin.settings.fsrs.hardInterval = value;
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName("Reset to Defaults")
      .setDesc("Reset FSRS parameters to default values")
      .addButton((button) =>
        button
          .setButtonText("Reset")
          .setWarning()
          .onClick(async () => {
            const defaultSettings = (await import("../settings"))
              .DEFAULT_SETTINGS;
            this.plugin.settings.fsrs = { ...defaultSettings.fsrs };
            await this.plugin.saveSettings();
            this.display(); // Refresh the settings tab
          }),
      );
  }

  private addDatabaseSettings(containerEl: HTMLElement): void {
    containerEl.createEl("h3", { text: "Database" });

    new Setting(containerEl)
      .setName("Database Path")
      .setDesc("Custom path for the database file (leave empty for default)")
      .addText((text) =>
        text
          .setPlaceholder(
            ".obsidian/plugins/obsidian-flashcards-plugin/flashcards.db",
          )
          .setValue(this.plugin.settings.database.customPath || "")
          .onChange(async (value) => {
            this.plugin.settings.database.customPath =
              value.trim() || undefined;
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName("Auto Backup")
      .setDesc("Automatically backup the database")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.database.autoBackup)
          .onChange(async (value) => {
            this.plugin.settings.database.autoBackup = value;
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName("Backup Interval")
      .setDesc("Number of days between automatic backups")
      .addText((text) =>
        text
          .setPlaceholder("7")
          .setValue(this.plugin.settings.database.backupInterval.toString())
          .onChange(async (value) => {
            const num = parseInt(value);
            if (!isNaN(num) && num > 0) {
              this.plugin.settings.database.backupInterval = num;
              await this.plugin.saveSettings();
            }
          }),
      );
  }

  private addReviewSettings(containerEl: HTMLElement): void {
    containerEl.createEl("h3", { text: "Review Sessions" });

    new Setting(containerEl)
      .setName("Show Progress")
      .setDesc("Display progress bar during review sessions")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.review.showProgress)
          .onChange(async (value) => {
            this.plugin.settings.review.showProgress = value;
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName("Keyboard Shortcuts")
      .setDesc("Enable keyboard shortcuts in review modal (1-4 for difficulty)")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.review.enableKeyboardShortcuts)
          .onChange(async (value) => {
            this.plugin.settings.review.enableKeyboardShortcuts = value;
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName("Session Limit")
      .setDesc("Limit the number of cards per review session")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.review.enableSessionLimit)
          .onChange(async (value) => {
            this.plugin.settings.review.enableSessionLimit = value;
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName("Session Goal")
      .setDesc("Target number of cards per review session")
      .addText((text) =>
        text
          .setPlaceholder("20")
          .setValue(this.plugin.settings.review.sessionGoal.toString())
          .onChange(async (value) => {
            const num = parseInt(value);
            if (!isNaN(num) && num > 0) {
              this.plugin.settings.review.sessionGoal = num;
              await this.plugin.saveSettings();
            }
          }),
      );
  }

  private addUISettings(containerEl: HTMLElement): void {
    containerEl.createEl("h3", { text: "User Interface" });

    new Setting(containerEl)
      .setName("Background Refresh Interval")
      .setDesc("How often to refresh deck stats in the side panel (in seconds)")
      .addText((text) =>
        text
          .setPlaceholder("5")
          .setValue(
            this.plugin.settings.ui.backgroundRefreshInterval.toString(),
          )
          .onChange(async (value) => {
            const num = parseInt(value);
            if (!isNaN(num) && num >= 1 && num <= 60) {
              this.plugin.settings.ui.backgroundRefreshInterval = num;
              await this.plugin.saveSettings();
              // Restart background refresh with new interval
              if (this.plugin.view) {
                this.plugin.view.restartBackgroundRefresh();
              }
            }
          }),
      );
  }

  private addDebugSettings(containerEl: HTMLElement): void {
    containerEl.createEl("h3", { text: "Debug" });
    containerEl.createEl("p", {
      text: "Debug settings for troubleshooting and development.",
      cls: "setting-item-description",
    });

    new Setting(containerEl)
      .setName("Enable Debug Logging")
      .setDesc(
        "Show detailed logging in the console for sync operations and flashcard processing",
      )
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.debug.enableLogging)
          .onChange(async (value) => {
            this.plugin.settings.debug.enableLogging = value;
            await this.plugin.saveSettings();
          }),
      );
  }
}
