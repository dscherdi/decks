import {
  App,
  PluginSettingTab,
  Setting,
  Notice,
  Modal,
  DropdownComponent,
} from "obsidian";
import type { DecksSettings } from "../../settings";
import { BackupService } from "../../services/BackupService";
import DecksPlugin from "@/main";
import type { IDatabaseService } from "@/database/DatabaseFactory";
import { Logger } from "@/utils/logging";

export class DecksSettingTab extends PluginSettingTab {
  private settings: DecksSettings;
  private saveSettings: () => Promise<void>;
  private performSync: (force?: boolean) => Promise<void>;
  private refreshViewStats: () => Promise<void>;
  private restartBackgroundRefresh: () => void;
  private startBackgroundRefresh: () => void;
  private stopBackgroundRefresh: () => void;
  private purgeDatabase: () => Promise<void>;
  private backupService: BackupService;
  private plugin: DecksPlugin;
  private db: IDatabaseService;
  private logger: Logger;

  constructor(
    app: App,
    plugin: DecksPlugin,
    settings: DecksSettings,
    db: IDatabaseService,
    saveSettings: () => Promise<void>,
    logger: Logger,
    performSync: (force?: boolean) => Promise<void>,
    refreshViewStats: () => Promise<void>,
    restartBackgroundRefresh: () => void,
    startBackgroundRefresh: () => void,
    stopBackgroundRefresh: () => void,
    purgeDatabase: () => Promise<void>,
    backupService: BackupService
  ) {
    super(app, plugin);
    this.plugin = plugin;
    this.settings = settings;
    this.db = db;
    this.logger = logger;
    this.saveSettings = saveSettings;
    this.performSync = performSync;
    this.refreshViewStats = refreshViewStats;
    this.restartBackgroundRefresh = restartBackgroundRefresh;
    this.startBackgroundRefresh = startBackgroundRefresh;
    this.stopBackgroundRefresh = stopBackgroundRefresh;
    this.purgeDatabase = purgeDatabase;
    this.backupService = backupService;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    ;

    // Review Session Settings
    this.addReviewSettings(containerEl);

    // Parsing Settings
    this.addParsingSettings(containerEl);

    // UI Settings
    this.addUISettings(containerEl);

    // Backup Settings
    this.addBackupSettings(containerEl);

    // Debug Settings
    this.addDebugSettings(containerEl);

    // Experimental Settings
    this.addExperimentalSettings(containerEl);

    // Database Management Settings
    this.addDatabaseSettings(containerEl);
  }

  private addReviewSettings(containerEl: HTMLElement): void {
    new Setting(containerEl).setName("Review sessions").setHeading();

    new Setting(containerEl)
      .setName("Show progress")
      .setDesc("Display progress bar during review sessions")
      .addToggle((toggle) =>
        toggle
          .setValue(this.settings.review.showProgress)
          .onChange(async (value) => {
            this.settings.review.showProgress = value;
            await this.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Keyboard shortcuts")
      .setDesc("Enable keyboard shortcuts in review modal (1-4 for difficulty)")
      .addToggle((toggle) =>
        toggle
          .setValue(this.settings.review.enableKeyboardShortcuts)
          .onChange(async (value) => {
            this.settings.review.enableKeyboardShortcuts = value;
            await this.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Session duration")
      .setDesc(
        "Maximum duration for flashcard review sessions in minutes (1-60)"
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
          })
      );

    new Setting(containerEl)
      .setName("Study day starts at")
      .setDesc(
        "Hour when the study day rolls over (0-23, default is 4). Reviews done before this hour count toward the previous day's statistics and daily limits."
      )
      .addSlider((slider) =>
        slider
          .setLimits(0, 23, 1)
          .setValue(this.settings.review.nextDayStartsAt)
          .setDynamicTooltip()
          .onChange(async (value) => {
            this.settings.review.nextDayStartsAt = value;
            await this.saveSettings();
          })
      );
  }

  private addParsingSettings(containerEl: HTMLElement): void {
    new Setting(containerEl).setName("Parsing").setHeading();

    // Get all folders for dropdown options
    const folderOptions: Record<string, string> = {
      "": "Scan entire vault (default)",
    };

    this.app.vault.getAllFolders().forEach((folder) => {
      folderOptions[folder.path] = folder.path;
    });

    new Setting(containerEl)
      .setName("Folder search path")
      .setDesc(
        "Limit scanning to a specific folder. Select 'scan entire vault' to scan all files."
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
    new Setting(containerEl).setName("User interface").setHeading();

    const intervalSetting = new Setting(containerEl)
      .setName("Background refresh interval")
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
          })
      );

    new Setting(containerEl)
      .setName("Enable background refresh")
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
          })
      );

    new Setting(containerEl)
      .setName("Enable notices")
      .setDesc(
        "Show notification messages for completed review sessions and sync operations"
      )
      .addToggle((toggle) =>
        toggle
          .setValue(this.settings.ui.enableNotices)
          .onChange(async (value) => {
            this.settings.ui.enableNotices = value;
            await this.saveSettings();
          })
      );

    // Set initial state of interval setting
    intervalSetting.setDisabled(!this.settings.ui.enableBackgroundRefresh);
  }

  private addDebugSettings(containerEl: HTMLElement): void {
    new Setting(containerEl).setName("Debug").setHeading();
    containerEl.createEl("p", {
      text: "Debug settings for troubleshooting and development.",
      cls: "setting-item-description",
    });

    new Setting(containerEl)
      .setName("Enable debug logging")
      .setDesc(
        "Show detailed logging in the console for sync operations and flashcard processing"
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
          })
      );

    new Setting(containerEl)
      .setName("Enable performance logs")
      .setDesc(
        "Show performance timing metrics in the console (sync times, parsing performance, etc.)"
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
          })
      );
  }

  private addExperimentalSettings(containerEl: HTMLElement): void {
    new Setting(containerEl).setName("Experimental features").setHeading();
    containerEl.createEl("p", {
      text: "Experimental features may be unstable. Use with caution and back up your data.",
      cls: "setting-item-description",
    });

    new Setting(containerEl)
      .setName("Database worker thread")
      .setDesc(
        "Run database operations in a background worker thread to prevent UI freezing with large databases. Requires restart to take effect."
      )
      .addToggle((toggle) =>
        toggle
          .setValue(this.settings.experimental?.enableDatabaseWorker || false)
          .onChange(async (value) => {
            if (!this.settings.experimental) {
              this.settings.experimental = {
                enableDatabaseWorker: false,
              };
            }
            this.settings.experimental.enableDatabaseWorker = value;
            await this.saveSettings();

            new Notice(
              value
                ? "Database worker enabled. Restart Obsidian to activate."
                : "Database worker disabled. Restart Obsidian to deactivate."
            );
          })
      );
  }

  private addDatabaseSettings(containerEl: HTMLElement): void {
    new Setting(containerEl).setName("Database management").setHeading();
    containerEl.createEl("p", {
      text: "Manage your flashcard database. Use with caution - these actions cannot be undone.",
      cls: "setting-item-description",
    });

    new Setting(containerEl)
      .setName("Purge database")
      .setDesc(
        "Permanently delete all flashcards, review history, and deck data. This will force a clean rebuild from your vault files. All progress will be lost!"
      )
      .addButton((button) =>
        button
          .setButtonText("Purge database")
          .setWarning()
          .onClick(() => {
            new DatabasePurgeModal(
              this.app,
              this.purgeDatabase,
              this.performSync,
              this.refreshViewStats,
              this.logger
            ).open();
          })
      );
  }

  private addBackupSettings(containerEl: HTMLElement): void {
    new Setting(containerEl).setName("Backup").setHeading();

    new Setting(containerEl)
      .setName("Enable auto backup")
      .setDesc("Automatically backup review data after each session")
      .addToggle((toggle) =>
        toggle
          .setValue(this.settings.backup.enableAutoBackup)
          .onChange(async (value) => {
            this.settings.backup.enableAutoBackup = value;
            await this.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Max backups")
      .setDesc("Maximum number of backups to keep (3-10)")
      .addSlider((slider) =>
        slider
          .setLimits(3, 10, 1)
          .setValue(this.settings.backup.maxBackups)
          .setDynamicTooltip()
          .onChange(async (value) => {
            this.settings.backup.maxBackups = value;
            this.backupService.setMaxBackups(value);
            await this.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Create backup now")
      .setDesc("Create a manual backup of your flashcard database")
      .addButton((button) =>
        button
          .setButtonText("Create backup")
          .setCta()
          .onClick(async () => {
            const notice = new Notice("Creating backup...", 0);
            try {
              const filename = await this.backupService.createBackup(this.db);
              notice.hide();
              new Notice(`✅ Backup created: ${filename}`, 5000);
            } catch (error) {
              notice.hide();
              new Notice(`❌ Failed to create backup: ${(error as Error).message}`, 8000);
              this.logger.debug("Backup creation failed:", error);
            }
          })
      );

    // Backup restoration section
    new Setting(containerEl).setName("Restore backup").setHeading();

    let selectedBackup = "";
    const backupSetting = new Setting(containerEl)
      .setName("Available backups")
      .setDesc("Select a backup to restore")
      .addDropdown((dropdown) => {
        dropdown.addOption("", "Select backup...");
        dropdown.onChange((value) => {
          selectedBackup = value;
        });
      })
      .addButton((button) =>
        button
          .setButtonText("Refresh")
          .setTooltip("Refresh backup list")
          .onClick(async () => {
            await this.refreshBackupList(backupSetting);
          })
      )
      .addButton((button) =>
        button
          .setButtonText("Restore")
          .setCta()
          .onClick(async () => {
            if (!selectedBackup) {
              new Notice("Please select a backup to restore");
              return;
            }

            await this.restoreBackup(selectedBackup);
          })
      );

    // Initial load of backup list
    this.refreshBackupList(backupSetting).catch((error) => {
      this.logger.debug("Failed to load initial backup list:", error);
    });
  }

  private async refreshBackupList(setting: Setting): Promise<void> {
    try {
      this.logger.debug("Refreshing backup list...");
      const backups = await this.backupService.getAvailableBackups();
      this.logger.debug("Found backups:", backups);

      // Get the dropdown component
      const dropdown = setting.components.find(
        (comp) => comp instanceof DropdownComponent
      );

      if (dropdown === undefined) {
        this.logger.debug("Dropdown component not found");
        new Notice("Dropdown not found", 3000);
        return;
      }

      // Clear existing options by removing all children
      while (dropdown.selectEl.firstChild) {
        dropdown.selectEl.removeChild(dropdown.selectEl.firstChild);
      }

      // Add default option
      const defaultOption = dropdown.selectEl.createEl("option");
      defaultOption.value = "";
      defaultOption.textContent = "Select backup...";

      if (backups.length === 0) {
        const noBackupsOption = dropdown.selectEl.createEl("option");
        noBackupsOption.value = "";
        noBackupsOption.textContent = "No backups found";
        dropdown.setDisabled(true);
        new Notice("No backups found", 3000);
      } else {
        dropdown.setDisabled(false);
        for (const backup of backups) {
          const option = dropdown.selectEl.createEl("option");
          option.value = backup.filename;
          option.textContent = `${backup.timestamp.toLocaleString()}`;
        }
        new Notice(`Found ${backups.length} backup(s)`, 3000);
      }
    } catch (error) {
      this.logger.debug("Failed to load backup list:", error);
      new Notice(`Failed to load backup list: ${(error as Error).message}`, 5000);
    }
  }

  private async restoreBackup(filename: string): Promise<void> {
    const progressNotice = new Notice("Restoring backup...", 0);

    try {
      // Get database service from plugin
      if (!this.db) {
        throw new Error("Database not available");
      }

      let current = 0;
      let total = 0;

      await this.backupService.restoreFromBackup(
        filename,
        this.db,
        (currentCount: number, totalCount: number) => {
          current = currentCount;
          total = totalCount;
          const progress = Math.round((current / total) * 100);
          progressNotice.setMessage(
            `Restoring backup: ${progress}% (${current}/${total})`
          );
        }
      );

      progressNotice.hide();

      if (this.plugin.view) {
        await this.plugin.view.refresh(true);
      }
    } catch (error) {
      progressNotice.hide();
      this.logger.debug("Backup restoration failed:", error);
      new Notice(`❌ Backup restoration failed: ${(error as Error).message}`, 8000);
    }
  }
}

class DatabasePurgeModal extends Modal {
  private purgeDatabase: () => Promise<void>;
  private performSync: (force?: boolean) => Promise<void>;
  private refreshViewStats: () => Promise<void>;
  private logger: Logger;

  constructor(
    app: App,
    purgeDatabase: () => Promise<void>,
    performSync: (force?: boolean) => Promise<void>,
    refreshViewStats: () => Promise<void>,
    logger: Logger
  ) {
    super(app);
    this.purgeDatabase = purgeDatabase;
    this.performSync = performSync;
    this.refreshViewStats = refreshViewStats;
    this.logger = logger;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();

    contentEl.createEl("h2", { text: "Purge database" });

    const warning = contentEl.createEl("div", {
      cls: "setting-item-description",
    });

    const p1 = warning.createEl("p");
    p1.createEl("strong", {
      text: "This will permanently delete all flashcard data including:",
    });

    const ul = warning.createEl("ul");
    ul.createEl("li", { text: "All flashcards and their content" });
    ul.createEl("li", { text: "Complete review history and progress" });
    ul.createEl("li", { text: "All deck information" });
    ul.createEl("li", { text: "Statistical data" });

    const p2 = warning.createEl("p");
    p2.createEl("strong", { text: "This action cannot be undone!" });

    warning.createEl("p", {
      text: "The database will be rebuilt from your current vault files, but all progress will be lost.",
    });

    contentEl.createEl("p", {
      text: "To confirm this action, type the text shown in the placeholder below",
      cls: "setting-item-description",
    });

    const input = contentEl.createEl("input", {
      type: "text",
      placeholder: "DELETE ALL DATA",
      cls: "decks-dialog-width decks-dialog-margin-bottom",
    });

    const buttonContainer = contentEl.createEl("div", {
      cls: "decks-flex-container decks-flex-gap decks-flex-justify-end",
    });

    const cancelButton = buttonContainer.createEl("button", { text: "Cancel" });
    cancelButton.onclick = () => this.close();

    const confirmButton = buttonContainer.createEl("button", {
      text: "Purge database",
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
          this.logger.debug("Failed to purge database:", error);
          new Notice(
            "Failed to purge database. Check the console for details.",
            5000
          );
        }
      } else {
        new Notice(
          "Confirmation text doesn't match. Database purge cancelled.",
          3000
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
