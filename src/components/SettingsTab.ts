import { App, PluginSettingTab, Setting, Notice, Modal } from "obsidian";
import { FlashcardsSettings } from "../settings";

export class DecksSettingTab extends PluginSettingTab {
  private settings: FlashcardsSettings;
  private saveSettings: () => Promise<void>;
  private performSync: (force?: boolean) => Promise<void>;
  private refreshViewStats: () => Promise<void>;
  private restartBackgroundRefresh: () => void;
  private startBackgroundRefresh: () => void;
  private stopBackgroundRefresh: () => void;
  private purgeDatabase: () => Promise<void>;

  constructor(
    app: App,
    plugin: any,
    settings: FlashcardsSettings,
    saveSettings: () => Promise<void>,
    performSync: (force?: boolean) => Promise<void>,
    refreshViewStats: () => Promise<void>,
    restartBackgroundRefresh: () => void,
    startBackgroundRefresh: () => void,
    stopBackgroundRefresh: () => void,
    purgeDatabase: () => Promise<void>,
  ) {
    super(app, plugin);
    this.settings = settings;
    this.saveSettings = saveSettings;
    this.performSync = performSync;
    this.refreshViewStats = refreshViewStats;
    this.restartBackgroundRefresh = restartBackgroundRefresh;
    this.startBackgroundRefresh = startBackgroundRefresh;
    this.stopBackgroundRefresh = stopBackgroundRefresh;
    this.purgeDatabase = purgeDatabase;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    containerEl.createEl("h2", { text: "Decks Plugin Settings" });

    // Review Session Settings
    this.addReviewSettings(containerEl);

    // Parsing Settings
    this.addParsingSettings(containerEl);

    // UI Settings
    this.addUISettings(containerEl);

    // Debug Settings
    this.addDebugSettings(containerEl);

    // Database Management Settings
    this.addDatabaseSettings(containerEl);
  }

  private addReviewSettings(containerEl: HTMLElement): void {
    containerEl.createEl("h3", { text: "Review Sessions" });

    new Setting(containerEl)
      .setName("Show Progress")
      .setDesc("Display progress bar during review sessions")
      .addToggle((toggle) =>
        toggle
          .setValue(this.settings.review.showProgress)
          .onChange(async (value) => {
            this.settings.review.showProgress = value;
            await this.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName("Keyboard Shortcuts")
      .setDesc("Enable keyboard shortcuts in review modal (1-4 for difficulty)")
      .addToggle((toggle) =>
        toggle
          .setValue(this.settings.review.enableKeyboardShortcuts)
          .onChange(async (value) => {
            this.settings.review.enableKeyboardShortcuts = value;
            await this.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName("Session Duration")
      .setDesc(
        "Maximum duration for flashcard review sessions in minutes (1-60)",
      )
      .addText((text) =>
        text
          .setPlaceholder("25")
          .setValue(this.settings.review.sessionDuration.toString())
          .onChange(async (value) => {
            const num = parseInt(value);
            if (!isNaN(num) && num >= 1 && num <= 60) {
              this.settings.review.sessionDuration = num;
              await this.saveSettings();
            }
          }),
      );
  }

  private addParsingSettings(containerEl: HTMLElement): void {
    containerEl.createEl("h3", { text: "Parsing" });

    // Get all folders for dropdown options
    const folderOptions: Record<string, string> = {
      "": "Scan entire vault (default)",
    };

    this.app.vault.getAllFolders().forEach((folder) => {
      folderOptions[folder.path] = folder.path;
    });

    new Setting(containerEl)
      .setName("Folder Search Path")
      .setDesc(
        "Limit scanning to a specific folder. Select 'Scan entire vault' to scan all files.",
      )
      .addDropdown((dropdown) => {
        // Add options to dropdown
        Object.entries(folderOptions).forEach(([value, display]) => {
          dropdown.addOption(value, display);
        });

        dropdown
          .setValue(this.settings.parsing.folderSearchPath)
          .onChange(async (value) => {
            this.settings.parsing.folderSearchPath = value;
            await this.saveSettings();
          });
      });
  }

  private addUISettings(containerEl: HTMLElement): void {
    containerEl.createEl("h3", { text: "User Interface" });

    const intervalSetting = new Setting(containerEl)
      .setName("Background Refresh Interval")
      .setDesc("How often to refresh deck stats in the side panel (in seconds)")
      .addText((text) =>
        text
          .setPlaceholder("5")
          .setValue(this.settings.ui.backgroundRefreshInterval.toString())
          .onChange(async (value) => {
            const num = parseInt(value);
            if (!isNaN(num) && num >= 1 && num <= 60) {
              this.settings.ui.backgroundRefreshInterval = num;
              await this.saveSettings();
              // Restart background refresh with new interval
              this.restartBackgroundRefresh();
            }
          }),
      );

    new Setting(containerEl)
      .setName("Enable Background Refresh")
      .setDesc("Automatically refresh deck stats in the side panel")
      .addToggle((toggle) =>
        toggle
          .setValue(this.settings.ui.enableBackgroundRefresh)
          .onChange(async (value) => {
            this.settings.ui.enableBackgroundRefresh = value;
            await this.saveSettings();

            // Enable/disable interval setting based on toggle
            intervalSetting.setDisabled(!value);

            // Start or stop background refresh based on setting
            if (value) {
              this.startBackgroundRefresh();
            } else {
              this.stopBackgroundRefresh();
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
          .setValue(this.settings.ui.enableNotices)
          .onChange(async (value) => {
            this.settings.ui.enableNotices = value;
            await this.saveSettings();
          }),
      );

    // Set initial state of interval setting
    intervalSetting.setDisabled(!this.settings.ui.enableBackgroundRefresh);
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
          .setValue(this.settings.debug?.enableLogging || false)
          .onChange(async (value) => {
            if (!this.settings.debug) {
              this.settings.debug = {
                enableLogging: false,
                performanceLogs: false,
              };
            }
            this.settings.debug.enableLogging = value;
            await this.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName("Enable Performance Logs")
      .setDesc(
        "Show performance timing metrics in the console (sync times, parsing performance, etc.)",
      )
      .addToggle((toggle) =>
        toggle
          .setValue(this.settings.debug?.performanceLogs || false)
          .onChange(async (value) => {
            if (!this.settings.debug) {
              this.settings.debug = {
                enableLogging: false,
                performanceLogs: false,
              };
            }
            this.settings.debug.performanceLogs = value;
            await this.saveSettings();
          }),
      );
  }

  private addDatabaseSettings(containerEl: HTMLElement): void {
    containerEl.createEl("h3", { text: "Database Management" });
    containerEl.createEl("p", {
      text: "Manage your flashcard database. Use with caution - these actions cannot be undone.",
      cls: "setting-item-description",
    });

    new Setting(containerEl)
      .setName("Purge Database")
      .setDesc(
        "⚠️ Permanently delete all flashcards, review history, and deck data. This will force a clean rebuild from your vault files. All progress will be lost!",
      )
      .addButton((button) =>
        button
          .setButtonText("Purge Database")
          .setWarning()
          .onClick(() => {
            new DatabasePurgeModal(
              this.app,
              this.purgeDatabase,
              this.performSync,
              this.refreshViewStats,
            ).open();
          }),
      );
  }
}

class DatabasePurgeModal extends Modal {
  private purgeDatabase: () => Promise<void>;
  private performSync: (force?: boolean) => Promise<void>;
  private refreshViewStats: () => Promise<void>;

  constructor(
    app: App,
    purgeDatabase: () => Promise<void>,
    performSync: (force?: boolean) => Promise<void>,
    refreshViewStats: () => Promise<void>,
  ) {
    super(app);
    this.purgeDatabase = purgeDatabase;
    this.performSync = performSync;
    this.refreshViewStats = refreshViewStats;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();

    contentEl.createEl("h2", { text: "⚠️ Purge Database" });

    const warning = contentEl.createEl("div", {
      cls: "setting-item-description",
    });
    warning.innerHTML = `
      <p><strong>This will permanently delete ALL flashcard data including:</strong></p>
      <ul>
        <li>All flashcards and their content</li>
        <li>Complete review history and progress</li>
        <li>All deck information</li>
        <li>Statistical data</li>
      </ul>
      <p><strong>This action cannot be undone!</strong></p>
      <p>The database will be rebuilt from your current vault files, but all progress will be lost.</p>
    `;

    contentEl.createEl("p", {
      text: 'Type "DELETE ALL DATA" to confirm:',
      cls: "setting-item-description",
    });

    const input = contentEl.createEl("input", {
      type: "text",
      placeholder: "DELETE ALL DATA",
    });
    input.style.width = "100%";
    input.style.marginBottom = "1rem";

    const buttonContainer = contentEl.createEl("div");
    buttonContainer.style.display = "flex";
    buttonContainer.style.gap = "0.5rem";
    buttonContainer.style.justifyContent = "flex-end";

    const cancelButton = buttonContainer.createEl("button", { text: "Cancel" });
    cancelButton.onclick = () => this.close();

    const confirmButton = buttonContainer.createEl("button", {
      text: "Purge Database",
      cls: "mod-warning",
    });

    confirmButton.onclick = async () => {
      if (input.value === "DELETE ALL DATA") {
        try {
          this.close();

          // Show progress notice
          const notice = new Notice("Purging database...", 0);

          // Purge the database
          await this.purgeDatabase();

          // Trigger a full sync to rebuild from vault
          await this.performSync(true);

          // Update the notice
          notice.setMessage("✅ Database purged and rebuilt successfully");
          setTimeout(() => notice.hide(), 3000);

          // Refresh the view
          await this.refreshViewStats();
        } catch (error) {
          console.error("Failed to purge database:", error);
          new Notice(
            "❌ Failed to purge database. Check console for details.",
            5000,
          );
        }
      } else {
        new Notice(
          "Confirmation text doesn't match. Database purge cancelled.",
          3000,
        );
      }
    };

    // Focus the input
    input.focus();

    // Allow Enter key to confirm
    input.addEventListener("keypress", (e) => {
      if (e.key === "Enter") {
        confirmButton.click();
      }
    });
  }

  onClose() {
    const { contentEl } = this;
    contentEl.empty();
  }
}
