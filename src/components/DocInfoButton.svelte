<script lang="ts">
  // Small "(i)" button that opens the matching documentation page in the
  // browser. Obsidian opens http(s) anchors in the system browser, so a bare
  // <a href> is all that's needed. Reused across the main UI surfaces.
  import { setIcon } from "obsidian";
  import { I18n } from "@decks/core";
  import { docUrl } from "../utils/docs";

  export let path: string;

  function icon(node: HTMLElement, name: string) {
    setIcon(node, name);
    return {
      update(next: string) {
        node.empty();
        setIcon(node, next);
      },
    };
  }
</script>

<a
  class="clickable-icon decks-doc-info"
  href={docUrl(path)}
  target="_blank"
  rel="noopener"
  aria-label={I18n.t.help.docs}
  title={I18n.t.help.docs}
  use:icon={"info"}
  on:click|stopPropagation
  on:touchend|stopPropagation
></a>

<style>
  .decks-doc-info {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    color: var(--text-muted);
  }
  .decks-doc-info:hover {
    color: var(--text-normal);
  }
  .decks-doc-info :global(svg) {
    width: 16px;
    height: 16px;
  }
</style>
