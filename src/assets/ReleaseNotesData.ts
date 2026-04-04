import type { ReleaseNote } from "./ReleaseNotesTypes";

// Content injected at build time — DO NOT MODIFY THIS LINE
const RELEASE_NOTES_JSON = "__DECKS_RELEASE_NOTES_JSON__";

function parseReleaseNotes(): ReleaseNote[] {
  try {
    return JSON.parse(RELEASE_NOTES_JSON) as ReleaseNote[];
  } catch {
    return [];
  }
}

const RELEASE_NOTES: ReleaseNote[] = parseReleaseNotes();

export default RELEASE_NOTES;
