import { shouldShowReleaseNotes } from "@/utils/release-notes";
import { DEFAULT_SETTINGS } from "@/settings";

describe("showing release notes after an update", () => {
  it("shows them once per version, not on every launch", () => {
    expect(shouldShowReleaseNotes("2.6.0", "2.5.7")).toBe(true);
    // The version is recorded as soon as they are shown, so the next launch
    // must be silent — this is the difference between a notice and a nuisance.
    expect(shouldShowReleaseNotes("2.6.0", "2.6.0")).toBe(false);
  });

  it("shows them on a fresh install, where nothing has been seen", () => {
    expect(shouldShowReleaseNotes("2.6.0", "")).toBe(true);
    expect(shouldShowReleaseNotes("2.6.0", undefined)).toBe(true);
  });

  // Rolling back is still a different build from the one last shown.
  it("shows them on a downgrade", () => {
    expect(shouldShowReleaseNotes("2.5.7", "2.6.0")).toBe(true);
  });

  // Without a version there is nothing to compare, so every launch would count
  // as a change and reopen the tab forever.
  it("stays silent when the manifest has no version", () => {
    expect(shouldShowReleaseNotes("", "2.6.0")).toBe(false);
    expect(shouldShowReleaseNotes(undefined, "")).toBe(false);
  });

  // An existing install's data.json predates this field; the settings deep
  // merge supplies the default, and that default has to mean "not yet shown".
  it("defaults to unseen so an upgrade surfaces them", () => {
    expect(DEFAULT_SETTINGS.ui.lastSeenVersion).toBe("");
    expect(shouldShowReleaseNotes("2.6.0", DEFAULT_SETTINGS.ui.lastSeenVersion)).toBe(true);
  });
});
