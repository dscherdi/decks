import * as fs from 'fs';
import * as path from 'path';

/**
 * Console adapters to make existing services work without Obsidian dependencies
 */

// Mock Obsidian types for console usage
export interface MockTFile {
  path: string;
  basename: string;
  extension: string;
  name: string;
}

export interface MockCachedMetadata {
  tags?: Array<{ tag: string }>;
  frontmatter?: { tags?: string | string[] };
}

export interface MockVault {
  adapter: MockDataAdapter;
  getMarkdownFiles(): MockTFile[];
  cachedRead(file: MockTFile): Promise<string>;
  configDir: string;
}

export interface MockDataAdapter {
  read(path: string): Promise<string>;
  readBinary(path: string): Promise<ArrayBuffer>;
  write(path: string, content: string): Promise<void>;
  writeBinary(path: string, data: ArrayBuffer): Promise<void>;
  exists(path: string): Promise<boolean>;
  mkdir(path: string): Promise<void>;
  list(path: string): Promise<{ files: string[]; folders: string[] }>;
  stat(path: string): Promise<{ mtime: number; size: number }>;
  remove(path: string): Promise<void>;
  copy(src: string, dest: string): Promise<void>;
  rename(src: string, dest: string): Promise<void>;
}

export interface MockMetadataCache {
  getFileCache(file: MockTFile): MockCachedMetadata | null;
}

/**
 * Console implementation of Obsidian's DataAdapter using Node.js fs
 */
export class ConsoleDataAdapter implements MockDataAdapter {
  private basePath: string;

  constructor(basePath: string) {
    this.basePath = path.resolve(basePath);
  }

  private resolvePath(filePath: string): string {
    return path.resolve(this.basePath, filePath);
  }

  async read(filePath: string): Promise<string> {
    const fullPath = this.resolvePath(filePath);
    return fs.promises.readFile(fullPath, 'utf-8');
  }

  async readBinary(filePath: string): Promise<ArrayBuffer> {
    const fullPath = this.resolvePath(filePath);
    const buffer = await fs.promises.readFile(fullPath);
    return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
  }

  async write(filePath: string, content: string): Promise<void> {
    const fullPath = this.resolvePath(filePath);
    await fs.promises.mkdir(path.dirname(fullPath), { recursive: true });
    await fs.promises.writeFile(fullPath, content, 'utf-8');
  }

  async writeBinary(filePath: string, data: ArrayBuffer): Promise<void> {
    const fullPath = this.resolvePath(filePath);
    await fs.promises.mkdir(path.dirname(fullPath), { recursive: true });
    await fs.promises.writeFile(fullPath, Buffer.from(data));
  }

  async exists(filePath: string): Promise<boolean> {
    const fullPath = this.resolvePath(filePath);
    try {
      await fs.promises.access(fullPath);
      return true;
    } catch {
      return false;
    }
  }

  async mkdir(dirPath: string): Promise<void> {
    const fullPath = this.resolvePath(dirPath);
    await fs.promises.mkdir(fullPath, { recursive: true });
  }

  async list(dirPath: string): Promise<{ files: string[]; folders: string[] }> {
    const fullPath = this.resolvePath(dirPath);
    const entries = await fs.promises.readdir(fullPath, { withFileTypes: true });

    const files: string[] = [];
    const folders: string[] = [];

    for (const entry of entries) {
      if (entry.isFile()) {
        files.push(entry.name);
      } else if (entry.isDirectory()) {
        folders.push(entry.name);
      }
    }

    return { files, folders };
  }

  async stat(filePath: string): Promise<{ mtime: number; size: number }> {
    const fullPath = this.resolvePath(filePath);
    const stats = await fs.promises.stat(fullPath);
    return {
      mtime: stats.mtime.getTime(),
      size: stats.size
    };
  }

  async remove(filePath: string): Promise<void> {
    const fullPath = this.resolvePath(filePath);
    const stats = await fs.promises.stat(fullPath);
    if (stats.isDirectory()) {
      await fs.promises.rmdir(fullPath, { recursive: true });
    } else {
      await fs.promises.unlink(fullPath);
    }
  }

  async copy(src: string, dest: string): Promise<void> {
    const srcPath = this.resolvePath(src);
    const destPath = this.resolvePath(dest);
    await fs.promises.mkdir(path.dirname(destPath), { recursive: true });
    await fs.promises.copyFile(srcPath, destPath);
  }

  async rename(src: string, dest: string): Promise<void> {
    const srcPath = this.resolvePath(src);
    const destPath = this.resolvePath(dest);
    await fs.promises.mkdir(path.dirname(destPath), { recursive: true });
    await fs.promises.rename(srcPath, destPath);
  }
}

/**
 * Console implementation of Obsidian's Vault
 */
export class ConsoleVault implements MockVault {
  public adapter: ConsoleDataAdapter;
  public configDir: string;

  constructor(vaultPath: string, configDir?: string) {
    this.adapter = new ConsoleDataAdapter(vaultPath);
    this.configDir = configDir || path.join(vaultPath, '.obsidian');
  }

  getMarkdownFiles(): MockTFile[] {
    return this.getAllMarkdownFilesSync();
  }

  private getAllMarkdownFilesSync(): MockTFile[] {
    const files: MockTFile[] = [];
    const vaultPath = (this.adapter as any).basePath;

    const walkSync = (dir: string): void => {
      try {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
          const fullPath = path.join(dir, entry.name);
          if (entry.isDirectory()) {
            walkSync(fullPath);
          } else if (entry.isFile() && entry.name.endsWith('.md')) {
            const relativePath = path.relative(vaultPath, fullPath);
            files.push(this.createMockTFile(relativePath));
          }
        }
      } catch (error) {
        // Skip directories we can't read
      }
    };

    walkSync(vaultPath);
    return files;
  }

  private createMockTFile(filePath: string): MockTFile {
    const name = path.basename(filePath);
    const basename = path.basename(filePath, '.md');
    const extension = 'md';

    return {
      path: filePath,
      basename,
      extension,
      name
    };
  }

  async cachedRead(file: MockTFile): Promise<string> {
    return this.adapter.read(file.path);
  }
}

/**
 * Console implementation of Obsidian's MetadataCache
 */
export class ConsoleMetadataCache implements MockMetadataCache {
  private cache = new Map<string, MockCachedMetadata>();
  private vault: ConsoleVault;

  constructor(vault: ConsoleVault) {
    this.vault = vault;
  }

  getFileCache(file: MockTFile): MockCachedMetadata | null {
    if (this.cache.has(file.path)) {
      return this.cache.get(file.path)!;
    }

    // Parse file synchronously for metadata
    try {
      const content = fs.readFileSync(
        path.resolve((this.vault.adapter as any).basePath, file.path),
        'utf-8'
      );

      const metadata = this.parseMetadata(content);
      this.cache.set(file.path, metadata);
      return metadata;
    } catch {
      return null;
    }
  }

  private parseMetadata(content: string): MockCachedMetadata {
    const metadata: MockCachedMetadata = {};

    // Parse frontmatter tags
    const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
    if (frontmatterMatch) {
      const frontmatter = frontmatterMatch[1];
      const tagsMatch = frontmatter.match(/^tags:\s*(.+)$/m);
      if (tagsMatch) {
        const tagsStr = tagsMatch[1].trim();
        if (tagsStr.startsWith('[') && tagsStr.endsWith(']')) {
          // Array format: [tag1, tag2]
          try {
            metadata.frontmatter = { tags: JSON.parse(tagsStr) };
          } catch {
            // Fallback to string format
            metadata.frontmatter = { tags: tagsStr };
          }
        } else {
          // String format: tag1, tag2
          metadata.frontmatter = { tags: tagsStr };
        }
      }
    }

    // Parse inline tags
    const inlineTags = content.match(/#[\w\-\/]+/g);
    if (inlineTags) {
      metadata.tags = inlineTags.map(tag => ({ tag }));
    }

    return metadata;
  }

  // Clear cache when files change
  invalidateCache(filePath: string): void {
    this.cache.delete(filePath);
  }

  clearCache(): void {
    this.cache.clear();
  }
}

/**
 * Mock Notice for console (just console.log)
 */
export class ConsoleNotice {
  constructor(message: string, duration?: number) {
    console.log(`📢 ${message}`);
  }
}

// Replace Obsidian Notice with console version
export { ConsoleNotice as Notice };
