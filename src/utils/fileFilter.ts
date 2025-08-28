import { TFile } from "obsidian";

export class FileFilter {
  private folderSearchPath?: string;

  constructor(folderSearchPath?: string) {
    this.folderSearchPath = folderSearchPath;
  }

  updateFolderSearchPath(folderSearchPath?: string): void {
    this.folderSearchPath = folderSearchPath;
  }

  filterFiles(files: TFile[]): TFile[] {
    if (!this.folderSearchPath || this.folderSearchPath.trim() === "") {
      return files;
    }

    const searchPath = this.folderSearchPath.trim();
    return files.filter(
      (file) =>
        file.path.startsWith(searchPath + "/") || file.path === searchPath
    );
  }

  shouldIncludeFile(file: TFile): boolean {
    if (!this.folderSearchPath || this.folderSearchPath.trim() === "") {
      return true;
    }

    const searchPath = this.folderSearchPath.trim();
    return file.path.startsWith(searchPath + "/") || file.path === searchPath;
  }
}
