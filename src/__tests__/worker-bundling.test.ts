import * as fs from "fs";
import * as path from "path";

describe("Worker Bundling", () => {
  const distDir = path.join(__dirname, "../../dist");
  const workerPath = path.join(distDir, "database-worker.js");

  it("should have database-worker.js in dist directory", () => {
    expect(fs.existsSync(workerPath)).toBe(true);
  });

  it("should have non-empty worker file", () => {
    if (fs.existsSync(workerPath)) {
      const stats = fs.statSync(workerPath);
      expect(stats.size).toBeGreaterThan(1000); // Should be at least 1KB
    }
  });

  it("should contain expected worker code structure", () => {
    if (fs.existsSync(workerPath)) {
      const content = fs.readFileSync(workerPath, "utf8");

      // Check for essential worker components
      expect(content).toContain("initialize");
      expect(content).toContain("self.onmessage");
      expect(content).toContain("sqlJsCode");
      expect(content).toContain("wasmBytes");
      expect(content).toContain("querySql");
      expect(content).toContain("executeSql");
      // Check for basic worker operations
      expect(content).toContain("export");
      expect(content).toContain("close");
    }
  });

  it("should be properly bundled", () => {
    if (fs.existsSync(workerPath)) {
      const content = fs.readFileSync(workerPath, "utf8");

      // Check that it's bundled (contains minified/bundled code)
      expect(content.length).toBeGreaterThan(2000); // Simplified worker should be at least 2KB
    }
  });

  it("should have valid JavaScript syntax", () => {
    if (fs.existsSync(workerPath)) {
      const content = fs.readFileSync(workerPath, "utf8");

      // Basic syntax checks - should not throw when parsing
      expect(() => {
        // This would throw if there are syntax errors
        new Function(content);
      }).not.toThrow();
    }
  });
});
