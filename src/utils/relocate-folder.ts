import type { DataAdapter } from "obsidian";

type FolderAdapter = Pick<DataAdapter, "exists" | "list" | "rename" | "remove" | "rmdir" | "mkdir">;

/**
 * Move a folder from where an earlier version kept it. A file already at the destination is
 * kept and the old copy dropped; the old folder goes once it is empty. Returns how many files moved.
 */
export async function relocateFolder(adapter: FolderAdapter, from: string, to: string): Promise<number> {
  if (from === to || !(await adapter.exists(from))) return 0;
  if (!(await adapter.exists(to))) {
    const parent = to.includes("/") ? to.slice(0, to.lastIndexOf("/")) : "";
    if (parent && !(await adapter.exists(parent))) await adapter.mkdir(parent);
    const count = (await adapter.list(from)).files.length;
    await adapter.rename(from, to);
    return count;
  }
  const listing = await adapter.list(from);
  let moved = 0;
  for (const file of listing.files) {
    const target = `${to}/${file.slice(from.length + 1)}`;
    if (await adapter.exists(target)) {
      await adapter.remove(file);
    } else {
      await adapter.rename(file, target);
      moved++;
    }
  }
  for (const folder of listing.folders) {
    moved += await relocateFolder(adapter, folder, `${to}/${folder.slice(from.length + 1)}`);
  }
  await adapter.rmdir(from, false);
  return moved;
}
