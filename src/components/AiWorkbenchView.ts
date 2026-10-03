import { ItemView, WorkspaceLeaf } from "obsidian";
import { mount, unmount } from "svelte";
import { I18n } from "@decks/core";
import type { AiStagedCard } from "@decks/core";
import type { Svelte5MountedComponent } from "../types/svelte-components";
import AiWorkbenchHub from "./AiWorkbenchHub.svelte";
import type { AiWorkbenchData, AiWorkbenchGap, TriageAction } from "./ai-workbench-types";

export type { AiWorkbenchData, AiWorkbenchGap, TriageAction } from "./ai-workbench-types";

export const VIEW_TYPE_AI_WORKBENCH = "ai-workbench-view";

export interface AiWorkbenchOptions {
  load: () => Promise<AiWorkbenchData>;
  onOpenSession: (id: string) => void;
  onNewSession: () => void;
  setArchived: (id: string, archived: boolean) => Promise<void>;
  triage: (card: AiStagedCard, action: TriageAction) => Promise<void>;
  onGenerateGap: (gap: AiWorkbenchGap) => void;
  setModel: (id: string) => Promise<void>;
}

type HubComponent = Svelte5MountedComponent & { setData?(data: AiWorkbenchData): void };

/** The hub as a workspace leaf. Reads its contents from the database on open,
 *  which is what lets Obsidian restore it with the workspace. */
export class AiWorkbenchView extends ItemView {
  private component: HubComponent | null = null;
  private options: AiWorkbenchOptions | null = null;

  constructor(leaf: WorkspaceLeaf, options?: AiWorkbenchOptions) {
    super(leaf);
    this.options = options ?? null;
  }

  getViewType(): string {
    return VIEW_TYPE_AI_WORKBENCH;
  }

  getDisplayText(): string {
    return I18n.t.modals.aiGenerator.hub.title;
  }

  getIcon(): string {
    return "wand-2";
  }

  // eslint-disable-next-line @typescript-eslint/require-await -- Obsidian's ItemView lifecycle is async by contract; the work is deferred below.
  async onOpen(): Promise<void> {
    this.contentEl.empty();
    this.contentEl.addClass("decks-aiw-container");
    // Counts go stale while a session runs elsewhere; coming back re-reads them.
    this.registerEvent(
      this.app.workspace.on("active-leaf-change", (leaf) => {
        if (leaf === this.leaf) this.refresh().catch(console.error);
      }),
    );
    this.refresh().catch(console.error);
  }

  // eslint-disable-next-line @typescript-eslint/require-await -- see onOpen.
  async onClose(): Promise<void> {
    this.unmountComponent();
    this.contentEl.empty();
  }

  /** Re-read the pile and redraw. Cheap: a handful of indexed queries. */
  async refresh(): Promise<void> {
    if (!this.options) return;
    const data = await this.options.load();
    // Updated in place, so an open triage queue does not collapse on every action.
    if (this.component?.setData) this.component.setData(data);
    else this.render(data);
  }

  private render(data: AiWorkbenchData): void {
    if (!this.options) return;
    this.unmountComponent();
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("decks-aiw-container");

    const options = this.options;
    this.component = mount(AiWorkbenchHub, {
      target: contentEl,
      props: {
        sessions: data.sessions,
        counts: data.counts,
        flagged: data.flagged,
        outcome: data.outcome,
        activeSessionId: data.activeSessionId,
        gap: data.gap,
        modelOptions: data.model?.options ?? [],
        model: data.model?.selected ?? "",
        onOpenSession: options.onOpenSession,
        onNewSession: options.onNewSession,
        onTriage: (card: AiStagedCard, action: TriageAction) => {
          void options
            .triage(card, action)
            .then(() => this.refresh())
            .catch(console.error);
        },
        onGenerateGap: options.onGenerateGap,
        onSetModel: (id: string) => void options.setModel(id).catch(console.error),
        onSetArchived: (id: string, archived: boolean) => {
          // Archiving reorders the table, so the hub is re-read: a row's
          // position is a query result, not component state.
          void options
            .setArchived(id, archived)
            .then(() => this.refresh())
            .catch(console.error);
        },
      },
    }) as HubComponent;
  }

  private unmountComponent(): void {
    if (!this.component) return;
    try {
      void unmount(this.component);
    } catch (e) {
      console.warn("Error unmounting AI workbench hub:", e);
    }
    this.component = null;
  }
}
