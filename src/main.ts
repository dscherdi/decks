import {
  Plugin,
  TFile,
  WorkspaceLeaf,
  Notice,
  TAbstractFile,
  getAllTags,
  getLanguage,
} from "obsidian";

import {
  DatabaseFactory,
  type IDatabaseService,
} from "./database/DatabaseFactory";
import { DeckManager } from "./services/DeckManager";
import { DeckSynchronizer } from "./services/DeckSynchronizer";
import { CanvasFileEventHandlers } from "./services/CanvasFileEventHandlers";
import { Scheduler } from "./services/Scheduler";
import { DeviceLocalState } from "./services/DeviceLocalState";
import { SyncLog } from "./services/SyncLog";
import {
  resolveDbPath,
  resolveBackupFolder,
  resolveSyncLogFolder,
} from "./utils/paths";
import { BackupService } from "./services/BackupService";
import { StatisticsService } from "./services/StatisticsService";
import { FlashcardWriter, type FlashcardEdits } from "./services/FlashcardWriter";
import { FlashcardEditModalWrapper } from "./components/FlashcardEditModalWrapper";
import { AiRefactoringService, type RefactorFieldSet } from "@decks/core";
import { AiKeyStore } from "./services/AiKeyStore";
import { ObsidianHttpClient } from "./services/ObsidianHttpClient";
import {
  AiRefactorController,
  cardToRefactorFieldSet,
  fieldSetToEdits,
} from "./services/AiRefactorController";
import { AiBatchRefactorModalWrapper } from "./components/AiBatchRefactorModalWrapper";
import type { Flashcard } from "./database/types";
import { yieldToUI } from "./utils/ui";
import { Logger, formatTime } from "./utils/logging";
import { ProgressTracker } from "./utils/progress";
import { generateDeckId } from "./utils/hash";

import { type DecksSettings, DEFAULT_SETTINGS } from "./settings";
import { DecksSettingTab } from "./components/settings/SettingsTab";
import { I18n } from "@decks/core";

import { DecksView } from "./components/DecksView";
import { DecksViewModal } from "./components/DecksViewModal";
import { ReleaseNotesModal } from "./components/ReleaseNotesModal";
import {
  FlashcardManagerView,
  VIEW_TYPE_FLASHCARD_MANAGER,
  openFlashcardManager,
} from "./components/FlashcardManagerView";
import { TestDeckService } from "./services/TestDeckService";
import { CustomDeckService } from "./services/CustomDeckService";
import {
  FlashcardReviewView,
  VIEW_TYPE_FLASHCARD_REVIEW,
} from "./components/review/FlashcardReviewView";

export const VIEW_TYPE_DECKS = "decks-view";
export { VIEW_TYPE_FLASHCARD_REVIEW, VIEW_TYPE_FLASHCARD_MANAGER };

/**
 * Deep merge utility that ignores null and undefined values
 * This prevents null values in loaded data from overriding valid defaults
 */
function deepMergeIgnoreNull<T extends Record<string, unknown>>(
  target: T,
  source: Record<string, unknown>
): T {
  if (source === null || source === undefined) {
    return target;
  }

  if (typeof target !== "object" || typeof source !== "object") {
    return source as T;
  }

  const result = { ...target } as Record<string, unknown>;

  for (const key in source) {
    if (Object.prototype.hasOwnProperty.call(source, key)) {
      const sourceValue = source[key];

      if (sourceValue === null || sourceValue === undefined) {
        // Keep the target value, don't override with null/undefined
        continue;
      }

      if (
        typeof sourceValue === "object" &&
        sourceValue !== null &&
        !Array.isArray(sourceValue) &&
        typeof result[key] === "object" &&
        result[key] !== null &&
        !Array.isArray(result[key])
      ) {
        // Recursively merge objects
        result[key] = deepMergeIgnoreNull(
          result[key] as Record<string, unknown>,
          sourceValue as Record<string, unknown>
        );
      } else {
        result[key] = sourceValue;
      }
    }
  }

  return result as T;
}

export default class DecksPlugin extends Plugin {
  private db: IDatabaseService;
  public deckManager: DeckManager;
  private deckSynchronizer: DeckSynchronizer;
  private canvasFileEvents: CanvasFileEventHandlers;
  private scheduler: Scheduler;
  private backupService: BackupService;
  private statisticsService: StatisticsService;
  private customDeckService: CustomDeckService;
  private flashcardWriter: FlashcardWriter;
  public aiKeyStore: AiKeyStore;
  public aiRefactorController: AiRefactorController;
  public settings: DecksSettings;
  private logger: Logger;
  private progressTracker: ProgressTracker;
  private lastKnownDatabaseMtime = 0;
  private lastReloadFromDiskAt = 0;
  private reloadFromDiskInFlight = false;
  private deviceLocalState: DeviceLocalState;
  private syncLog: SyncLog;
  private snapshotTimer: number | null = null;

  // Coalesce rapid-fire vault `modify` events (Obsidian autosaves every ~1-2s
  // during typing) into one trailing-edge sync per deck after the user pauses.
  private pendingDeckSyncs = new Map<string, ReturnType<typeof setTimeout>>();
  private static readonly FILE_MODIFY_DEBOUNCE_MS = 3000;

  async onload() {
    // Load settings first
    await this.loadSettings();

    // Resolve the active UI language before any view, command, or notice is registered.
    // Pass Obsidian's UI language into core's platform-agnostic resolver.
    I18n.init(this.settings, getLanguage());

    // Initialize utilities
    const pluginFolderName = this.manifest.dir?.split('/').pop() || this.manifest.id;
    this.logger = new Logger(
      this.settings,
      this.app.vault.adapter,
      this.app.vault.configDir,
      pluginFolderName
    );
    this.progressTracker = new ProgressTracker(this.settings);

    this.logger.debug("Loading Decks plugin");

    try {
      // Ensure plugin directory exists
      const adapter = this.app.vault.adapter;
      const pluginDir = this.manifest.dir || `${this.app.vault.configDir}/plugins/${this.manifest.id}`;
      if (!(await adapter.exists(pluginDir))) {
        await adapter.mkdir(pluginDir);
      }

      // Resolved paths (user-configurable in Settings → File locations).
      // Empty/unset values fall back to the legacy plugin-folder defaults
      // so existing installs are unaffected. Changes to dbFolder and
      // syncLogFolder require a restart; backupFolder is read on demand.
      const pathCtx = {
        manifestDir: this.manifest.dir,
        manifestId: this.manifest.id,
        vaultConfigDir: this.app.vault.configDir,
      };
      const databasePath = resolveDbPath(this.settings.paths, pathCtx);
      const backupDir = resolveBackupFolder(this.settings.paths, pathCtx);
      const syncLogFolder = resolveSyncLogFolder(this.settings.paths);

      // Ensure parent dirs for the resolved paths exist.
      const dbParent = databasePath.substring(0, databasePath.lastIndexOf("/"));
      if (dbParent && !(await adapter.exists(dbParent))) {
        await adapter.mkdir(dbParent);
      }

      this.db = await DatabaseFactory.create(
        databasePath,
        adapter,
        this.logger.debug.bind(this),
        {
          configDir: this.app.vault.configDir,
        }
      );

      if (this.db.migrationNotice) {
        new Notice(this.db.migrationNotice, 15000);
      }

      // One-time migration of legacy settings-based trained weights into the DB.
      await this.migrateLegacyTrainedWeights();

      // Initialize deck manager with optimized main-thread approach
      this.deckManager = new DeckManager(
        this.app.vault,
        this.app.metadataCache,
        this.db,
        {
          settings: this.settings,
          configDir: this.app.vault.configDir,
        },
        this.settings.parsing.folderSearchPath
      );

      // Initialize deck synchronizer
      this.deckSynchronizer = new DeckSynchronizer(
        this.db,
        this.deckManager,
        this.settings,
        this.app.vault.adapter,
        this.app.vault.configDir
      );

      // Canvas file events route through their own handler module — the
      // markdown-tag-based handlers don't apply to .canvas files (no
      // frontmatter, folder-scope instead of tag-scope).
      this.canvasFileEvents = new CanvasFileEventHandlers({
        settings: this.settings,
        db: this.db,
        deckSynchronizer: this.deckSynchronizer,
        logger: this.logger,
        scheduleDeckSync: (deckId: string) => this.scheduleDeckSync(deckId),
        refreshStats: async () => {
          await this.getDecksView()?.refreshStats();
        },
      });

      // Initialize backup service with the resolved backup folder.
      this.backupService = new BackupService(
        this.app.vault.adapter,
        backupDir,
        this.logger.debug.bind(this.logger)
      );

      // Initialize statistics service
      this.statisticsService = new StatisticsService(this.db, this.settings);

      // Initialize custom deck service
      this.customDeckService = new CustomDeckService(this.db);
      this.flashcardWriter = new FlashcardWriter(this.app);

      // AI refactoring. API keys live in a non-synced file under the plugin
      // dir (AiKeyStore) — never in data.json. HTTP goes through Obsidian's
      // requestUrl (ObsidianHttpClient) to bypass CORS.
      this.aiKeyStore = new AiKeyStore(adapter, pluginDir);
      this.aiRefactorController = new AiRefactorController(
        new AiRefactoringService(new ObsidianHttpClient(), this.logger),
        this.db,
        this.settings,
        this.aiKeyStore,
      );

      // Apply current filter compile thresholds (leech / dense) to db + service
      this.applyFilterCompileOptions();

      // Per-device sync state (deviceId, seq counter, HLC clock). Backed by
      // window.localStorage so it never propagates cross-device via data.json.
      this.deviceLocalState = new DeviceLocalState();

      // Append-only sync log. One file per device under syncLogFolder
      // (vault root by default), named <deviceId>.deckssynclog. Hidden
      // from Obsidian's file explorer by the custom extension but sync'd
      // by iCloud / Obsidian Sync as a small text file (much faster than
      // the binary decks.db).
      this.syncLog = new SyncLog(
        this.app.vault.adapter,
        this.deviceLocalState,
        this.logger,
        this.db,
        syncLogFolder
      );
      // After both exist, attach the log so every CRUD method on the DB
      // automatically emits the matching sync op (profile, tag mapping,
      // custom deck, session ops). Without this, only Scheduler.rate emits.
      this.db.setSyncLog(this.syncLog);

      // Initialize scheduler
      this.scheduler = new Scheduler(
        this.db,
        this.settings,
        this.backupService,
        this.logger
      );
      this.scheduler.setSyncLog(this.syncLog);

      // Register the side panel view
      this.registerView(
        VIEW_TYPE_DECKS,
        (leaf) =>
          new DecksView(
            leaf,
            this.db,
            this.deckSynchronizer,
            this.deckManager,
            this.scheduler,
            this.statisticsService,
            this.customDeckService,
            this.settings,
            this.progressTracker,
            this.logger,
            () => this.saveSettings(),
            (card) => this.openEditFlashcardModal(card),
            (cards) => this.openBatchRefactorModal(cards),
          )
      );

      // Register the review tab view
      this.registerView(
        VIEW_TYPE_FLASHCARD_REVIEW,
        (leaf) =>
          new FlashcardReviewView(
            leaf,
            this.scheduler,
            this.settings,
            this.db
          )
      );

      // Register the flashcard manager tab view
      this.registerView(
        VIEW_TYPE_FLASHCARD_MANAGER,
        (leaf) =>
          new FlashcardManagerView(
            leaf,
            this.db,
            this.customDeckService,
            this.settings,
          ),
      );

      // Add ribbon icon
      this.addRibbonIcon("brain", I18n.t.ribbon.decks, () => {
        new DecksViewModal(
          this.app,
          this.db,
          this.deckSynchronizer,
          this.deckManager,
          this.scheduler,
          this.statisticsService,
          this.customDeckService,
          this.settings,
          this.logger,
          () => this.getDecksView(),
          () => this.saveSettings(),
          (card) => this.openEditFlashcardModal(card),
          (cards) => this.openBatchRefactorModal(cards),
        ).open();
      });

      // Add command to show flashcards panel
      this.addCommand({
        id: "show-flashcards-panel",
        name: I18n.t.commands.showPanel,
        callback: () => {
          void this.activateView();
        },
      });

      // Add command to show release notes
      this.addCommand({
        id: "show-release-notes",
        name: I18n.t.commands.showReleaseNotes,
        callback: () => {
          new ReleaseNotesModal(this.app).open();
        },
      });

      // Add command to open flashcard manager
      this.addCommand({
        id: "open-flashcard-manager",
        name: I18n.t.commands.openManager,
        callback: () => {
          openFlashcardManager(
            this.app,
            this.db,
            this.customDeckService,
            this.settings,
            undefined,
            async () => {
              await this.getDecksView()?.refresh();
            },
            async () => {
              await this.deckManager.cleanupOrphanedDecks();
            },
            (widths) => {
              this.settings.ui.managerColumnWidths = widths;
              void this.saveSettings();
            },
            (card) => this.openEditFlashcardModal(card),
            (cards) => this.openBatchRefactorModal(cards),
          );
        },
      });

      // Test deck: create on fresh install, also available as a command
      const testDeckService = new TestDeckService(this.app);

      if (!this.settings.hasCreatedTestDeck) {
        this.settings.hasCreatedTestDeck = true;
        await this.saveSettings();
        this.app.workspace.onLayoutReady(() => {
          testDeckService
            .createTestDeck(
              this.settings.parsing.deckTag,
              this.settings.parsing.folderSearchPath
            )
            .catch(console.error);
        });
      }

      this.addCommand({
        id: "create-test-deck",
        name: I18n.t.commands.createTestDeck,
        callback: () => {
          testDeckService
            .createTestDeck(
              this.settings.parsing.deckTag,
              this.settings.parsing.folderSearchPath
            )
            .catch(console.error);
        },
      });

      // Canvas test deck: create on fresh install / first upgrade to a build
      // that has canvas decks, also available as a command. Auto-points the
      // canvas-decks setting at the resolved folder if it was empty.
      const setCanvasFolderIfEmpty = async (folder: string | null) => {
        if (!folder) return;
        if (this.settings.canvasDecks.folderPath.trim() !== "") return;
        this.settings.canvasDecks.folderPath = folder;
        await this.saveSettings();
      };

      if (!this.settings.hasCreatedCanvasTestDeck) {
        this.settings.hasCreatedCanvasTestDeck = true;
        await this.saveSettings();
        this.app.workspace.onLayoutReady(() => {
          testDeckService
            .createTestCanvasDeck(
              this.settings.canvasDecks.tagName,
              this.settings.canvasDecks.folderPath
            )
            .then(setCanvasFolderIfEmpty)
            .catch(console.error);
        });
      }

      this.addCommand({
        id: "create-canvas-test-deck",
        name: I18n.t.commands.createCanvasTestDeck,
        callback: () => {
          testDeckService
            .createTestCanvasDeck(
              this.settings.canvasDecks.tagName,
              this.settings.canvasDecks.folderPath
            )
            .then(setCanvasFolderIfEmpty)
            .catch(console.error);
        },
      });

      // Force a full resync (bypasses the mtime gate). Defensive lever for
      // the rare "I think the index is wrong" case — normally the gate
      // handles incremental sync correctly and this is unnecessary.
      this.addCommand({
        id: "force-full-resync",
        name: I18n.t.commands.fullResync,
        callback: () => {
          new Notice(I18n.t.notices.reparsing);
          this.deckSynchronizer
            .sync({ force: true })
            .then(() => {
              new Notice(I18n.t.notices.resyncComplete);
              void this.getDecksView()?.refresh();
            })
            .catch((error) => {
              this.logger.error("Force resync failed", error);
              new Notice(I18n.t.notices.resyncFailed);
            });
        },
      });

      // Add command to open decks modal
      this.addCommand({
        id: "open-review-modal",
        name: I18n.t.commands.openReview,
        callback: () => {
          new DecksViewModal(
            this.app,
            this.db,
            this.deckSynchronizer,
            this.deckManager,
            this.scheduler,
            this.statisticsService,
            this.customDeckService,
            this.settings,
            this.logger,
            () => this.getDecksView(),
            () => this.saveSettings(),
            (card) => this.openEditFlashcardModal(card),
            (cards) => this.openBatchRefactorModal(cards),
          ).open();
        },
      });

      // Reload from disk on window/leaf focus so the user sees other-device
      // changes that iCloud (or Obsidian Sync, Dropbox, ...) just delivered.
      // syncWithDisk() merges remote into in-memory only — it does NOT write
      // back, which avoids the iCloud feedback loop where every read triggers
      // another upload.
      this.registerDomEvent(window, "focus", () => {
        void this.reloadFromDiskIfNewer();
      });
      this.registerEvent(
        this.app.workspace.on("active-leaf-change", (leaf) => {
          if (leaf?.view.getViewType() === VIEW_TYPE_DECKS) {
            void this.reloadFromDiskIfNewer();
          }
        })
      );

      // Flush any buffered sync-log ops to disk + persist the in-memory DB
      // snapshot before the window loses focus or the app backgrounds.
      // Covers desktop alt-tab and mobile app-suspend. Without this, ops
      // written in the last 2s before backgrounding would stay in memory
      // and never make it to iCloud.
      this.registerDomEvent(window, "blur", () => {
        void this.flushAndSnapshotIfDirty();
      });
      this.registerDomEvent(window, "pagehide", () => {
        void this.flushAndSnapshotIfDirty();
      });

      // Periodic snapshot timer. The decks.db binary is now persisted only
      // when dirty AND the timer fires — instead of after every local op.
      // This keeps iCloud's "stability heuristic" from constantly resetting
      // (binary blob keeps changing) so the BIG file uploads cleanly during
      // idle periods while the small .deckssynclog files carry the hot path.
      this.snapshotTimer = window.setInterval(() => {
        if (this.db?.isDirty()) {
          void this.db.save().catch((error) => {
            this.logger.debug("periodic snapshot save failed", error as object);
          });
        }
      }, 30 * 60 * 1000);
      this.register(() => {
        if (this.snapshotTimer !== null) {
          window.clearInterval(this.snapshotTimer);
          this.snapshotTimer = null;
        }
      });

      // Compact our own sync log on plugin load so the file doesn't grow
      // unbounded across years of use. Best-effort; failures here are
      // harmless (we just keep the longer file until the next attempt).
      void this.syncLog
        .compact()
        .catch((error) => this.logger.debug("startup compact failed", error as object));

      // Listen for file changes to update decks. Both .md (tag-scoped) and
      // .canvas (folder-scoped) files reach the handlers, which branch by
      // extension and dispatch to the right pipeline.
      this.registerEvent(
        this.app.vault.on("modify", async (file) => {
          if (file instanceof TFile && (file.extension === "md" || file.extension === "canvas")) {
            await this.handleFileChange(file);
          }
        })
      );

      this.registerEvent(
        this.app.vault.on("delete", async (file) => {
          if (file instanceof TFile && (file.extension === "md" || file.extension === "canvas")) {
            await this.handleFileDelete(file);
          }
        })
      );

      this.registerEvent(
        this.app.vault.on("rename", async (file, oldPath) => {
          if (file instanceof TFile && (file.extension === "md" || file.extension === "canvas")) {
            await this.handleFileRename(file, oldPath);
          }
        })
      );

      // New tagged files should appear in the deck list immediately,
      // without waiting for the next manual refresh. For markdown we can't
      // always read the tag synchronously on "create" (Obsidian populates
      // metadataCache a beat later), so the handler defers via
      // metadataCache's own "changed" event the FIRST time it fires for the
      // file. Canvas files have no metadata to wait for — handled inline.
      this.registerEvent(
        this.app.vault.on("create", async (file) => {
          if (file instanceof TFile && (file.extension === "md" || file.extension === "canvas")) {
            await this.handleFileCreate(file);
          }
        })
      );

      // Register markdown post-processor for cloze deletion rendering
      this.registerMarkdownPostProcessor((el) => {
        const container = el.closest("[data-decks-cloze-index]");
        if (!container) return;

        const activeIndexStr = container.getAttribute("data-decks-cloze-index");
        if (activeIndexStr === null) return;
        const activeIndex = parseInt(activeIndexStr, 10);
        const activeEndStr = container.getAttribute("data-decks-cloze-index-end");
        const activeEnd = activeEndStr !== null ? parseInt(activeEndStr, 10) : activeIndex + 1;
        const mode = container.getAttribute("data-decks-cloze-mode") || "open";
        const revealed = container.getAttribute("data-decks-cloze-revealed") === "true";

        let markCount = parseInt(container.getAttribute("data-decks-cloze-counter") || "0", 10);
        const marks = el.querySelectorAll("mark");

        marks.forEach((mark) => {
          const text = mark.textContent || "";
          const currentIndex = markCount;
          markCount++;
          const span = document.createElement("span");

          if (currentIndex >= activeIndex && currentIndex < activeEnd) {
            if (revealed) {
              span.className = "decks-cloze-revealed";
              span.textContent = text;
            } else {
              span.className = "decks-cloze-active";
              span.textContent = "[...]";
              span.setAttribute("data-decks-cloze-text", text);
            }
          } else if (mode === "hidden") {
            span.className = "decks-cloze-blank";
            span.textContent = "[...]";
          } else {
            span.className = "decks-cloze-context";
            span.textContent = text;
          }

          mark.replaceWith(span);
        });

        container.setAttribute("data-decks-cloze-counter", String(markCount));
      });

      // Add settings tab
      this.addSettingTab(
        new DecksSettingTab(
          this.app,
          this,
          this.settings,
          this.db,
          this.saveSettings.bind(this),
          this.logger,
          () => this.getDecksView()?.refresh() || Promise.resolve(),
          async () => {
            await this.getDecksView()?.refreshStats();
          },
          () => {
            this.getDecksView()?.restartBackgroundRefresh();
          },
          () => {
            this.getDecksView()?.startBackgroundRefresh();
          },
          () => {
            this.getDecksView()?.stopBackgroundRefresh();
          },
          this.db.purgeDatabase.bind(this.db),
          this.backupService
        )
      );

      // Setup database file watcher
      this.setupDatabaseWatcher();

      this.logger.debug("Decks plugin loaded successfully");
    } catch (error) {
      console.error("Error loading Decks plugin:", error);
      if (this.settings?.ui?.enableNotices !== false) {
        new Notice(I18n.t.notices.loadFailed);
      }
    }
  }

  onunload() {
    this.logger.debug("Unloading Decks plugin");

    // Drain any buffered sync-log ops + persist the DB snapshot before
    // tearing down. Plugin disable / reload would otherwise lose the last
    // <2s of ops and any in-memory mutations not yet snapshotted.
    void this.flushAndSnapshotIfDirty();

    // Close database connection using factory singleton
    void DatabaseFactory.close();
  }

  async loadSettings() {
    const loadedData = await this.loadData();
    this.settings = deepMergeIgnoreNull(
      DEFAULT_SETTINGS as unknown as Record<string, unknown>,
      (loadedData || {}) as Record<string, unknown>
    ) as unknown as DecksSettings;

    // Migration: existing users upgrading from before deckTag was configurable
    // should keep #flashcards, not get the new default #decks
    if (loadedData && typeof loadedData === "object") {
      const rawParsing = (loadedData as Record<string, unknown>).parsing;
      if (
        !rawParsing ||
        typeof rawParsing !== "object" ||
        !Object.prototype.hasOwnProperty.call(
          rawParsing,
          "deckTag"
        )
      ) {
        this.settings.parsing.deckTag = "#flashcards";
      }
    }
  }

  /**
   * Trained FSRS weights used to live in settings (`settings.fsrs`). They now live in the
   * `fsrs_weight_sets` DB table. On first run after upgrade, import any legacy weights as the
   * initial (active) weight set, then drop the stale settings block.
   */
  private async migrateLegacyTrainedWeights(): Promise<void> {
    const legacy = (
      this.settings as unknown as {
        fsrs?: {
          trainedWeights?: number[] | null;
          lastTrainedAt?: string | null;
          lastTrainedReviewCount?: number | null;
          lastBeforeLogLoss?: number | null;
          lastAfterLogLoss?: number | null;
        };
      }
    ).fsrs;
    if (!legacy) return;

    if (Array.isArray(legacy.trainedWeights) && legacy.trainedWeights.length > 0) {
      const existing = await this.db.getAllTrainedWeightSets();
      if (existing.length === 0) {
        await this.db.saveTrainedWeightSet({
          weights: legacy.trainedWeights,
          trainedAt: legacy.lastTrainedAt ?? new Date().toISOString(),
          reviewsTrained: legacy.lastTrainedReviewCount ?? 0,
          cardsTrained: 0,
          beforeLogLoss: legacy.lastBeforeLogLoss ?? null,
          afterLogLoss: legacy.lastAfterLogLoss ?? null,
          steps: 0,
          durationMs: 0,
          weightsVersion: "fsrs-6",
        });
      }
    }

    delete (this.settings as unknown as Record<string, unknown>).fsrs;
    await this.saveSettings();
  }

  async saveSettings() {
    await this.saveData(this.settings);
    // FSRS instances are now deck-specific, no global instance to update

    // Update DeckManager folder search path if it exists
    if (this.deckManager) {
      this.deckManager.updateFolderSearchPath(
        this.settings.parsing.folderSearchPath
      );
    }

    // Refresh filter compile thresholds in case leech/dense settings changed
    this.applyFilterCompileOptions();
  }

  private applyFilterCompileOptions(): void {
    const options = {
      leechThreshold: this.settings.review.leechThreshold,
      denseCardCharThreshold: this.settings.review.denseCardCharThreshold,
    };
    this.db?.setFilterCompileOptions(options);
    this.customDeckService?.setFilterCompileOptions(options);
  }

  async activateView() {
    const { workspace } = this.app;

    let leaf: WorkspaceLeaf | null = null;
    const leaves = workspace.getLeavesOfType(VIEW_TYPE_DECKS);

    if (leaves.length > 0) {
      // View already open
      leaf = leaves[0];
    } else {
      // Open in right sidebar
      leaf = workspace.getRightLeaf(false);
      if (leaf) {
        await leaf.setViewState({
          type: VIEW_TYPE_DECKS,
          active: true,
        });
      }
    }

    if (leaf) {
      await workspace.revealLeaf(leaf);
    }
  }

  /**
   * Push a new backup folder setting through to the BackupService. Called
   * from the settings tab onChange so the "Available backups" dropdown
   * starts listing from the new location immediately, without restart.
   */
  refreshBackupFolder(_rawFolder: string): void {
    const resolved = resolveBackupFolder(this.settings.paths, {
      manifestDir: this.manifest.dir,
      manifestId: this.manifest.id,
      vaultConfigDir: this.app.vault.configDir,
    });
    this.backupService.setBackupDir(resolved);
  }

  /**
   * Pull other-device changes from disk into in-memory DB. Triggered by
   * window/leaf focus events. Throttled to 2s to dampen rapid-fire focus
   * bursts (alt-tab, modal open/close). Single-flight so concurrent firings
   * collapse into one merge. Never writes back to disk — that would create
   * an iCloud feedback loop where every read triggers another upload.
   *
   * Two-step sync on focus:
   *   1. SQL merge from disk DB (slow, captures the legacy fallback path)
   *   2. SyncLog.applyPending() — replays new ops from other devices' logs
   *      since the last applied seq. This is the fast path: small text
   *      files iCloud delivers in seconds.
   */
  /**
   * Drain any buffered sync-log ops to disk and, if the in-memory DB has
   * unsaved mutations, persist the snapshot too. Called on window blur,
   * pagehide (mobile background), and onunload. Best-effort: failures are
   * logged but don't surface to the user — the next focus reload or
   * periodic timer will retry.
   */
  private async flushAndSnapshotIfDirty(): Promise<void> {
    // Drain any debounced deck syncs first so their DB writes are included
    // in the snapshot below.
    try {
      await this.flushPendingDeckSyncs();
    } catch (error) {
      this.logger.debug("flushPendingDeckSyncs failed on blur/pagehide", error as object);
    }
    try {
      await this.syncLog?.flushNow();
    } catch (error) {
      this.logger.debug("flushNow failed on blur/pagehide", error as object);
    }
    if (this.db?.isDirty()) {
      try {
        await this.db.save();
      } catch (error) {
        this.logger.debug("save failed on blur/pagehide", error as object);
      }
    }
  }

  private async reloadFromDiskIfNewer(): Promise<void> {
    if (!this.db) return;
    if (this.reloadFromDiskInFlight) return;
    const now = Date.now();
    if (now - this.lastReloadFromDiskAt < 2000) return;
    this.lastReloadFromDiskAt = now;
    this.reloadFromDiskInFlight = true;
    try {
      await this.db.syncWithDisk();
      await this.syncLog?.applyPending();
      await this.getDecksView()?.refresh();
    } catch (error) {
      this.logger.debug("reloadFromDiskIfNewer failed", error as object);
    } finally {
      this.reloadFromDiskInFlight = false;
    }
  }

  /**
   * Open the edit modal for a single flashcard. Resolves after the user
   * cancels or saves; on save, writes to the markdown file and re-syncs
   * the affected deck before resolving.
   */
  async openEditFlashcardModal(card: Flashcard): Promise<void> {
    return new Promise((resolve) => {
      let resolved = false;
      const settle = () => {
        if (resolved) return;
        resolved = true;
        resolve();
      };
      const wrapper = new FlashcardEditModalWrapper(
        this.app,
        card,
        async (edits: FlashcardEdits) => {
          const result = await this.flashcardWriter.editFlashcard(card, edits);
          if (result.ok) {
            const file = this.app.vault.getAbstractFileByPath(card.sourceFile);
            if (file instanceof TFile) {
              await this.handleFileChange(file);
            }
            new Notice("Card updated");
          }
          return result;
        },
        settle,
        {
          aiEnabled: this.aiRefactorController.isEnabled(),
          onRefactor: (current, options, signal) =>
            this.aiRefactorController.refactorCard(
              card,
              current,
              {
                instructions: options.instructions,
                targetKeys: options.targetKeys,
                sourceContext: options.sourceContext,
                images: options.images,
              },
              signal,
            ),
        },
      );
      wrapper.open();
    });
  }

  async openBatchRefactorModal(cards: Flashcard[]): Promise<void> {
    return new Promise((resolve) => {
      const wrapper = new AiBatchRefactorModalWrapper(
        this.app,
        {
          cards,
          run: (card) =>
            this.aiRefactorController.refactorCard(
              card,
              cardToRefactorFieldSet(card),
            ),
          apply: async (card, accepted) => {
            const merged = {
              ...(cardToRefactorFieldSet(card) as Record<string, unknown>),
            };
            for (const p of accepted) merged[p.key] = p.after;
            const edits = fieldSetToEdits(merged as unknown as RefactorFieldSet);
            const result = await this.flashcardWriter.editFlashcard(card, edits);
            if (result.ok) {
              const file = this.app.vault.getAbstractFileByPath(card.sourceFile);
              if (file instanceof TFile) {
                await this.handleFileChange(file);
              }
              return { ok: true };
            }
            return { ok: false, error: result.failure.message };
          },
        },
        () => resolve(),
      );
      wrapper.open();
    });
  }

  async handleFileChange(file: TFile) {
    if (file.extension === "canvas") {
      await this.canvasFileEvents.onModified(file);
      return;
    }
    // Check if file has flashcards tag
    const metadata = this.app.metadataCache.getFileCache(file);
    this.logger.debug(`File changed: ${file.path}, metadata:`, metadata);

    if (!metadata) return;

    // Get all tags using Obsidian's API (includes inline and frontmatter tags)
    const allTags = getAllTags(metadata) || [];

    const baseTag = this.settings.parsing.deckTag;
    const hasFlashcardsTag = allTags.some((tag) =>
      tag.startsWith(baseTag)
    );

    this.logger.debug(
      `File ${file.path} has flashcards tag:`,
      hasFlashcardsTag
    );

    if (hasFlashcardsTag) {
      // Check if deck exists for this file
      const existingDeck = await this.db.getDeckByFilepath(file.path);
      if (existingDeck) {
        // Update deck tag if it changed
        const newTag =
          allTags.find((tag) => tag.startsWith(baseTag)) || baseTag;
        if (existingDeck.tag !== newTag) {
          this.logger.debug(
            `Updating deck tag from ${existingDeck.tag} to ${newTag}`
          );
          await this.db.updateDeck(existingDeck.id, { tag: newTag });
        }

        // Defer the heavy parse/diff/DB-write to a trailing-edge debounce per
        // deck — Obsidian autosaves every ~1-2s during typing, and running the
        // full pipeline on each save is wasted work. The UI refresh runs after
        // the sync inside runDebouncedDeckSync().
        this.scheduleDeckSync(existingDeck.id);
      } else {
        // New file with flashcards tag - create deck for this file only
        const newTag =
          allTags.find((tag) => tag.startsWith(baseTag)) || baseTag;
        await this.deckSynchronizer.createDeckForFile(file.path, newTag);
        await yieldToUI();

        // Get the newly created deck and sync it
        const newDeck = await this.db.getDeckByFilepath(file.path);
        if (newDeck) {
          await this.deckSynchronizer.syncDeck(newDeck.id);
        }

        // For new decks, refresh all stats to show the new deck
        await this.getDecksView()?.refreshStats();
      }
    }
  }

  // Schedule a trailing-edge debounced sync for one deck. Repeated calls
  // for the same deckId within the debounce window collapse into a single
  // sync that runs after the last call goes quiet.
  private scheduleDeckSync(deckId: string): void {
    const existing = this.pendingDeckSyncs.get(deckId);
    if (existing !== undefined) clearTimeout(existing);
    const timer = setTimeout(() => {
      this.pendingDeckSyncs.delete(deckId);
      void this.runDebouncedDeckSync(deckId);
    }, DecksPlugin.FILE_MODIFY_DEBOUNCE_MS);
    this.pendingDeckSyncs.set(deckId, timer);
  }

  private async runDebouncedDeckSync(deckId: string): Promise<void> {
    try {
      await yieldToUI();
      await this.deckSynchronizer.syncDeck(deckId);
      await this.getDecksView()?.refreshStatsById(deckId);
    } catch (error) {
      this.logger.error(`Debounced sync failed for deck ${deckId}`, error);
    }
  }

  // Run any pending debounced deck syncs now. Used on unload so an edit
  // sitting in the debounce window isn't silently dropped on plugin disable.
  private async flushPendingDeckSyncs(): Promise<void> {
    const pending = Array.from(this.pendingDeckSyncs.entries());
    this.pendingDeckSyncs.clear();
    for (const [deckId, timer] of pending) {
      clearTimeout(timer);
      await this.runDebouncedDeckSync(deckId);
    }
  }

  async performInitialSync() {
    try {
      const startTime = performance.now();
      this.logger.debug("Performing initial background sync...");

      // Use requestIdleCallback or setTimeout to ensure non-blocking execution
      await yieldToUI();

      // Delegate to view for domain logic
      await this.getDecksView()?.refresh();

      await yieldToUI();

      const totalTime = performance.now() - startTime;
      this.logger.performance(
        `Initial sync completed successfully in ${formatTime(totalTime)}`
      );
    } catch (error) {
      console.error("Error during initial sync:", error);
      // Don't throw - let the app continue working even if initial sync fails
    }
  }

  async handleFileDelete(file: TFile) {
    if (file.extension === "canvas") {
      await this.canvasFileEvents.onDeleted(file.path);
      return;
    }
    // Remove the deck and all associated flashcards/review logs
    await this.db.deleteDeckByFilepath(file.path);

    // Just refresh stats to remove deleted deck from UI (much faster than full sync)
    await this.getDecksView()?.refreshStats();
  }

  /**
   * Handle a newly-created markdown file. If it carries the configured
   * deck tag, create the deck row and parse the cards. The tag may not be
   * visible synchronously on `create` because Obsidian populates the
   * metadata cache a beat later; defer once via metadataCache "changed"
   * if needed.
   */
  async handleFileCreate(file: TFile): Promise<void> {
    if (file.extension === "canvas") {
      await this.canvasFileEvents.onCreated(file);
      return;
    }
    const baseTag = this.settings.parsing.deckTag;
    const checkAndSync = async (): Promise<boolean> => {
      const metadata = this.app.metadataCache.getFileCache(file);
      if (!metadata) return false;
      const tags = getAllTags(metadata) || [];
      const hasTag = tags.some((t) => t.startsWith(baseTag));
      if (!hasTag) return true; // metadata seen, definitely no tag — stop deferring
      this.logger.debug(`New tagged file detected: ${file.path}`);
      // Full discovery sync creates the deck and parses cards; the mtime
      // gate guarantees only the new file is parsed, not every existing deck.
      try {
        await this.deckSynchronizer.sync();
        await this.getDecksView()?.refresh();
      } catch (error) {
        this.logger.error(`Failed to sync newly-created file ${file.path}`, error);
      }
      return true;
    };

    if (await checkAndSync()) return;

    // Metadata not yet ready — defer until metadataCache fires "changed"
    // for this file. Self-unregistering one-shot listener.
    const ref = this.app.metadataCache.on("changed", (changedFile) => {
      if (changedFile !== file) return;
      this.app.metadataCache.offref(ref);
      void checkAndSync();
    });
    this.registerEvent(ref);
  }

  async handleFileRename(file: TAbstractFile, oldPath: string): Promise<void> {
    if (file instanceof TFile && file.extension === "canvas") {
      await this.canvasFileEvents.onRenamed(file, oldPath);
      return;
    }
    if (file instanceof TFile && file.extension === "md") {
      // Handle deck ID regeneration for renamed files
      const oldDeck = await this.db.getDeckByFilepath(oldPath);
      if (oldDeck) {
        const oldDeckId = oldDeck.id;
        const newDeckId = generateDeckId(file.path);

        this.logger.debug(`File renamed from ${oldPath} to ${file.path}`);
        this.logger.debug(`Updating deck ID from ${oldDeckId} to ${newDeckId}`);

        // Update deck with new ID, name, and filepath
        await this.db.renameDeck(
          oldDeckId,
          newDeckId,
          file.basename,
          file.path
        );

        // Update all flashcard deck IDs
        await this.deckManager.updateFlashcardDeckIds(oldDeckId, newDeckId);

        // Clear the mtime gate for the renamed deck. The file's mtime may
        // not advance on a pure rename (some filesystems preserve it), so
        // without this clear the next refresh would short-circuit and skip
        // re-parsing — fine for a same-content rename, but rename+edit in
        // one swing would lose the edit. Zero forces the next sync to read
        // the file fresh.
        await this.db.setDeckLastSyncedMtime(newDeckId, 0);

        await yieldToUI();

        await this.db.save();
        // Refresh view if available
        await this.getDecksView()?.refreshStats();
      }
    }
  }

  private setupDatabaseWatcher(): void {
    const pluginDir = this.manifest.dir || `${this.app.vault.configDir}/plugins/${this.manifest.id}`;
    const databasePath = `${pluginDir}/flashcards.db`;

    // Initialize lastKnownDatabaseMtime
    void this.updateLastKnownDatabaseMtime(databasePath);

    // Polling every 2 seconds using Obsidian's registerInterval
    this.registerInterval(
      window.setInterval(() => {
        void this.checkForDatabaseChanges(databasePath);
      }, 2000)
    );

    // Watch for window focus events using registerDomEvent
    this.registerDomEvent(window, "focus", () => {
      void this.checkForDatabaseChanges(databasePath);
    });

    this.logger.debug("Database watcher setup complete");
  }

  private async updateLastKnownDatabaseMtime(
    databasePath: string
  ): Promise<void> {
    try {
      if (await this.app.vault.adapter.exists(databasePath)) {
        const stat = await this.app.vault.adapter.stat(databasePath);
        if (stat) {
          this.lastKnownDatabaseMtime = stat.mtime;
        }
      }
    } catch (error) {
      this.logger.debug("Failed to update lastKnownDatabaseMtime:", error);
    }
  }

  getDecksView(): DecksView | null {
    const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_DECKS);
    if (leaves.length > 0) {
      const view = leaves[0].view;
      if (view instanceof DecksView) {
        return view;
      }
    }
    return null;
  }

  private async checkForDatabaseChanges(databasePath: string): Promise<void> {
    try {
      if (!(await this.app.vault.adapter.exists(databasePath))) {
        return;
      }

      const stat = await this.app.vault.adapter.stat(databasePath);
      if (stat && stat.mtime > this.lastKnownDatabaseMtime) {
        this.logger.debug(
          `Database file changed (${stat.mtime} > ${this.lastKnownDatabaseMtime}), triggering sync`
        );

        // Trigger sync with disk
        await this.db.syncWithDisk();

        // Update our known mtime
        this.lastKnownDatabaseMtime = stat.mtime;

        // Refresh the view if available
        await this.getDecksView()?.refreshStats();
      }
    } catch (error) {
      this.logger.debug("Error checking for database changes:", error);
    }
  }
}
