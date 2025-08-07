# Progress Bar Demo - Force Refresh Feature

This document demonstrates the new progress bar feature that appears during force refresh operations in the Decks plugin.

## What is Force Refresh?

Force refresh is triggered when you click the refresh button (🔄) in the deck list panel. Unlike regular background sync, force refresh:

- Processes ALL decks regardless of modification time
- Shows a visual progress bar with real-time updates
- Provides detailed status information during the operation
- Displays completion statistics

## Progress Bar Examples

### Small Collection (1-5 decks)
```
🔍 Discovering decks...
[██░░░░░░░░░░░░░░░░░░░░░░░] 10%

📚 Processing 3 decks...
[█████░░░░░░░░░░░░░░░░░░░░] 20%

📄 Processing deck: Spanish Verbs (2/3)
[██████████████░░░░░░░░░░░] 55%

✅ Sync complete! Processed 47 flashcards across 3 decks in 234ms
[█████████████████████████] 100%
```

### Large Collection (10+ decks)
```
🔍 Discovering decks...
[██░░░░░░░░░░░░░░░░░░░░░░░] 10%

📚 Processing 12 decks...
[█████░░░░░░░░░░░░░░░░░░░░] 20%

📄 Processing deck: German Grammar (7/12)
[██████████████████░░░░░░░] 72%

📄 Processing deck: French Vocabulary (11/12)
[███████████████████████░░] 92%

✅ Sync complete! Processed 1,247 flashcards across 12 decks in 2.15s
[█████████████████████████] 100%
```

## Progress Stages

The progress bar goes through these stages:

1. **Discovery (0-10%)**: Scanning vault for flashcard files
2. **Processing Setup (10-20%)**: Preparing decks for sync
3. **Deck Processing (20-95%)**: Processing each deck individually
4. **Finalization (95-100%)**: Cleanup and statistics
5. **Completion**: Shows final summary with auto-hide after 3 seconds

## How to Test the Progress Bar

### Method 1: Large Collection
1. Create multiple markdown files with flashcards (5+ files)
2. Add substantial content to each file (10+ flashcards per file)
3. Click the refresh button in the deck panel
4. Watch the progress bar update in real-time

### Method 2: Simulated Delay
1. Create a few flashcard files
2. Enable performance logs in settings to see timing details
3. Click refresh and observe both the progress bar and console logs
4. The progress bar updates as each deck is processed

### Method 3: Error Simulation
1. Create a flashcard file with invalid markdown
2. Force refresh to see error handling
3. Progress bar will show error state: "❌ Sync failed - check console for details"

## Progress Bar Features

### Visual Elements
- **Unicode Progress Bar**: Uses █ (filled) and ░ (empty) characters
- **Real-time Updates**: Progress updates as each deck is processed
- **Status Messages**: Clear descriptions of current operation
- **Percentage Display**: Numerical progress indicator
- **Auto-hide**: Automatically disappears after successful completion

### Error Handling
- Shows error message if sync fails
- Maintains progress bar with error styling
- Longer display time (5 seconds) for error messages
- Logs detailed error information to console

### Performance Integration
- Works seamlessly with performance logging
- Shows final timing information in completion message
- Coordinates with existing refresh button state (spinning icon)
- Non-blocking operation maintains UI responsiveness

## Technical Details

### Progress Calculation
- **Discovery**: Fixed 10% for vault scanning
- **Setup**: Fixed 10% for deck preparation  
- **Processing**: 70% distributed across deck count
- **Finalization**: Fixed 5% for cleanup

### Update Frequency
- Updates once per deck during processing
- Real-time status updates for current operation
- Smooth progress increments based on deck count

### Memory Efficiency
- Minimal overhead during operation
- Progress bar elements cleaned up after completion
- No persistent storage of progress state

## Best Practices

### For Users
- Use force refresh when flashcards seem out of sync
- Enable performance logs to monitor large collection performance
- Don't interrupt force refresh (wait for completion)
- Check console for detailed timing information

### For Large Collections (100+ decks)
- Force refresh may take several seconds
- Progress bar prevents wondering if operation is stuck
- Performance logs help identify slow decks
- Consider organizing large collections into subdirectories

This progress bar feature significantly improves user experience during sync operations, especially with large flashcard collections!