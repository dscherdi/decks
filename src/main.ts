import {
  Plugin,
  TFile,
  WorkspaceLeaf,
  Notice,
  MarkdownRenderer,
  Component,
  Modal,
  ItemView,
} from "obsidian";

import FlashcardsView from "./components/FlashcardsView.svelte";
import type {
  CardData,
  ScheduleData,
  CardContent,
  CardForReview,
  FlashcardsData,
} from "./types";

class FlashcardsPlugin extends Plugin {
  scheduleData: ScheduleData = {};
  cards: Record<string, CardContent> = {}; // In-memory only, not saved to disk
  reviewQueue: CardForReview[] = [];
  currentCard: CardForReview | null = null;
  defaultEaseFactor: number = 2.5;
  defaultInterval: number = 1;
  view: any = null; // Will hold reference to current view

  async onload() {
    console.log("Loading Flashcards plugin");

    // // Register the plugin view
    // this.registerView(
    //   "flashcards-view",
    //   (leaf) => new FlashcardsView(leaf, this),
    // );

    // Register flashcards document view
    this.registerView(
      "flashcards-document",
      (leaf) => new FlashcardsDocumentView(leaf, this),
    );

    // Add the command to show the flashcards view
    this.addCommand({
      id: "show-flashcards",
      name: "Show Flashcards",
      callback: () => {
        this.activateView();
      },
    });

    // Add command to create flashcards document
    this.addCommand({
      id: "create-flashcards-document",
      name: "Create Flashcards Document",
      callback: async () => {
        try {
          console.log("Creating new flashcards document");
          const file = await this.createFlashcardsDocument();
          if (file) {
            console.log("Document created, activating view");
            await this.activateDocumentView(file);
          }
        } catch (error) {
          console.error("Error in create-flashcards-document command:", error);
          new Notice(
            "Error creating flashcards document. See console for details.",
          );
        }
      },
    });

    // Add ribbon icon
    this.addRibbonIcon("cards", "Flashcards", () => {
      this.activateView();
    });

    // Register extension handler for .flashcards files
    console.log("Registering .flashcards extension handler");
    this.registerExtensions(["flashcards"], "flashcards-document");

    // Initialize the review algorithm
    this.loadReviewData();

    // Load styles
    this.loadStyles();

    console.log("Flashcards plugin loaded successfully");
  }

  loadStyles() {
    try {
      console.log("Loading custom styles");
      // Load custom CSS
      const styleEl = document.createElement("style");
      styleEl.id = "flashcards-notion-styles";
      styleEl.textContent = `
      /* Notion-like table styles */
      .notion-like-table table {
        width: 100%;
        border-collapse: collapse;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      }

      .notion-like-table th {
        background-color: var(--background-primary);
        color: var(--text-muted);
        font-weight: 500;
        font-size: 13px;
        text-transform: uppercase;
        letter-spacing: 0.5px;
      }

      .notion-like-table td, .notion-like-table th {
        padding: 8px 12px;
        border-bottom: 1px solid var(--background-modifier-border);
      }

      .notion-like-table tr:hover {
        background-color: rgba(55, 53, 47, 0.03);
      }

      /* Notion-like buttons */
      .notion-like-btn {
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
        font-weight: 500;
        border-radius: 3px;
      }

      /* Empty state styling */
      .notion-like-empty-cell {
        text-align: center;
        height: 200px;
        background-color: rgba(55, 53, 47, 0.03);
      }

      .flashcards-empty-message {
        color: rgba(55, 53, 47, 0.5);
        padding: 40px 20px;
        text-align: center;
        font-size: 15px;
        line-height: 1.5;
      }

      /* Basic visibility fixes */
      .flashcards-empty-state,
      .flashcards-error,
      .flashcards-table,
      .flashcards-cards-container,
      .notion-like-table {
        display: block !important;
        visibility: visible !important;
      }
      `;
      document.head.appendChild(styleEl);
      console.log("Added inline styles to document head");

      // Also load the full stylesheet from the styles directory
      try {
        // Load the external stylesheet
        const stylePath = this.manifest.dir + "/styles/flashcards-document.css";
        console.log("Loading external stylesheet:", stylePath);
        this.loadResource(stylePath, "style");
      } catch (styleError) {
        console.error("Error loading external stylesheet:", styleError);
        // Still continue even if external stylesheet fails
      }
    } catch (error) {
      console.error("Error loading styles:", error);
    }
  }

  loadResource(path: string, type: string) {
    try {
      if (type === "style") {
        const resource = document.createElement("link");
        resource.rel = "stylesheet";
        resource.href = path;
        document.head.appendChild(resource);
        console.log(`Loaded stylesheet: ${path}`);
      } else {
        console.error(`Unknown resource type: ${type}`);
      }
    } catch (error) {
      console.error(`Failed to load resource ${path}:`, error);
    }
  }

  async activateView() {
    const { workspace } = this.app;
    const leaf = workspace.getRightLeaf(false);
    await leaf?.setViewState({
      type: "flashcards-view",
    });
    workspace.revealLeaf(leaf!);
  }

  async activateDocumentView(file: TFile) {
    try {
      if (!file) {
        console.error(
          "Cannot activate document view: file is null or undefined",
        );
        new Notice("Error: No file to open");
        return;
      }

      console.log("Activating flashcards document view for file:", file.path);

      // Ensure styles are loaded before opening the file
      this.loadStyles();

      // Add a small delay to ensure styles are applied
      await new Promise((resolve) => setTimeout(resolve, 100));

      const { workspace } = this.app;
      const leaf = workspace.getLeaf();

      console.log("Opening file with viewType: flashcards-document");
      await leaf.openFile(file);
      workspace.revealLeaf(leaf);
      console.log("Flashcards document view activated successfully");
    } catch (error) {
      console.error("Error activating flashcards document view:", error);
      new Notice(
        "Error opening flashcards document: " + (error as Error).message,
      );
    }
  }

  async loadReviewData() {
    const data = await this.loadData();
    if (data) {
      this.scheduleData = data.scheduleData || {};
      this.reviewQueue = data.reviewQueue || [];
      console.log(
        "Loaded review data. Card schedules:",
        Object.keys(this.scheduleData).length,
      );

      // Debug the loaded card schedules
      for (const cardId in this.scheduleData) {
        const scheduleInfo = this.scheduleData[cardId];
        console.log(
          `Card ${cardId}:`,
          "Next review:",
          scheduleInfo.nextReview
            ? new Date(scheduleInfo.nextReview).toISOString()
            : "Not set",
          "Canvas:",
          scheduleInfo.canvasId || "Unknown",
        );
      }

      // Initialize cards object if not already present
      this.cards = {};
    } else {
      console.log("No review data found, initializing empty state");
      this.scheduleData = {};
      this.reviewQueue = [];
      this.cards = {};
    }
  }

  async saveReviewData() {
    // Only save scheduling information, not card content
    await this.saveData({
      scheduleData: this.scheduleData,
      reviewQueue: this.reviewQueue,
    });
  }

  async createFlashcardsDocument() {
    try {
      console.log("Creating new flashcards document");

      // Generate a filename
      const filename = `Flashcards-${new Date().toISOString().slice(0, 10)}.flashcards`;
      console.log("Generated filename:", filename);

      // Initialize data with a proper structure
      const data: FlashcardsData = {
        metadata: {
          name: filename.replace(".flashcards", ""),
          created: new Date().toISOString(),
          lastModified: new Date().toISOString(),
          view: "table", // Default to Notion-like table view
          sortBy: "created",
          sortDirection: "desc",
        },
        cards: [],
      };
      console.log("Initialized data structure:", data);

      // Convert data to JSON string
      const jsonString = JSON.stringify(data, null, 2);
      console.log("Created JSON string, length:", jsonString.length);

      try {
        // Create the file
        console.log("Creating file in vault:", filename);
        const newFile = await this.app.vault.create(filename, jsonString);
        console.log("File created successfully:", newFile.path);

        // Show confirmation
        new Notice("New flashcards document created");

        // Return the file for further processing
        return newFile;
      } catch (fileError) {
        console.error("Error creating file:", fileError);
        new Notice(
          "Error creating flashcards document: " + (fileError as Error).message,
        );
        return null;
      }
    } catch (error) {
      console.error("Error in createFlashcardsDocument:", error);
      new Notice(
        "Error creating flashcards document: " + (error as Error).message,
      );
      return null;
    }
  }
}

class FlashcardsDocumentView extends ItemView {
  private plugin: FlashcardsPlugin;
  private currentFile: TFile | null = null;
  private data: FlashcardsData | null = null;
  private viewType: "table" | "card" = "table";
  private filterTag: string | null = null;
  private searchTerm: string = "";
  private sortField: string = "created";
  private sortDirection: "asc" | "desc" = "desc";
  private components: Component[] = [];
  private defaultView: "table" = "table";
  private svelteView: any = null; // Will hold the Svelte component instance

  constructor(leaf: WorkspaceLeaf, plugin: FlashcardsPlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType(): string {
    return "flashcards-document";
  }

  getDisplayText(): string {
    return this.currentFile ? this.currentFile.basename : "Flashcards";
  }

  getIcon(): string {
    return "cards";
  }

  async onOpen() {
    try {
      console.log("FlashcardsDocumentView onOpen called");
      this.contentEl.empty();
      this.contentEl.classList.add("flashcards-document-view");
      this.contentEl.classList.add("notion-like-view");

      if (!this.currentFile) {
        console.log("No current file, rendering empty state");
        this.renderEmptyState();
        return;
      }

      console.log("Loading file:", this.currentFile.path);
      await this.loadFile(this.currentFile);
    } catch (error) {
      console.error("Error in FlashcardsDocumentView onOpen:", error);
      this.renderError(
        "Error loading flashcards document. See console for details.",
      );
    }
  }

  async loadFile(file: TFile) {
    try {
      console.log("Loading flashcards file:", file.path);
      this.currentFile = file;

      // Read file content
      console.log("Reading file content");
      let content = await this.app.vault.read(file);

      // Check if the content is empty and initialize if needed
      if (!content || content.trim() === "") {
        console.log("File is empty, initializing with default structure");
        this.initializeData();
        await this.saveData();
        content = JSON.stringify(this.data);
      }

      // Parse JSON content
      console.log("Parsing JSON content");
      try {
        this.data = JSON.parse(content) as FlashcardsData;
      } catch (jsonError) {
        console.error("JSON parse error:", jsonError);
        console.log("Content that failed to parse:", content);

        // Try to recover by initializing fresh data
        console.log("Attempting to recover by initializing fresh data");
        this.initializeData();
        await this.saveData();
      }
      // Make sure we have a valid data structure
      if (!this.data || typeof this.data !== "object") {
        console.log("Data is not a valid object, initializing");
        this.initializeData();
      }
      if (!this.data) {
        throw new Error("Data is null after parsing");
      }

      // Ensure metadata exists
      if (!this.data.metadata) {
        console.log("No metadata in data, creating");
        this.data.metadata = {
          name: this.currentFile ? this.currentFile.basename : "Flashcards",
          created: new Date().toISOString(),
          lastModified: new Date().toISOString(),
          view: "table",
          sortBy: "created",
          sortDirection: "desc",
        };
      }

      // Ensure cards array exists
      if (!this.data.cards) {
        console.log("No cards array in data, creating empty array");
        this.data.cards = [];
      }

      // Apply stored view preferences, but always prioritize table view
      console.log("Using metadata from file:", this.data.metadata);
      // Always use table view for Notion-like experience
      this.viewType = "table";
      this.sortField = this.data.metadata.sortBy || "created";
      this.sortDirection = this.data.metadata.sortDirection || "desc";

      console.log("Rendering view");
      this.render();
    } catch (error) {
      console.error("Error loading flashcards document:", error);
      this.renderError(
        "Error parsing flashcards document: " + (error as Error).message,
      );
    }
  }

  async onClose() {
    // Clean up any Svelte components
    if (this.svelteView) {
      this.svelteView.$destroy();
      this.svelteView = null;
    }

    // Clean up all components
    this.components.forEach((component) => {
      if (component && component.unload) {
        component.unload();
      }
    });
    this.components = [];
  }

  renderEmptyState() {
    try {
      console.log("Rendering empty state");

      // Create the Svelte component for empty state
      const target = this.contentEl.createDiv();

      this.svelteView = new FlashcardsView({
        target,
        props: {
          data: null,
          reviewData: this.plugin.scheduleData,
          currentFile: this.currentFile,
          renderMarkdown: this.renderMarkdown.bind(this),
          saveData: this.saveData.bind(this),
        },
      });

      // Listen for the createNewDocument event
      window.addEventListener(
        "createNewDocument",
        () => {
          this.createNewFlashcardsDocument();
        },
        { once: true },
      );

      console.log("Empty state rendered successfully");
    } catch (error) {
      console.error("Error rendering empty state:", error);
      this.contentEl.empty();
      this.contentEl.createEl("div", {
        cls: "flashcards-error",
        text: "Error rendering empty state: " + (error as Error).message,
      });
    }
  }

  renderError(message: string) {
    try {
      console.log("Rendering error:", message);
      // Clear the content area first
      this.contentEl.empty();

      const container = this.contentEl.createEl("div", {
        cls: "flashcards-error",
      });
      container.createEl("h2", { text: "Error" });
      container.createEl("p", { text: message });

      const actionContainer = container.createEl("div", {
        cls: "flashcards-actions",
      });

      const reloadButton = actionContainer.createEl("button", {
        text: "Try Again",
        cls: "mod-cta",
      });

      reloadButton.addEventListener("click", async () => {
        console.log("Try again button clicked");
        if (this.currentFile) {
          await this.loadFile(this.currentFile);
        } else {
          this.renderEmptyState();
        }
      });

      console.log("Error message rendered successfully");
    } catch (error) {
      console.error("Error in renderError:", error);
      // Last resort fallback
      this.contentEl.empty();
      this.contentEl.innerHTML = `<div class="flashcards-error">
        <h2>Critical Error</h2>
        <p>The flashcards view encountered a critical error.</p>
        <p>Original error: ${message}</p>
        <p>Error while rendering: ${(error as Error).message}</p>
      </div>`;
    }
  }

  render() {
    try {
      console.log("Rendering flashcards document view");
      this.contentEl.empty();
      this.contentEl.classList.add("notion-like-view");

      if (!this.data) {
        console.error("No data available for rendering");
        this.renderError(
          "Invalid flashcards document format: No data available.",
        );
        return;
      }

      // Create the Svelte component
      const target = this.contentEl.createDiv();

      this.svelteView = new FlashcardsView({
        target,
        props: {
          data: this.data,
          reviewData: this.plugin.scheduleData,
          currentFile: this.currentFile,
          renderMarkdown: this.renderMarkdown.bind(this),
          saveData: this.saveData.bind(this),
        },
      });

      // Set up event listeners for card operations
      window.addEventListener("reviewDue", this.reviewDueCards.bind(this), {
        once: true,
      });
      window.addEventListener(
        "reviewCard",
        (e: Event) => {
          const card = (e as CustomEvent).detail;
          this.reviewCards([card]);
        },
        { once: true },
      );

      window.addEventListener(
        "showCard",
        (e: Event) => {
          const card = (e as CustomEvent).detail;
          this.showCardContent(card);
        },
        { once: true },
      );
    } catch (error) {
      console.error("Error in render():", error);
      this.renderError(
        "Error rendering flashcards: " + (error as Error).message,
      );
    }
  }

  async renderMarkdown(text: string, element: HTMLElement) {
    if (!text) return;

    // Clear the element
    element.empty();

    // Create a temporary component for rendering
    const component = new Component();
    this.components.push(component); // Store for cleanup
    component.load(); // Initialize component

    // Use Obsidian's markdown renderer
    await MarkdownRenderer.renderMarkdown(
      text, // The markdown text
      element, // The element to render into
      "", // Source path (empty string is fine for our use)
      component, // Pass the new component to prevent memory leaks
    );
  }

  // Review operations
  reviewDueCards() {
    if (!this.data || !this.data.cards) {
      new Notice("No cards available for review");
      return;
    }

    // Find all due cards
    const dueCards = this.data.cards.filter((card) => {
      const reviewData = this.plugin.scheduleData[card.id];
      if (!reviewData || !reviewData.nextReview) {
        return false;
      }

      const nextReview = new Date(reviewData.nextReview);
      const now = new Date();

      return nextReview <= now;
    });

    if (dueCards.length === 0) {
      new Notice("No cards due for review");
      return;
    }

    // Start review
    this.reviewCards(dueCards);
  }

  reviewCards(cards: CardData[]) {
    if (!cards || cards.length === 0) {
      new Notice("No cards available for review");
      return;
    }

    // Set this view as the current view for reloading after review
    this.plugin.view = this;

    // Open the review modal
    const modal = new FlashcardReviewModal(this.app, cards, this.plugin);
    modal.open();
  }

  showCardContent(card: CardData) {
    const modal = new FlashcardViewModal(this.app, card, this.plugin, this);
    modal.open();
  }

  // Data operations
  initializeData() {
    console.log("Initializing data structure");
    this.data = {
      metadata: {
        name: this.currentFile ? this.currentFile.basename : "Flashcards",
        created: new Date().toISOString(),
        lastModified: new Date().toISOString(),
        view: "table", // Default to Notion-like table view
        sortBy: "created",
        sortDirection: "desc",
      },
      cards: [],
    };
    console.log("Data structure initialized:", this.data);
    return this.data;
  }

  async saveData() {
    if (!this.currentFile || !this.data) {
      return false;
    }

    // Update the last modified timestamp
    if (this.data.metadata) {
      this.data.metadata.lastModified = new Date().toISOString();

      // Save view preferences, but always keep table as default
      this.data.metadata.view = "table"; // Always save as table view for consistency
      this.data.metadata.sortBy = this.sortField;
      this.data.metadata.sortDirection = this.sortDirection;
    }

    // Convert data to JSON string
    const jsonString = JSON.stringify(this.data, null, 2);

    // Save to file
    await this.app.vault.modify(this.currentFile, jsonString);

    return true;
  }

  async reloadContent() {
    try {
      if (this.currentFile) {
        await this.loadFile(this.currentFile);
      } else {
        this.renderEmptyState();
      }
    } catch (error) {
      console.error("Error reloading content:", error);
      this.renderError("Error reloading content: " + (error as Error).message);
    }
  }

  saveViewPreference() {
    if (this.data && this.data.metadata) {
      // Allow view switching in the UI but save table as the default for next load
      this.data.metadata.view = "table"; // Always save as table view for consistency
      this.data.metadata.sortBy = this.sortField;
      this.data.metadata.sortDirection = this.sortDirection;

      // Don't await this to avoid blocking the UI
      this.saveData();
    }
  }

  async createNewFlashcardsDocument() {
    try {
      console.log("Creating new flashcards document");

      // Generate a filename
      const filename = `Flashcards-${new Date().toISOString().slice(0, 10)}.flashcards`;
      console.log("Generated filename:", filename);

      // Initialize data
      this.initializeData();
      console.log("Initialized data structure");

      // Convert data to JSON string
      const jsonString = JSON.stringify(this.data, null, 2);
      console.log("Created JSON string, length:", jsonString.length);

      try {
        // Create the file
        console.log("Creating file in vault");
        const newFile = await this.app.vault.create(filename, jsonString);
        console.log("File created successfully:", newFile.path);

        // Open the file
        console.log("Loading the new file");
        await this.loadFile(newFile);

        // Show confirmation
        new Notice("New flashcards document created");
      } catch (fileError) {
        console.error("Error creating file:", fileError);
        new Notice(
          "Error creating flashcards document: " + (fileError as Error).message,
        );
      }
    } catch (error) {
      console.error("Error in createNewFlashcardsDocument:", error);
      new Notice(
        "Error creating flashcards document: " + (error as Error).message,
      );
    }
  }
}

class FlashcardViewModal extends Modal {
  private card: CardData;
  private plugin: FlashcardsPlugin;
  private view: FlashcardsDocumentView;
  private components: Component[] = [];

  constructor(
    app: any,
    card: CardData,
    plugin: FlashcardsPlugin,
    view: FlashcardsDocumentView,
  ) {
    super(app);
    this.card = card;
    this.plugin = plugin;
    this.view = view;
  }

  async onOpen() {
    const containerEl = this.contentEl;
    containerEl.empty();
    containerEl.addClass("flashcard-view-modal");

    // Card content
    const cardContainer = containerEl.createEl("div", {
      cls: "flashcard-container",
    });

    // Title
    cardContainer.createEl("h2", { text: this.card.title });

    // Tags
    if (this.card.tags && this.card.tags.length > 0) {
      const tagContainer = cardContainer.createEl("div", {
        cls: "flashcards-tags",
      });
      this.card.tags.forEach((tag) => {
        tagContainer.createEl("span", {
          cls: "flashcards-tag",
          text: tag,
        });
      });
    }

    // Content
    const cardContentEl = cardContainer.createEl("div", {
      cls: "flashcard-content",
    });
    await this.view.renderMarkdown(this.card.content, cardContentEl);

    // Review info
    const reviewData = this.plugin.scheduleData[this.card.id];
    if (reviewData) {
      const reviewInfo = cardContainer.createEl("div", {
        cls: "flashcard-review-info",
      });

      const lastReview = reviewData.lastReview
        ? new Date(reviewData.lastReview)
        : null;
      const nextReview = reviewData.nextReview
        ? new Date(reviewData.nextReview)
        : null;

      if (lastReview) {
        reviewInfo.createEl("div", {
          text: `Last reviewed: ${lastReview.toLocaleDateString()}`,
        });
      }

      if (nextReview) {
        const now = new Date();
        let reviewClass = "flashcards-upcoming";
        let reviewText = `Next review: ${nextReview.toLocaleDateString()}`;

        if (nextReview <= now) {
          reviewClass = "flashcards-due-now";
          reviewText = "Due for review now";
        }

        reviewInfo.createEl("div", {
          cls: reviewClass,
          text: reviewText,
        });
      }
    }

    // Buttons
    const buttonContainer = containerEl.createEl("div", {
      cls: "flashcard-view-buttons",
    });

    const closeButton = buttonContainer.createEl("button", {
      text: "Close",
      cls: "flashcard-view-button",
    });

    const reviewButton = buttonContainer.createEl("button", {
      text: "Review",
      cls: "flashcard-view-button mod-cta",
    });

    closeButton.addEventListener("click", () => {
      this.close();
    });

    reviewButton.addEventListener("click", () => {
      this.close();
      this.view.reviewCards([this.card]);
    });
  }

  onClose() {
    const containerEl = this.contentEl;
    containerEl.empty();

    // Unload all components to prevent memory leaks
    this.components.forEach((component) => {
      if (component && component.unload) {
        component.unload();
      }
    });
    this.components = [];
  }
}

class FlashcardReviewModal extends Modal {
  private cards: CardData[];
  private currentIndex: number = 0;
  private plugin: FlashcardsPlugin;
  private components: Component[] = [];

  constructor(app: any, cards: CardData[], plugin: FlashcardsPlugin) {
    super(app);
    this.cards = cards;
    this.plugin = plugin;
  }

  async onOpen() {
    this.contentEl.empty();
    await this.showCard();
  }

  async showCard() {
    const containerEl = this.contentEl;
    containerEl.empty();
    containerEl.addClass("flashcard-review-modal");

    if (this.currentIndex >= this.cards.length) {
      containerEl.createEl("h2", { text: "Review Complete!" });
      // Add a close button to make it more obvious the review is done
      const closeButton = containerEl.createEl("button", {
        text: "Close",
        cls: "flashcard-start-btn",
      });
      closeButton.addEventListener("click", () => this.close());
      return;
    }

    // Progress indicator
    const progressContainer = containerEl.createEl("div", {
      cls: "flashcard-progress",
    });
    progressContainer.createEl("span", {
      text: `Card ${this.currentIndex + 1} of ${this.cards.length}`,
    });
    const progressBar = progressContainer.createEl("div", {
      cls: "progress-bar-container",
    });
    const progressValue = progressBar.createEl("div", {
      cls: "progress-bar-value",
    });
    progressValue.style.width = `${(this.currentIndex / this.cards.length) * 100}%`;

    const card = this.cards[this.currentIndex];
    const cardContainer = containerEl.createEl("div", {
      cls: "flashcard-container",
    });

    // Question - render as markdown
    cardContainer.createEl("h3", { text: card.title });

    // Tags
    if (card.tags && card.tags.length > 0) {
      const tagContainer = cardContainer.createEl("div", {
        cls: "flashcards-tags",
      });
      card.tags.forEach((tag) => {
        tagContainer.createEl("span", {
          cls: "flashcards-tag",
          text: tag,
        });
      });
    }

    // Answer (initially blurred)
    const answerContainer = cardContainer.createEl("div", {
      cls: "flashcard-answer blurred",
    });

    // Create a component for markdown rendering
    const component = new Component();
    this.components.push(component);
    component.load();

    // Pre-render the markdown but it will be blurred
    await MarkdownRenderer.renderMarkdown(
      card.content,
      answerContainer,
      "",
      component,
    );

    // Create button container but hide it initially
    const buttonContainer = containerEl.createEl("div", {
      cls: "difficulty-buttons",
      attr: { style: "display: none;" },
    });
    this.createDifficultyButtons(buttonContainer);

    // Click to reveal answer and show buttons
    cardContainer.addEventListener("click", () => {
      if (answerContainer.classList.contains("blurred")) {
        answerContainer.classList.remove("blurred");
        buttonContainer.style.display = "flex";
      }
    });
  }

  createDifficultyButtons(btnContainer: HTMLElement) {
    const difficulties = [
      { text: "Again", quality: 0 },
      { text: "Hard", quality: 3 },
      { text: "Good", quality: 4 },
      { text: "Easy", quality: 5 },
    ];

    difficulties.forEach((diff) => {
      const btn = btnContainer.createEl("button", {
        text: diff.text,
        cls: `difficulty-btn difficulty-${diff.text.toLowerCase()}`,
      });
      btn.addEventListener("click", async () => {
        // Update card schedule and wait for it to complete
        await this.updateCardSchedule(
          this.cards[this.currentIndex],
          diff.quality,
        );
        this.currentIndex++;
        await this.showCard();
      });
    });
  }

  async updateCardSchedule(card: CardData, quality: number) {
    const now = new Date();

    console.log("Updating card schedule:", card.id, "quality:", quality);

    if (!this.plugin.scheduleData[card.id]) {
      console.log("Creating new schedule data for ID:", card.id);
      this.plugin.scheduleData[card.id] = {
        lastReview: now,
        nextReview: now,
        interval: this.plugin.defaultInterval,
        easeFactor: this.plugin.defaultEaseFactor,
        repetitions: 0,
      };
    }

    const scheduleData = this.plugin.scheduleData[card.id];

    // Implementation of SuperMemo 2 Algorithm
    if (quality >= 3) {
      if (scheduleData.repetitions === 0) {
        scheduleData.interval = 1; // 1 day
      } else if (scheduleData.repetitions === 1) {
        scheduleData.interval = 6; // 6 days
      } else {
        scheduleData.interval = Math.round(
          scheduleData.interval * scheduleData.easeFactor,
        );
      }
      scheduleData.repetitions += 1;
    } else {
      scheduleData.repetitions = 0;
      scheduleData.interval = 1; // Reset to 1 day
    }

    // Update ease factor
    scheduleData.easeFactor = Math.max(
      1.3,
      scheduleData.easeFactor +
        (0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02)),
    );

    // Calculate next review date
    scheduleData.lastReview = now;
    const nextReviewDate = new Date(
      now.getTime() + scheduleData.interval * 24 * 60 * 60 * 1000,
    );
    nextReviewDate.setMilliseconds(0); // Standardize to remove milliseconds
    scheduleData.nextReview = nextReviewDate;

    await this.plugin.saveReviewData();
  }

  onClose() {
    const containerEl = this.contentEl;
    containerEl.empty();

    // Unload all components to prevent memory leaks
    this.components.forEach((component) => {
      if (component && component.unload) {
        component.unload();
      }
    });
    this.components = [];

    // Reload the view to update the lists after review
    if (this.plugin && this.plugin.view) {
      const view = this.plugin.view as FlashcardsDocumentView;
      if (view.reloadContent) {
        view.reloadContent();
      } else {
        // If the view doesn't have a reloadContent method, try to render it again
        view.render();
      }
    }

    // Show a notice with review statistics if cards were reviewed
    if (this.currentIndex > 0) {
      const totalReviewed = Math.min(this.currentIndex, this.cards.length);
      new Notice(
        `Review complete: ${totalReviewed} of ${this.cards.length} cards reviewed`,
      );
    }
  }
}

// Export the main plugin class
export default FlashcardsPlugin;
