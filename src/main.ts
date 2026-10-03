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
import type { Extension } from "@codemirror/state";
import { decksHideAnchorTokens } from "./editor/hide-anchor-tokens";
import { openVaultPdf } from "./utils/pdf-open";
import { AiSourcePdfStore } from "./services/AiSourcePdfStore";
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
import { ObsidianNoteAccess } from "./services/ObsidianNoteAccess";
import { AnchorMigrator } from "./services/AnchorMigrator";
import { CanvasFileEventHandlers } from "./services/CanvasFileEventHandlers";
import { Scheduler } from "@decks/core";
import { EXAMS_PROFILE_ID, getExamDeckTag } from "@decks/core";
import { AnchorUpgrader, parseHeaderLevels } from "@decks/core";
import { DeviceLocalState } from "./services/DeviceLocalState";
import { SyncLog } from "./services/SyncLog";
import {
  resolveDbPath,
  resolveBackupFolder,
  resolveSyncLogFolder,
  resolvePdfCacheFolder,
} from "./utils/paths";
import { BackupService } from "./services/BackupService";
import { StatisticsService } from "@decks/core";
import { FlashcardWriter, type FlashcardEdits } from "./services/FlashcardWriter";
import { FlashcardEditModalWrapper } from "./components/FlashcardEditModalWrapper";
import { stagedCardsFromSnapshot } from "./services/ai-session-rows";
import { AiChatService, AiConceptService, AiCritiqueService, AiGenerationService, AiGradingService, AiMatchService, buildExamPool, heldByOtherDecks, fixedCard, fixFields, missesSessionPrompt, mixFromPool, ocrSentinelForTier, pageMarker, type QuestionMix, type TypedGradingMode, AiRefactoringService, type CritiqueCard, type GeneratedCard, type GeneratedCardType, buildConceptRows, generateDeckId, hubTotals, I18n, localRowId, sourceDisplayName, type AiSession, type AiStagedCard, partitionAgainstDeck, type RefactorFieldSet, resolveCardTemplate, yieldToUI, OcclusionV2Parser, type OcclusionDoc, OCCLUSION_V2_VERSION, isOcclusionV2, parseOcclusionBack } from "@decks/core";
import { AiKeyStore } from "./services/AiKeyStore";
import { DecksProAuth } from "./services/DecksProAuth";
import { ObsidianHttpClient } from "./services/ObsidianHttpClient";
import {
  AiRefactorController,
  cardToRefactorFieldSet,
  fieldSetToEdits,
} from "./services/AiRefactorController";
import { AiChatController } from "./services/AiChatController";
import { AiConceptController } from "./services/AiConceptController";
import { AiCritiqueController } from "./services/AiCritiqueController";
import { AiGradingController } from "./services/AiGradingController";
import { AiMatchController } from "./services/AiMatchController";
import {
  AiWorkbenchView,
  VIEW_TYPE_AI_WORKBENCH,
  type AiWorkbenchData,
  type AiWorkbenchGap,
  type TriageAction,
} from "./components/AiWorkbenchView";
import { buildModelOptions } from "./utils/ai-model-options";
import type {
  AiSessionRestore,
  AiSessionSnapshot,
} from "./components/ai-generator-types";
import { AiGeneratorController } from "./services/AiGeneratorController";
import { PdfOcrCache } from "@decks/core";
import { ObsidianFileStore } from "./services/ObsidianFileStore";
import { buildSectionContent, hashPdf, loadPdf, renderPageImage } from "./utils/pdf";
import { buildAiConfig } from "./services/ai-config";
import { FlashcardComposer } from "./services/FlashcardComposer";
import { AiBatchRefactorModalWrapper } from "./components/AiBatchRefactorModalWrapper";
import type { AiGeneratorOptions, AiSessionSeed } from "./components/ai-generator-types";
import {
  AiGeneratorView,
  VIEW_TYPE_AI_GENERATOR,
} from "./components/AiGeneratorView";
import type { GeneratorSaveRequest } from "./components/generator-save";
import type { Flashcard } from "./database/types";
import { Logger, formatTime } from "./utils/logging";
import { ProgressTracker } from "./utils/progress";
import { resolveModelId } from "./utils/ai-model-options";

import { type DecksSettings, DEFAULT_SETTINGS } from "./settings";
import { DecksSettingTab } from "./components/settings/SettingsTab";

import { DecksView } from "./components/DecksView";
import { DecksViewModal } from "./components/DecksViewModal";
import { ReleaseNotesModal } from "./components/ReleaseNotesModal";
import {
  ReleaseNotesView,
  VIEW_TYPE_RELEASE_NOTES,
} from "./components/ReleaseNotesView";
import { shouldShowReleaseNotes } from "./utils/release-notes";
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
import { ExamView, VIEW_TYPE_FLASHCARD_EXAM } from "./components/exam/ExamView";
import type { ExamMissHooks } from "./components/exam/exam-miss-props";
import {
  type CardSource,
  type ReviewRepairHooks,
  repairTargets,
  resolveCardSource,
} from "./components/review/review-repair-props";
import { questionFronts, refactorAsNote } from "./utils/reverse-card";

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
  public decksProAuth: DecksProAuth;
  /** Kept so the Decks Pro sign-in hand-off can repaint the panel. */
  private settingTab: DecksSettingTab | null = null;
  public aiRefactorController: AiRefactorController;
  public aiGeneratorController: AiGeneratorController;
  public aiCritiqueController: AiCritiqueController;
  public aiGradingController: AiGradingController;
  public aiMatchController: AiMatchController;
  public aiConceptController: AiConceptController;
  public aiChatController: AiChatController;
  private aiSourcePdfs: AiSourcePdfStore;
  public pdfOcrCache: PdfOcrCache;
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
  // Resolves after the whenReady() post-init chain (incl. the exams tag
  // mapping) so first-run file creation can sequence behind it.
  private dbPostInit: Promise<void> = Promise.resolve();

  // Coalesce rapid-fire vault `modify` events (Obsidian autosaves every ~1-2s
  // during typing) into one trailing-edge sync per deck after the user pauses.
  private pendingDeckSyncs = new Map<string, number>();
  /** Options for the generator leaf being opened; the view takes them in setState. */
  private pendingGeneratorOptions: AiGeneratorOptions | null = null;
  private aiStatusEl: HTMLElement | null = null;
  private aiStatusTimer: number | null = null;
  private static readonly FILE_MODIFY_DEBOUNCE_MS = 3000;

  // Coalesce bursts of `create` events (bulk file creation / import) into a
  // single trailing-edge full sync, instead of one full vault scan per file.
  private pendingFullSync: number | null = null;
  private static readonly FULL_SYNC_DEBOUNCE_MS = 1000;
  // Coalesce per-file UI stat refreshes (e.g. bulk delete) into one repaint.
  private pendingStatsRefresh: number | null = null;
  private static readonly STATS_REFRESH_DEBOUNCE_MS = 300;
  // Registered once, then mutated in place so settings can swap extensions
  // without re-registering; Obsidian re-reads it on workspace.updateOptions().
  private editorExtensions: Extension[] = [];

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
      this.dbPostInit = this.db.whenReady().then(async () => {
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
        let caughtUp = true;
        try {
          await this.syncLog.applyPending();
        } catch (error) {
          caughtUp = false;
          this.logger.debug("startup applyPending failed", error);
        }
        try {
          await this.syncLog.compact();
        } catch (error) {
          this.logger.debug("startup compact failed", error);
        }
        this.syncLog.announce();
        this.scheduleAiStatus();
        // Another device's sessions must have arrived before their copies can count as strays.
        if (caughtUp) void this.pruneAiSourcePdfs();
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
        // One-time tag mapping for the Exams preset, derived from the user's
        // base tag. Base-tag renames migrate it with every other mapping.
        if (!this.settings.examsPresetMappingDone) {
          try {
            const examsTag = getExamDeckTag(this.settings.parsing.deckTag);
            const existing = await this.db.getProfileIdForTag(examsTag);
            if (!existing) {
              await this.db.createTagMapping(EXAMS_PROFILE_ID, examsTag);
            }
            this.settings.examsPresetMappingDone = true;
            await this.saveSettings();
          } catch (error) {
            this.logger.debug("startup exams mapping failed", error);
          }
        }
        void this.getDecksView()?.refresh();
      });
      this.dbPostInit = this.dbPostInit.catch((e) =>
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
        this.logger.debug.bind(this.logger),
        // Lazy: the device state is created further down.
        () => this.deviceLocalState?.getDeviceId() ?? null
      );
      // Applied here as well as from the settings slider. It used to be set
      // only by the slider's onChange, so every restart silently put a user
      // configured for ten backups back on five until they opened that tab.
      this.backupService.setMaxBackups(this.settings.backup.maxBackups);

      // Initialize statistics service
      this.statisticsService = new StatisticsService(this.db, this.settings, this.logger);

      // Initialize custom deck service
      this.customDeckService = new CustomDeckService(this.db);
      this.flashcardWriter = new FlashcardWriter(this.app);

      // AI refactoring. API keys live in a non-synced file under the plugin
      // dir (AiKeyStore) — never in data.json. HTTP goes through Obsidian's
      // requestUrl (ObsidianHttpClient) to bypass CORS.
      this.aiKeyStore = new AiKeyStore(adapter, pluginDir);
      this.decksProAuth = new DecksProAuth(
        this.aiKeyStore,
        () => this.settings.ai,
        this.logger,
        () => this.saveSettings(),
      );
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
      this.aiCritiqueController = new AiCritiqueController(
        new AiCritiqueService(new ObsidianHttpClient(), this.logger),
        this.settings,
        this.aiKeyStore,
      );
      this.aiGradingController = new AiGradingController(
        new AiGradingService(new ObsidianHttpClient(), this.logger),
        this.settings,
        this.aiKeyStore,
      );
      this.aiMatchController = new AiMatchController(
        new AiMatchService(new ObsidianHttpClient(), this.logger),
        this.settings,
        this.aiKeyStore,
        this.db,
      );
      this.aiConceptController = new AiConceptController(
        new AiConceptService(new ObsidianHttpClient(), this.logger),
        this.settings,
        this.aiKeyStore,
      );
      this.aiSourcePdfs = new AiSourcePdfStore(
        this.app.vault.adapter,
        `${this.manifest.dir ?? `${this.app.vault.configDir}/plugins/${this.manifest.id}`}/ai-sources`,
      );
      this.aiChatController = new AiChatController(
        new AiChatService(new ObsidianHttpClient(), this.logger),
        this.settings,
        this.aiKeyStore,
      );
      // PDF → OCR text cache for the generator's two-stage PDF pipeline. Folder
      // resolved on demand so a settings change takes effect without a restart.
      this.pdfOcrCache = new PdfOcrCache(
        new ObsidianFileStore(this.app),
        () =>
          resolvePdfCacheFolder(this.settings.paths, {
            manifestDir: this.manifest.dir,
            manifestId: this.manifest.id,
            vaultConfigDir: this.app.vault.configDir,
          }),
        () => buildAiConfig(this.settings, this.aiKeyStore),
        new ObsidianHttpClient(),
        renderPageImage,
        this.logger,
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
      this.backupService.setBeforeRestore(() =>
        this.syncLog.markOwnLogApplied()
      );

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
            () => void this.openAiWorkbench(),
            () => this.openAnkiImportModal(),
            this.examMissHooks(),
            this.reviewRepairHooks(),
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
            this.db,
            this.reviewRepairHooks()
          )
      );

      // Register the exam tab view
      this.registerView(
        VIEW_TYPE_FLASHCARD_EXAM,
        (leaf) => new ExamView(leaf, this.db, this.examMissHooks())
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

      // The workbench's pile in the status bar; it opens the hub.
      this.aiStatusEl = this.addStatusBarItem();
      this.aiStatusEl.addClass("decks-ai-status");
      this.aiStatusEl.hide();
      this.aiStatusEl.onClickEvent(() => void this.openAiWorkbench());

      // Options at construction, not after setViewState, so Obsidian can
      // restore the leaf with the workspace.
      this.registerView(
        VIEW_TYPE_AI_WORKBENCH,
        (leaf) =>
          new AiWorkbenchView(leaf, {
            load: () => this.loadAiWorkbench(),
            onOpenSession: (id) => this.openAiGeneratorModal(id),
            onNewSession: () => this.openAiGeneratorModal(),
            setArchived: (id, archived) =>
              // Archiving must not float the session back to the top of the
              // hub, so the touch is suppressed.
              this.db.updateAiSession(id, { archived }, { touch: false }),
            triage: (card, action) => this.triageAiCard(card, action),
            onGenerateGap: (gap) => this.openGapSession(gap),
            setModel: (id) => this.setAiModel(id),
          }),
      );

      // Register the AI generator tab view
      this.registerView(
        VIEW_TYPE_AI_GENERATOR,
        (leaf) =>
          new AiGeneratorView(
            leaf,
            () => {
              const pending = this.pendingGeneratorOptions;
              this.pendingGeneratorOptions = null;
              return pending;
            },
            (sessionId) => this.buildAiGeneratorOptions(sessionId ?? undefined),
          ),
      );

      // Register the release notes tab view
      this.registerView(
        VIEW_TYPE_RELEASE_NOTES,
        (leaf) => new ReleaseNotesView(leaf),
      );

      // Let internal links in reviewed cards use Obsidian's page preview
      // (mod-key hover, configurable under core Page Preview settings).
      this.registerHoverLinkSource("decks", {
        display: "Decks",
        defaultMod: true,
      });

      // Sign-in hand-off from the website: obsidian://decks-auth?state=..&code=..
      this.registerObsidianProtocolHandler("decks-auth", (params) => {
        void this.completeProSignIn(params.state, params.code);
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
          () => void this.openAiWorkbench(),
          () => this.openAnkiImportModal(),
          this.examMissHooks(),
          this.reviewRepairHooks(),
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

      // Add command to open the AI workbench hub
      this.addCommand({
        id: "open-ai-workbench",
        name: I18n.t.commands.openAiWorkbench,
        callback: () => {
          void this.openAiWorkbench();
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

      // After an update, show what changed — once per version. Deferred to
      // layout-ready so it does not compete with the workspace restoring its
      // own tabs.
      this.app.workspace.onLayoutReady(() => {
        void this.openReleaseNotesIfUpdated();
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

      // Demo exam deck: tagged `<deckTag>/exams`, so it resolves to the Exams
      // preset via the startup tag mapping. Created once, plus a command.
      const createExamDemoDeck = () => {
        testDeckService
          .createExamDemoDeck(
            this.settings.parsing.deckTag,
            this.settings.parsing.folderSearchPath
          )
          .catch(console.error);
      };

      if (!this.settings.hasCreatedExamDeck) {
        this.settings.hasCreatedExamDeck = true;
        await this.saveSettings();
        // The file must not reach the vault before the exams tag mapping
        // exists, or its first parse resolves to the default profile.
        this.app.workspace.onLayoutReady(() => {
          void this.dbPostInit.then(createExamDemoDeck);
        });
      }

      this.addCommand({
        id: "create-exam-demo-deck",
        name: I18n.t.commands.createExamDemoDeck,
        callback: createExamDemoDeck,
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
            () => void this.openAiWorkbench(),
            undefined,
            this.examMissHooks(),
            this.reviewRepairHooks(),
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

      this.registerEditorExtension(this.editorExtensions);
      this.applyEditorExtensions();

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

      // Add settings tab. The reference is kept so the Decks Pro sign-in
      // hand-off can repaint it: the browser round-trip finishes outside the
      // settings UI, which would otherwise keep showing "signed out".
      this.settingTab = new DecksSettingTab(
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
      );
      this.addSettingTab(this.settingTab);

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
    if (this.aiStatusTimer !== null) window.clearTimeout(this.aiStatusTimer);
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

    // The generator is a leaf now; without this the settings merge would carry
    // the dead key into every future save of data.json.
    delete (this.settings.ui as unknown as Record<string, unknown>)
      .aiGeneratorDisplayMode;
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

  /**
   * Open the release notes in a tab when the running version differs from the
   * one last shown — an update, or a first install.
   *
   * The version is recorded before the tab is opened: if opening ever throws,
   * the alternative is a tab that tries to reopen on every launch, which is a
   * far worse failure than missing the notes once.
   */
  private async openReleaseNotesIfUpdated(): Promise<void> {
    const current = this.manifest.version;
    if (!shouldShowReleaseNotes(current, this.settings.ui.lastSeenVersion)) return;

    this.settings.ui.lastSeenVersion = current;
    await this.saveSettings();

    try {
      await this.app.workspace
        .getLeaf("tab")
        .setViewState({ type: VIEW_TYPE_RELEASE_NOTES, active: true });
    } catch (e) {
      console.error("Decks: could not open release notes", e);
    }
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

  /** Sync registered editor extensions with settings. Safe to call repeatedly. */
  applyEditorExtensions(): void {
    this.editorExtensions.length = 0;
    if (this.settings.ui.hideAnchorTokensInEditor) {
      this.editorExtensions.push(decksHideAnchorTokens);
    }
    this.app.workspace.updateOptions();
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
      this.scheduleAiStatus();
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
          aiProvider: this.settings.ai.provider,
          defaultModel: this.aiDefaultModel(),
          onModelChange: (id: string) => void this.setAiModel(id),
          // A reverse card is rewritten as its note's card, the way round the note holds it.
          onRefactor: (current, options, signal) =>
            refactorAsNote(card, current, options.targetKeys, (noteFields, targetKeys) =>
              this.aiRefactorController.refactorCard(
                noteFields,
                {
                  instructions: options.instructions,
                  targetKeys,
                  sourceContext: options.sourceContext,
                  images: options.images,
                  split: options.split,
                  model: options.model,
                },
                signal,
              ),
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

  async openBatchRefactorModal(
    cards: Flashcard[],
    sourceContext?: string,
    startSplit = false,
  ): Promise<void> {
    // One rewrite per note: a reverse card is rewritten as its note's card.
    cards = await repairTargets(this.db, cards);
    if (cards.length === 0) return;
    return new Promise((resolve) => {
      const wrapper = new AiBatchRefactorModalWrapper(
        this.app,
        {
          cards,
          startSplit,
          aiProvider: this.settings.ai.provider,
          defaultModel: this.aiDefaultModel(),
          onModelChange: (id: string) => void this.setAiModel(id),
          run: (card, options, signal) =>
            this.aiRefactorController.refactorCard(
              cardToRefactorFieldSet(card),
              // A caller-supplied source is the page the card came from; the
              // modal's own instructions still win when it sets one.
              sourceContext ? { sourceContext, ...options } : options,
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

  /**
   * Remember the tier or model chosen in a modal.
   *
   * Decks Pro has no tier control in settings — the choice belongs where the
   * work happens — so the modals are the only place it is set, and it has to
   * stick between them.
   */
  private async setAiModel(id: string): Promise<void> {
    const provider = this.settings.ai.provider;
    if (!id || this.settings.ai.models[provider] === id) return;
    this.settings.ai.models[provider] = id;
    await this.saveSettings();
  }

  /** The model the in-prompt picker defaults to: the configured one, with retired ids reset. */
  private aiDefaultModel(): string {
    const provider = this.settings.ai.provider;
    return resolveModelId(
      provider,
      this.settings.ai.models[provider],
      this.settings.ai.customModel?.[provider] ?? false,
    );
  }

  openAiGeneratorModal(
    sessionId?: string,
    seed?: AiSessionSeed,
    focus?: { rowId: string },
  ): void {
    this.pendingGeneratorOptions = this.buildAiGeneratorOptions(sessionId, seed, focus);
    this.showAiGeneratorLeaf(sessionId);
  }

  /** The generator leaf, when it is showing this stored session. */
  private generatorShowing(sessionId: string): AiGeneratorView | null {
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_AI_GENERATOR)) {
      if (leaf.view instanceof AiGeneratorView && leaf.view.showsSession(sessionId)) return leaf.view;
    }
    return null;
  }

  /**
   * Act on a flagged card from the hub. An open session owns its pile, so the
   * action goes through it; otherwise the stored card is re-read and changed only
   * if it is still waiting.
   */
  private async triageAiCard(card: AiStagedCard, action: TriageAction): Promise<void> {
    const view = this.generatorShowing(card.sessionId);
    const rowId = localRowId(card.sessionId, card.id);
    if (action === "fix") {
      if (view) {
        view.focusRow(rowId);
        void this.app.workspace.revealLeaf(view.leaf);
      } else {
        this.openAiGeneratorModal(card.sessionId, undefined, { rowId });
      }
      return;
    }
    if (view && (await view.applyTriage(rowId, action).catch(() => false))) return;
    const current = (await this.db.getAiStagedCards(card.sessionId)).find((c) => c.id === card.id);
    if (!current || current.rubricVerdict !== "flagged") return;
    if (current.status !== "proposed" && current.status !== "kept") return;
    await this.db.updateAiStagedCard(
      card.id,
      action === "discard" ? { status: "discarded" } : { rubricVerdict: "pass" },
    );
    this.scheduleAiStatus();
  }

  /** Coalesced: a streaming round persists every few hundred milliseconds. */
  private scheduleAiStatus(): void {
    if (this.aiStatusTimer !== null) window.clearTimeout(this.aiStatusTimer);
    this.aiStatusTimer = window.setTimeout(() => {
      this.aiStatusTimer = null;
      void this.refreshAiStatus().catch((e) => this.logger.debug("AI status refresh failed", e));
    }, 1000);
  }

  private async refreshAiStatus(): Promise<void> {
    const el = this.aiStatusEl;
    if (!el) return;
    el.empty();
    if (!this.settings.ai.enabled) {
      el.hide();
      return;
    }
    const [sessions, counts] = await Promise.all([
      this.db.getAiSessions(false),
      this.db.getAiSessionCounts(),
    ]);
    const totals = hubTotals(sessions.map((s) => counts[s.id] ?? { staged: 0, flagged: 0, saved: 0 }));
    if (totals.staged === 0) {
      el.hide();
      return;
    }
    el.show();
    el.createSpan({ text: I18n.format(I18n.t.modals.aiGenerator.hub.rowStaged, { count: totals.staged }) });
    if (totals.flagged > 0) {
      el.createSpan({ cls: "decks-ai-status-warn", text: `⚠ ${totals.flagged}` });
    }
  }

  /** Resume the session with a round for its uncovered concepts written, not sent. */
  private openGapSession(gap: AiWorkbenchGap): void {
    const terms = gap.concepts.map((c) => `${c.term} (p. ${c.page})`).join(", ");
    this.openAiGeneratorModal(gap.sessionId, {
      prompt: I18n.format(I18n.t.modals.aiGenerator.coverage.conceptPrompt, { terms }),
    });
  }

  /** What a generator leaf needs to run. Also used when the workspace restores a
   *  leaf, so a session tab reopens after a restart instead of coming back blank. */
  private buildAiGeneratorOptions(
    sessionId?: string,
    seed?: AiSessionSeed,
    focus?: { rowId: string },
  ): AiGeneratorOptions {
    return {
      seed,
      focus,
      // Loaded on mount rather than passed in: the PDF must be re-read, from the vault
      // or from its kept copy, before its chapters mean anything.
      restoreSession: sessionId
        ? () => this.loadAiSessionForResume(sessionId)
        : undefined,
      persistSession: (snapshot: AiSessionSnapshot) =>
        this.persistAiSession(snapshot),
      generate: ({ model, ...rest }, handlers, signal) =>
        this.aiGeneratorController.generateStream(
          { ...rest, modelOverride: model },
          handlers,
          signal,
        ),
      save: (cards, request) => this.saveGeneratedCards(cards, request),
      deckFronts: async (filePath) => {
        const deck = await this.db.getDeckByFilepath(filePath);
        return deck ? questionFronts(await this.db.getFlashcardsByDeck(deck.id)) : [];
      },
      refine: async (
        card: GeneratedCard,
        options: {
          instructions?: string;
          split?: boolean;
          cloze?: boolean;
          sourceContext?: string;
          model?: string;
        },
        signal?: AbortSignal,
      ) => {
        // A staged card has no row in the database yet, so the refactor service
        // is handed the field set directly rather than a stored Flashcard.
        const { cloze, ...rest } = options;
        const result = await this.aiRefactorController.refactorCard(
          fixFields(card, cloze ? "cloze" : null),
          rest,
          signal,
        );
        const toCard = (f: RefactorFieldSet): GeneratedCard => {
          const fixed = fixedCard(f);
          return fixed ? { ...card, ...fixed } : card;
        };
        return result.splitCards?.length
          ? result.splitCards.map(toCard)
          : [toCard(result.proposed)];
      },
      critique: async (
        cards: CritiqueCard[],
        model?: string,
        signal?: AbortSignal,
        cardType?: GeneratedCardType,
      ) => {
        const result = await this.aiCritiqueController.critique(
          cards,
          { model, cardType },
          signal,
        );
        return result?.verdicts ?? null;
      },
      loadProfiles: async () =>
        (await this.db.getAllProfiles()).map((p) => ({
          id: p.id,
          name: p.name,
        })),
      defaultFolder: this.settings.parsing.folderSearchPath || "",
      canvasFolder: this.settings.canvasDecks.folderPath || "",
      deckTag: this.settings.parsing.deckTag,
      aiProvider: this.settings.ai.provider,
      defaultModel: this.aiDefaultModel(),
      onModelChange: (id: string) => void this.setAiModel(id),
      keepSourcePdf: (hash: string, bytes: ArrayBuffer) => this.aiSourcePdfs.keep(hash, bytes),
      readSourcePdf: (hash: string) => this.aiSourcePdfs.read(hash),
      pdfPaneWidth: this.settings.ui.aiPdfPaneWidth,
      onPdfPaneWidth: (width: number) => {
        this.settings.ui.aiPdfPaneWidth = width;
        void this.saveSettings();
      },
      // Development builds only. The panel is a raw request/response viewer —
      // useful while building, not something to ship inside a paid feature.
      // esbuild folds __DECKS_DEV__ to false in production and drops the branch.
      debugEnabled: __DECKS_DEV__ && this.settings.debug.enableLogging,
      // PDF attach is available to all providers: Decks Pro OCRs the pages,
      // any other provider uses free pdf.js text extraction.
      pdfAvailable: this.settings.ai.enabled,
      pdfOcr: this.pdfOcrCache,
      conceptLedger: this.settings.ai.enabled
        ? {
            extract: (source, sourcedPages, signal) =>
              this.aiConceptController.extract(source, sourcedPages, signal),
            load: async (sourceHash) => ({
              concepts: await this.db.getAiConcepts(sourceHash),
              extracted: await this.db.getAiExtractedPages(sourceHash),
            }),
            save: (sourceHash, pages, concepts) =>
              this.db.saveAiConcepts(sourceHash, pages, concepts),
            cards: (sourceHash, excludeSessionId) =>
              this.db.getAiCardsForSource(sourceHash, excludeSessionId),
            ...(this.aiMatchController?.isAvailable()
              ? {
                  map: (concepts, cards, signal) =>
                    this.aiMatchController.mapConcepts(concepts, cards, signal),
                  remember: (stagedId, conceptId) =>
                    this.db.updateAiStagedCard(stagedId, { conceptId }),
                }
              : {}),
          }
        : null,
      repairCards: this.settings.ai.enabled
        ? (ids, split) => void this.openRepairForCards(ids, split)
        : undefined,
      similar: this.aiMatchController?.isAvailable()
        ? (filePath, staged, signal) => this.aiMatchController.similar(filePath, staged, signal)
        : undefined,
      ask: this.settings.ai.enabled
        ? (req, signal) => this.aiChatController.ask(req, signal)
        : undefined,
      examPlanner: {
        mix: (filePath, typedGrading) => this.examMixFor(filePath, typedGrading),
        defaults: async (id) =>
          (await this.db.getProfileById(id))?.examSettings ?? null,
        saveDefaults: (id, examSettings) =>
          this.db.updateProfile(id, { examSettings }),
      },
    };
  }

  private showAiGeneratorLeaf(sessionId?: string): void {
    // Always a leaf: a session is a place you return to, and a modal cannot be
    // reopened with the workspace or dragged into a split.
    const { workspace } = this.app;
    const existing = workspace.getLeavesOfType(VIEW_TYPE_AI_GENERATOR);
    // Resuming a different session reuses the leaf rather than stacking tabs;
    // one workbench session at a time matches the hub it came from.
    const leaf = existing.length > 0 ? existing[0] : workspace.getLeaf("tab");
    // The label goes in with the state, so the tab reads right on first paint.
    void (sessionId ? this.db.getAiSession(sessionId).catch(() => null) : Promise.resolve(null))
      .then((session) => {
        const label = session ? sourceDisplayName(session.sourceRef) : null;
        return leaf.setViewState({
          type: VIEW_TYPE_AI_GENERATOR,
          active: true,
          state: sessionId ? (label ? { sessionId, label } : { sessionId }) : {},
        });
      })
      .then(() => {
        // setState normally takes the pending options; this covers a leaf that was not asked.
        const view = leaf.view;
        const pending = this.pendingGeneratorOptions;
        this.pendingGeneratorOptions = null;
        if (pending && view instanceof AiGeneratorView) view.setOptions(pending);
        void workspace.revealLeaf(leaf);
      })
      .catch(console.error);
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
  /** Reconcile a generator pile into the database. The session is created on
   *  the first write, so opening the generator alone leaves nothing behind. */
  private async persistAiSession(
    snapshot: AiSessionSnapshot,
  ): Promise<string | null> {
    if (snapshot.rows.length === 0 && !snapshot.sessionId) return null;

    let id = snapshot.sessionId;
    const deckId = snapshot.destinationPath ? generateDeckId(snapshot.destinationPath) : null;
    if (id) {
      // The source follows the PDF in use; a view without its PDF never erases the one stored.
      const source =
        snapshot.sourceKind === "pdf" && snapshot.sourceHash
          ? {
              sourceKind: snapshot.sourceKind,
              sourceRef: snapshot.sourceRef,
              sourceHash: snapshot.sourceHash,
              selectedIds: snapshot.selectedIds,
            }
          : {};
      await this.db.updateAiSession(id, {
        ...source,
        model: snapshot.model,
        turns: snapshot.turns,
        // Only once the session has saved somewhere; an unsaved one keeps what it had.
        deckId: deckId ?? undefined,
        profileId: snapshot.profileId ?? undefined,
      });
    } else {
      id = await this.db.createAiSession({
        sourceKind: snapshot.sourceKind,
        sourceRef: snapshot.sourceRef,
        sourceHash: snapshot.sourceHash,
        selectedIds: snapshot.selectedIds,
        deckId,
        profileId: snapshot.profileId,
        model: snapshot.model,
        spendCents: 0,
        turns: snapshot.turns,
        archived: false,
      });
    }

    // An upsert, so re-writing the whole pile is idempotent and a row's latest
    // state always wins over what was stored a moment ago.
    await this.db.createAiStagedCards(stagedCardsFromSnapshot(snapshot, id));
    // Taken off the pile by Clear or Undo; left as kept they would still count.
    for (const dropped of snapshot.droppedIds) {
      await this.db.updateAiStagedCard(`${id}:${dropped}`, { status: "discarded" });
    }
    this.scheduleAiStatus();
    return id;
  }

  /**
   * What an attempt could already draw from a destination note. Counted through
   * the same pool the setup dialog builds, so the blueprint and the dialog
   * cannot disagree.
   */
  private async examMixFor(
    filePath: string,
    typedGrading: TypedGradingMode,
  ): Promise<QuestionMix> {
    const cards = await this.db.getFlashcardsByDeck(generateDeckId(filePath));
    const examDeckIds = new Set(await this.db.getExamEnabledDeckIds());
    const examEnabledByDeckId = new Map<string, boolean>();
    for (const card of cards) {
      examEnabledByDeckId.set(card.deckId, examDeckIds.has(card.deckId));
    }
    const pool = buildExamPool(cards, examEnabledByDeckId, typedGrading);
    return mixFromPool(pool.eligible);
  }

  /**
   * The two routes out of a finished attempt: write cards where there are
   * none, repair the ones that keep being missed.
   */
  /** The ledger's concepts on the missed pages, so the prompt can name them. */
  private async missedConcepts(
    sourceHash: string | null,
    pages: number[],
  ): Promise<Array<{ term: string; page: number }>> {
    if (!sourceHash) return [];
    const onPages = new Set(pages);
    try {
      const concepts = await this.db.getAiConcepts(sourceHash);
      // A handful names the gap; the whole ledger would bury it.
      return concepts
        .filter((c) => onPages.has(c.page))
        .slice(0, 12)
        .map((c) => ({ term: c.term, page: c.page }));
    } catch {
      return [];
    }
  }

  private examMissHooks(): ExamMissHooks {
    return {
      onSessionFromMisses: ({ pages, sourceRef, sourceHash }) => {
        void this.missedConcepts(sourceHash, pages).then((concepts) =>
          this.openAiGeneratorModal(undefined, {
            prompt: missesSessionPrompt(pages, concepts),
            pdfPath: sourceRef || undefined,
            pages,
          }),
        );
      },
      onRepairCards: (cardIds) => {
        void this.openRepairForCards(cardIds);
      },
      judge: () => this.aiGradingController?.judge() ?? Promise.resolve(null),
    };
  }

  private async openRepairForCards(cardIds: string[], split = false): Promise<void> {
    const cards: Flashcard[] = [];
    for (const id of cardIds) {
      const card = await this.db.getFlashcardById(id);
      if (card) cards.push(card);
    }
    if (cards.length === 0) return;
    await this.openBatchRefactorModal(cards, undefined, split);
  }

  /**
   * A card that keeps lapsing offers the two things that help: the page it came
   * from, and a fix grounded in that page.
   */
  private reviewRepairHooks(): ReviewRepairHooks {
    return {
      resolve: (card) => resolveCardSource(this.db, card),
      read: ({ page, path }) => {
        void openVaultPdf(this.app, path, page);
      },
      fix: (card, source) => {
        void this.sourcePageText(source).then((text) =>
          this.openBatchRefactorModal([card], text || undefined),
        );
      },
    };
  }

  /** One page of a source, from the OCR cache when the generator already
   *  transcribed it, and from the PDF's own text layer otherwise. */
  private async sourcePageText(source: CardSource): Promise<string> {
    const file = this.app.vault.getAbstractFileByPath(source.path);
    if (!(file instanceof TFile)) return "";
    try {
      const bytes = await this.app.vault.readBinary(file);
      // Hash first: pdf.js detaches the buffer it is handed.
      const hash = hashPdf(bytes);
      const cached = await this.pdfOcrCache.get(
        hash,
        ocrSentinelForTier(this.aiDefaultModel()),
        source.page,
      );
      if (cached) return `${pageMarker(source.page)}\n${cached}`;
      const doc = await loadPdf(bytes);
      return await buildSectionContent(doc, [source.page], "text", () =>
        Promise.resolve(new Map<number, string>()),
      );
    } catch (e) {
      console.debug("Decks: could not read the card's source page", e);
      return "";
    }
  }

  /** Drop kept PDF copies that no session, archived or not, still refers to. */
  private async pruneAiSourcePdfs(): Promise<void> {
    try {
      const sessions = await this.db.getAiSessions(true);
      // An empty list is more likely a database that did not load than one with no sessions.
      if (sessions.length === 0) return;
      const keep = new Set(sessions.map((s) => s.sourceHash).filter((h): h is string => Boolean(h)));
      await this.aiSourcePdfs.prune(keep);
    } catch (error) {
      this.logger.debug("pruning kept AI source PDFs failed", error);
    }
  }

  /** Reveal the hub, reusing its leaf. Refreshed on every open, since the pile
   *  changes underneath it whenever the generator runs. */
  async openAiWorkbench(): Promise<void> {
    const { workspace } = this.app;
    const existing = workspace.getLeavesOfType(VIEW_TYPE_AI_WORKBENCH);
    const leaf = existing.length > 0 ? existing[0] : workspace.getLeaf("tab");
    await leaf.setViewState({ type: VIEW_TYPE_AI_WORKBENCH, active: true });
    if (leaf.view instanceof AiWorkbenchView) await leaf.view.refresh();
    await workspace.revealLeaf(leaf);
  }

  /** A session and its pile, for Resume. Discarded cards come back too — a
   *  dropped card is still evidence of what the model proposed. */
  private async loadAiSessionForResume(
    id: string,
  ): Promise<AiSessionRestore | null> {
    const session = await this.db.getAiSession(id);
    if (!session) return null;
    const cards = await this.db.getAiStagedCards(id);
    const deck = session.deckId ? await this.db.getDeckById(session.deckId) : null;
    const destinationPath =
      deck && this.app.vault.getAbstractFileByPath(deck.filepath) ? deck.filepath : null;
    return { session, cards, destinationPath };
  }

  /** Everything the workbench hub shows, in four indexed queries. */
  private async loadAiWorkbench(): Promise<AiWorkbenchData> {
    const since = new Date(Date.now() - 7 * 86400_000).toISOString();
    const [sessions, counts, flagged, outcome] = await Promise.all([
      this.db.getAiSessions(true),
      this.db.getAiSessionCounts(),
      this.db.getFlaggedAiStagedCards(),
      this.db.getAiOutcome(since),
    ]);
    const open = this.app.workspace
      .getLeavesOfType(VIEW_TYPE_AI_GENERATOR)
      .map((leaf) => leaf.view.getState() as { sessionId?: unknown })
      .find((state) => typeof state.sessionId === "string");
    const provider = this.settings.ai.provider;
    const options = this.settings.ai.enabled ? buildModelOptions(provider, this.aiDefaultModel()) : [];
    return {
      sessions,
      counts,
      flagged,
      outcome,
      activeSessionId: typeof open?.sessionId === "string" ? open.sessionId : null,
      gap: await this.lastSessionGap(sessions).catch(() => null),
      model: options.length > 1 ? { options, selected: this.aiDefaultModel() } : null,
    };
  }

  /** Concepts the most recent live source-backed session has no card for. */
  private async lastSessionGap(sessions: AiSession[]): Promise<AiWorkbenchGap | null> {
    const last = sessions.find((s) => !s.archived && s.sourceHash);
    if (!last?.sourceHash) return null;
    const concepts = await this.db.getAiConcepts(last.sourceHash);
    if (concepts.length === 0) return null;
    const cards = await this.db.getAiCardsForSource(last.sourceHash);
    const missing = buildConceptRows(concepts, cards).filter((r) => r.state === "no_card");
    if (missing.length === 0) return null;
    return {
      sessionId: last.id,
      source: sourceDisplayName(last.sourceRef) ?? last.sourceRef,
      concepts: missing.map((r) => ({ term: r.term, page: r.page })),
    };
  }

  /** Ids the destination deck already holds. A file that is not yet a deck has
   *  nothing to check against, which is correct. */
  private async existingDeckCardIds(
    request: GeneratorSaveRequest,
  ): Promise<Set<string>> {
    if (request.kind !== "append") return new Set();
    const deck = await this.db.getDeckByFilepath(request.filePath);
    if (!deck) return new Set();
    const cards = await this.db.getFlashcardsByDeck(deck.id);
    return new Set(cards.map((c) => c.id));
  }

  private async saveGeneratedCards(
    input: GeneratedCard[],
    request: GeneratorSaveRequest,
  ): Promise<{
    ok: boolean;
    error?: string;
    count?: number;
    skipped?: number;
    elsewhere?: number;
    deckId?: string;
    filePath?: string;
  }> {
    try {
      // In-run dedup only compares against the current run; this is what stops
      // a second copy of a card the user already learned.
      const { fresh, duplicates } = partitionAgainstDeck(
        input,
        await this.existingDeckCardIds(request),
      );
      const skipped = duplicates.length;
      const destination =
        request.kind === "append" ? await this.db.getDeckByFilepath(request.filePath) : null;
      const held = await heldByOtherDecks(this.db, fresh, destination?.id ?? null);
      const elsewhere = held.size;
      const cards = fresh.filter((card) => !held.has(card));
      if (cards.length === 0) {
        return { ok: true, count: 0, skipped, elsewhere, filePath: request.kind === "append" ? request.filePath : undefined };
      }
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
        return { ok: true, count: cards.length, skipped, elsewhere, deckId, filePath };
      } else {
        // Append to any vault file. Use the existing deck's profile if the file
        // is already a deck, otherwise the default profile; then register/sync.
        const existing = await this.db.getDeckByFilepath(request.filePath);
        const profileId =
          existing?.profileId ?? (await this.db.getDefaultProfile()).id;
        const profile =
          (await this.db.getProfileById(profileId)) ??
          (await this.db.getDefaultProfile());
        await this.flashcardComposer.saveGenerated(cards, {
          kind: "append",
          format: request.format,
          filePath: request.filePath,
          level: profile.headerLevel,
        });
        const tag =
          request.format === "canvas"
            ? this.settings.canvasDecks.tagName || this.settings.parsing.deckTag
            : this.settings.parsing.deckTag;
        const deckId = await this.registerGeneratedDeck(
          request.filePath,
          tag,
          profileId,
        );
        return {
          ok: true,
          count: cards.length,
          skipped,
          elsewhere,
          deckId,
          filePath: request.filePath,
        };
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

      const totalTime = performance.now() - startTime;
      this.logger.performance(
        `Initial sync completed successfully in ${formatTime(totalTime)}`
      );
    } catch (error) {
      console.error("Error during initial sync:", error);
      // Don't throw - let the app continue working even if initial sync fails
    }

    // Outside the try above: a refresh that throws must not take the migration
    // with it. It used to, silently — a vault reached 370 reviewed cards with
    // two of them anchored, because the failure that skipped it also hid it.
    await this.runAnchorMigrationOnce();
    this.startAnchorUpgrades();
  }

  private anchorUpgradeRunning = false;

  // Rewrites minted anchor tokens a few notes a minute, never during a sync.
  private startAnchorUpgrades(): void {
    const notes = new ObsidianNoteAccess(this.app);
    const upgrader = new AnchorUpgrader(
      notes,
      this.db,
      new AnchorStamper(notes, this.db, this.logger),
      this.logger
    );
    const tick = async (): Promise<void> => {
      if (this.anchorUpgradeRunning || this.deckSynchronizer.isInProgress) return;
      this.anchorUpgradeRunning = true;
      try {
        this.syncLog.announce();
        const decks = (await this.db.getAllDecksWithProfiles()).map((deck) => ({
          id: deck.id,
          filepath: deck.filepath,
          titleMode: parseHeaderLevels(deck.profile).includes(0),
        }));
        await upgrader.runBatch(decks, 5);
      } catch (error) {
        this.logger.debug("Anchor upgrade batch failed", error);
      } finally {
        this.anchorUpgradeRunning = false;
      }
    };
    this.registerInterval(window.setInterval(() => void tick(), 60_000));
  }

  /** For settings: cards still resolving through this device's bindings. Older devices are only logged. */
  async cardIdentityPending(): Promise<number> {
    const older = await this.syncLog.olderDevices().catch(() => []);
    if (older.length > 0) this.logger.debug("Card identity: devices on an older version", older);
    return AnchorUpgrader.pendingCount(this.db);
  }

  // One-time anchor migration: runs after the first full sync (cards must
  // exist in the DB). Misses fall back to lazy stamping at review time.
  private async runAnchorMigrationOnce(): Promise<void> {
    if (this.settings.anchorMigrationV1Done) return;
    try {
      const stamper = new AnchorStamper(new ObsidianNoteAccess(this.app), this.db, this.logger);
      const migrator = new AnchorMigrator(this.app, this.db, stamper, this.logger);
      await migrator.run(this.settings.ui?.enableNotices !== false);
      // Only once it has actually run. Marking it done up front meant a single
      // failure retired the pass permanently.
      this.settings.anchorMigrationV1Done = true;
      await this.saveSettings();
    } catch (error) {
      this.logger.error("Anchor migration failed", error);
    }
  }

  /** Repaint the settings panel if it is currently mounted. */
  private refreshSettingsTab(): void {
    if (this.settingTab?.containerEl.isConnected) this.settingTab.display();
  }

  // Completes the obsidian://decks-auth hand-off started from settings. The
  // nonce check lives in DecksProAuth, so a stray or replayed URL is rejected.
  private async completeProSignIn(state?: string, code?: string): Promise<void> {
    if (!this.decksProAuth) return;
    const s = I18n.t.settings.ai;
    try {
      const ok = await this.decksProAuth.completeSignIn({ state, code });
      new Notice(ok ? s.signInSuccess : s.signInFailed);
      if (ok) {
        // Decks Pro becomes usable immediately; select it if AI is still unset.
        if (!this.settings.ai.enabled) {
          this.settings.ai.enabled = true;
        }
        this.settings.ai.provider = "decks-pro";
        await this.saveSettings();
        // The settings panel rendered its signed-out state before the browser
        // round-trip; repaint so it reflects the account without a reopen.
        this.refreshSettingsTab();
      }
    } catch (error) {
      this.logger.error("Decks Pro sign-in failed", error);
      new Notice(s.signInFailed);
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
