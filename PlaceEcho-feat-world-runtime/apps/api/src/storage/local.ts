import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type { StorageProvider } from "./provider.js";

export class LocalStorageProvider implements StorageProvider {
  readonly rootDirectory: string;

  constructor(rootDirectory: string) {
    this.rootDirectory = path.resolve(rootDirectory);
  }

  async put(key: string, data: Uint8Array): Promise<void> {
    const filePath = this.resolveKey(key);
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, data);
  }

  async get(key: string): Promise<Uint8Array | null> {
    try {
      return await readFile(this.resolveKey(key));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return null;
      }
      throw error;
    }
  }

  async delete(key: string): Promise<void> {
    await rm(this.resolveKey(key), { force: true });
  }

  private resolveKey(key: string): string {
    const resolved = path.resolve(this.rootDirectory, key);
    const relative = path.relative(this.rootDirectory, resolved);

    if (relative.startsWith("..") || path.isAbsolute(relative)) {
      throw new Error("Storage key must remain within the configured root.");
    }

    return resolved;
  }
}
