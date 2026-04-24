## Image occlusion

Image occlusion flashcards combine an image with a numbered list to create cards where you identify labeled regions on an image.

### Format

Place an image embed followed by a numbered list under a header. The image should contain numbered indexes (labels) that correspond to the numbered list entries. Each `==highlighted==` term in the list is the answer for that label.

```markdown
## Bones of the arm

![[arm_bones.png]]
1. ==Humerus==
2. ==Radius==
3. ==Ulna==
```

### How it works

- The parser detects the image-embed + numbered-list pattern under a header when cloze is enabled on the profile
- Each numbered list item produces exactly one flashcard with type `image-occlusion`
- The image embed becomes the **front** of every card
- The numbered list (without the image) becomes the **back** of every card
- The active list item's cloze markers are blanked during review; other items follow the profile's cloze context mode (hidden or open)

### Card generation rules

- One card per non-empty list item, regardless of how many `==highlights==` it contains
- All highlights in the active item are blanked and revealed together as a group
- Items without `==highlights==` still generate cards — the full item text is treated as the answer
- Empty list items are skipped
- Reverse cards are not generated for image occlusion cards

### Parsing detection

The parser checks the content lines under a header:
1. First non-empty line must match the image embed regex: `![[filename.(png|jpg|jpeg|gif|svg|bmp|webp)]]`
2. All remaining non-empty lines must be numbered list items: `1. text`, `2. text`, etc.
3. If either condition fails, the block falls through to regular cloze or header-paragraph parsing

### Breadcrumb and navigation

Image occlusion cards include the card's own header in the breadcrumb (unlike other card types that exclude it). This allows the go-to-source button to navigate directly to the parent header in the source file by extracting the last breadcrumb part.

### ID generation

Image occlusion cards use the same ID scheme as cloze cards: `generateClozeFlashcardId(front, clozeText, clozeOrder, deckId)` where `front` is the image embed.

### Schema

The `flashcards` table type column accepts `'image-occlusion'` as a valid type (added in schema v12). The card stores:
- `front`: the image embed (e.g., `![[arm_bones.png]]`)
- `back`: the numbered list content (without the image embed)
- `cloze_text`: the answer text for this card's list item (with `==` markers stripped)
- `cloze_order`: the 0-based index of the list item

### Review rendering

1. **Front**: The image embed is rendered via Obsidian's markdown renderer
2. **Back**: `prepareImageOcclusionBack()` processes the numbered list — wraps non-cloze items in `==` markers so the post-processor can apply hidden/open mode to all items. Returns a mark index range (`markStart`, `markEnd`) identifying which `<mark>` elements belong to the active list item.
3. The markdown post-processor uses `data-decks-cloze-index` and `data-decks-cloze-index-end` attributes for range-based active mark identification, replacing active marks with clickable `[...]` blanks.
4. Clicking any active blank reveals all active blanks for that list item using the `data-decks-cloze-text` attribute.
