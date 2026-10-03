import { ItemView, WorkspaceLeaf, Component, MarkdownRenderer } from "obsidian";
import { mount, unmount } from "svelte";
import { I18n, sourceDisplayName } from "@decks/core";
import type { Svelte5MountedComponent } from "../types/svelte-components";
import AiGeneratorModal from "./AiGeneratorModal.svelte";
import type { AiGeneratorOptions } from "./ai-generator-types";

export const VIEW_TYPE_AI_GENERATOR = "ai-generator-view";

type TriageComponent = Svelte5MountedComponent & {
  applyTriage?(rowId: string, action: "keep" | "discard"): Promise<boolean>;
  focusRow?(rowId: string): Promise<void>;
};

export class AiGeneratorView extends ItemView {
  private options: AiGeneratorOptions | null = null;
  private sessionId: string | null = null;
  private component: TriageComponent | null = null;
  private markdownComponents: Component[] = [];

  /** The session the mounted options were built for. */
  private mountedFor: string | null | undefined = undefined;
  /** The session's source, for the tab label. */
  private label: string | null = null;
  /** True while this view re-sets its own state to refresh the tab header. */
  private relabeling = false;
  private relabelTimer: number | null = null;

  /** `takePending` hands over the options this leaf is being opened with; `build`
   *  rebuilds them from the session id when the workspace restores the tab. */
  constructor(
    leaf: WorkspaceLeaf,
    private readonly takePending?: () => AiGeneratorOptions | null,
    private readonly build?: (sessionId: string | null) => AiGeneratorOptions,
  ) {
    super(leaf);
  }

  getViewType(): string {
    return VIEW_TYPE_AI_GENERATOR;
  }

  getDisplayText(): string {
    const g = I18n.t.modals.aiGenerator;
    return this.label ? I18n.format(g.sessionTab, { source: this.label }) : g.title;
  }

  getIcon(): string {
    return "wand-2";
  }

  /** Whether this leaf is showing the given stored session. */
  showsSession(id: string): boolean {
    return this.sessionId === id && this.component !== null;
  }

  /** Act on a flagged card through the open session, so its next save cannot undo it. */
  async applyTriage(rowId: string, action: "keep" | "discard"): Promise<boolean> {
    const fn = this.component?.applyTriage;
    return fn ? fn(rowId, action) : false;
  }

  focusRow(rowId: string): void {
    void this.component?.focusRow?.(rowId);
  }

  setOptions(options: AiGeneratorOptions): void {
    this.options = options;
    this.mountedFor = this.sessionId;
    this.mountComponent();
  }

  /** Which session this leaf shows. The options are callbacks and cannot be
   *  serialised, so the id is the only part worth persisting. */
  getState(): Record<string, unknown> {
    if (!this.sessionId) return {};
    return this.label ? { sessionId: this.sessionId, label: this.label } : { sessionId: this.sessionId };
  }

  async setState(
    state: unknown,
    result: Parameters<ItemView["setState"]>[1],
  ): Promise<void> {
    const next =
      state && typeof state === "object" && "sessionId" in state
        ? (state as { sessionId?: unknown }).sessionId
        : undefined;
    const label =
      state && typeof state === "object" && "label" in state
        ? (state as { label?: unknown }).label
        : undefined;
    this.sessionId = typeof next === "string" ? next : null;
    this.label = typeof label === "string" && label ? label : null;
    await super.setState(state, result);
    // A relabel only refreshes the header; it must not rebuild the session.
    if (this.relabeling) return;
    const pending = this.takePending?.();
    if (pending) this.setOptions(pending);
    else if (this.build && (!this.options || this.mountedFor !== this.sessionId)) {
      this.setOptions(this.build(this.sessionId));
    }
  }

  // eslint-disable-next-line @typescript-eslint/require-await -- Obsidian's ItemView onOpen/onClose are async by contract; this override has no await
  async onOpen(): Promise<void> {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("decks-ai-generator-tab-container");
    if (this.options) this.mountComponent();
  }

  // eslint-disable-next-line @typescript-eslint/require-await -- Obsidian's ItemView onOpen/onClose are async by contract; this override has no await
  async onClose(): Promise<void> {
    if (this.relabelTimer !== null) window.clearTimeout(this.relabelTimer);
    this.unmountComponent();
    this.contentEl.empty();
  }

  /** Put the session's source in the tab label once it is known. Deferred so it
   *  never runs inside another setViewState, and skipped when nothing changed. */
  noteSource(ref: string): void {
    const label = sourceDisplayName(ref);
    if (!label || label === this.label || !this.sessionId) return;
    this.label = label;
    if (this.relabelTimer !== null) window.clearTimeout(this.relabelTimer);
    const session = this.sessionId;
    this.relabelTimer = window.setTimeout(() => {
      this.relabelTimer = null;
      if (this.leaf.view !== this || this.sessionId !== session) return;
      this.relabeling = true;
      void this.leaf
        .setViewState({ type: VIEW_TYPE_AI_GENERATOR, state: { sessionId: session, label } })
        .catch(console.error)
        .finally(() => {
          this.relabeling = false;
        });
    }, 0);
  }

  private renderMarkdown(content: string, el: HTMLElement): void {
    try {
      const component = new Component();
      component.load();
      this.markdownComponents.push(component);
      void MarkdownRenderer.render(this.app, content, el, "", component);
    } catch (error) {
      console.error("Error rendering markdown:", error);
      el.textContent = content;
    }
  }

  private mountComponent(): void {
    if (!this.options) return;
    this.unmountComponent();

    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("decks-ai-generator-tab-container");

    // Spread, never list: a hand-maintained list silently fell behind once and
    // every prop has a default, so nothing failed loudly.
    // The session is created on its first save; remember it so the tab can reopen it.
    const persist = this.options.persistSession;
    const persistSession = persist
      ? async (snapshot: Parameters<typeof persist>[0]) => {
          const id = await persist(snapshot);
          if (id && id !== this.sessionId) {
            this.sessionId = id;
            this.mountedFor = id;
            this.app.workspace.requestSaveLayout();
          }
          this.noteSource(snapshot.sourceRef);
          return id;
        }
      : undefined;

    this.component = mount(AiGeneratorModal, {
      target: contentEl,
      props: {
        ...this.options,
        persistSession,
        app: this.app,
        renderMarkdown: (source: string, el: HTMLElement) => {
          this.renderMarkdown(source, el);
        },
      },
    }) as TriageComponent;
  }

  private unmountComponent(): void {
    if (this.component) {
      try {
        void unmount(this.component);
      } catch (e) {
        console.warn("Error unmounting AI generator component:", e);
      }
      this.component = null;
    }
    for (const c of this.markdownComponents) {
      try {
        c.unload();
      } catch (e) {
        console.warn("Error unloading markdown component:", e);
      }
    }
    this.markdownComponents = [];
  }
}
