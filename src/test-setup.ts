// Test setup file to mock browser APIs not available in Node.js.
// Node/jest bootstrap: polyfills window/activeWindow from the Node global, so it
// must reference the Node global directly; it never runs in Obsidian. Excluded
// from linting via eslint.config.mjs `ignores`.

// esbuild's `define` injects this at build time; jest doesn't run esbuild, so
// declare it here. Tests exercise the development path, which is the one with
// the extra behaviour (URL overrides) worth covering.
(global as { __DECKS_DEV__?: boolean }).__DECKS_DEV__ = true;

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
