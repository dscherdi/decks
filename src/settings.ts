import { type AiProviderId, type LanguagePreference } from "@decks/core";
import {
  type ReviewShortcuts,
  DEFAULT_REVIEW_SHORTCUTS,
} from "./utils/shortcuts";

export type DeckListSortMode =
  | "name-asc"
  | "name-desc"
  | "new-asc"
  | "new-desc"
  | "due-asc"
  | "due-desc";

export interface DecksSettings {
  // Review Session Settings
  review: {
    showProgress: boolean;
    enableKeyboardShortcuts: boolean;
    shortcuts: ReviewShortcuts; // Customizable review keys (4 ratings + reveal)
    sessionDuration: number; // Session duration in minutes (1-60, default 25)
    nextDayStartsAt: number; // Hour (0-23) when study day rolls over (default 4 AM)
    leechThreshold: number; // Lapses count at/above which a card is flagged as a leech (default 8)
    denseCardCharThreshold: number; // back text length (chars) at/above which a card is flagged as dense (default 500)
    hasGlobalReviewCap: boolean; // When true, cap total review cards per day across ALL decks combined
    globalReviewCapAmount: number; // Max review cards per day across all decks (when hasGlobalReviewCap)
  };

  // Parsing Settings
  parsing: {
    folderSearchPath: string; // Folder path to scan for flashcard files, empty means scan entire vault
    deckTag: string; // Base tag used to identify flashcard decks (e.g., "#decks", "#flashcards")
  };

  // Canvas decks: any Obsidian .canvas file inside `folderPath` becomes a
  // deck tagged with `tagName`. Empty folderPath disables canvas scanning.
  canvasDecks: {
    folderPath: string;
    tagName: string;
  };

  // UI Settings
  ui: {
    enableBackgroundRefresh: boolean;
    backgroundRefreshInterval: number; // seconds
    enableNotices: boolean;
    reviewDisplayMode: "modal" | "tab";
    flashcardManagerDisplayMode: "modal" | "tab";
    aiGeneratorDisplayMode: "modal" | "tab";
    // Deck / group / custom-deck ids the user has pinned to the top of
    // the deck list. Synced across devices via data.json.
    pinnedDeckIds: string[];
    // Active sort key + direction for the deck list column headers.
    deckListSort: DeckListSortMode;
    // Decks with totalCount strictly less than this number are hidden
    // from the list. Pinned decks are exempt. 0 disables the filter.
    minDeckCardCount: number;
    // Per-column widths (in pixels) for the flashcard manager table.
    // Empty object means use defaults from the grid template.
    managerColumnWidths: Record<string, number>;
  };

  // Backup Settings
  backup: {
    enableAutoBackup: boolean;
    maxBackups: number;
  };

  // Debug Settings
  debug: {
    enableLogging: boolean;
    performanceLogs: boolean;
  };

  // File location settings. All paths are vault-relative — empty/unset uses
  // the per-field default so existing installs are unaffected. The intended
  // use case is moving these files out of the hidden .obsidian/ folder so
  // iCloud syncs them at first-class priority instead of the deprioritized
  // hidden-directory tier.
  paths: {
    // Folder holding the SQLite DB. Default: plugin folder (".obsidian/plugins/decks").
    // Changes require a restart to take effect.
    dbFolder: string;
    // Folder for periodic backups. Default: plugin folder + "/backups".
    // Read on demand by BackupService, so changes take effect immediately
    // without restart.
    backupFolder: string;
    // Folder for the per-device .deckssynclog files. Default: vault root.
    // Changes require a restart to take effect.
    syncLogFolder: string;
  };

  // Internationalization
  i18n: {
    language: LanguagePreference; // "auto" follows Obsidian's getLanguage()
  };

  // AI features (global). Refactor prompts are per-DeckProfile; this section is
  // the global toggle + active provider/model. API keys are NOT stored here —
  // they live in a separate non-synced file (see AiKeyStore) so secrets never
  // land in data.json.
  ai: {
    enabled: boolean;
    provider: AiProviderId;
    models: Record<AiProviderId, string>;
    localBaseUrl: string; // for the openai-compatible provider
  };

  // Table template engine. Templates are authored as markdown files inside
  // `templateFolder` and synced to the deck_templates DB cache; empty disables.
  templates: {
    templateFolder: string;
  };

  // Internal tracking
  hasCreatedTestDeck: boolean;
  hasCreatedCanvasTestDeck: boolean;
}

export const DEFAULT_SETTINGS: DecksSettings = {
  review: {
    showProgress: true,
    enableKeyboardShortcuts: true,
    shortcuts: { ...DEFAULT_REVIEW_SHORTCUTS },
    sessionDuration: 25,
    nextDayStartsAt: 4,
    leechThreshold: 8,
    denseCardCharThreshold: 500,
    hasGlobalReviewCap: false,
    globalReviewCapAmount: 100,
  },

  parsing: {
    folderSearchPath: "", // Default: scan entire vault
    deckTag: "#decks",
  },

  canvasDecks: {
    folderPath: "", // Default: canvas scanning disabled
    tagName: "#decks/canvas",
  },

  ui: {
    enableBackgroundRefresh: true,
    backgroundRefreshInterval: 120,
    enableNotices: false,
    reviewDisplayMode: "modal",
    flashcardManagerDisplayMode: "modal",
    aiGeneratorDisplayMode: "modal",
    pinnedDeckIds: [],
    deckListSort: "name-asc",
    minDeckCardCount: 0,
    managerColumnWidths: {},
  },

  backup: {
    enableAutoBackup: true,
    maxBackups: 5,
  },

  debug: {
    enableLogging: false,
    performanceLogs: false,
  },

  paths: {
    dbFolder: "",
    backupFolder: "",
    syncLogFolder: "",
  },

  i18n: {
    language: "auto",
  },

  ai: {
    enabled: false,
    provider: "openai",
    models: {
      gemini: "gemini-3.5-flash",
      openai: "gpt-5.4-mini",
      claude: "claude-haiku-4-5-20251001",
      "openai-compatible": "gemma3",
    },
    localBaseUrl: "http://localhost:11434/v1",
  },

  templates: {
    templateFolder: "",
  },

  hasCreatedTestDeck: false,
  hasCreatedCanvasTestDeck: false,
};
