import { open, stat } from "node:fs/promises";
import type { FileSnapshot } from "./types.js";

const DEFAULT_MAX_CAPTURE_BYTES = 8 * 1024 * 1024;
const BINARY_PROBE_BYTES = 8192;

export class SnapshotManager {
  readonly #maxChars: number;
  readonly #maxCaptureBytes: number;

  constructor(maxChars: number, maxCaptureBytes = DEFAULT_MAX_CAPTURE_BYTES) {
    this.#maxChars = maxChars;
    this.#maxCaptureBytes = maxCaptureBytes;
  }

  async capture(path: string): Promise<FileSnapshot> {
    try {
      const info = await stat(path);
      if (!info.isFile()) return { path, exists: true, content: "", truncated: false, readError: "target is not a regular file" };
      if (info.size > this.#maxCaptureBytes) {
        return { path, exists: true, content: "", truncated: true, oversized: true, readError: `file exceeds snapshot limit (${info.size} > ${this.#maxCaptureBytes} bytes)` };
      }
      const handle = await open(path, "r");
      try {
        const probe = Buffer.alloc(Math.min(BINARY_PROBE_BYTES, Math.max(1, info.size)));
        const { bytesRead } = await handle.read(probe, 0, probe.length, 0);
        if (probe.subarray(0, bytesRead).includes(0)) {
          return { path, exists: true, content: "", truncated: false, binary: true, readError: "binary file content is not reviewed" };
        }
        const raw = await handle.readFile({ encoding: "utf8" });
        const normalized = normalizeEol(raw);
        const truncated = normalized.length > this.#maxChars;
        return { path, exists: true, content: truncated ? normalized.slice(0, this.#maxChars) : normalized, truncated, ...(truncated ? { fullContent: normalized } : {}) };
      } finally { await handle.close(); }
    } catch (error) {
      if (isEnoent(error)) return { path, exists: false, content: "", truncated: false };
      return { path, exists: false, content: "", truncated: false, readError: error instanceof Error ? error.message : String(error) };
    }
  }

  async captureMany(paths: readonly string[]): Promise<Map<string, FileSnapshot>> {
    const entries = await Promise.all(paths.map(async (path) => [path, await this.capture(path)] as const));
    return new Map(entries);
  }
}

function normalizeEol(value: string): string { return value.replace(/\r\n/g, "\n").replace(/\r/g, "\n"); }
function isEnoent(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && (error as { code?: unknown }).code === "ENOENT";
}
