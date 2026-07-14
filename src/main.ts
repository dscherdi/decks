import {
  Plugin,
  TFile,
  WorkspaceLeaf,
  Notice,
  TAbstractFile,
  MarkdownRenderChild,
  MarkdownRenderer,
  MarkdownView,
  getAllTags,
  getLanguage,
  type Editor,
} from "obsidian";
import { renderHtmlIntoShadow } from "./utils/html-template-render";
import { renderOcclusion } from "./utils/occlusion-render";
import { OcclusionStudioModalWrapper } from "./components/OcclusionStudioModalWrapper";
import { FilePickerModal } from "./utils/file-picker";
import { IMAGE_EXTENSIONS } from "./utils/attachments";

import {
  DatabaseFactory,
  type IDatabaseService,
} from "./database/DatabaseFactory";
import { DeckManager } from "./services/DeckManager";
import { TemplateSyncService } from "./services/TemplateSyncService";
import { DeckSynchronizer } from "./services/DeckSynchronizer";
import { AnchorStamper } from "./services/AnchorStamper";
import { AnchorMigrator } from "./services/AnchorMigrator";
import { CanvasFileEventHandlers } from "./services/CanvasFileEventHandlers";
import { Scheduler } from "@decks/core";
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
import { AiGenerationService, AiRefactoringService, type GeneratedCard, generateDeckId, I18n, type RefactorFieldSet, resolveCardTemplate, yieldToUI, OcclusionV2Parser, type OcclusionDoc, OCCLUSION_V2_VERSION, isOcclusionV2, parseOcclusionBack } from "@decks/core";
import { AiKeyStore } from "./services/AiKeyStore";
import { ObsidianHttpClient } from "./services/ObsidianHttpClient";
import {
  AiRefactorController,
  cardToRefactorFieldSet,
  fieldSetToEdits,
} from "./services/AiRefactorController";
import { AiGeneratorController } from "./services/AiGeneratorController";
import { FlashcardComposer } from "./services/FlashcardComposer";
import { AiBatchRefactorModalWrapper } from "./components/AiBatchRefactorModalWrapper";
import {
  AiGeneratorModalWrapper,
  type AiGeneratorOptions,
} from "./components/AiGeneratorModalWrapper";
import {
  AiGeneratorView,
  VIEW_TYPE_AI_GENERATOR,
} from "./components/AiGeneratorView";
import type { GeneratorSaveRequest } from "./components/generator-save";
import type { Flashcard } from "./database/types";
import { Logger, formatTime } from "./utils/logging";
import { ProgressTracker } from "./utils/progress";

import { type DecksSettings, DEFAULT_SETTINGS } from "./settings";
import { DecksSettingTab } from "./components/settings/SettingsTab";

import { DecksView } from "./components/DecksView";
import { DecksViewModal } from "./components/DecksViewModal";
import { ReleaseNotesModal } from "./components/ReleaseNotesModal";
import { SrMigrationController } from "./services/SrMigrationController";
import { SrMigrationModalWrapper } from "./components/migration/SrMigrationModalWrapper";
import { AnkiImportController } from "./services/AnkiImportController";
import { AnkiImportModalWrapper } from "./components/migration/AnkiImportModalWrapper";
import {
  FlashcardManagerView,
  VIEW_TYPE_FLASHCARD_MANAGER,
  openFlashcardManager,
} from "./components/FlashcardManagerView";
import { TestDeckService } from "./services/TestDeckService";
import { CustomDeckService } from "@decks/core";
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
  private templateSyncService: TemplateSyncService;
  private canvasFileEvents: CanvasFileEventHandlers;
  private scheduler: Scheduler;
  private backupService: BackupService;
  private statisticsService: StatisticsService;
  private customDeckService: CustomDeckService;
  private flashcardWriter: FlashcardWriter;
  private flashcardComposer: FlashcardComposer;
  public aiKeyStore: AiKeyStore;
  public aiRefactorController: AiRefactorController;
  public aiGeneratorController: AiGeneratorController;
  public settings: DecksSettings;
  private logger: Logger;
  private progressTracker: ProgressTracker;
  private lastKnownDatabaseMtime = 0;
  private lastReloadFromDiskAt = 0;
  private reloadFromDiskInFlight = false;
  private static readonly RELOAD_FROM_DISK_THROTTLE_MS = 60_000;
  private deviceLocalState: DeviceLocalState;
  private syncLog: SyncLog;
  private snapshotTimer: number | null = null;

  // Coalesce rapid-fire vault `modify` events (Obsidian autosaves every ~1-2s
  // during typing) into one trailing-edge sync per deck after the user pauses.
  private pendingDeckSyncs = new Map<string, number>();
  private static readonly FILE_MODIFY_DEBOUNCE_MS = 3000;

  // Coalesce bursts of `create` events (bulk file creation / import) into a
  // single trailing-edge full sync, instead of one full vault scan per file.
  private pendingFullSync: number | null = null;
  private static readonly FULL_SYNC_DEBOUNCE_MS = 1000;
  // Coalesce per-file UI stat refreshes (e.g. bulk delete) into one repaint.
  private pendingStatsRefresh: number | null = null;
  private static readonly STATS_REFRESH_DEBOUNCE_MS = 300;

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

      // DB init runs in the background (off the onload critical path). Anything
      // that needs the DB ready is sequenced after whenReady() so onload returns
      // fast and Obsidian startup isn't blocked on loading the .db + SQL.js.
      void this.db.whenReady().then(async () => {
        if (this.db.migrationNotice) {
          new Notice(this.db.migrationNotice, 15000);
        }
        // One-time migration of legacy settings-based trained weights into the DB.
        await this.migrateLegacyTrainedWeights();
        // Recover local ops that never reached the lazily-saved binary (e.g. a
        // suspend done right before a hard reload), then catch up other devices,
        // then compact. Order matters: replay BEFORE compact (compact rewrites the
        // own log). Best-effort per step.
        try {
          await this.syncLog.replayOwnLog();
        } catch (error) {
          this.logger.debug("startup replayOwnLog failed", error);
        }
        try {
          await this.syncLog.applyPending();
        } catch (error) {
          this.logger.debug("startup applyPending failed", error);
        }
        try {
          await this.syncLog.compact();
        } catch (error) {
          this.logger.debug("startup compact failed", error);
        }
        // One-time cleanup of orphaned cards left behind by deck deletions that
        // ran without FK cascade enforcement. Keys on the (authoritative) decks
        // table, so it only removes cards whose deck row is genuinely gone;
        // review_logs survive, so a re-synced card restores its FSRS state.
        if (!this.settings.orphanPruneV1Done) {
          try {
            const pruned = await this.db.pruneOrphanedFlashcards();
            this.settings.orphanPruneV1Done = true;
            await this.saveSettings();
            if (pruned > 0) this.logger.debug(`startup orphan prune removed ${pruned} card(s)`);
          } catch (error) {
            this.logger.debug("startup orphan prune failed", error);
          }
        }
        void this.getDecksView()?.refresh();
      }).catch((e) =>
        this.logger.error("Post-init startup work failed", e)
      );

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

      // Template cache sync (folder → deck_templates). Rebuild once on load.
      this.templateSyncService = new TemplateSyncService(
        this.app,
        this.db,
        () => this.settings.templates?.templateFolder ?? "",
        this.logger
      );
      void this.templateSyncService.syncAll();

      // Canvas file events route through their own handler module — the
      // markdown-tag-based handlers don't apply to .canvas files (no
      // frontmatter, folder-scope instead of tag-scope).
      this.canvasFileEvents = new CanvasFileEventHandlers({
        settings: this.settings,
        db: this.db,
        deckSynchronizer: this.deckSynchronizer,
        logger: this.logger,
        scheduleDeckSync: (deckId: string) => this.scheduleDeckSync(deckId),
        scheduleFullSync: () => this.scheduleFullSync(),
        scheduleStatsRefresh: () => this.scheduleStatsRefresh(),
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
        this.settings,
        this.aiKeyStore,
      );
      this.aiGeneratorController = new AiGeneratorController(
        new AiGenerationService(new ObsidianHttpClient(), this.logger),
        this.settings,
        this.aiKeyStore,
      );
      this.flashcardComposer = new FlashcardComposer(this.app);

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
            () => this.openAiGeneratorModal(),
            () => this.openAnkiImportModal(),
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

      // Register the AI generator tab view
      this.registerView(
        VIEW_TYPE_AI_GENERATOR,
        (leaf) => new AiGeneratorView(leaf),
      );

      // Let internal links in reviewed cards use Obsidian's page preview
      // (mod-key hover, configurable under core Page Preview settings).
      this.registerHoverLinkSource("decks", {
        display: "Decks",
        defaultMod: true,
      });

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
          () => this.openAiGeneratorModal(),
          () => this.openAnkiImportModal(),
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

      // Add command to open the AI flashcard generator
      this.addCommand({
        id: "open-ai-generator",
        name: I18n.t.commands.openAiGenerator,
        callback: () => {
          this.openAiGeneratorModal();
        },
      });

      // Insert an image-occlusion block at the cursor and open the studio.
      this.addCommand({
        id: "insert-image-occlusion",
        name: I18n.t.commands.insertImageOcclusion,
        editorCallback: (editor, view) => {
          if (!(view instanceof MarkdownView) || !view.file) return;
          const images = this.app.vault
            .getFiles()
            .filter((f) => IMAGE_EXTENSIONS.includes(f.extension.toLowerCase()));
          if (images.length === 0) {
            new Notice(I18n.t.occlusion.noImages);
            return;
          }
          new FilePickerModal(
            this.app,
            images,
            (file) => {
              void this.insertOcclusionAtCursor(editor, view, file);
            },
            I18n.t.occlusion.pickImage
          ).open();
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

      // Add command to open the legacy SR migration modal
      this.addCommand({
        id: "migrate-from-sr",
        name: I18n.t.commands.migrateFromSr,
        callback: () => {
          this.openSrMigrationModal();
        },
      });

      // Add command to open the Anki import modal
      this.addCommand({
        id: "import-from-anki",
        name: I18n.t.commands.importFromAnki,
        callback: () => {
          this.openAnkiImportModal();
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

      // Create the sample template file for the getting-started demo, and point
      // the template folder at it if the user hasn't configured one yet (then
      // rebuild the cache so the example renders immediately).
      const setTemplateFolderIfEmpty = async (folder: string | null) => {
        if (!folder) return;
        if (this.settings.templates.templateFolder.trim() !== "") return;
        this.settings.templates.templateFolder = folder;
        await this.saveSettings();
        await this.templateSyncService.syncAll();
      };
      const createTestDeckWithTemplate = () => {
        testDeckService
          .createTestDeck(
            this.settings.parsing.deckTag,
            this.settings.parsing.folderSearchPath
          )
          .then(() =>
            testDeckService.createTemplateShowcase(
              this.settings.templates.templateFolder
            )
          )
          .then(setTemplateFolderIfEmpty)
          .catch(console.error);
      };

      if (!this.settings.hasCreatedTestDeck) {
        this.settings.hasCreatedTestDeck = true;
        await this.saveSettings();
        this.app.workspace.onLayoutReady(createTestDeckWithTemplate);
      }

      this.addCommand({
        id: "create-test-deck",
        name: I18n.t.commands.createTestDeck,
        callback: createTestDeckWithTemplate,
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

      // Explicitly clean up orphaned cards (deck_id points at a deleted deck row)
      // left by FK-off migrations or old deletes. NOT run automatically during
      // sync — a transiently-missing deck row would otherwise wipe a live deck.
      this.addCommand({
        id: "cleanup-orphaned-cards",
        name: I18n.t.commands.cleanupOrphanedCards,
        callback: () => {
          this.db
            .pruneOrphanedFlashcards()
            .then((count) => {
              new Notice(I18n.format(I18n.t.notices.orphansCleaned, { count }));
              if (count > 0) void this.getDecksView()?.refresh();
            })
            .catch((error) =>
              this.logger.error("Orphan cleanup failed", error)
            );
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
            () => this.openAiGeneratorModal(),
          ).open();
        },
      });

      // On window focus, pull other-device changes from disk (throttled, never on pane focus).
      this.registerDomEvent(window, "focus", () => {
        void this.reloadFromDiskIfNewer();
      });

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
            this.logger.debug("periodic snapshot save failed", error);
          });
        }
      }, 30 * 60 * 1000);
      this.register(() => {
        if (this.snapshotTimer !== null) {
          window.clearInterval(this.snapshotTimer);
          this.snapshotTimer = null;
        }
      });

      // (Own-log replay + other-device applyPending + compaction now run in the
      // whenReady() recovery block above, sequenced after the DB is loaded.)

      // Listen for file changes to update decks. Both .md (tag-scoped) and
      // .canvas (folder-scoped) files reach the handlers, which branch by
      // extension and dispatch to the right pipeline.
      this.registerEvent(
        this.app.vault.on("modify", async (file) => {
          if (file instanceof TFile && (file.extension === "md" || file.extension === "canvas")) {
            if (this.templateSyncService.isTemplateFile(file)) {
              await this.templateSyncService.syncFile(file);
            }
            await this.handleFileChange(file);
          }
        })
      );

      this.registerEvent(
        this.app.vault.on("delete", async (file) => {
          if (file instanceof TFile && (file.extension === "md" || file.extension === "canvas")) {
            if (file.extension === "md") {
              await this.templateSyncService.handleDelete(file.path);
            }
            await this.handleFileDelete(file);
          }
        })
      );

      this.registerEvent(
        this.app.vault.on("rename", async (file, oldPath) => {
          if (file instanceof TFile && (file.extension === "md" || file.extension === "canvas")) {
            if (file.extension === "md") {
              await this.templateSyncService.handleRename(file, oldPath);
            }
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
        this.app.vault.on("create", (file) => {
          if (file instanceof TFile && (file.extension === "md" || file.extension === "canvas")) {
            if (file.extension === "md" && this.templateSyncService.isTemplateFile(file)) {
              void this.templateSyncService.syncFile(file);
            }
            this.handleFileCreate(file);
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
          const span = activeDocument.createElement("span");

          if (currentIndex >= activeIndex && currentIndex < activeEnd) {
            if (revealed) {
              span.className = "decks-cloze-revealed";
              // Keep rendered children (MathJax, formatting) instead of flattening.
              while (mark.firstChild) span.appendChild(mark.firstChild);
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
            // Keep rendered children (MathJax, formatting) instead of flattening.
            while (mark.firstChild) span.appendChild(mark.firstChild);
          }

          mark.replaceWith(span);
        });

        container.setAttribute("data-decks-cloze-counter", String(markCount));
      });

      // Live preview of template-face codeblocks when viewing a template file.
      // Each `decks-[html|md]-[front|back|notes]` block renders its content so
      // authors see the face (placeholders like {{Word}} render literally).
      const templateLangs = [
        "decks-html-front", "decks-html-back", "decks-html-notes",
        "decks-md-front", "decks-md-back", "decks-md-notes",
      ];
      for (const lang of templateLangs) {
        const isHtml = lang.startsWith("decks-html-");
        this.registerMarkdownCodeBlockProcessor(lang, (source, el, ctx) => {
          const block = el.createDiv({ cls: "decks-template-preview-block" });
          block.createDiv({ cls: "decks-template-preview-label", text: lang });
          const body = block.createDiv({ cls: "decks-template-preview-body markdown-rendered" });
          if (isHtml) {
            renderHtmlIntoShadow(body, source, (linkpath) => {
              const dest = this.app.metadataCache.getFirstLinkpathDest(linkpath, ctx.sourcePath);
              return dest ? this.app.vault.getResourcePath(dest) : null;
            });
          } else {
            const child = new MarkdownRenderChild(body);
            ctx.addChild(child);
            void MarkdownRenderer.render(this.app, source, body, ctx.sourcePath, child);
          }
        });
      }

      // Interactive image occlusion (V2) blocks: render the image with its mask
      // overlay in reading view and offer an Edit button into the studio.
      this.registerMarkdownCodeBlockProcessor("decks-occlusion", (source, el, ctx) => {
        el.empty();
        const root = el.createDiv({ cls: "decks-occlusion-block" });
        const result = OcclusionV2Parser.parseOcclusionBlock(source);

        if (!result.ok) {
          root.createDiv({
            cls: "decks-occlusion-error",
            text: I18n.format(I18n.t.occlusion.parseError, { error: result.error }),
          });
        } else {
          const viewer = root.createDiv();
          renderOcclusion(viewer, {
            doc: result.doc,
            activeMaskId: null,
            revealed: false,
            showContext: "hidden",
            showAnswers: true,
            resolveImage: (linkpath) => {
              const dest = this.app.metadataCache.getFirstLinkpathDest(linkpath, ctx.sourcePath);
              return dest ? this.app.vault.getResourcePath(dest) : null;
            },
            renderMarkdown: (content, target) => {
              const child = new MarkdownRenderChild(target);
              ctx.addChild(child);
              void MarkdownRenderer.render(this.app, content, target, ctx.sourcePath, child);
            },
          });
        }

        const toolbar = root.createDiv({ cls: "decks-occlusion-toolbar" });
        const editBtn = toolbar.createEl("button", {
          cls: "decks-occlusion-edit-btn",
          text: I18n.t.occlusion.edit,
        });
        editBtn.onclick = () => {
          const info = ctx.getSectionInfo(el);
          const doc: OcclusionDoc = result.ok
            ? result.doc
            : { __v: 2, image: "", masks: [] };
          this.openOcclusionStudio(
            ctx.sourcePath,
            doc,
            info?.lineStart,
            info?.lineEnd,
          );
        };
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
          this.backupService,
          () => this.resyncTemplates()
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

    // Cancel pending debounced timers so they can't fire after teardown.
    if (this.pendingFullSync !== null) {
      window.clearTimeout(this.pendingFullSync);
      this.pendingFullSync = null;
    }
    if (this.pendingStatsRefresh !== null) {
      window.clearTimeout(this.pendingStatsRefresh);
      this.pendingStatsRefresh = null;
    }

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
      this.logger.debug("flushPendingDeckSyncs failed on blur/pagehide", error);
    }
    try {
      await this.syncLog?.flushNow();
    } catch (error) {
      this.logger.debug("flushNow failed on blur/pagehide", error);
    }
    if (this.db?.isDirty()) {
      try {
        await this.db.save();
      } catch (error) {
        this.logger.debug("save failed on blur/pagehide", error);
      }
    }
  }

  private async reloadFromDiskIfNewer(): Promise<void> {
    if (!this.db) return;
    if (this.reloadFromDiskInFlight) return;
    if (this.deckSynchronizer?.isReviewing) return;
    const now = Date.now();
    if (now - this.lastReloadFromDiskAt < DecksPlugin.RELOAD_FROM_DISK_THROTTLE_MS) {
      return;
    }
    this.lastReloadFromDiskAt = now;
    this.reloadFromDiskInFlight = true;
    try {
      await this.db.syncWithDisk();
      await this.syncLog?.applyPending();
      // Repaint from the merged DB — no vault scan needed.
      await this.getDecksView()?.refreshDecksAndStats();
    } catch (error) {
      this.logger.debug("reloadFromDiskIfNewer failed", error);
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
    // V2 occlusion cards are edited visually in the studio, not as text fields.
    if (isOcclusionV2(card)) {
      const doc = parseOcclusionBack(card.back);
      if (doc) {
        this.openOcclusionStudio(card.sourceFile, doc, undefined, undefined, doc.image);
        return;
      }
    }
    const templateColumns = await this.resolveTemplateColumns(card);
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
              // handleFileChange only schedules a debounced sync for markdown
              // decks; run it now so the manager sees the edit immediately when
              // it reloads after this modal closes. (Canvas is synced inline by
              // handleFileChange.)
              if (file.extension !== "canvas") {
                await this.flushDeckSync(card.deckId);
              }
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
                split: options.split,
              },
              signal,
            ),
          onSplit: async (cards) => {
            const edits = cards.map((c) => fieldSetToEdits(c));
            const result = await this.flashcardWriter.splitFlashcard(card, edits);
            if (result.ok) {
              const file = this.app.vault.getAbstractFileByPath(card.sourceFile);
              if (file instanceof TFile) {
                await this.handleFileChange(file);
                if (file.extension !== "canvas") {
                  await this.flushDeckSync(card.deckId);
                }
              }
              new Notice(`Split into ${cards.length} cards`);
            }
            return result;
          },
        },
        templateColumns,
      );
      wrapper.open();
    });
  }

  /** Rebuild the deck_templates cache from the template folder (e.g. after the
   * folder setting changes), so bindings update without a reload. */
  async resyncTemplates(): Promise<void> {
    await this.templateSyncService.syncAll();
  }

  /**
   * For a table card whose row binds a template, return its row columns so the
   * editor can show one input per column. Returns null otherwise (default editor).
   */
  private async resolveTemplateColumns(
    card: Flashcard,
  ): Promise<{ headers: string[]; cells: string[] } | null> {
    if (card.type !== "table" || !card.templateRow) return null;
    const templates = await this.db.getAllDeckTemplates();
    if (templates.length === 0) return null;
    const deck = await this.db.getDeckById(card.deckId);
    const bound = resolveCardTemplate(
      card.tags,
      deck?.fileTags ?? [],
      card.templateRow,
      templates,
    );
    if (!bound) return null;
    return {
      headers: card.templateRow.headers,
      cells: card.templateRow.cells,
    };
  }

  async openBatchRefactorModal(cards: Flashcard[]): Promise<void> {
    return new Promise((resolve) => {
      const wrapper = new AiBatchRefactorModalWrapper(
        this.app,
        {
          cards,
          run: (card, options, signal) =>
            this.aiRefactorController.refactorCard(
              card,
              cardToRefactorFieldSet(card),
              options,
              signal,
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
                if (file.extension !== "canvas") {
                  await this.flushDeckSync(card.deckId);
                }
              }
              return { ok: true };
            }
            return { ok: false, error: result.failure.message };
          },
          applySplit: async (card, fieldSets) => {
            const edits = fieldSets.map((c) => fieldSetToEdits(c));
            const result = await this.flashcardWriter.splitFlashcard(card, edits);
            if (result.ok) {
              const file = this.app.vault.getAbstractFileByPath(card.sourceFile);
              if (file instanceof TFile) {
                await this.handleFileChange(file);
                if (file.extension !== "canvas") {
                  await this.flushDeckSync(card.deckId);
                }
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

  openAiGeneratorModal(): void {
    const options: AiGeneratorOptions = {
      generate: (options, handlers, signal) =>
        this.aiGeneratorController.generateStream(options, handlers, signal),
      save: (cards, request) => this.saveGeneratedCards(cards, request),
      loadProfiles: async () =>
        (await this.db.getAllProfiles()).map((p) => ({
          id: p.id,
          name: p.name,
        })),
      loadDecks: async () =>
        (await this.db.getAllDecks()).map((d) => ({
          id: d.id,
          name: d.name,
          isCanvas: d.filepath.endsWith(".canvas"),
        })),
      defaultFolder: this.settings.parsing.folderSearchPath || "",
      canvasFolder: this.settings.canvasDecks.folderPath || "",
      deckTag: this.settings.parsing.deckTag,
    };

    if (this.settings.ui.aiGeneratorDisplayMode === "tab") {
      const { workspace } = this.app;
      const existing = workspace.getLeavesOfType(VIEW_TYPE_AI_GENERATOR);
      const leaf = existing.length > 0 ? existing[0] : workspace.getLeaf("tab");
      void leaf
        .setViewState({ type: VIEW_TYPE_AI_GENERATOR, active: true })
        .then(() => {
          const view = leaf.view;
          if (view instanceof AiGeneratorView) {
            view.setOptions(options);
          }
          void workspace.revealLeaf(leaf);
        })
        .catch(console.error);
      return;
    }

    new AiGeneratorModalWrapper(this.app, options).open();
  }

  openSrMigrationModal(): void {
    const controller = new SrMigrationController(
      this.app,
      this.db,
      this.deckSynchronizer,
      this.settings,
      this.logger,
    );
    new SrMigrationModalWrapper(
      this.app,
      this.db,
      controller,
      async () => {
        await this.getDecksView()?.refresh();
      },
    ).open();
  }

  openAnkiImportModal(): void {
    const controller = new AnkiImportController(
      this.app,
      this.db,
      this.deckSynchronizer,
      this.settings,
      this.logger,
      this.templateSyncService,
      () => this.saveSettings(),
    );
    new AnkiImportModalWrapper(
      this.app,
      this.db,
      controller,
      async () => {
        await this.getDecksView()?.refresh();
      },
    ).open();
  }

  // Write the kept generated cards to disk, then register/sync the deck so the
  // new cards appear. Returns a result the modal surfaces to the user.
  private async saveGeneratedCards(
    cards: GeneratedCard[],
    request: GeneratorSaveRequest,
  ): Promise<{ ok: boolean; error?: string; count?: number; deckId?: string }> {
    try {
      if (request.kind === "new-file") {
        const profile =
          (await this.db.getProfileById(request.profileId)) ??
          (await this.db.getDefaultProfile());
        const { filePath } = await this.flashcardComposer.saveGenerated(cards, {
          kind: "new-file",
          format: request.format,
          folder: request.folder,
          name: request.name,
          tag: request.tag,
          level: profile.headerLevel,
        });
        const tag =
          request.format === "canvas"
            ? this.settings.canvasDecks.tagName || request.tag
            : request.tag;
        const deckId = await this.registerGeneratedDeck(
          filePath,
          tag,
          request.profileId,
        );
        return { ok: true, count: cards.length, deckId };
      } else {
        const deck = await this.db.getDeckById(request.deckId);
        if (!deck) return { ok: false, error: "Deck not found" };
        const profile =
          (await this.db.getProfileById(deck.profileId)) ??
          (await this.db.getDefaultProfile());
        await this.flashcardComposer.saveGenerated(cards, {
          kind: "append",
          format: request.format,
          filePath: deck.filepath,
          level: profile.headerLevel,
        });
        const file = this.app.vault.getAbstractFileByPath(deck.filepath);
        if (file instanceof TFile) {
          await this.handleFileChange(file);
          await this.deckSynchronizer.syncDeck(deck.id);
        }
        return { ok: true, count: cards.length, deckId: deck.id };
      }
    } catch (e) {
      this.logger.error("Failed to save generated cards", e);
      const message = e instanceof Error && e.message ? e.message : String(e);
      return {
        ok: false,
        error: message || I18n.t.modals.aiGenerator.saveFailed,
      };
    }
  }

  // Ensure a deck row exists for a freshly created file, associate the chosen
  // profile, and parse its cards. Idempotent with the file-create handler.
  // Returns the deck id when resolvable so the caller can select it.
  private async registerGeneratedDeck(
    filePath: string,
    tag: string,
    profileId: string,
  ): Promise<string | undefined> {
    let deck = await this.db.getDeckByFilepath(filePath);
    if (!deck) {
      await this.deckSynchronizer.createDeckForFile(filePath, tag);
      await yieldToUI();
      deck = await this.db.getDeckByFilepath(filePath);
    }
    if (!deck) return undefined;
    if (profileId && deck.profileId !== profileId) {
      await this.db.updateDeck(deck.id, { profileId });
    }
    await this.deckSynchronizer.syncDeck(deck.id);
    await this.getDecksView()?.refreshStats();
    return deck.id;
  }

  async handleFileChange(file: TFile) {
    // Skipped during migration (delete-mode rewrites originals) — its forced
    // sync covers everything, so skip the per-file auto-sync.
    if (this.deckSynchronizer.isMigrating) return;
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
    if (existing !== undefined) window.clearTimeout(existing);
    const timer = window.setTimeout(() => {
      this.pendingDeckSyncs.delete(deckId);
      void this.runDebouncedDeckSync(deckId);
    }, DecksPlugin.FILE_MODIFY_DEBOUNCE_MS);
    this.pendingDeckSyncs.set(deckId, timer);
  }

  // Debounced full vault sync: a burst of create events collapses into one
  // trailing full sync + UI refresh after things settle.
  private scheduleFullSync(): void {
    if (this.pendingFullSync !== null) window.clearTimeout(this.pendingFullSync);
    this.pendingFullSync = window.setTimeout(() => {
      this.pendingFullSync = null;
      void this.runDebouncedFullSync();
    }, DecksPlugin.FULL_SYNC_DEBOUNCE_MS);
  }

  private async runDebouncedFullSync(): Promise<void> {
    try {
      await this.deckSynchronizer.sync();
      await this.getDecksView()?.refresh({ skipSync: true });
    } catch (error) {
      this.logger.error("Debounced full sync failed", error);
    }
  }

  // Debounced UI stats refresh: a burst of deletes collapses into one repaint.
  private scheduleStatsRefresh(): void {
    if (this.pendingStatsRefresh !== null) {
      window.clearTimeout(this.pendingStatsRefresh);
    }
    this.pendingStatsRefresh = window.setTimeout(() => {
      this.pendingStatsRefresh = null;
      void this.getDecksView()?.refreshStats();
    }, DecksPlugin.STATS_REFRESH_DEBOUNCE_MS);
  }

  // Run a deck's sync immediately (awaited), cancelling any pending debounce.
  // Used after an interactive edit so callers can rely on the DB being current
  // before they reload (e.g. reopening the edit modal from the manager).
  private async flushDeckSync(deckId: string): Promise<void> {
    const timer = this.pendingDeckSyncs.get(deckId);
    if (timer !== undefined) {
      window.clearTimeout(timer);
      this.pendingDeckSyncs.delete(deckId);
    }
    await this.runDebouncedDeckSync(deckId);
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
      window.clearTimeout(timer);
      await this.runDebouncedDeckSync(deckId);
    }
    // Drain a pending full sync (e.g. a bulk create sitting in the debounce
    // window) so it isn't dropped on blur/pagehide/unload.
    if (this.pendingFullSync !== null) {
      window.clearTimeout(this.pendingFullSync);
      this.pendingFullSync = null;
      await this.runDebouncedFullSync();
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

      await this.runAnchorMigrationOnce();

      const totalTime = performance.now() - startTime;
      this.logger.performance(
        `Initial sync completed successfully in ${formatTime(totalTime)}`
      );
    } catch (error) {
      console.error("Error during initial sync:", error);
      // Don't throw - let the app continue working even if initial sync fails
    }
  }

  // One-time anchor migration: runs after the first full sync (cards must
  // exist in the DB). Idempotent — misses fall back to lazy stamping at
  // review time, so marking it done up front is safe.
  private async runAnchorMigrationOnce(): Promise<void> {
    if (this.settings.anchorMigrationV1Done) return;
    this.settings.anchorMigrationV1Done = true;
    await this.saveSettings();
    try {
      const stamper = new AnchorStamper(this.app, this.db, this.logger);
      const migrator = new AnchorMigrator(this.app, this.db, stamper, this.logger);
      await migrator.run(this.settings.ui?.enableNotices !== false);
    } catch (error) {
      this.logger.error("Anchor migration failed", error);
    }
  }

  async handleFileDelete(file: TFile) {
    if (file.extension === "canvas") {
      await this.canvasFileEvents.onDeleted(file.path);
      return;
    }
    // Remove the deck and all associated flashcards/review logs
    await this.db.deleteDeckByFilepath(file.path);

    // Debounced stats refresh so a bulk delete repaints the UI once.
    this.scheduleStatsRefresh();
  }

  /**
   * Handle a newly-created markdown file. If it carries the configured
   * deck tag, create the deck row and parse the cards. The tag may not be
   * visible synchronously on `create` because Obsidian populates the
   * metadata cache a beat later; defer once via metadataCache "changed"
   * if needed.
   */
  handleFileCreate(file: TFile): void {
    // The migration writes many files at once and runs its own single sync;
    // skip the per-file auto-sync to avoid "Sync already in progress" collisions.
    if (this.deckSynchronizer.isMigrating) return;
    if (file.extension === "canvas") {
      this.canvasFileEvents.onCreated(file);
      return;
    }
    const baseTag = this.settings.parsing.deckTag;
    const checkAndSync = (): boolean => {
      const metadata = this.app.metadataCache.getFileCache(file);
      if (!metadata) return false;
      const tags = getAllTags(metadata) || [];
      const hasTag = tags.some((t) => t.startsWith(baseTag));
      if (!hasTag) return true; // metadata seen, definitely no tag — stop deferring
      this.logger.debug(`New tagged file detected: ${file.path}`);
      // Debounced full discovery sync: a burst of new files collapses into a
      // single trailing sync. The mtime gate guarantees only changed/new files
      // are parsed, not every existing deck.
      this.scheduleFullSync();
      return true;
    };

    if (checkAndSync()) return;

    // Metadata not yet ready — defer until metadataCache fires "changed"
    // for this file. Self-unregistering one-shot listener.
    const ref = this.app.metadataCache.on("changed", (changedFile) => {
      if (changedFile !== file) return;
      this.app.metadataCache.offref(ref);
      checkAndSync();
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

  /** Insert a `decks-occlusion` block for `file` at the cursor, then open the studio. */
  private async insertOcclusionAtCursor(
    editor: Editor,
    view: MarkdownView,
    file: TFile,
  ): Promise<void> {
    const sourcePath = view.file?.path;
    if (!sourcePath) return;
    const linktext = this.app.metadataCache.fileToLinktext(file, sourcePath);
    const doc: OcclusionDoc = {
      __v: OCCLUSION_V2_VERSION,
      image: `[[${linktext}]]`,
      masks: [],
    };
    const fenced = "```decks-occlusion\n" + OcclusionV2Parser.toYaml(doc).trimEnd() + "\n```";
    const cursor = editor.getCursor();
    const atLineStart = cursor.ch === 0;
    editor.replaceSelection((atLineStart ? "" : "\n") + fenced + "\n");
    // Persist so the studio's vault.process sees the new block.
    await view.save();
    const openLine = atLineStart ? cursor.line : cursor.line + 1;
    const closeLine = openLine + fenced.split("\n").length - 1;
    this.openOcclusionStudio(sourcePath, doc, openLine, closeLine, doc.image);
  }

  /** Open the image-occlusion studio for a `decks-occlusion` block in a note. */
  openOcclusionStudio(
    sourcePath: string,
    doc: OcclusionDoc,
    lineStart?: number,
    lineEnd?: number,
    matchImage?: string,
  ): void {
    new OcclusionStudioModalWrapper(this.app, {
      sourcePath,
      doc,
      lineStart,
      lineEnd,
      matchImage,
      onSaved: () => {
        const file = this.app.vault.getAbstractFileByPath(sourcePath);
        if (file instanceof TFile) {
          this.handleFileChange(file).catch((e) =>
            this.logger.debug("occlusion re-sync failed", e),
          );
        }
      },
    }).open();
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
