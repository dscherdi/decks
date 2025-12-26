import * as fs from "fs";
import * as path from "path";

/**
 * File system adapter that provides consistent interface for both console and Obsidian usage
 */
export interface IFileSystemAdapter {
  read(filePath: string): Promise<string>;
  readBinary(filePath: string): Promise<ArrayBuffer>;
  write(filePath: string, content: string): Promise<void>;
  writeBinary(filePath: string, data: ArrayBuffer): Promise<void>;
  exists(filePath: string): Promise<boolean>;
  mkdir(dirPath: string): Promise<void>;
  list(dirPath: string): Promise<{ files: string[]; folders: string[] }>;
  stat(filePath: string): Promise<{ mtime: number; size: number }>;
  remove(filePath: string): Promise<void>;
  copy(src: string, dest: string): Promise<void>;
  move(src: string, dest: string): Promise<void>;
}

/**
 * Node.js file system adapter for console usage
 */
export class NodeFileSystemAdapter implements IFileSystemAdapter {
  private basePath: string;

  constructor(basePath: string) {
    this.basePath = path.resolve(basePath);
  }

  private resolvePath(filePath: string): string {
    return path.resolve(this.basePath, filePath);
  }

  async read(filePath: string): Promise<string> {
    const fullPath = this.resolvePath(filePath);
    return fs.promises.readFile(fullPath, "utf-8");
  }

  async readBinary(filePath: string): Promise<ArrayBuffer> {
    const fullPath = this.resolvePath(filePath);
    const buffer = await fs.promises.readFile(fullPath);
    return buffer.buffer.slice(
      buffer.byteOffset,
      buffer.byteOffset + buffer.byteLength
    );
  }

  async write(filePath: string, content: string): Promise<void> {
    const fullPath = this.resolvePath(filePath);
    await fs.promises.mkdir(path.dirname(fullPath), { recursive: true });
    await fs.promises.writeFile(fullPath, content, "utf-8");
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
    const entries = await fs.promises.readdir(fullPath, {
      withFileTypes: true,
    });

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
      size: stats.size,
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

  async move(src: string, dest: string): Promise<void> {
    const srcPath = this.resolvePath(src);
    const destPath = this.resolvePath(dest);
    await fs.promises.mkdir(path.dirname(destPath), { recursive: true });
    await fs.promises.rename(srcPath, destPath);
  }

  getBasePath(): string {
    return this.basePath;
  }
}

/**
 * Obsidian adapter wrapper for compatibility
 */
export class ObsidianFileSystemAdapter implements IFileSystemAdapter {
  constructor(private adapter: any) {} // eslint-disable-line @typescript-eslint/no-explicit-any

  async read(filePath: string): Promise<string> {
    return this.adapter.read(filePath);
  }

  async readBinary(filePath: string): Promise<ArrayBuffer> {
    return this.adapter.readBinary(filePath);
  }

  async write(filePath: string, content: string): Promise<void> {
    return this.adapter.write(filePath, content);
  }

  async writeBinary(filePath: string, data: ArrayBuffer): Promise<void> {
    return this.adapter.writeBinary(filePath, data);
  }

  async exists(filePath: string): Promise<boolean> {
    return this.adapter.exists(filePath);
  }

  async mkdir(dirPath: string): Promise<void> {
    return this.adapter.mkdir(dirPath);
  }

  async list(dirPath: string): Promise<{ files: string[]; folders: string[] }> {
    const result = await this.adapter.list(dirPath);
    return {
      files: result.files || [],
      folders: result.folders || [],
    };
  }

  async stat(filePath: string): Promise<{ mtime: number; size: number }> {
    const stat = await this.adapter.stat(filePath);
    return {
      mtime: stat.mtime,
      size: stat.size,
    };
  }

  async remove(filePath: string): Promise<void> {
    return this.adapter.remove(filePath);
  }

  async copy(src: string, dest: string): Promise<void> {
    return this.adapter.copy(src, dest);
  }

  async move(src: string, dest: string): Promise<void> {
    return this.adapter.rename(src, dest);
  }
}
