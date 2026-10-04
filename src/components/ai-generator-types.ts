import type {
  AiProviderId,
  AiSession,
  AiSessionTurn,
  AiSourceKind,
  AiStagedCard,
  CardOrigin,
  CardVerdict,
  ChatRequest,
  ChatResult,
  ConceptCard,
  ConceptMapCard,
  CritiqueCard,
  OverlapCard,
  ExamSettings,
  GeneratedCard,
  GeneratedCardType,
  GenerateHandlers,
  McqProblem,
  GenerateResult,
  PdfOcrCache,
  QuestionMix,
  RefactorImage,
  SourceConcept,
  TypedGradingMode,
} from "@decks/core";
import type { PdfReading } from "../settings";
import type { ChapterNode, PdfDoc } from "../utils/pdf";
import type { GeneratorSaveRequest, ProfileOpt } from "./generator-save";

/** A generated card plus the batch-review UI's keep/saved state. */
export interface GenRow {
  id: string;
  card: GeneratedCard;
  keep: boolean;
  saved: boolean;
  /** The rubric verdict. Absent while the pass runs and when it could not run:
   *  an unjudged card is not a passing one. */
  verdict?: CardVerdict;
  /** The row this one replaced, and how. A fix drops its parent, never deletes
   *  it. */
  parentId?: string;
  origin?: CardOrigin;
  /** True while this row's fix is in flight. */
  fixing?: boolean;
  /** The parse fault in a generated question; undefined when it is sound. */
  invalid?: McqProblem;
  /** The source concept this card was mapped to; null when it tests none listed. */
  conceptId?: string | null;
  /** Fronts of cards in the destination deck that test the same fact. */
  similarTo?: string[];
}

/** An attached PDF and its chapter selection. The parse path (OCR vs text) is
 * derived from the active provider at resolve time, not stored per attachment. */
export interface PdfAttachment {
  /** Matches the composer pill's ContextItem id (`pdf:<hash>`). */
  contextId: string;
  label: string;
  /** Vault path, when the PDF came from the vault. Absent for a dropped or
   *  pasted one, whose cards show a page without a jump-back. */
  vaultPath?: string;
  doc: PdfDoc;
  hash: string;
  chapters: ChapterNode[];
  selectedIds: Set<string>;
}

/** A tab entry for the chapter panel — one per attached PDF. */
export interface PdfTab {
  id: string;
  label: string;
}

/** A vault note reference offered in the composer's @-mention autocomplete. */
export interface MentionItem {
  path: string;
  label: string;
}

/** One place a PDF can be attached from, listed in the composer's attach menu. */
export interface PdfSource {
  label: string;
  icon: string;
  onPick: () => void;
}

/** The generator's pile, as the database needs to see it. A whole-pile
 *  snapshot rather than a stream of mutations. */
export interface AiSessionSnapshot {
  /** null on the first write — the caller creates the session and returns its id. */
  sessionId: string | null;
  sourceKind: AiSourceKind;
  sourceRef: string;
  sourceHash: string | null;
  selectedIds: string[];
  model: string | null;
  cardType: GeneratedCardType;
  rows: GenRow[];
  /** The thread's questions and answers, so Resume reopens a conversation
   *  rather than a bare pile. */
  turns: AiSessionTurn[];
  /** Rows in rounds a refinement replaced; stored as superseded, not staged. */
  supersededRowIds: string[];
  /** Rows taken off the pile (Clear, Undo) since the last write; stored as discarded. */
  droppedIds: string[];
  /** Where this session saved to, once it has; remembered for Resume. */
  destinationPath: string | null;
  profileId: string | null;
}

/** A persisted session and its pile, handed back to the generator on Resume. */
export interface AiSessionRestore {
  session: AiSession;
  cards: AiStagedCard[];
  /** The note the session last saved to, when it still exists. */
  destinationPath?: string | null;
}

/** The block shape lives in core beside the rules that operate on it. */
export type { ThreadBlock } from "@decks/core";

export interface AiGeneratorOptions {
  /** Persist a tier chosen here — settings no longer offers the control. */
  onModelChange?: (id: string) => void;
  /** Copies of PDFs attached from outside the vault, by hash, so Resume can reopen them. */
  keepSourcePdf?: (hash: string, bytes: ArrayBuffer) => Promise<void>;
  readSourcePdf?: (hash: string) => Promise<ArrayBuffer | null>;
  /** The PDF pane's remembered width, and where a dragged width is kept. */
  pdfPaneWidth?: number;
  onPdfPaneWidth?: (width: number) => void;
  generate: (
    options: {
      prompt: string;
      sourceContext?: string;
      images?: RefactorImage[];
      maxBatches?: number;
      existingCards?: GeneratedCard[];
      model?: string;
      cardType?: GeneratedCardType;
      debug?: boolean;
    },
    handlers: GenerateHandlers,
    signal: AbortSignal,
  ) => Promise<GenerateResult>;
  save: (
    cards: GeneratedCard[],
    request: GeneratorSaveRequest,
  ) => Promise<{
    ok: boolean;
    error?: string;
    count?: number;
    /** Proposed cards the destination deck already held. */
    skipped?: number;
    /** Proposed cards another deck already held, so they were not written. */
    elsewhere?: number;
    deckId?: string;
    filePath?: string;
  }>;
  /** Score a round against the rubric; null when the pass could not run. */
  critique: (
    cards: CritiqueCard[],
    model?: string,
    signal?: AbortSignal,
    cardType?: GeneratedCardType,
  ) => Promise<CardVerdict[] | null>;
  /** Apply a rubric fix, returning the replacement(s). */
  refine: (
    card: GeneratedCard,
    options: {
      instructions?: string;
      split?: boolean;
      cloze?: boolean;
      sourceContext?: string;
      model?: string;
    },
    signal?: AbortSignal,
  ) => Promise<GeneratedCard[]>;
  /** Write the pile and return its session. One seam rather than a method per
   *  mutation; called after each round, fix and save. */
  persistSession?: (snapshot: AiSessionSnapshot) => Promise<string | null>;
  /** Present only when resuming: loads the session and its pile. */
  restoreSession?: () => Promise<AiSessionRestore | null>;
  loadProfiles: () => Promise<ProfileOpt[]>;
  defaultFolder: string;
  canvasFolder: string;
  deckTag: string;
  aiProvider: AiProviderId;
  defaultModel: string;
  /** How attached PDF pages are read on the hosted provider. */
  pdfReading?: PdfReading;
  debugEnabled: boolean;
  /** Whether PDF attachment is offered (Decks Pro only for the initial rollout). */
  pdfAvailable: boolean;
  /** OCR-text cache used to resolve scanned PDF pages; null when unavailable. */
  pdfOcr: PdfOcrCache | null;
  /** The concept ledger's operations, or null when no AI is configured. */
  conceptLedger: ConceptLedgerOps | null;
  /** Reads and stores what an exam blueprint needs. */
  examPlanner: ExamPlannerOps | null;
  /** Answer a question about the attached source; absent when AI is off. */
  ask?: (req: ChatRequest, signal?: AbortSignal) => Promise<ChatResult>;
  /** Opens the session aimed at something already — see UC-44. */
  seed?: AiSessionSeed;
  /** Fronts of the cards a deck note holds, for asking what the pile misses. */
  deckFronts?: (filePath: string) => Promise<string[]>;
  /** Open on this card with the flagged filter on, once the pile is restored. */
  focus?: { rowId: string };
  /** Finds cards in a destination file that test the same fact; absent when unavailable. */
  similar?: (filePath: string, staged: OverlapCard[], signal?: AbortSignal) => Promise<Map<string, string[]>>;
  /** Rework saved cards in place, by flashcard id; `split` offers each as several. */
  repairCards?: (flashcardIds: string[], split: boolean) => void;
}

/** What to open a fresh session pointed at. */
export interface AiSessionSeed {
  prompt: string;
  /** Vault path of the PDF to reattach. */
  pdfPath?: string;
  /** Pages to narrow the chapter selection to. */
  pages?: number[];
}

/** What the destination already offers an attempt, and where its defaults live. */
export interface ExamPlannerOps {
  mix: (
    filePath: string,
    typedGrading: TypedGradingMode,
  ) => Promise<QuestionMix>;
  defaults: (profileId: string) => Promise<ExamSettings | null>;
  saveDefaults: (profileId: string, settings: ExamSettings) => Promise<void>;
}

/** Read, store and score the examinable concepts in one source. */
export interface ConceptLedgerOps {
  extract: (
    source: string,
    sourcedPages: Set<number>,
    signal?: AbortSignal,
  ) => Promise<SourceConcept[]>;
  load: (sourceHash: string) => Promise<{
    concepts: Array<SourceConcept & { id: string }>;
    extracted: number[];
  }>;
  save: (
    sourceHash: string,
    pages: number[],
    concepts: SourceConcept[],
  ) => Promise<void>;
  /** Maps cards the term match missed to concepts; absent when unavailable. */
  map?: (
    concepts: Array<SourceConcept & { id: string }>,
    cards: ConceptMapCard[],
    signal?: AbortSignal,
  ) => Promise<Map<string, string | null>>;
  /** Stores a mapped concept on an earlier session's staged card. */
  remember?: (stagedId: string, conceptId: string) => Promise<void>;
  /** Cards this source has already produced, for the ledger's card counts. */
  cards: (
    sourceHash: string,
    excludeSessionId?: string,
  ) => Promise<ConceptCard[]>;
}
