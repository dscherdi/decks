// Test setup file to mock browser APIs not available in Node.js

// Mock requestAnimationFrame for Node.js test environment
global.requestAnimationFrame = (callback: FrameRequestCallback): number => {
  return setTimeout(callback, 0);
};

// Mock cancelAnimationFrame
global.cancelAnimationFrame = (handle: number): void => {
  clearTimeout(handle);
};

// Mock performance.now if not available
if (typeof global.performance === "undefined") {
  global.performance = {
    now: () => Date.now(),
  } as Performance;
}

// Obsidian injects `window` (and the popout-aware `activeWindow`) at runtime;
// the Node test environment doesn't, so source that now calls window.setTimeout
// etc. (popout-window compatibility) would throw. Point them at the Node global.
if (typeof window === "undefined") {
  const nodeGlobal = global as Window & typeof globalThis;
  (global as { window?: Window & typeof globalThis }).window = nodeGlobal;
  (global as { activeWindow?: Window & typeof globalThis }).activeWindow =
    nodeGlobal;
}
