import {
  App,
  PluginSettingTab,
  Setting,
  Notice,
  Modal,
  DropdownComponent,
  normalizePath,
} from "obsidian";
import type { DecksSettings } from "../../settings";
import { BackupService } from "../../services/BackupService";
import DecksPlugin from "@/main";
import type { IDatabaseService } from "@/database/DatabaseFactory";
import { Logger } from "@/utils/logging";
import { OptimizeFsrsModal } from "./OptimizeFsrsModal";

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

    // FSRS optimization
    this.addFsrsOptimizationSettings(containerEl);

    // Debug Settings
    this.addDebugSettings(containerEl);

    // File locations (DB path, backups, sync logs)
    this.addPathsSettings(containerEl);

    // Database Management Settings
    this.addDatabaseSettings(containerEl);
  }

  private addPathsSettings(containerEl: HTMLElement): void {
    const configDir = this.plugin.app.vault.configDir;
    const pluginFolder = `${configDir}/plugins/${this.plugin.manifest.id}`;

    new Setting(containerEl).setName("File locations").setHeading();
    containerEl.createEl("p", {
      text:
        `All paths are vault-relative. Leave empty to use the default location. ` +
        `Most users won't need to change these — they exist so you can move the ` +
        `DB out of the hidden ${configDir}/ folder (where iCloud and other sync ` +
        `providers tend to deprioritize it).`,
      cls: "setting-item-description",
    });

    new Setting(containerEl)
      .setName("Database folder")
      .setDesc(
        `Folder containing flashcards.db. Default: ${pluginFolder}/. ` +
        `Restart Obsidian after changing this. The DB file is not moved ` +
        `automatically — back up first, then either move the file manually ` +
        `or use 'Restore from file' below to import it into the new location.`
      )
      .addText((text) =>
        text
          .setPlaceholder(pluginFolder)
          .setValue(this.settings.paths.dbFolder)
          .onChange(async (value) => {
            this.settings.paths.dbFolder = value.trim();
            await this.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Backup folder")
      .setDesc(
        `Folder for automatic and manual backups. Default: ${pluginFolder}/backups/. ` +
        `Changes take effect immediately — no restart needed.`
      )
      .addText((text) =>
        text
          .setPlaceholder(`${pluginFolder}/backups`)
          .setValue(this.settings.paths.backupFolder)
          .onChange(async (value) => {
            this.settings.paths.backupFolder = value.trim();
            await this.saveSettings();
            // BackupService reads the folder on demand; nudge it now so
            // "available backups" picks up the new location immediately.
            const newFolder = this.settings.paths.backupFolder.trim();
            this.plugin.refreshBackupFolder?.(newFolder);
          })
      );

    new Setting(containerEl)
      .setName("Sync log folder")
      .setDesc(
        `Folder for the per-device .deckssynclog files used by multi-device sync. ` +
        `Default: vault root (which iCloud syncs fastest). Restart Obsidian ` +
        `after changing this.`
      )
      .addText((text) =>
        text
          .setPlaceholder("(vault root)")
          .setValue(this.settings.paths.syncLogFolder)
          .onChange(async (value) => {
            this.settings.paths.syncLogFolder = value.trim();
            await this.saveSettings();
          })
      );
  }

  private addFsrsOptimizationSettings(containerEl: HTMLElement): void {
    new Setting(containerEl).setName("Algorithm tuning").setHeading();

    const fsrs = this.settings.fsrs;
    const desc = this.formatFsrsDescription();

    const setting = new Setting(containerEl)
      .setName("Optimize parameters")
      .setDesc(desc);

    setting.addButton((b) =>
      b
        .setButtonText("Optimize")
        .setCta()
        .onClick(() => {
          new OptimizeFsrsModal(
            this.app,
            this.db,
            this.settings,
            this.saveSettings,
            this.logger,
            () => this.display()
          ).open();
        })
    );

    if (fsrs.trainedWeights !== null) {
      setting.addButton((b) =>
        b
          .setButtonText("Reset to defaults")
          .setWarning()
          .onClick(async () => {
            this.settings.fsrs.trainedWeights = null;
            this.settings.fsrs.lastTrainedAt = null;
            this.settings.fsrs.lastTrainedReviewCount = 0;
            this.settings.fsrs.lastBeforeLogLoss = null;
            this.settings.fsrs.lastAfterLogLoss = null;
            await this.saveSettings();
            new Notice("Trained parameters cleared, defaults restored.");
            this.display();
          })
      );
    }
  }

  private formatFsrsDescription(): string {
    const fsrs = this.settings.fsrs;
    if (fsrs.trainedWeights === null) {
      return "Trains the algorithm's 21 weights on your standard-profile review history. Needs at least 100 reviews. Intensive decks are unaffected.";
    }
    const when = fsrs.lastTrainedAt
      ? new Date(fsrs.lastTrainedAt).toLocaleString()
      : "unknown";
    const before = fsrs.lastBeforeLogLoss?.toFixed(4) ?? "—";
    const after = fsrs.lastAfterLogLoss?.toFixed(4) ?? "—";
    return `Currently using trained weights from ${when} (${fsrs.lastTrainedReviewCount.toLocaleString()} reviews, log-loss ${before} → ${after}).`;
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

    new Setting(containerEl)
      .setName("Leech threshold")
      .setDesc(
        "A card is flagged as a leech once its lapse count reaches this number (default 8). Leeches are repeatedly forgotten and likely need rewriting."
      )
      .addText((text) =>
        text
          .setPlaceholder("8")
          .setValue(this.settings.review.leechThreshold.toString())
          .onChange(async (value) => {
            const num = parseInt(value);
            if (!isNaN(num) && num >= 1 && num <= 100) {
              this.settings.review.leechThreshold = num;
              await this.saveSettings();
            }
          })
      );

    new Setting(containerEl)
      .setName("Dense card character threshold")
      .setDesc(
        "A card is flagged as dense once its back text reaches this many characters (default 500). Dense cards are typically too information-rich and benefit from being split."
      )
      .addText((text) =>
        text
          .setPlaceholder("500")
          .setValue(this.settings.review.denseCardCharThreshold.toString())
          .onChange(async (value) => {
            const num = parseInt(value);
            if (!isNaN(num) && num >= 50 && num <= 5000) {
              this.settings.review.denseCardCharThreshold = num;
              await this.saveSettings();
            }
          })
      );
  }

  private isValidDeckTag(tag: string): boolean {
    return /^#[a-z0-9][a-z0-9_-]*$/.test(tag);
  }

  private async migrateTagMappings(oldTag: string, newTag: string): Promise<void> {
    const mappings = await this.db.getAllTagMappings();
    for (const mapping of mappings) {
      if (mapping.tag === oldTag || mapping.tag.startsWith(oldTag + "/")) {
        const migratedTag = newTag + mapping.tag.slice(oldTag.length);
        await this.db.deleteTagMapping(mapping.id);
        await this.db.createTagMapping(mapping.profileId, migratedTag);
      }
    }
    await this.db.save();
  }

  private addParsingSettings(containerEl: HTMLElement): void {
    new Setting(containerEl).setName("Parsing").setHeading();

    let previousTag = this.settings.parsing.deckTag;

    new Setting(containerEl)
      .setName("Deck tag")
      .setDesc(
        "Base tag used to identify flashcard decks. Files tagged with this " +
          "(or sub-tags like " +
          this.settings.parsing.deckTag +
          "/math) will be treated as decks. " +
          "The default tag has been renamed from #flashcards to #decks. " +
          "If you were using #flashcards, it will continue to work until you change it here."
      )
      .addText((text) =>
        text
          .setPlaceholder("#decks")
          .setValue(this.settings.parsing.deckTag)
          .onChange(async (value) => {
            const trimmed = value.trim().toLowerCase();
            if (this.isValidDeckTag(trimmed) && trimmed !== previousTag) {
              const oldTag = previousTag;
              this.settings.parsing.deckTag = trimmed;
              previousTag = trimmed;
              await this.saveSettings();
              await this.migrateTagMappings(oldTag, trimmed);
            }
          })
      );

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
          .setValue(normalizePath(this.settings.parsing.folderSearchPath))
          .onChange(async (value) => {
            this.settings.parsing.folderSearchPath = normalizePath(value);
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

    new Setting(containerEl)
      .setName("Review display mode")
      .setDesc(
        // eslint-disable-next-line obsidianmd/ui/sentence-case
        "Where review and browse sessions open. Tabs can be dragged to sidebars, bottom panels, or separate windows."
      )
      .addDropdown((dropdown) =>
        dropdown
          .addOption("modal", "Modal overlay")
          .addOption("tab", "New tab")
          .setValue(this.settings.ui.reviewDisplayMode)
          .onChange(async (value) => {
            this.settings.ui.reviewDisplayMode = value as "modal" | "tab";
            await this.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Flashcard manager display mode")
      .setDesc(
        // eslint-disable-next-line obsidianmd/ui/sentence-case
        "Where the flashcard manager opens. Tabs can be dragged to sidebars, bottom panels, or separate windows."
      )
      .addDropdown((dropdown) =>
        dropdown
          .addOption("modal", "Modal overlay")
          .addOption("tab", "New tab")
          .setValue(this.settings.ui.flashcardManagerDisplayMode)
          .onChange(async (value) => {
            this.settings.ui.flashcardManagerDisplayMode = value as
              | "modal"
              | "tab";
            await this.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Hide decks with fewer than")
      .setDesc(
        "Decks (and groups) with fewer than this many total cards are hidden from the list. Pinned decks are always shown. Set to 0 to disable."
      )
      .addText((text) =>
        text
          .setPlaceholder("0")
          .setValue(String(this.settings.ui.minDeckCardCount))
          .onChange(async (value) => {
            const n = Number.parseInt(value, 10);
            const next = Number.isFinite(n) && n >= 0 ? n : 0;
            this.settings.ui.minDeckCardCount = next;
            await this.saveSettings();
            // Push the new threshold into the sidepanel if it's mounted
            // so the user sees the filter apply without reopening.
            this.plugin.getDecksView()?.applyMinDeckCardCountUpdate(next);
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
      )
      .addButton((button) =>
        button
          .setButtonText("Restore from file")
          .setTooltip("Pick a .db backup from anywhere on disk")
          .onClick(() => {
            this.pickAndRestoreFromFile();
          })
      );

    // Initial load of backup list
    this.refreshBackupList(backupSetting).catch((error) => {
      this.logger.debug("Failed to load initial backup list:", error);
    });
  }

  /**
   * Open a native file picker for a .db file anywhere on disk, then restore
   * the database from its raw bytes. Uses HTML <input type="file"> rather
   * than Electron's remote.dialog so the same code works on iOS/Android
   * Obsidian (the WebView's native picker is available everywhere). The
   * raw bytes are validated against the SQLite header + schema version
   * before being applied.
   */
  private pickAndRestoreFromFile(): void {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".db,application/octet-stream";
    // Hidden from the document — we only need it as a programmatic file
    // picker trigger. The setCssProps helper avoids ESLint's no-inline-
    // style rule while keeping the element invisible.
    input.setCssProps({ display: "none" });
    input.addEventListener("change", () => {
      const file = input.files?.[0];
      if (!file) return;
      this.restoreFromFileBytes(file).catch((error: Error) => {
        this.logger.debug("Restore from file failed", error);
        new Notice(`❌ Restore failed: ${error.message}`, 8000);
      });
    });
    document.body.appendChild(input);
    input.click();
    // Detach after the picker fires; some browsers leak the element otherwise.
    setTimeout(() => input.remove(), 60_000);
  }

  private async restoreFromFileBytes(file: File): Promise<void> {
    if (!this.db) throw new Error("Database not available");
    const progressNotice = new Notice(`Restoring from ${file.name}…`, 0);
    try {
      const buffer = await file.arrayBuffer();
      await this.backupService.restoreFromFile(
        buffer,
        this.db,
        (current, total) => {
          const progress = Math.round((current / total) * 100);
          progressNotice.setMessage(`Restoring from ${file.name}: ${progress}%`);
        }
      );
      progressNotice.hide();
      if (this.plugin.view) {
        await this.plugin.view.refresh(true);
      }
    } catch (error) {
      progressNotice.hide();
      throw error;
    }
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
