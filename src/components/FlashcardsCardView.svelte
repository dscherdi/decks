<script lang="ts">
  import { onMount, createEventDispatcher } from 'svelte';
  import type { CardData, ReviewData } from '../types';
  
  export let cards: CardData[] = [];
  export let reviewData: Record<string, ReviewData> = {};
  export let filterTag: string | null = null;
  export let searchTerm: string = '';
  export let sortField: string = 'created';
  export let sortDirection: 'asc' | 'desc' = 'desc';
  
  const dispatch = createEventDispatcher();
  
  // Derived from props
  $: filteredCards = getFilteredCards(cards, filterTag, searchTerm, sortField, sortDirection);
  
  // Event handlers
  function handleTagClick(tag: string) {
    dispatch('tagSelect', tag);
  }
  
  function handleEditClick(card: CardData, event: MouseEvent) {
    event.stopPropagation();
    dispatch('editCard', card);
  }
  
  function handleDeleteClick(cardId: string, event: MouseEvent) {
    event.stopPropagation();
    dispatch('deleteCard', cardId);
  }
  
  function handleReviewClick(card: CardData, event: MouseEvent) {
    event.stopPropagation();
    dispatch('reviewCard', card);
  }
  
  function handleCardClick(card: CardData) {
    dispatch('showCard', card);
  }
  
  // Utility functions
  function getFilteredCards(
    allCards: CardData[], 
    tag: string | null, 
    search: string,
    sort: string,
    direction: 'asc' | 'desc'
  ) {
    if (!allCards || !Array.isArray(allCards)) {
      return [];
    }
    
    let filtered = [...allCards];
    
    // Filter by tag if a tag filter is active
    if (tag) {
      filtered = filtered.filter(
        (card) => card.tags && card.tags.includes(tag)
      );
    }
    
    // Filter by search term if there is one
    if (search) {
      const searchLower = search.toLowerCase();
      filtered = filtered.filter(
        (card) =>
          (card.title && card.title.toLowerCase().includes(searchLower)) ||
          (card.content && card.content.toLowerCase().includes(searchLower))
      );
    }
    
    // Sort cards
    filtered.sort((a, b) => {
      let valA, valB;
      
      // Determine values to compare based on sort field
      if (sort === "nextReview") {
        const reviewDataA = reviewData[a.id];
        const reviewDataB = reviewData[b.id];
        
        valA = reviewDataA && reviewDataA.nextReview 
          ? new Date(reviewDataA.nextReview) 
          : new Date(0);
        valB = reviewDataB && reviewDataB.nextReview 
          ? new Date(reviewDataB.nextReview) 
          : new Date(0);
      } else if (sort === "created" || sort === "modified") {
        valA = a[sort] ? new Date(a[sort]) : new Date(0);
        valB = b[sort] ? new Date(b[sort]) : new Date(0);
      } else if (sort === "tags") {
        valA = a.tags ? a.tags.join(",") : "";
        valB = b.tags ? b.tags.join(",") : "";
      } else {
        valA = a[sort] || "";
        valB = b[sort] || "";
      }
      
      // Perform comparison based on sort direction
      if (direction === "asc") {
        return valA > valB ? 1 : -1;
      } else {
        return valA < valB ? 1 : -1;
      }
    });
    
    return filtered;
  }
  
  function getReviewStatus(cardId: string) {
    const reviewInfo = reviewData[cardId];
    if (!reviewInfo || !reviewInfo.nextReview) {
      return {
        text: "Not reviewed",
        class: "flashcards-not-reviewed"
      };
    }
    
    const reviewDate = new Date(reviewInfo.nextReview);
    const now = new Date();
    
    if (reviewDate <= now) {
      return {
        text: "Due now",
        class: "flashcards-due-now"
      };
    } else {
      return {
        text: reviewDate.toLocaleDateString(),
        class: "flashcards-upcoming"
      };
    }
  }
  
  // Function to render markdown content (using Obsidian's API)
  // This will need to be handled by the parent component
  function renderMarkdownContent(content: string): string {
    // Return a simplified version for now - the actual rendering will be done in the parent
    return content;
  }
</script>

<div class="flashcards-cards-container">
  {#if filteredCards.length === 0}
    <div class="flashcards-empty-message">
      No cards found. Add your first card using the "Add Card" button above.
      
      <div class="flashcards-empty-cta">
        <button 
          class="flashcards-add-btn notion-like-btn"
          on:click={() => dispatch('addCard')}
        >
          Add Your First Card
        </button>
      </div>
    </div>
  {:else}
    {#each filteredCards as card}
      <div class="flashcards-card" on:click={() => handleCardClick(card)}>
        <!-- Card header -->
        <div class="flashcards-card-header">
          <div class="flashcards-card-title">
            {card.title}
          </div>
          
          <!-- Tags -->
          <div class="flashcards-tags">
            {#if card.tags && card.tags.length > 0}
              {#each card.tags as tag}
                <span 
                  class="flashcards-tag"
                  on:click={(e) => {
                    e.stopPropagation();
                    handleTagClick(tag);
                  }}
                >
                  {tag}
                </span>
              {/each}
            {/if}
          </div>
        </div>
        
        <!-- Card content (preview) -->
        <div class="flashcards-card-content">
          <div class="markdown-rendered">
            <!-- The actual markdown rendering will happen in the parent component -->
            {card.content.substring(0, 150)}
            {card.content.length > 150 ? '...' : ''}
          </div>
        </div>
        
        <!-- Card footer -->
        <div class="flashcards-card-footer">
          <!-- Next review date -->
          {@const status = getReviewStatus(card.id)}
          <div class={`flashcards-review-date ${status.class}`}>
            {status.text}
          </div>
          
          <!-- Action buttons -->
          <div class="flashcards-actions">
            <button 
              class="flashcards-action-btn notion-like-btn"
              aria-label="Edit card"
              on:click={(e) => handleEditClick(card, e)}
            >
              <svg viewBox="0 0 100 100" width="16" height="16">
                <path d="M12,86.5V70.5L62.8,19.6l16,16L28.1,86.5H12Z M72.1,35.7l-16-16l10-10c1.6-1.6,3.7-2.5,5.9-2.5c2.2,0,4.3,0.9,5.9,2.5l4.2,4.2c3.3,3.3,3.3,8.5,0,11.8L72.1,35.7Z" />
              </svg>
            </button>
            
            <button 
              class="flashcards-action-btn notion-like-btn"
              aria-label="Delete card"
              on:click={(e) => handleDeleteClick(card.id, e)}
            >
              <svg viewBox="0 0 100 100" width="16" height="16">
                <path d="M75,25H100V33.3H91.7V91.7C91.7,96.3,87.9,100,83.3,100H16.7C12.1,100,8.3,96.3,8.3,91.7V33.3H0V25H25V8.3C25,3.7,28.7,0,33.3,0H66.7C71.3,0,75,3.7,75,8.3V25ZM16.7,33.3V91.7H83.3V33.3H16.7ZM33.3,50H41.7V75H33.3V50ZM58.3,50H66.7V75H58.3V50ZM33.3,8.3V25H66.7V8.3H33.3Z" />
              </svg>
            </button>
            
            <button 
              class="flashcards-action-btn notion-like-btn"
              aria-label="Review card"
              on:click={(e) => handleReviewClick(card, e)}
            >
              <svg viewBox="0 0 100 100" width="16" height="16">
                <path d="M25,12.5v75L87.5,50L25,12.5z" />
              </svg>
            </button>
          </div>
        </div>
      </div>
    {/each}
  {/if}
</div>

<style>
  /* Styling is handled by the global CSS file */
</style>