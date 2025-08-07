import { DEFAULT_SETTINGS, FlashcardsSettings } from "../settings";

describe("Settings", () => {
  describe("DEFAULT_SETTINGS", () => {
    it("should have enableBackgroundRefresh set to true by default", () => {
      expect(DEFAULT_SETTINGS.ui.enableBackgroundRefresh).toBe(true);
    });

    it("should have backgroundRefreshInterval set to 5 seconds by default", () => {
      expect(DEFAULT_SETTINGS.ui.backgroundRefreshInterval).toBe(5);
    });

    it("should have all required UI settings", () => {
      expect(DEFAULT_SETTINGS.ui).toHaveProperty("enableBackgroundRefresh");
      expect(DEFAULT_SETTINGS.ui).toHaveProperty("backgroundRefreshInterval");
    });

    it("should have valid types for UI settings", () => {
      expect(typeof DEFAULT_SETTINGS.ui.enableBackgroundRefresh).toBe(
        "boolean",
      );
      expect(typeof DEFAULT_SETTINGS.ui.backgroundRefreshInterval).toBe(
        "number",
      );
    });
  });

  describe("FlashcardsSettings interface compliance", () => {
    it("should match the interface structure", () => {
      const settings: FlashcardsSettings = DEFAULT_SETTINGS;

      // Verify the settings object conforms to the interface
      expect(settings.fsrs).toBeDefined();
      expect(settings.review).toBeDefined();
      expect(settings.parsing).toBeDefined();
      expect(settings.ui).toBeDefined();
      expect(settings.debug).toBeDefined();
    });

    it("should have debug settings with enableLogging and performanceLogs", () => {
      const debugSettings = DEFAULT_SETTINGS.debug;

      expect(debugSettings.enableLogging).toBeDefined();
      expect(debugSettings.performanceLogs).toBeDefined();
      expect(typeof debugSettings.enableLogging).toBe("boolean");
      expect(typeof debugSettings.performanceLogs).toBe("boolean");
    });

    it("should have valid UI settings structure", () => {
      const uiSettings = DEFAULT_SETTINGS.ui;

      expect(uiSettings.enableBackgroundRefresh).toBeDefined();
      expect(uiSettings.backgroundRefreshInterval).toBeDefined();
      expect(uiSettings.backgroundRefreshInterval).toBeGreaterThan(0);
    });
  });

  describe("Background refresh settings validation", () => {
    it("should have reasonable default values", () => {
      expect(DEFAULT_SETTINGS.ui.enableBackgroundRefresh).toBe(true);
      expect(DEFAULT_SETTINGS.ui.backgroundRefreshInterval).toBe(5);
    });

    it("should have interval within acceptable range", () => {
      const interval = DEFAULT_SETTINGS.ui.backgroundRefreshInterval;
      expect(interval).toBeGreaterThanOrEqual(1);
      expect(interval).toBeLessThanOrEqual(60);
    });
  });

  describe("Debug settings", () => {
    it("should have enableLogging set to false by default", () => {
      expect(DEFAULT_SETTINGS.debug.enableLogging).toBe(false);
    });

    it("should have performanceLogs set to false by default", () => {
      expect(DEFAULT_SETTINGS.debug.performanceLogs).toBe(false);
    });

    it("should have valid types for debug settings", () => {
      expect(typeof DEFAULT_SETTINGS.debug.enableLogging).toBe("boolean");
      expect(typeof DEFAULT_SETTINGS.debug.performanceLogs).toBe("boolean");
    });
  });
});
