import { readFile, stat } from "node:fs/promises";
import type { FileSnapshot } from "./types.js";

export class SnapshotManager {
  readonly #maxChars: number;

  constructor(maxChars: number) {
    this.#maxChars = maxChars;
  }

  async capture(path: string): Promise<FileSnapshot> {
    try {
      const info = await stat(path);
      if (!info.isFile()) {
        return { path, exists: true, content: "", truncated: false, readError: "target is not a regular file" };
      }
      const raw = await readFile(path, "utf8");
      const normalized = normalizeEol(raw);
      const truncated = normalized.length > this.#maxChars;
      return {
        path,
        exists: true,
        content: truncated ? normalized.slice(0, this.#maxChars) : normalized,
        truncated,
        ...(truncated ? { fullContent: normalized } : {}),
      };
    } catch (error) {
      if (isEnoent(error)) return { path, exists: false, content: "", truncated: false };
      return {
        path,
        exists: false,
        content: "",
        truncated: false,
        readError: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async captureMany(paths: readonly string[]): Promise<Map<string, FileSnapshot>> {
    const entries = await Promise.all(paths.map(async (path) => [path, await this.capture(path)] as const));
    return new Map(entries);
  }
}

function normalizeEol(value: string): string {
  return value.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

function isEnoent(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && (error as { code?: unknown }).code === "ENOENT";
}
