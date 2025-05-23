<script lang="ts">
  // Import without the Svelte components initially to diagnose the issue
  import { onMount } from 'svelte';
  import type { CardData, FlashcardsData } from '../types';
  
  // Props passed from the Obsidian plugin
  export let data: FlashcardsData | null = null;
  export let reviewData: Record<string, any> = {}; // Simplified type
  export let currentFile: any = null; // TFile from Obsidian
  export let renderMarkdown: any; // Simplified type
  export let saveData: () => Promise<boolean>;
  
  // Local state
  let viewType = 'table';
  let errorMessage = null;
  
  // Simplified onMount to avoid any potential issues
  onMount(() => {
    console.log("FlashcardsView mounted");
  });
  
  function createNewDocument() {
    const event = new CustomEvent('createNewDocument');
    window.dispatchEvent(event);
  }
</script>

<div class="flashcards-document-view notion-like-view">
  {#if !data}
    <div class="flashcards-empty-state">
      <h2>No Flashcards Document Selected</h2>
      <div class="flashcards-actions">
        <button 
          class="mod-cta notion-like-btn"
          on:click={createNewDocument}
        >
          Create New Flashcards Document
        </button>
      </div>
    </div>
  {:else}
    <div class="flashcards-content">
      <h3>Document: {data.metadata?.name || 'Untitled'}</h3>
      <p>Card Count: {data.cards?.length || 0}</p>
      
      <div class="flashcards-table-container">
        <table class="flashcards-table">
          <thead>
            <tr>
              <th>Title</th>
              <th>Tags</th>
              <th>Created</th>
            </tr>
          </thead>
          <tbody>
            {#if data.cards && data.cards.length > 0}
              {#each data.cards as card}
                <tr>
                  <td>{card.title}</td>
                  <td>{card.tags ? card.tags.join(', ') : ''}</td>
                  <td>{new Date(card.created).toLocaleDateString()}</td>
                </tr>
              {/each}
            {:else}
              <tr>
                <td colspan="3" class="empty-message">No cards found</td>
              </tr>
            {/if}
          </tbody>
        </table>
      </div>
    </div>
  {/if}
</div>

<style>
  .flashcards-content {
    padding: 20px;
  }
  
  .flashcards-table-container {
    margin-top: 20px;
    border: 1px solid var(--background-modifier-border);
    border-radius: 4px;
    overflow: auto;
  }
  
  .flashcards-table {
    width: 100%;
    border-collapse: collapse;
  }
  
  .flashcards-table th,
  .flashcards-table td {
    padding: 8px 12px;
    text-align: left;
    border-bottom: 1px solid var(--background-modifier-border);
  }
  
  .empty-message {
    text-align: center;
    padding: 20px;
    color: var(--text-muted);
  }
</style>