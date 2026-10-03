import {
  checkGeneratedMcq,
  generatedCardId,
  isQuestionShaped,
  type AiStagedCard,
} from "@decks/core";
import type { AiSessionSnapshot } from "../components/ai-generator-types";

/** The pile as staged-card rows. A question also stores its options and answers,
 *  so the pile can be read without re-parsing each card. */
export function stagedCardsFromSnapshot(
  snapshot: AiSessionSnapshot,
  sessionId: string,
): Array<Omit<AiStagedCard, "created" | "modified">> {
  const superseded = new Set(snapshot.supersededRowIds);
  return snapshot.rows.map((row) => {
    const origin = row.origin ?? "generate";
    const mcq =
      snapshot.cardType === "mcq" && isQuestionShaped(origin)
        ? checkGeneratedMcq(row.card)
        : null;
    return {
      id: `${sessionId}:${row.id}`,
      sessionId,
      front: row.card.front,
      back: row.card.back,
      notes: row.card.notes,
      cardType: snapshot.cardType,
      options: mcq?.valid ? mcq.mcq.options.map((o) => o.text) : null,
      correct: mcq?.valid ? mcq.mcq.correct : null,
      explanation: mcq?.valid ? mcq.mcq.explanation : null,
      valid: snapshot.cardType === "mcq" ? row.invalid === undefined : null,
      sourcePage: row.card.page ?? null,
      sectionIdx: row.card.section ?? null,
      conceptId: row.conceptId ?? null,
      status: row.saved
        ? "saved"
        : superseded.has(row.id)
          ? "superseded"
          : row.keep
            ? "kept"
            : "discarded",
      rubricVerdict: row.verdict?.verdict ?? null,
      rubricCodes: row.verdict?.codes ?? [],
      fixProposal: row.verdict?.fix || null,
      parentId: row.parentId ? `${sessionId}:${row.parentId}` : null,
      origin,
      dedupHash: generatedCardId(row.card),
    };
  });
}
