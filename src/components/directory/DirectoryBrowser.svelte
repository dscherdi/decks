<script lang="ts">
  // The deck directory browser: the directory filters and searches, this lists the answer.
  import { onDestroy, onMount } from "svelte";
  import { MarkdownRenderer, setIcon, type App, type Component } from "obsidian";
  import {
    I18n,
    catalogInstallState,
    directoryCoverUrl,
    directoryDescriptionSummary,
    directoryLanguageName,
    directorySubjectLabel,
    directoryTermsUrl,
    fetchDirectoryCatalog,
    fetchDirectoryFilters,
    formatByteSize,
    installedDirectorySlugs,
    isPersonalUseLicense,
    type DirectoryCatalogDeck,
    type DirectoryCatalogFilters,
    type DirectoryCatalogQuery,
    type DirectoryCatalogSort,
    type DirectoryDeckRecord,
    type HttpClient,
  } from "@decks/core";
  import type { IDatabaseService } from "../../database/DatabaseFactory";
  import type { DirectoryService } from "../../services/DirectoryService";

  export let app: App;
  export let renderer: Component;
  export let http: HttpClient;
  export let db: IDatabaseService;
  export let directory: DirectoryService;
  export let onChanged: () => Promise<void> = async () => {};

  type View = "all" | "added" | "updates";
  type RowStatus = { kind: "busy" } | { kind: "done" } | { kind: "error"; message: string };

  const t = I18n.t.directory;
  const locale = I18n.code;
  const views: { id: View; label: string }[] = [
    { id: "all", label: t.browseAll },
    { id: "added", label: t.browseShowAdded },
    { id: "updates", label: t.browseUpdates },
  ];

  let search = "";
  let appliedSearch = "";
  let subject = "";
  let language = "";
  let sort: DirectoryCatalogSort = "downloads";
  let view: View = "all";

  let decks: DirectoryCatalogDeck[] = [];
  let hasMore = false;
  let page = 0;
  let loading = true;
  let loadingMore = false;
  let error: string | null = null;
  let filters: DirectoryCatalogFilters = { subjects: [], languages: [] };
  let records: DirectoryDeckRecord[] = [];
  let status: Record<string, RowStatus> = {};
  let openSlug: string | null = null;

  let generation = 0;
  let searchTimer: number | undefined;

  $: openDeck = decks.find((deck) => deck.slug === openSlug) ?? null;
  $: emptyText = view === "added" ? t.browseEmptyAdded : view === "updates" ? t.browseEmptyUpdates : t.browseEmpty;

  function icon(node: HTMLElement, name: string) {
    setIcon(node, name);
    return { update: (next: string) => setIcon(node, next) };
  }

  function markdown(node: HTMLElement, source: string) {
    const render = (text: string) => {
      node.empty();
      void MarkdownRenderer.render(app, text, node, "", renderer);
    };
    render(source);
    return { update: render };
  }

  function stateOf(deck: DirectoryCatalogDeck, current: DirectoryDeckRecord[]) {
    return catalogInstallState(deck, current);
  }

  function query(nextPage: number): DirectoryCatalogQuery {
    return {
      q: appliedSearch,
      subject: subject || undefined,
      language: language || undefined,
      sort,
      page: nextPage,
      slugs: view === "all" ? undefined : installedDirectorySlugs(records),
    };
  }

  function narrow(list: DirectoryCatalogDeck[]): DirectoryCatalogDeck[] {
    return view === "updates" ? list.filter((deck) => stateOf(deck, records).state === "update") : list;
  }

  async function refreshRecords(): Promise<void> {
    try {
      records = await db.listDirectoryDecks();
    } catch {
      records = [];
    }
  }

  async function reload(): Promise<void> {
    const mine = ++generation;
    page = 0;
    loading = true;
    error = null;
    try {
      const result = await fetchDirectoryCatalog(http, query(0));
      if (mine !== generation) return;
      decks = narrow(result.decks);
      hasMore = result.hasMore;
    } catch {
      if (mine !== generation) return;
      decks = [];
      hasMore = false;
      error = t.browseLoadFailed;
    } finally {
      if (mine === generation) loading = false;
    }
  }

  async function loadMore(): Promise<void> {
    if (!hasMore || loading || loadingMore) return;
    const mine = generation;
    loadingMore = true;
    try {
      const result = await fetchDirectoryCatalog(http, query(page + 1));
      if (mine !== generation) return;
      page += 1;
      const known = new Set(decks.map((deck) => deck.slug));
      decks = [...decks, ...narrow(result.decks).filter((deck) => !known.has(deck.slug))];
      hasMore = result.hasMore;
    } catch {
      if (mine === generation) error = t.browseLoadFailed;
    } finally {
      if (mine === generation) loadingMore = false;
    }
  }

  async function add(deck: DirectoryCatalogDeck): Promise<void> {
    if (status[deck.slug]?.kind === "busy") return;
    status = { ...status, [deck.slug]: { kind: "busy" } };
    const result = await directory.addFromCatalog(deck.slug);
    await refreshRecords();
    status = { ...status, [deck.slug]: result.ok ? { kind: "done" } : { kind: "error", message: result.error } };
    if (result.ok) await onChanged();
  }

  function onSearchInput(): void {
    window.clearTimeout(searchTimer);
    searchTimer = window.setTimeout(() => {
      if (search === appliedSearch) return;
      appliedSearch = search;
      void reload();
    }, 300);
  }

  function setView(next: View): void {
    if (view === next) return;
    view = next;
    void reload();
  }

  function meta(deck: DirectoryCatalogDeck): string {
    return [
      I18n.format(t.browseCards, { count: deck.cardCount }),
      directoryLanguageName(deck.language, locale),
      I18n.format(t.browseDownloads, { count: deck.downloadCount }),
    ]
      .filter(Boolean)
      .join(" · ");
  }

  function versionText(deck: DirectoryCatalogDeck, current: DirectoryDeckRecord[]): string {
    const state = stateOf(deck, current);
    return state.state === "update" && state.installedVersion !== null
      ? I18n.format(t.browseVersionUpdate, { from: state.installedVersion, to: deck.version })
      : I18n.format(t.browseVersion, { version: deck.version });
  }

  function openTerms(): void {
    window.open(directoryTermsUrl(locale));
  }

  onMount(() => {
    void (async () => {
      await refreshRecords();
      void fetchDirectoryFilters(http)
        .then((next) => (filters = next))
        .catch(() => {});
      await reload();
    })();
  });

  onDestroy(() => window.clearTimeout(searchTimer));
</script>

<div class="decks-dirb">
  {#if openDeck}
    {@const state = stateOf(openDeck, records)}
    {@const row = status[openDeck.slug]}
    {@const cover = directoryCoverUrl(openDeck.cover)}
    <div class="decks-dirb-detail">
      <button type="button" class="decks-dirb-back" on:click={() => (openSlug = null)}>
        <span use:icon={"chevron-left"} aria-hidden="true"></span>
        {t.browseBack}
      </button>
      {#if cover}
        <img class="decks-dirb-hero" src={cover} alt="" />
      {/if}
      <div class="decks-dirb-title-row">
        <div class="decks-dirb-title-text">
          <h2 class="decks-dirb-title">{openDeck.title}</h2>
          <div class="decks-dirb-facts">
            {[directorySubjectLabel(openDeck.subject), directoryLanguageName(openDeck.language, locale), openDeck.level]
              .filter(Boolean)
              .join(" · ")}
          </div>
          <div class="decks-dirb-facts">
            {I18n.format(t.browseCards, { count: openDeck.cardCount })} · {I18n.format(t.browseDownloads, {
              count: openDeck.downloadCount,
            })}
          </div>
        </div>
        {#if state.state === "installed" && row?.kind !== "busy"}
          <span class="decks-dirb-added"><span use:icon={"check"} aria-hidden="true"></span>{t.browseAddedState}</span>
        {:else}
          <button type="button" class="mod-cta" disabled={row?.kind === "busy"} on:click={() => void add(openDeck)}>
            {row?.kind === "busy"
              ? state.state === "update"
                ? t.browseUpdating
                : t.browseAdding
              : state.state === "update"
                ? t.updateButton
                : t.browseAdd}
          </button>
        {/if}
      </div>
      {#if row?.kind === "error"}
        <div class="decks-dirb-error">{row.message}</div>
      {/if}
      <div class="decks-dirb-stats">
        <div><span>{t.versionName}</span>{versionText(openDeck, records)}</div>
        <div><span>{t.browseSize}</span>{formatByteSize(openDeck.sizeBytes)}</div>
        <div>
          <span>{t.licenseName}</span>{isPersonalUseLicense(openDeck.license) ? t.browseLicensePersonal : openDeck.license}
        </div>
      </div>
      {#if openDeck.description}
        <div class="decks-dirb-description markdown-rendered" use:markdown={openDeck.description}></div>
      {/if}
      {#if openDeck.decks.length > 1}
        <div class="decks-dirb-heading">{t.browseDecksInside}</div>
        <ul class="decks-dirb-parts">
          {#each openDeck.decks as part (part.key)}
            <li>
              <span class="decks-dirb-part-title">{part.title}</span>
              <span class="decks-dirb-part-meta"
                >{part.exam ? t.browseExam : I18n.format(t.browseCards, { count: part.cardCount })}</span
              >
            </li>
          {/each}
        </ul>
      {/if}
      <p class="decks-dirb-terms">
        {t.browseTerms}
        <button type="button" class="decks-dirb-link" on:click={openTerms}>{t.browseTermsLink}</button>
      </p>
    </div>
  {:else}
    <div class="decks-dirb-tools">
      <div class="decks-dirb-search-wrap">
        <span class="decks-dirb-search-icon" use:icon={"search"} aria-hidden="true"></span>
        <input
          class="decks-dirb-search"
          type="search"
          placeholder={t.browseSearch}
          aria-label={t.browseSearch}
          bind:value={search}
          on:input={onSearchInput}
        />
      </div>
      <div class="decks-dirb-row">
        <div class="decks-dirb-views" role="tablist">
          {#each views as option (option.id)}
            <button
              type="button"
              role="tab"
              class="decks-dirb-chip"
              class:is-active={view === option.id}
              aria-selected={view === option.id}
              on:click={() => setView(option.id)}>{option.label}</button
            >
          {/each}
        </div>
        <select class="dropdown" aria-label={t.subjectName} bind:value={subject} on:change={() => void reload()}>
          <option value="">{t.browseAllSubjects}</option>
          {#each filters.subjects as choice (choice.value)}
            <option value={choice.value}>{directorySubjectLabel(choice.value)} ({choice.count})</option>
          {/each}
        </select>
        <select class="dropdown" aria-label={t.languageName} bind:value={language} on:change={() => void reload()}>
          <option value="">{t.browseAllLanguages}</option>
          {#each filters.languages as choice (choice.value)}
            <option value={choice.value}>{directoryLanguageName(choice.value, locale)} ({choice.count})</option>
          {/each}
        </select>
        <select class="dropdown" aria-label={t.browseSort} bind:value={sort} on:change={() => void reload()}>
          <option value="downloads">{t.browseSortDownloads}</option>
          <option value="updated">{t.browseSortUpdated}</option>
          <option value="likes">{t.browseSortLikes}</option>
        </select>
      </div>
    </div>

    {#if loading && decks.length === 0}
      <div class="decks-dirb-empty"><span class="decks-dirb-spinner" aria-hidden="true"></span></div>
    {:else if error && decks.length === 0}
      <div class="decks-dirb-empty">
        <p>{error}</p>
        <button type="button" on:click={() => void reload()}>{t.browseRetry}</button>
      </div>
    {:else if decks.length === 0}
      <div class="decks-dirb-empty">{emptyText}</div>
    {:else}
      <div class="decks-dirb-list">
        {#each decks as deck (deck.slug)}
          {@const state = stateOf(deck, records)}
          {@const row = status[deck.slug]}
          {@const cover = directoryCoverUrl(deck.cover)}
          <div class="decks-dirb-item">
            <button type="button" class="decks-dirb-item-open" on:click={() => (openSlug = deck.slug)}>
              <span class="decks-dirb-cover" aria-hidden="true">
                {#if cover}
                  <img src={cover} alt="" loading="lazy" />
                {:else}
                  <span use:icon={"layers"}></span>
                {/if}
              </span>
              <span class="decks-dirb-item-text">
                <span class="decks-dirb-item-name">{deck.title}</span>
                {#if deck.description}
                  <span class="decks-dirb-item-desc">{directoryDescriptionSummary(deck.description, 120)}</span>
                {/if}
                <span class="decks-dirb-item-meta">
                  {#if state.state === "update"}<span class="decks-dirb-update">{t.browseUpdateAvailable}</span> ·{/if}
                  {meta(deck)}
                </span>
                {#if row?.kind === "error"}
                  <span class="decks-dirb-error">{row.message}</span>
                {/if}
              </span>
            </button>
            {#if state.state === "installed" && row?.kind !== "busy"}
              <span class="decks-dirb-added"><span use:icon={"check"} aria-hidden="true"></span>{t.browseAddedState}</span>
            {:else}
              <button
                type="button"
                class="mod-cta decks-dirb-add"
                disabled={row?.kind === "busy"}
                on:click={() => void add(deck)}
              >
                {row?.kind === "busy"
              ? state.state === "update"
                ? t.browseUpdating
                : t.browseAdding
              : state.state === "update"
                ? t.updateButton
                : t.browseAdd}
              </button>
            {/if}
          </div>
        {/each}
      </div>
      {#if hasMore}
        <div class="decks-dirb-more">
          <button type="button" disabled={loadingMore} on:click={() => void loadMore()}>{t.browseLoadMore}</button>
        </div>
      {/if}
      {#if error}
        <div class="decks-dirb-error">{error}</div>
      {/if}
      <p class="decks-dirb-terms">
        {t.browseTerms}
        <button type="button" class="decks-dirb-link" on:click={openTerms}>{t.browseTermsLink}</button>
      </p>
    {/if}
  {/if}
</div>
