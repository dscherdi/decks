<script lang="ts">
  import { createEventDispatcher, onMount } from 'svelte';
  import type { CardData, CardEditorData } from '../types';
  
  export let card: CardData | null = null;
  export let isOpen: boolean = false;
  
  const dispatch = createEventDispatcher();
  
  let titleInput: string = '';
  let contentInput: string = '';
  let tagsInput: string = '';
  let scheduleCheckbox: boolean = true;
  
  $: isEditing = !!card;
  
  onMount(() => {
    if (card) {
      titleInput = card.title || '';
      contentInput = card.content || '';
      tagsInput = card.tags ? card.tags.join(', ') : '';
    } else {
      resetForm();
    }
  });
  
  function resetForm() {
    titleInput = '';
    contentInput = '';
    tagsInput = '';
    scheduleCheckbox = true;
  }
  
  function handleClose() {
    dispatch('close');
  }
  
  function handleSubmit(event: Event) {
    event.preventDefault();
    
    // Validate form
    if (!titleInput.trim()) {
      dispatch('error', 'Please enter a title for the card');
      return;
    }
    
    if (!contentInput.trim()) {
      dispatch('error', 'Please enter content for the card');
      return;
    }
    
    // Parse tags
    const tagsString = tagsInput.trim();
    const tags = tagsString
      ? tagsString
          .split(',')
          .map((tag) => tag.trim())
          .filter((tag) => tag)
      : [];
    
    // Prepare card data
    const cardData: CardEditorData = {
      title: titleInput.trim(),
      content: contentInput.trim(),
      tags,
      scheduleNow: !isEditing && scheduleCheckbox
    };
    
    if (isEditing && card) {
      dispatch('update', { id: card.id, data: cardData });
    } else {
      dispatch('create', cardData);
    }
  }
</script>

<div class="flashcard-editor-modal" class:hidden={!isOpen}>
  <div class="flashcard-editor-content">
    <h2>{isEditing ? 'Edit Card' : 'Create New Card'}</h2>
    
    <form on:submit={handleSubmit}>
      <label>
        Title
        <input 
          type="text" 
          placeholder="Card title" 
          bind:value={titleInput}
          required
        />
      </label>
      
      <label>
        Content (supports Markdown)
        <textarea 
          placeholder="Card content in Markdown" 
          bind:value={contentInput}
          required
          rows="8"
        ></textarea>
      </label>
      
      <label>
        Tags (comma-separated)
        <input 
          type="text" 
          placeholder="tag1, tag2, tag3" 
          bind:value={tagsInput}
        />
      </label>
      
      {#if !isEditing}
        <label class="checkbox-label">
          <input 
            type="checkbox" 
            bind:checked={scheduleCheckbox}
          />
          Schedule for immediate review
        </label>
      {/if}
      
      <div class="flashcard-editor-buttons">
        <button 
          type="button" 
          class="flashcard-editor-button" 
          on:click={handleClose}
        >
          Cancel
        </button>
        
        <button 
          type="submit" 
          class="flashcard-editor-button mod-cta"
        >
          Save
        </button>
      </div>
    </form>
  </div>
</div>

<style>
  .flashcard-editor-modal {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background-color: rgba(0, 0, 0, 0.5);
    display: flex;
    justify-content: center;
    align-items: center;
    z-index: 1000;
  }
  
  .hidden {
    display: none;
  }
  
  .flashcard-editor-content {
    background-color: var(--background-primary);
    padding: 20px;
    border-radius: 5px;
    box-shadow: 0 2px 10px rgba(0, 0, 0, 0.1);
    width: 90%;
    max-width: 600px;
    max-height: 90vh;
    overflow-y: auto;
  }
  
  form {
    display: flex;
    flex-direction: column;
    gap: 15px;
  }
  
  label {
    display: flex;
    flex-direction: column;
    gap: 5px;
  }
  
  input[type="text"],
  textarea {
    padding: 8px;
    border-radius: 4px;
    border: 1px solid var(--background-modifier-border);
    background: var(--background-primary);
    color: var(--text-normal);
  }
  
  textarea {
    min-height: 150px;
    resize: vertical;
  }
  
  .checkbox-label {
    flex-direction: row !important;
    align-items: center;
    gap: 8px !important;
  }
  
  .flashcard-editor-buttons {
    display: flex;
    justify-content: flex-end;
    gap: 10px;
    margin-top: 20px;
  }
  
  .flashcard-editor-button {
    padding: 6px 12px;
    border-radius: 4px;
    border: 1px solid var(--background-modifier-border);
    background: var(--background-primary);
    color: var(--text-normal);
    cursor: pointer;
  }
  
  .mod-cta {
    background-color: var(--interactive-accent);
    color: var(--text-on-accent);
    border: none;
  }
</style>