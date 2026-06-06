import {
  App,
  PluginSettingTab,
  Setting,
  Notice,
  Modal,
  DropdownComponent,
  normalizePath,
  getLanguage,
} from "obsidian";
import type { DecksSettings } from "../../settings";
import { BackupService } from "../../services/BackupService";
import DecksPlugin from "@/main";
import type { IDatabaseService } from "@/database/DatabaseFactory";
import type { FsrsWeightSet } from "@/database/types";
import { Logger } from "@/utils/logging";
import { OptimizeFsrsModal } from "./OptimizeFsrsModal";
import { type AiProviderId, DECKS_CLOUD_DEFAULT_BASE_URL, I18n, type LanguagePreference, PROVIDER_MODELS, SUPPORTED_LANGUAGES } from "@decks/core";

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
  // Tracks when the user explicitly chose "Custom…" in the model picker so the
  // free-text field stays open even while the typed id matches no preset.
  private aiModelCustom = false;

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

    // Language
    this.addLanguageSettings(containerEl);

    // Review Session Settings
    this.addReviewSettings(containerEl);

    // Parsing Settings
    this.addParsingSettings(containerEl);

    // Canvas Decks Settings
    this.addCanvasDecksSettings(containerEl);

    // UI Settings
    this.addUISettings(containerEl);

    // AI features
    this.addAiSettings(containerEl);

    // Backup Settings
    this.addBackupSettings(containerEl);

    // FSRS optimization (async: reads the active trained weight set from the DB)
    const fsrsContainer = containerEl.createDiv();
    this.addFsrsOptimizationSettings(fsrsContainer).catch((e) =>
      this.logger?.error?.("Failed to render FSRS settings", e)
    );

    // Debug Settings
    this.addDebugSettings(containerEl);

    // File locations (DB path, backups, sync logs)
    this.addPathsSettings(containerEl);

    // Database Management Settings
    this.addDatabaseSettings(containerEl);
  }

  private addAiSettings(containerEl: HTMLElement): void {
    const s = I18n.t.settings.ai;
    new Setting(containerEl).setName(s.heading).setHeading();

    // The provider/model/key fields render into their own container so toggling
    // "enabled" (or switching provider) rebuilds ONLY that container instead of
    // the whole settings tab. The enable toggle leads the block; the container
    // is appended after it so the provider fields render below.
    let subContainer: HTMLElement;

    new Setting(containerEl)
      .setName(s.enabled)
      .setDesc(s.enabledDesc)
      .addToggle((toggle) =>
        toggle.setValue(this.settings.ai.enabled).onChange(async (value) => {
          if (value === this.settings.ai.enabled) return;
          this.settings.ai.enabled = value;
          await this.saveSettings();
          this.plugin.getDecksView()?.applyAiEnabledUpdate(value);
          this.renderAiProviderSettings(subContainer);
        })
      );

    subContainer = containerEl.createDiv();
    this.renderAiProviderSettings(subContainer);
  }

  private renderAiProviderSettings(containerEl: HTMLElement): void {
    containerEl.empty();
    if (!this.settings.ai.enabled) return;

    const s = I18n.t.settings.ai;
    const provider = this.settings.ai.provider;

    new Setting(containerEl)
      .setName(s.provider)
      .setDesc(s.providerDesc)
      .addDropdown((dd) =>
        dd
          .addOption("gemini", s.providerGemini)
          .addOption("openai", s.providerOpenai)
          .addOption("claude", s.providerClaude)
          .addOption("openai-compatible", s.providerLocal)
          .addOption("decks-cloud", s.providerDecksCloud)
          .setValue(provider)
          .onChange(async (value) => {
            if (value === this.settings.ai.provider) return;
            this.settings.ai.provider = value as AiProviderId;
            this.aiModelCustom = false;
            await this.saveSettings();
            // Rebuild only this sub-container (shows/hides the local URL field).
            this.renderAiProviderSettings(containerEl);
          })
      );

    this.renderModelSetting(containerEl, provider);

    if (provider === "openai-compatible") {
      new Setting(containerEl)
        .setName(s.localBaseUrl)
        .setDesc(s.localBaseUrlDesc)
        .addText((text) =>
          text
            .setValue(this.settings.ai.localBaseUrl)
            .onChange(async (value) => {
              this.settings.ai.localBaseUrl = value.trim();
              await this.saveSettings();
            })
        );
    }

    if (provider === "decks-cloud") {
      new Setting(containerEl)
        .setName(s.serverUrl)
        .setDesc(s.serverUrlDesc)
        .addText((text) =>
          text
            .setPlaceholder(DECKS_CLOUD_DEFAULT_BASE_URL)
            .setValue(this.settings.ai.decksCloudBaseUrl)
            .onChange(async (value) => {
              this.settings.ai.decksCloudBaseUrl = value.trim();
              await this.saveSettings();
            })
        );
    }

    // Credential lives in the non-synced AiKeyStore, never in data.json. For the
    // hosted decks-cloud provider this field holds the license key.
    const isCloud = provider === "decks-cloud";
    new Setting(containerEl)
      .setName(isCloud ? s.licenseKey : s.apiKey)
      .setDesc(isCloud ? s.licenseKeyDesc : s.apiKeyDesc)
      .addText((text) => {
        text
          .setPlaceholder(isCloud ? s.licenseKeyPlaceholder : s.apiKeyPlaceholder)
          .onChange(async (value) => {
            await this.plugin.aiKeyStore.set(provider, value);
          });
        text.inputEl.type = "password";
        // Block body is required: TextComponent.setValue() returns `this`, and
        // Obsidian components are thenables (BaseComponent.then). Returning the
        // component from a .then callback makes the Promise adopt it and recurse
        // through .then forever (hard freeze). The block returns undefined.
        void this.plugin.aiKeyStore.get(provider).then((k) => {
          text.setValue(k);
        });
      });
  }

  // The local (openai-compatible) provider keeps a free-text model field since
  // its ids depend on the running server; hosted providers get a curated
  // dropdown plus a "Custom…" option that reveals a free-text field.
  private renderModelSetting(
    containerEl: HTMLElement,
    provider: AiProviderId,
  ): void {
    const s = I18n.t.settings.ai;
    const current = this.settings.ai.models[provider] ?? "";

    if (provider === "openai-compatible") {
      new Setting(containerEl)
        .setName(s.model)
        .setDesc(s.modelDesc)
        .addText((text) =>
          text.setValue(current).onChange(async (value) => {
            this.settings.ai.models[provider] = value.trim();
            await this.saveSettings();
          }),
        );
      return;
    }

    const CUSTOM = "__custom__";
    const presets = PROVIDER_MODELS[provider];
    const presetIds = presets.map((m) => m.id);
    const showCustom = this.aiModelCustom || !presetIds.includes(current);

    new Setting(containerEl)
      .setName(s.model)
      .setDesc(s.modelDesc)
      .addDropdown((dd) => {
        for (const m of presets) dd.addOption(m.id, m.name);
        dd.addOption(CUSTOM, s.modelCustom);
        dd.setValue(showCustom ? CUSTOM : current);
        dd.onChange(async (value) => {
          if (value === CUSTOM) {
            this.aiModelCustom = true;
            this.renderAiProviderSettings(containerEl);
            return;
          }
          this.aiModelCustom = false;
          this.settings.ai.models[provider] = value;
          await this.saveSettings();
          this.renderAiProviderSettings(containerEl);
        });
      });

    if (showCustom) {
      new Setting(containerEl)
        .setName(s.modelCustomLabel)
        .addText((text) =>
          text.setValue(current).onChange(async (value) => {
            this.settings.ai.models[provider] = value.trim();
            await this.saveSettings();
          }),
        );
    }
  }

  private addLanguageSettings(containerEl: HTMLElement): void {
    new Setting(containerEl).setName(I18n.t.settings.language.heading).setHeading();

    new Setting(containerEl)
      .setName(I18n.t.settings.language.name)
      .setDesc(I18n.t.settings.language.desc)
      .addDropdown((dropdown) => {
        dropdown.addOption("auto", I18n.t.settings.language.auto);
        for (const lang of SUPPORTED_LANGUAGES) {
          dropdown.addOption(lang.code, lang.label);
        }
        dropdown
          .setValue(this.settings.i18n?.language ?? "auto")
          .onChange(async (value) => {
            this.settings.i18n = { language: value as LanguagePreference };
            await this.saveSettings();
            // Re-resolve language and re-render this settings tab immediately,
            // so the user sees the change confirmed in the new language.
            // Other already-mounted views (deck list, review modal, commands)
            // still need a plugin reload to pick it up.
            I18n.init(this.settings, getLanguage());
            new Notice(I18n.t.notices.languageChanged);
            this.display();
          });
      });
  }

  private addPathsSettings(containerEl: HTMLElement): void {
    const configDir = this.plugin.app.vault.configDir;
    const pluginFolder = `${configDir}/plugins/${this.plugin.manifest.id}`;

    new Setting(containerEl).setName(I18n.t.settings.paths.heading).setHeading();
    containerEl.createEl("p", {
      text: I18n.format(I18n.t.settings.paths.paragraph, { configDir }),
      cls: "setting-item-description",
    });

    new Setting(containerEl)
      .setName(I18n.t.settings.paths.dbFolder)
      .setDesc(I18n.format(I18n.t.settings.paths.dbFolderDesc, { pluginFolder }))
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
      .setName(I18n.t.settings.paths.backupFolder)
      .setDesc(I18n.format(I18n.t.settings.paths.backupFolderDesc, { pluginFolder }))
      .addText((text) =>
        text
          .setPlaceholder(
            I18n.format(I18n.t.settings.paths.backupFolderPlaceholder, { pluginFolder })
          )
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
      .setName(I18n.t.settings.paths.syncLogFolder)
      .setDesc(I18n.t.settings.paths.syncLogFolderDesc)
      .addText((text) =>
        text
          .setPlaceholder(I18n.t.settings.paths.syncLogFolderPlaceholder)
          .setValue(this.settings.paths.syncLogFolder)
          .onChange(async (value) => {
            this.settings.paths.syncLogFolder = value.trim();
            await this.saveSettings();
          })
      );
  }

  private async addFsrsOptimizationSettings(containerEl: HTMLElement): Promise<void> {
    new Setting(containerEl).setName(I18n.t.settings.fsrs.heading).setHeading();

    const active = await this.db.getActiveTrainedWeightSet();
    const desc = this.formatFsrsDescription(active);

    const setting = new Setting(containerEl)
      .setName(I18n.t.settings.fsrs.optimize)
      .setDesc(desc);

    setting.addButton((b) =>
      b
        .setButtonText(I18n.t.settings.fsrs.optimizeButton)
        .setCta()
        .onClick(() => {
          new OptimizeFsrsModal(this.app, this.db, this.logger, () =>
            this.display()
          ).open();
        })
    );

    if (active) {
      setting.addButton((b) =>
        b
          .setButtonText(I18n.t.settings.fsrs.resetButton)
          .setWarning()
          .onClick(async () => {
            await this.db.clearTrainedWeights();
            new Notice(I18n.t.notices.trainedParamsCleared);
            this.display();
          })
      );
    }
  }

  private formatFsrsDescription(active: FsrsWeightSet | null): string {
    if (!active) {
      return I18n.t.settings.fsrs.descUntrained;
    }
    const when = active.trainedAt
      ? new Date(active.trainedAt).toLocaleString()
      : I18n.t.settings.fsrs.descTrainedUnknownWhen;
    const before =
      active.beforeLogLoss?.toFixed(4) ?? I18n.t.settings.fsrs.descTrainedMissingMetric;
    const after =
      active.afterLogLoss?.toFixed(4) ?? I18n.t.settings.fsrs.descTrainedMissingMetric;
    return I18n.format(I18n.t.settings.fsrs.descTrained, {
      when,
      count: active.reviewsTrained.toLocaleString(),
      before,
      after,
    });
  }

  private addReviewSettings(containerEl: HTMLElement): void {
    new Setting(containerEl).setName(I18n.t.settings.review.heading).setHeading();

    new Setting(containerEl)
      .setName(I18n.t.settings.review.showProgress)
      .setDesc(I18n.t.settings.review.showProgressDesc)
      .addToggle((toggle) =>
        toggle
          .setValue(this.settings.review.showProgress)
          .onChange(async (value) => {
            this.settings.review.showProgress = value;
            await this.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName(I18n.t.settings.review.keyboardShortcuts)
      .setDesc(I18n.t.settings.review.keyboardShortcutsDesc)
      .addToggle((toggle) =>
        toggle
          .setValue(this.settings.review.enableKeyboardShortcuts)
          .onChange(async (value) => {
            this.settings.review.enableKeyboardShortcuts = value;
            await this.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName(I18n.t.settings.review.sessionDuration)
      .setDesc(I18n.t.settings.review.sessionDurationDesc)
      .addText((text) =>
        text
          .setPlaceholder(I18n.t.settings.review.sessionDurationPlaceholder)
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
      .setName(I18n.t.settings.review.studyDayStartsAt)
      .setDesc(I18n.t.settings.review.studyDayStartsAtDesc)
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
      .setName(I18n.t.settings.review.leechThreshold)
      .setDesc(I18n.t.settings.review.leechThresholdDesc)
      .addText((text) =>
        text
          .setPlaceholder(I18n.t.settings.review.leechThresholdPlaceholder)
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
      .setName(I18n.t.settings.review.denseCardCharThreshold)
      .setDesc(I18n.t.settings.review.denseCardCharThresholdDesc)
      .addText((text) =>
        text
          .setPlaceholder(I18n.t.settings.review.denseCardCharThresholdPlaceholder)
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
    new Setting(containerEl).setName(I18n.t.settings.parsing.heading).setHeading();

    let previousTag = this.settings.parsing.deckTag;

    new Setting(containerEl)
      .setName(I18n.t.settings.parsing.deckTag)
      .setDesc(
        I18n.format(I18n.t.settings.parsing.deckTagDesc, {
          tag: this.settings.parsing.deckTag,
        })
      )
      .addText((text) =>
        text
          .setPlaceholder(I18n.t.settings.parsing.deckTagPlaceholder)
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
      "": I18n.t.settings.parsing.folderSearchPathDefault,
    };

    this.app.vault.getAllFolders().forEach((folder) => {
      folderOptions[folder.path] = folder.path;
    });

    new Setting(containerEl)
      .setName(I18n.t.settings.parsing.folderSearchPath)
      .setDesc(I18n.t.settings.parsing.folderSearchPathDesc)
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

  private isValidCanvasTag(tag: string): boolean {
    return /^#[a-z0-9][a-z0-9_/-]*$/.test(tag);
  }

  private addCanvasDecksSettings(containerEl: HTMLElement): void {
    new Setting(containerEl)
      .setName(I18n.t.settings.canvasDecks.heading)
      .setHeading();

    // Folder picker dropdown reusing the same getAllFolders() pattern.
    const folderOptions: Record<string, string> = {
      "": I18n.t.settings.canvasDecks.folderPathDefault,
    };
    this.app.vault.getAllFolders().forEach((folder) => {
      folderOptions[folder.path] = folder.path;
    });

    new Setting(containerEl)
      .setName(I18n.t.settings.canvasDecks.folderPath)
      .setDesc(I18n.t.settings.canvasDecks.folderPathDesc)
      .addDropdown((dropdown) => {
        Object.entries(folderOptions).forEach(([value, display]) => {
          dropdown.addOption(value, display);
        });
        dropdown
          .setValue(normalizePath(this.settings.canvasDecks.folderPath))
          .onChange(async (value) => {
            this.settings.canvasDecks.folderPath = normalizePath(value);
            await this.saveSettings();
          });
      });

    new Setting(containerEl)
      .setName(I18n.t.settings.canvasDecks.tagName)
      .setDesc(I18n.t.settings.canvasDecks.tagNameDesc)
      .addText((text) =>
        text
          .setPlaceholder(I18n.t.settings.canvasDecks.tagNamePlaceholder)
          .setValue(this.settings.canvasDecks.tagName)
          .onChange(async (value) => {
            const trimmed = value.trim().toLowerCase();
            if (this.isValidCanvasTag(trimmed)) {
              this.settings.canvasDecks.tagName = trimmed;
              await this.saveSettings();
            }
          })
      );
  }

  private addUISettings(containerEl: HTMLElement): void {
    new Setting(containerEl).setName(I18n.t.settings.ui.heading).setHeading();

    const intervalSetting = new Setting(containerEl)
      .setName(I18n.t.settings.ui.backgroundRefreshInterval)
      .setDesc(I18n.t.settings.ui.backgroundRefreshIntervalDesc)
      .addText((text) =>
        text
          .setPlaceholder(I18n.t.settings.ui.backgroundRefreshIntervalPlaceholder)
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
      .setName(I18n.t.settings.ui.enableBackgroundRefresh)
      .setDesc(I18n.t.settings.ui.enableBackgroundRefreshDesc)
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
      .setName(I18n.t.settings.ui.enableNotices)
      .setDesc(I18n.t.settings.ui.enableNoticesDesc)
      .addToggle((toggle) =>
        toggle
          .setValue(this.settings.ui.enableNotices)
          .onChange(async (value) => {
            this.settings.ui.enableNotices = value;
            await this.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName(I18n.t.settings.ui.reviewDisplayMode)
      .setDesc(I18n.t.settings.ui.reviewDisplayModeDesc)
      .addDropdown((dropdown) =>
        dropdown
          .addOption("modal", I18n.t.settings.ui.displayModeModal)
          .addOption("tab", I18n.t.settings.ui.displayModeTab)
          .setValue(this.settings.ui.reviewDisplayMode)
          .onChange(async (value) => {
            this.settings.ui.reviewDisplayMode = value as "modal" | "tab";
            await this.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName(I18n.t.settings.ui.flashcardManagerDisplayMode)
      .setDesc(I18n.t.settings.ui.flashcardManagerDisplayModeDesc)
      .addDropdown((dropdown) =>
        dropdown
          .addOption("modal", I18n.t.settings.ui.displayModeModal)
          .addOption("tab", I18n.t.settings.ui.displayModeTab)
          .setValue(this.settings.ui.flashcardManagerDisplayMode)
          .onChange(async (value) => {
            this.settings.ui.flashcardManagerDisplayMode = value as
              | "modal"
              | "tab";
            await this.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName(I18n.t.settings.ui.aiGeneratorDisplayMode)
      .setDesc(I18n.t.settings.ui.aiGeneratorDisplayModeDesc)
      .addDropdown((dropdown) =>
        dropdown
          .addOption("modal", I18n.t.settings.ui.displayModeModal)
          .addOption("tab", I18n.t.settings.ui.displayModeTab)
          .setValue(this.settings.ui.aiGeneratorDisplayMode)
          .onChange(async (value) => {
            this.settings.ui.aiGeneratorDisplayMode = value as "modal" | "tab";
            await this.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName(I18n.t.settings.ui.minDeckCardCount)
      .setDesc(I18n.t.settings.ui.minDeckCardCountDesc)
      .addText((text) =>
        text
          .setPlaceholder(I18n.t.settings.ui.minDeckCardCountPlaceholder)
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
    new Setting(containerEl).setName(I18n.t.settings.debug.heading).setHeading();
    containerEl.createEl("p", {
      text: I18n.t.settings.debug.paragraph,
      cls: "setting-item-description",
    });

    new Setting(containerEl)
      .setName(I18n.t.settings.debug.enableLogging)
      .setDesc(I18n.t.settings.debug.enableLoggingDesc)
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
      .setName(I18n.t.settings.debug.performanceLogs)
      .setDesc(I18n.t.settings.debug.performanceLogsDesc)
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
    new Setting(containerEl).setName(I18n.t.settings.database.heading).setHeading();
    containerEl.createEl("p", {
      text: I18n.t.settings.database.paragraph,
      cls: "setting-item-description",
    });

    new Setting(containerEl)
      .setName(I18n.t.settings.database.purgeDatabase)
      .setDesc(I18n.t.settings.database.purgeDatabaseDesc)
      .addButton((button) =>
        button
          .setButtonText(I18n.t.settings.database.purgeDatabaseButton)
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
    new Setting(containerEl).setName(I18n.t.settings.backup.heading).setHeading();

    new Setting(containerEl)
      .setName(I18n.t.settings.backup.enableAutoBackup)
      .setDesc(I18n.t.settings.backup.enableAutoBackupDesc)
      .addToggle((toggle) =>
        toggle
          .setValue(this.settings.backup.enableAutoBackup)
          .onChange(async (value) => {
            this.settings.backup.enableAutoBackup = value;
            await this.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName(I18n.t.settings.backup.maxBackups)
      .setDesc(I18n.t.settings.backup.maxBackupsDesc)
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
      .setName(I18n.t.settings.backup.createBackupNow)
      .setDesc(I18n.t.settings.backup.createBackupNowDesc)
      .addButton((button) =>
        button
          .setButtonText(I18n.t.settings.backup.createBackupButton)
          .setCta()
          .onClick(async () => {
            const notice = new Notice(I18n.t.notices.creatingBackup, 0);
            try {
              const filename = await this.backupService.createBackup(this.db);
              notice.hide();
              new Notice(I18n.format(I18n.t.notices.backupCreated, { filename }), 5000);
            } catch (error) {
              notice.hide();
              new Notice(
                I18n.format(I18n.t.notices.backupFailed, {
                  message: (error as Error).message,
                }),
                8000
              );
              this.logger.debug("Backup creation failed:", error);
            }
          })
      );

    // Backup restoration section
    new Setting(containerEl).setName(I18n.t.settings.backup.restoreHeading).setHeading();

    let selectedBackup = "";
    const backupSetting = new Setting(containerEl)
      .setClass("decks-backup-restore-setting")
      .setName(I18n.t.settings.backup.availableBackups)
      .setDesc(I18n.t.settings.backup.availableBackupsDesc)
      .addDropdown((dropdown) => {
        dropdown.addOption("", I18n.t.settings.backup.selectBackupOption);
        dropdown.onChange((value) => {
          selectedBackup = value;
        });
      })
      .addButton((button) =>
        button
          .setButtonText(I18n.t.settings.backup.refreshButton)
          .setTooltip(I18n.t.settings.backup.refreshTooltip)
          .onClick(async () => {
            await this.refreshBackupList(backupSetting);
          })
      )
      .addButton((button) =>
        button
          .setButtonText(I18n.t.settings.backup.restoreButton)
          .setCta()
          .onClick(async () => {
            if (!selectedBackup) {
              new Notice(I18n.t.notices.selectBackupPrompt);
              return;
            }

            await this.restoreBackup(selectedBackup);
          })
      )
      .addButton((button) =>
        button
          .setButtonText(I18n.t.settings.backup.restoreFromFile)
          .setTooltip(I18n.t.settings.backup.restoreFromFileTooltip)
          .onClick(() => {
            this.pickAndRestoreFromFile();
          })
      );

    new Setting(containerEl)
      .setName(I18n.t.settings.backup.rebuildState)
      .setDesc(I18n.t.settings.backup.rebuildStateDesc)
      .addButton((button) =>
        button
          .setButtonText(I18n.t.settings.backup.rebuildStateButton)
          .onClick(async () => {
            await this.rebuildCardStateFromReviewLogs();
          })
      );

    // Initial load of backup list
    this.refreshBackupList(backupSetting).catch((error) => {
      this.logger.debug("Failed to load initial backup list:", error);
    });
  }

  /**
   * Recovery action: rebuild card scheduling state from review history for cards
   * that show as new but have logs. Takes a safety backup first.
   */
  private async rebuildCardStateFromReviewLogs(): Promise<void> {
    const notice = new Notice(I18n.t.notices.creatingBackup, 0);
    try {
      await this.backupService.createBackup(this.db);
      const count = await this.db.rebuildCardStateFromReviewLogs();
      await this.db.save();
      notice.hide();
      new Notice(I18n.format(I18n.t.notices.cardsRebuilt, { count }), 6000);
    } catch (error) {
      notice.hide();
      new Notice(
        I18n.format(I18n.t.notices.restoreFailed, {
          message: (error as Error).message,
        }),
        8000
      );
      this.logger.debug("Rebuild from review history failed:", error);
    }
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
    const input = activeDocument.createElement("input");
    input.type = "file";
    input.accept = ".db,application/octet-stream";
    // Hidden from the activeDocument — we only need it as a programmatic file
    // picker trigger. The setCssProps helper avoids ESLint's no-inline-
    // style rule while keeping the element invisible.
    input.setCssProps({ display: "none" });
    input.addEventListener("change", () => {
      const file = input.files?.[0];
      if (!file) return;
      this.restoreFromFileBytes(file).catch((error: Error) => {
        this.logger.debug("Restore from file failed", error);
        new Notice(
          I18n.format(I18n.t.notices.restoreFailed, { message: error.message }),
          8000
        );
      });
    });
    activeDocument.body.appendChild(input);
    input.click();
    // Detach after the picker fires; some browsers leak the element otherwise.
    window.setTimeout(() => input.remove(), 60_000);
  }

  private async restoreFromFileBytes(file: File): Promise<void> {
    if (!this.db) throw new Error("Database not available");
    const progressNotice = new Notice(
      I18n.format(I18n.t.notices.restoringFromFile, { filename: file.name }),
      0
    );
    try {
      const buffer = await file.arrayBuffer();
      await this.backupService.restoreFromFile(
        buffer,
        this.db,
        (current, total) => {
          const progress = Math.round((current / total) * 100);
          progressNotice.setMessage(
            I18n.format(I18n.t.notices.restoringFromFileProgress, {
              filename: file.name,
              progress,
            })
          );
        }
      );
      progressNotice.hide();
      const decksView = this.plugin.getDecksView();
      if (decksView) {
        await decksView.refresh({ skipSync: true });
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
        new Notice(I18n.t.notices.dropdownNotFound, 3000);
        return;
      }

      // Clear existing options by removing all children
      while (dropdown.selectEl.firstChild) {
        dropdown.selectEl.removeChild(dropdown.selectEl.firstChild);
      }

      // Add default option
      const defaultOption = dropdown.selectEl.createEl("option");
      defaultOption.value = "";
      defaultOption.textContent = I18n.t.settings.backup.selectBackupOption;

      if (backups.length === 0) {
        const noBackupsOption = dropdown.selectEl.createEl("option");
        noBackupsOption.value = "";
        noBackupsOption.textContent = I18n.t.settings.backup.noBackupsOption;
        dropdown.setDisabled(true);
        new Notice(I18n.t.notices.noBackupsFound, 3000);
      } else {
        dropdown.setDisabled(false);
        for (const backup of backups) {
          const option = dropdown.selectEl.createEl("option");
          option.value = backup.filename;
          option.textContent = `${backup.timestamp.toLocaleString()}`;
        }
        new Notice(
          I18n.format(I18n.t.notices.backupsFound, { count: backups.length }),
          3000
        );
      }
    } catch (error) {
      this.logger.debug("Failed to load backup list:", error);
      new Notice(
        I18n.format(I18n.t.notices.backupListFailed, {
          message: (error as Error).message,
        }),
        5000
      );
    }
  }

  private async restoreBackup(filename: string): Promise<void> {
    const progressNotice = new Notice(I18n.t.notices.restoringBackup, 0);

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
            I18n.format(I18n.t.notices.restoreProgress, {
              progress,
              current,
              total,
            })
          );
        }
      );

      progressNotice.hide();

      const decksView = this.plugin.getDecksView();
      if (decksView) {
        await decksView.refresh({ skipSync: true });
      }
    } catch (error) {
      progressNotice.hide();
      this.logger.debug("Backup restoration failed:", error);
      new Notice(
        I18n.format(I18n.t.notices.backupRestoreFailed, {
          message: (error as Error).message,
        }),
        8000
      );
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

    contentEl.createEl("h2", { text: I18n.t.modals.purgeDatabase.title });

    const warning = contentEl.createEl("div", {
      cls: "setting-item-description",
    });

    const p1 = warning.createEl("p");
    p1.createEl("strong", {
      text: I18n.t.modals.purgeDatabase.warningStrong,
    });

    const ul = warning.createEl("ul");
    ul.createEl("li", { text: I18n.t.modals.purgeDatabase.listFlashcards });
    ul.createEl("li", { text: I18n.t.modals.purgeDatabase.listReviews });
    ul.createEl("li", { text: I18n.t.modals.purgeDatabase.listDecks });
    ul.createEl("li", { text: I18n.t.modals.purgeDatabase.listStatistics });

    const p2 = warning.createEl("p");
    p2.createEl("strong", { text: I18n.t.modals.purgeDatabase.cannotUndo });

    warning.createEl("p", {
      text: I18n.t.modals.purgeDatabase.rebuildNote,
    });

    contentEl.createEl("p", {
      text: I18n.t.modals.purgeDatabase.confirmPrompt,
      cls: "setting-item-description",
    });

    const input = contentEl.createEl("input", {
      type: "text",
      placeholder: I18n.t.modals.purgeDatabase.confirmPlaceholder,
      cls: "decks-dialog-width decks-dialog-margin-bottom",
    });

    const buttonContainer = contentEl.createEl("div", {
      cls: "decks-flex-container decks-flex-gap decks-flex-justify-end",
    });

    const cancelButton = buttonContainer.createEl("button", {
      text: I18n.t.modals.purgeDatabase.cancel,
    });
    cancelButton.onclick = () => this.close();

    const confirmButton = buttonContainer.createEl("button", {
      text: I18n.t.modals.purgeDatabase.purgeButton,
      cls: "mod-warning",
    });

    confirmButton.onclick = async () => {
      if (input.value === I18n.t.modals.purgeDatabase.confirmPlaceholder) {
        try {
          this.close();

          // Show progress notice
          const notice = new Notice(I18n.t.notices.purgingDatabase, 0);

          // Purge the database
          await this.purgeDatabase();

          // Trigger a full sync to rebuild from vault
          await this.performSync(true);

          // Update the notice
          notice.setMessage(I18n.t.notices.databasePurged);
          window.setTimeout(() => notice.hide(), 3000);

          // Refresh the view
          await this.refreshViewStats();
        } catch (error) {
          this.logger.debug("Failed to purge database:", error);
          new Notice(I18n.t.notices.purgeFailed, 5000);
        }
      } else {
        new Notice(I18n.t.notices.purgeConfirmMismatch, 3000);
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
