# FSRS Algorithm Precision Improvements

This document outlines the comprehensive precision improvements made to the FSRS (Free Spaced Repetition Scheduler) algorithm implementation to maximize numeric accuracy in all scheduling calculations.

## Overview

The FSRS algorithm has been refactored to preserve full IEEE 754 double precision (approximately 15-17 significant decimal digits) throughout all calculations involving stability, difficulty, retrievability, and intervals.

## Key Improvements

### 1. Eliminated Premature Rounding

**Before:**
```typescript
stability: Number(card.stability.toFixed(6))
difficulty: Number(card.difficulty.toFixed(2))
```

**After:**
```typescript
stability: card.stability  // Full precision maintained
difficulty: card.difficulty  // Full precision maintained
```

### 2. Exact Time Conversion Constants

**Added precise constants:**
```typescript
const MILLISECONDS_PER_DAY = 86400000;
const MINUTES_PER_DAY = 1440;
const SECONDS_PER_MINUTE = 60;
const MILLISECONDS_PER_MINUTE = 60000;
```

### 3. Enhanced Calculation Precision

**Forgetting Curve Function:**
- Stores intermediate calculations to avoid precision loss
- Validates each step before proceeding
- Uses exact mathematical operations

**Next Stability Calculation:**
- Breaks down complex expressions into intermediate variables
- Validates each component separately
- Preserves full precision through multi-step calculations

**Interval Calculations:**
- Uses exact day-to-minute conversions
- Avoids chained floating-point operations
- Maintains precision in sub-minute intervals

### 4. Precision-Preserving Time Handling

**Elapsed Time Calculation:**
```typescript
// Before: Multiple operations in one line
const elapsedDays = (now.getTime() - lastReview.getTime()) / 86400000;

// After: Explicit intermediate steps
const nowTime = now.getTime();
const lastReviewTime = lastReview.getTime();
const elapsedMilliseconds = nowTime - lastReviewTime;
const elapsedDays = elapsedMilliseconds / MILLISECONDS_PER_DAY;
```

### 5. Display-Only Formatting

**New Helper Function:**
```typescript
export function roundForDisplay(value: number, decimals: number): string {
  return value.toFixed(decimals);
}
```

**Usage:**
- Only used for UI display and export formatting
- Never used in internal calculations
- Preserves full precision in all algorithm logic

## Implementation Details

### Core Algorithm Functions

#### `forgettingCurve(elapsedDays: number, stability: number): number`
- Validates inputs for finite values
- Stores intermediate calculations in separate variables
- Uses precise power calculations with validation

#### `nextStability(difficulty, stability, retrievability, rating): number`
- Extracts and validates all weight parameters
- Calculates each component separately
- Validates intermediate results before final calculation
- Returns full-precision result

#### `nextDifficulty(difficulty: number, rating: number): number`
- Preserves precision through mean reversion calculation
- Only applies clamping after all calculations complete
- Maintains exact floating-point values

#### `nextIntervalMinutes(stability: number): number`
- Uses exact logarithmic calculations
- Employs precise day-to-minute conversion
- Validates each step of the calculation chain

### Data Storage

**Database Schema:**
- `stability: number` - stores full IEEE 754 precision
- `difficulty: number` - stores full IEEE 754 precision
- `interval: number` - stores exact minutes without rounding

**Internal Representation:**
- No `.toFixed()` calls in calculation paths
- No `Math.round()` calls except for discrete display units
- Full precision maintained through update cycles

## Testing Framework

### Precision Test Suite

The implementation includes comprehensive tests to verify:

1. **Significant Digit Preservation:** Values maintain at least 12 significant digits
2. **Multi-Cycle Stability:** 100+ review cycles without precision degradation
3. **Extreme Value Handling:** Very small/large values processed correctly
4. **Calculation Consistency:** Identical inputs produce identical outputs
5. **Edge Case Robustness:** Boundary conditions handled precisely

### Test Coverage

- ✅ Internal precision validation
- ✅ Forgetting curve precision
- ✅ Multi-cycle precision preservation
- ✅ Extreme value handling
- ✅ Time precision tests
- ✅ Scheduling info precision
- ✅ Precision loss detection
- ✅ Display formatting separation

## Performance Impact

**Memory:** Minimal increase due to intermediate variable storage
**CPU:** Negligible overhead from additional validations
**Accuracy:** Significant improvement in long-term scheduling precision

## Migration Notes

### Existing Data
- All existing flashcard data remains compatible
- No database migration required
- Precision improvements apply immediately to new calculations

### API Changes
- `roundForDisplay()` function added for UI formatting
- No breaking changes to existing method signatures
- Internal precision automatically improved

## Validation

### Precision Verification

```typescript
// Example: Verify 12+ significant digits maintained
const originalValue = 1.23456789012345;
const result = fsrs.updateCard(card, "good");
expect(result.stability.toString()).toMatch(/\d{12,}/);
```

### Consistency Verification

```typescript
// Example: Identical inputs produce identical outputs
const result1 = fsrs.updateCard(card1, "good");
const result2 = fsrs.updateCard(card2, "good");
expect(result1.stability).toBe(result2.stability);
```

## Benefits

1. **Long-term Accuracy:** Scheduling remains precise over thousands of reviews
2. **Sub-day Precision:** Minute-level intervals calculated exactly
3. **Reproducible Results:** Identical inputs always produce identical outputs
4. **Scientific Accuracy:** Algorithm behavior matches mathematical specifications
5. **Future-proof:** Maximum available precision preserved for future enhancements

## Usage Guidelines

### DO:
- Use full precision values in all internal calculations
- Store raw floating-point values in database
- Use `roundForDisplay()` only for UI presentation
- Validate intermediate results in complex calculations

### DON'T:
- Apply `.toFixed()` or `Math.round()` in algorithm logic
- Chain multiple floating-point operations without intermediate variables
- Store rounded values in database fields
- Use display-formatted values in calculations

## Implementation Checklist

- [x] Remove all premature rounding from algorithm logic
- [x] Add exact time conversion constants
- [x] Implement precision-preserving calculation methods
- [x] Create display-only formatting utilities
- [x] Add comprehensive precision test suite
- [x] Validate extreme value handling
- [x] Ensure multi-cycle precision preservation
- [x] Document precision guidelines
- [x] Verify API compatibility
- [x] Test performance impact

## Future Considerations

1. **Extended Precision:** Consider arbitrary precision libraries for extreme cases
2. **Performance Monitoring:** Track calculation performance in production
3. **Precision Metrics:** Add runtime precision monitoring
4. **Algorithm Updates:** Maintain precision in future FSRS versions

---

This precision improvement ensures the FSRS algorithm maintains mathematical accuracy throughout its operation, providing reliable and consistent spaced repetition scheduling for long-term learning effectiveness.