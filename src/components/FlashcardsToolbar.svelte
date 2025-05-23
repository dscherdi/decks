<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  
  export let viewType: 'table' | 'card' = 'table';
  export let searchTerm: string = '';
  export let tags: string[] = [];
  export let selectedTag: string | null = null;
  
  const dispatch = createEventDispatcher();
  
  function handleViewChange(type: 'table' | 'card') {
    if (type !== viewType) {
      dispatch('viewChange', type);
    }
  }
  
  function handleSearchInput(event: Event) {
    const input = event.target as HTMLInputElement;
    dispatch('search', input.value);
  }
  
  function handleTagSelect(event: Event) {
    const select = event.target as HTMLSelectElement;
    dispatch('tagSelect', select.value || null);
  }
  
  function handleAddCard() {
    dispatch('addCard');
  }
  
  function handleReviewDue() {
    dispatch('reviewDue');
  }
</script>

<div class="flashcards-toolbar notion-like-toolbar">
  <!-- View switcher -->
  <div class="flashcards-view-switcher">
    <button 
      class={viewType === 'table' ? 'active notion-like-btn-active' : 'notion-like-btn'} 
      aria-label="Table View"
      on:click={() => handleViewChange('table')}
    >
      <svg viewBox="0 0 100 100" width="16" height="16">
        <path d="M0,0V100H100V0H0ZM91.7,91.7H8.3V33.3H91.7V91.7ZM91.7,25H8.3V8.3H91.7V25Z"/>
      </svg>
    </button>
    
    <button 
      class={viewType === 'card' ? 'active notion-like-btn-active' : 'notion-like-btn'} 
      aria-label="Card View"
      on:click={() => handleViewChange('card')}
    >
      <svg viewBox="0 0 100 100" width="16" height="16">
        <path d="M0,0V41.7H41.7V0H0ZM33.3,33.3H8.3V8.3H33.3V33.3ZM0,58.3V100H41.7V58.3H0ZM33.3,91.7H8.3V66.7H33.3V91.7ZM58.3,0V41.7H100V0H58.3ZM91.7,33.3H66.7V8.3H91.7V33.3ZM58.3,58.3V100H100V58.3H58.3ZM91.7,91.7H66.7V66.7H91.7V91.7Z"/>
      </svg>
    </button>
  </div>
  
  <!-- Search -->
  <div class="flashcards-search">
    <input 
      type="text" 
      placeholder="Search cards..." 
      value={searchTerm}
      on:input={handleSearchInput}
    />
  </div>
  
  <!-- Tag filter -->
  <div class="flashcards-tag-filter">
    <select on:change={handleTagSelect}>
      <option value="" selected={!selectedTag}>All Tags</option>
      {#each tags as tag}
        <option value={tag} selected={selectedTag === tag}>{tag}</option>
      {/each}
    </select>
  </div>
  
  <!-- Add card button -->
  <button 
    class="flashcards-add-btn mod-cta" 
    on:click={handleAddCard}
  >
    Add Card
  </button>
  
  <!-- Review cards button -->
  <button 
    class="flashcards-review-btn" 
    on:click={handleReviewDue}
  >
    Review Due
  </button>
</div>

<style>
  /* Styling is handled by the global CSS file */
</style>