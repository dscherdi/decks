import { DEFAULT_FSRS_PARAMETERS } from "./algorithm/fsrs-weights";

export interface FlashcardsSettings {
  // Review Session Settings
  review: {
    showProgress: boolean;
    enableKeyboardShortcuts: boolean;
    sessionDuration: number; // Session duration in minutes (1-60, default 25)
  };

  // Parsing Settings
  parsing: {
    folderSearchPath: string; // Folder path to scan for flashcard files, empty means scan entire vault
  };

  // UI Settings
  ui: {
    enableBackgroundRefresh: boolean;
    backgroundRefreshInterval: number; // seconds
    enableNotices: boolean;
  };

  // Debug Settings
  debug: {
    enableLogging: boolean;
    performanceLogs: boolean;
  };
}

export const DEFAULT_SETTINGS: FlashcardsSettings = {
  review: {
    showProgress: true,
    enableKeyboardShortcuts: true,
    sessionDuration: 25,
  },

  parsing: {
    folderSearchPath: "", // Default: scan entire vault
  },

  ui: {
    enableBackgroundRefresh: true,
    backgroundRefreshInterval: 5,
    enableNotices: true,
  },

  debug: {
    enableLogging: false,
    performanceLogs: false,
  },
};
