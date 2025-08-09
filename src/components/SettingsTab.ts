import { App, PluginSettingTab, Setting } from "obsidian";
import DecksPlugin from "../main";
import { FlashcardsSettings } from "../settings";

export class DecksSettingTab extends PluginSettingTab {
  plugin: DecksPlugin;

  constructor(app: App, plugin: DecksPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    containerEl.createEl("h2", { text: "Decks Plugin Settings" });

    // FSRS Algorithm Settings
    this.addFSRSSettings(containerEl);

    // Review Session Settings
    this.addReviewSettings(containerEl);

    // Parsing Settings
    this.addParsingSettings(containerEl);

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
  }

  private addParsingSettings(containerEl: HTMLElement): void {
    containerEl.createEl("h3", { text: "Parsing Settings" });
    containerEl.createEl("p", {
      text: "Configure how flashcards are parsed from your notes.",
      cls: "setting-item-description",
    });

    new Setting(containerEl)
      .setName("Header Level for Flashcards")
      .setDesc(
        "Which header level to use for header-paragraph flashcards (H1 = 1, H2 = 2, etc.)",
      )
      .addDropdown((dropdown) =>
        dropdown
          .addOption("1", "H1 (#)")
          .addOption("2", "H2 (##)")
          .addOption("3", "H3 (###)")
          .addOption("4", "H4 (####)")
          .addOption("5", "H5 (#####)")
          .addOption("6", "H6 (######)")
          .setValue(this.plugin.settings.parsing.headerLevel.toString())
          .onChange(async (value) => {
            this.plugin.settings.parsing.headerLevel = parseInt(value);
            await this.plugin.saveSettings();

            // Force sync all decks to ensure all header levels are parsed and stored
            await this.plugin.performSync(true);

            // Refresh the view to show flashcards for the new header level
            if (this.plugin.view) {
              await this.plugin.view.refreshStats();
            }
          }),
      );
  }

  private addUISettings(containerEl: HTMLElement): void {
    containerEl.createEl("h3", { text: "User Interface" });

    const intervalSetting = new Setting(containerEl)
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

    new Setting(containerEl)
      .setName("Enable Background Refresh")
      .setDesc("Automatically refresh deck stats in the side panel")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.ui.enableBackgroundRefresh)
          .onChange(async (value) => {
            this.plugin.settings.ui.enableBackgroundRefresh = value;
            await this.plugin.saveSettings();

            // Enable/disable interval setting based on toggle
            intervalSetting.setDisabled(!value);

            // Start or stop background refresh based on setting
            if (this.plugin.view) {
              if (value) {
                this.plugin.view.startBackgroundRefresh();
              } else {
                this.plugin.view.stopBackgroundRefresh();
              }
            }
          }),
      );

    new Setting(containerEl)
      .setName("Enable Notices")
      .setDesc(
        "Show notification messages for completed review sessions and sync operations",
      )
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.ui.enableNotices)
          .onChange(async (value) => {
            this.plugin.settings.ui.enableNotices = value;
            await this.plugin.saveSettings();
          }),
      );

    // Set initial state of interval setting
    intervalSetting.setDisabled(
      !this.plugin.settings.ui.enableBackgroundRefresh,
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
          .setValue(this.plugin.settings.debug?.enableLogging || false)
          .onChange(async (value) => {
            if (!this.plugin.settings.debug) {
              this.plugin.settings.debug = {
                enableLogging: false,
                performanceLogs: false,
              };
            }
            this.plugin.settings.debug.enableLogging = value;
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName("Enable Performance Logs")
      .setDesc(
        "Show performance timing metrics in the console (sync times, parsing performance, etc.)",
      )
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.debug?.performanceLogs || false)
          .onChange(async (value) => {
            if (!this.plugin.settings.debug) {
              this.plugin.settings.debug = {
                enableLogging: false,
                performanceLogs: false,
              };
            }
            this.plugin.settings.debug.performanceLogs = value;
            await this.plugin.saveSettings();
          }),
      );
  }
}
