import type {
  AiProviderConfig,
  AiRefactoringService,
  RefactorFieldSet,
  RefactorImage,
  RefactorResult,
} from "@decks/core";
import type { Flashcard } from "../database/types";
import type { DecksSettings } from "../settings";
import type { AiKeyStore } from "./AiKeyStore";
import { buildAiConfig } from "./ai-config";
import type { FlashcardEdits } from "./FlashcardWriter";

/** Map a stored Flashcard to the editable field set for its type. */
export function cardToRefactorFieldSet(card: Flashcard): RefactorFieldSet {
  switch (card.type) {
    case "header-paragraph":
      return { type: "header-paragraph", front: card.front, back: card.back };
    case "table":
      return {
        type: "table",
        front: card.front,
        back: card.back,
        notes: card.notes ?? "",
      };
    case "cloze":
      return { type: "cloze", front: card.front, sentence: card.back };
    case "spatial":
      return {
        type: "spatial",
        front: card.front,
        back: card.back,
        hint: card.hint ?? "",
      };
    case "image-occlusion":
      return {
        type: "image-occlusion",
        listItem: extractImageOcclusionItem(card),
      };
  }
}

/** Convert a (proposed) field set into a FlashcardWriter edit. Shapes match 1:1. */
export function fieldSetToEdits(fields: RefactorFieldSet): FlashcardEdits {
  switch (fields.type) {
    case "header-paragraph":
      return { type: "header-paragraph", front: fields.front, back: fields.back };
    case "table":
      return {
        type: "table",
        front: fields.front,
        back: fields.back,
        notes: fields.notes,
      };
    case "cloze":
      return { type: "cloze", front: fields.front, sentence: fields.sentence };
    case "spatial":
      return {
        type: "spatial",
        front: fields.front,
        back: fields.back,
        hint: fields.hint,
      };
    case "image-occlusion":
      return { type: "image-occlusion", listItem: fields.listItem };
  }
}

function extractImageOcclusionItem(card: Flashcard): string {
  if (card.type !== "image-occlusion" || card.clozeOrder === null) {
    return card.clozeText ?? "";
  }
  const items: string[] = [];
  for (const line of card.back.split("\n")) {
    const m = /^\s*\d+\.\s+(.+)$/.exec(line);
    if (m) items.push(m[1]);
  }
  return items[card.clozeOrder] ?? card.clozeText ?? "";
}

/**
 * Plugin-side glue around the core AiRefactoringService: resolves the active
 * provider config (settings + non-synced key store) and delegates the refactor
 * to core. The system layer is the built-in master prompt; any extra guidance
 * comes from the user's composer instructions.
 */
export class AiRefactorController {
  constructor(
    private readonly service: AiRefactoringService,
    private readonly settings: DecksSettings,
    private readonly keyStore: AiKeyStore,
  ) {}

  isEnabled(): boolean {
    return this.settings.ai.enabled;
  }

  async buildConfig(): Promise<AiProviderConfig> {
    return buildAiConfig(this.settings, this.keyStore);
  }

  async refactorCard(
    _card: Flashcard,
    current: RefactorFieldSet,
    options?: {
      instructions?: string;
      targetKeys?: string[];
      sourceContext?: string;
      images?: RefactorImage[];
      split?: boolean;
    },
    signal?: AbortSignal,
  ): Promise<RefactorResult> {
    const config = await this.buildConfig();
    return this.service.refactorCard(
      config,
      {
        current,
        instructions: options?.instructions,
        targetKeys: options?.targetKeys,
        sourceContext: options?.sourceContext,
        images: options?.images,
        split: options?.split,
        // When debug logging is on, ask core to attach the prompt + raw response
        // so the modal can show a "Last request / response" panel.
        debug: this.settings.debug.enableLogging,
      },
      signal,
    );
  }
}
