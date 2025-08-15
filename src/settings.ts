import { DEFAULT_FSRS_PARAMETERS } from "./algorithm/fsrs-weights";

export interface FlashcardsSettings {
  // Review Session Settings
  review: {
    showProgress: boolean;
    enableKeyboardShortcuts: boolean;
  };

  // Parsing Settings
  parsing: {
    // Parsing settings can be added here in the future
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
  },

  parsing: {
    // Default parsing settings
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
