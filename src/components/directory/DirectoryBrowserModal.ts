import { App, Component, Modal } from "obsidian";
import { mount, unmount } from "svelte";
import type { HttpClient } from "@decks/core";
import type { IDatabaseService } from "../../database/DatabaseFactory";
import type { DirectoryService } from "../../services/DirectoryService";
import type { Svelte5MountedComponent } from "../../types/svelte-components";
import { makeModalResponsive, type ResponsiveModalHandle } from "../../utils/responsive-modal";
import DirectoryBrowser from "./DirectoryBrowser.svelte";

export interface DirectoryBrowserDeps {
  http: HttpClient;
  db: IDatabaseService;
  directory: DirectoryService;
  /** Called after a deck was added or updated, so the deck list can refresh. */
  onChanged: () => Promise<void>;
}

/** The deck directory's free decks, searched and filtered by the directory, added in one click. */
export class DirectoryBrowserModal extends Modal {
  private component: Svelte5MountedComponent | null = null;
  private responsiveHandle?: ResponsiveModalHandle;
  private renderer: Component | null = null;

  constructor(
    app: App,
    private readonly deps: DirectoryBrowserDeps
  ) {
    super(app);
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    this.responsiveHandle = makeModalResponsive(this, ["decks-directory-browser-modal"]);
    this.renderer = new Component();
    this.renderer.load();
    this.component = mount(DirectoryBrowser, {
      target: contentEl,
      props: {
        app: this.app,
        renderer: this.renderer,
        http: this.deps.http,
        db: this.deps.db,
        directory: this.deps.directory,
        onChanged: this.deps.onChanged,
      },
    }) as Svelte5MountedComponent;
  }

  onClose(): void {
    this.responsiveHandle?.dispose();
    this.responsiveHandle = undefined;
    if (this.component) {
      void unmount(this.component);
      this.component = null;
    }
    this.renderer?.unload();
    this.renderer = null;
    this.contentEl.empty();
  }
}
