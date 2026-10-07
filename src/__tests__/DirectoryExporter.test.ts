import { DEFAULT_DECK_PROFILE, deckWithProfile, type DeckWithProfile } from "@decks/core";
import { planExportDecks } from "../services/DirectoryExporter";

function deck(filepath: string, name: string): DeckWithProfile {
  return deckWithProfile(
    { id: filepath, name, filepath, tag: "#decks", lastReviewed: null, profileId: "profile_default", created: "", modified: "" },
    { ...DEFAULT_DECK_PROFILE, id: "profile_default", created: "", modified: "" }
  );
}

const vocabulary = deck("German/A1/German A1 Vocabulary.md", "German A1 Vocabulary");
const grammar = deck("German/A1/German A1 Grammar.md", "German A1 Grammar");
const verbs = deck("German/A1/German A1 Verbs.md", "German A1 Verbs");

describe("planExportDecks", () => {
  it("gives a single deck the package's own key", () => {
    expect(planExportDecks([vocabulary])).toEqual([{ deck: vocabulary, key: "", title: "German A1 Vocabulary" }]);
  });

  it("names several decks without the words they share", () => {
    expect(planExportDecks([vocabulary, grammar]).map(({ key, title }) => [key, title])).toEqual([
      ["vocabulary", "Vocabulary"],
      ["grammar", "Grammar"],
    ]);
  });

  it("keeps the keys given before, even when a new note changes the shared words", () => {
    const saved = { [vocabulary.filepath]: "vocabulary", [grammar.filepath]: "grammar" };
    const extra = deck("German/A1/Listening practice.md", "Listening practice");
    expect(planExportDecks([vocabulary, grammar, extra], saved).map(({ key }) => key)).toEqual([
      "vocabulary",
      "grammar",
      "listening-practice",
    ]);
  });

  it("never gives two decks the same key", () => {
    const twin = deck("German/A2/German A1 Verbs.md", "German A1 Verbs");
    expect(planExportDecks([verbs, twin]).map(({ key }) => key)).toEqual(["verbs", "verbs-2"]);
  });
});
