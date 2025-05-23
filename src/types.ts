import { App, TFile, Component } from "obsidian";

export interface FlashcardsPluginSettings {
  defaultEaseFactor: number;
  defaultInterval: number;
}

export interface CardData {
  id: string;
  title: string;
  content: string;
  tags: string[];
  created: string;
  modified: string;
}

export interface FlashcardMetadata {
  name: string;
  created: string;
  lastModified: string;
  view: "table" | "card";
  sortBy: string;
  sortDirection: "asc" | "desc";
}

export interface FlashcardsData {
  metadata: FlashcardMetadata;
  cards: CardData[];
}

export interface ReviewData {
  lastReview: Date;
  nextReview: Date;
  interval: number;
  easeFactor: number;
  repetitions: number;
  canvasId?: string;
}

export interface ScheduleData {
  [cardId: string]: ReviewData;
}

export interface CardContent {
  question: string;
  answer: string;
}

export interface CardForReview extends CardData {
  question?: string;
  answer?: string;
  canvasId?: string;
  lastReview?: Date;
  nextReview?: Date;
  interval?: number;
  easeFactor?: number;
  repetitions?: number;
}

export interface ModalHandlers {
  close: () => void;
  updateCardSchedule: (card: CardForReview, quality: number) => Promise<void>;
}

export interface ViewState {
  viewType: string;
  state: unknown;
}

export interface WorkspaceLeaf {
  view: View;
  getViewState(): ViewState;
  setViewState(state: ViewState, options?: unknown): Promise<void>;
  openFile(file: TFile, options?: unknown): Promise<void>;
}

export interface View {
  app: App;
  containerEl: HTMLElement;
  contentEl: HTMLElement;
  onload(): void;
  onunload(): void;
}

export interface ItemView extends View {
  getViewType(): string;
  getDisplayText(): string;
  getIcon(): string;
  onOpen(): Promise<void>;
  onClose(): Promise<void>;
}

export interface CardEditorData {
  title: string;
  content: string;
  tags: string[];
  scheduleNow: boolean;
}

export interface FlashcardComponents {
  components: Component[];
}