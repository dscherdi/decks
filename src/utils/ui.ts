/**
 * UI utility functions for preventing blocking operations
 */

/**
 * Yield control to the UI thread to prevent blocking
 * Uses requestAnimationFrame in browser environments, setTimeout in Node.js (tests)
 */
export async function yieldToUI(): Promise<void> {
  await new Promise<void>((resolve) => {
    if (typeof requestAnimationFrame !== "undefined") {
      requestAnimationFrame(() => resolve());
    } else {
      setTimeout(() => resolve(), 0);
    }
  });
}

/**
 * Yield control every N iterations to prevent blocking during loops
 * @param currentIndex - Current iteration index
 * @param yieldInterval - Yield every N iterations (default: 50)
 */
export async function yieldEvery(currentIndex: number, yieldInterval: number = 50): Promise<void> {
  if (currentIndex > 0 && currentIndex % yieldInterval === 0) {
    await yieldToUI();
  }
}

/**
 * Execute a function with automatic yielding for long-running operations
 * @param items - Array of items to process
 * @param processor - Function to process each item
 * @param yieldInterval - Yield every N items (default: 50)
 */
export async function processWithYielding<T, R>(
  items: T[],
  processor: (item: T, index: number) => R | Promise<R>,
  yieldInterval: number = 50
): Promise<R[]> {
  const results: R[] = [];

  for (let i = 0; i < items.length; i++) {
    const result = await processor(items[i], i);
    results.push(result);

    await yieldEvery(i, yieldInterval);
  }

  return results;
}
