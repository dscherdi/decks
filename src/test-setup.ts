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
