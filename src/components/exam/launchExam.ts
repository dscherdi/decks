import { App, Notice } from "obsidian";
import {
  ExamAttempt,
  buildExamPool,
  drawExamQuestions,
  I18n,
  type DeckProfile,
  type ExamDeckKind,
  type ExamSettings,
} from "@decks/core";
import type { DeckOrGroup, Flashcard } from "@/database/types";
import type { DecksSettings } from "@/settings";
import type { IDatabaseService } from "@/database/DatabaseFactory";
import { ExamSetupModal } from "./ExamSetupModal";

export interface ExamLaunchContext {
  app: App;
  db: IDatabaseService;
  settings: DecksSettings;
}

/**
 * Shared exam-launch flow used by both deck-list hosts (the leaf view and the
 * modal). The host supplies how cards are gathered for the selection and how
 * the resulting session is opened (modal vs tab, return-to-list behaviour).
 */
export async function launchExamForSelection(
  ctx: ExamLaunchContext,
  selection: DeckOrGroup,
  profile: DeckProfile | null,
  gatherCards: (selection: DeckOrGroup) => Promise<Flashcard[]>,
  openSession: (
    attempt: ExamAttempt,
    deckName: string,
    onRetake: () => void
  ) => void
): Promise<void> {
  try {
    const cards = await gatherCards(selection);
    const examDeckIds = new Set(await ctx.db.getExamEnabledDeckIds());
    const examEnabledByDeckId = new Map<string, boolean>();
    for (const card of cards) {
      examEnabledByDeckId.set(card.deckId, examDeckIds.has(card.deckId));
    }
    const initial: ExamSettings = profile?.examSettings ?? ctx.settings.exam;
    const showClozeContext = (profile?.clozeShowContext ?? "open") === "open";

    const pool = buildExamPool(
      cards,
      examEnabledByDeckId,
      initial.typedGrading,
      showClozeContext
    );
    if (pool.eligible.length === 0) {
      if (ctx.settings?.ui?.enableNotices !== false) {
        new Notice(I18n.t.exam.noQuestions);
      }
      return;
    }

    new ExamSetupModal(
      ctx.app,
      selection.name,
      pool.eligible.length,
      pool.skipped.length,
      initial,
      (finalSettings) => {
        // The string-grading ceiling affects eligibility, so re-pool when
        // the grading mode was changed in the dialog.
        const finalPool =
          finalSettings.typedGrading === initial.typedGrading
            ? pool
            : buildExamPool(
                cards,
                examEnabledByDeckId,
                finalSettings.typedGrading,
                showClozeContext
              );
        if (finalPool.eligible.length === 0) {
          new Notice(I18n.t.exam.noQuestions);
          return;
        }
        const deckKey =
          selection.type === "file" || selection.type === "custom"
            ? selection.id
            : selection.tag;
        const deckKind: ExamDeckKind =
          selection.type === "file"
            ? "file"
            : selection.type === "custom"
              ? "custom"
              : "group";
        const attempt = new ExamAttempt({
          questions: drawExamQuestions(finalPool.eligible, finalSettings),
          settings: finalSettings,
          deckKey,
          deckKind,
        });
        openSession(attempt, selection.name, () =>
          void launchExamForSelection(
            ctx,
            selection,
            profile,
            gatherCards,
            openSession
          )
        );
      }
    ).open();
  } catch (error) {
    console.error("Error starting exam:", error);
    if (ctx.settings?.ui?.enableNotices !== false) {
      new Notice(I18n.t.exam.noQuestions);
    }
  }
}
