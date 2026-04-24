## Description

Id like to implement creating image occlusion flashcards using native markdown
It should work like this
- An image occlusion flashcard is a header(title)-paragraph card that contains only a link to an image using the markdown link syntax ![[image.png/jpeg/(other image formats)]] and directly after it a numbered list containing one cloze per line. 
- This is the convention i want to use for image occlusion since it builds on top the cloze deletion feature. The image itself does not contain text just indexes and each index corresponds to the numbered list entry with the cloze. 
- Displaying image occlusion flashcards:
  - The review modal displays image occlusion flashcards by making the image the front of the card and the list with clozes the back of it in which clozes function just like they would normally. 