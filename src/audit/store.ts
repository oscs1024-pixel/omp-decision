import { appendFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import type { AuditEntry } from "./types.js";
export interface AuditStore {
  append(entry: AuditEntry): void;
  get(id: string): AuditEntry | undefined;
  recent(limit?: number): AuditEntry[];
  clear(): void;
}

export class InMemoryAuditStore implements AuditStore {
  readonly #entries: AuditEntry[] = [];
  readonly #byId = new Map<string, AuditEntry>();
  readonly #maxEntries: number;

  constructor(maxEntries = 1000) {
    this.#maxEntries = maxEntries;
  }

  append(entry: AuditEntry): void {
    this.#entries.push(entry);
    this.#byId.set(entry.id, entry);
    while (this.#entries.length > this.#maxEntries) {
      const removed = this.#entries.shift();
      if (removed) this.#byId.delete(removed.id);
    }
  }

  get(id: string): AuditEntry | undefined {
    return this.#byId.get(id);
  }

  recent(limit = 20): AuditEntry[] {
    return this.#entries.slice(-Math.max(0, limit)).reverse();
  }

  clear(): void {
    this.#entries.length = 0;
    this.#byId.clear();
  }
}

export class FileAuditStore implements AuditStore {
  readonly #memory: InMemoryAuditStore;
  #filePath: string;
  #dirCreated = false;
  #writing: Promise<void> = Promise.resolve();

  constructor(filePath: string, maxInMemory = 1000) {
    this.#filePath = filePath;
    this.#memory = new InMemoryAuditStore(maxInMemory);
  }

  setFilePath(newPath: string): void {
    if (this.#filePath !== newPath) {
      this.#filePath = newPath;
      this.#dirCreated = false;
    }
  }

  append(entry: AuditEntry): void {
    this.#memory.append(entry);
    this.#writing = this.#writing.then(() => this.#persist(entry)).catch(() => {});
  }

  async flush(): Promise<void> {
    await this.#writing;
  }
  async #persist(entry: AuditEntry): Promise<void> {
    if (!this.#dirCreated) {
      await mkdir(dirname(this.#filePath), { recursive: true });
      this.#dirCreated = true;
    }
    const line = JSON.stringify(entry) + "\n";
    await appendFile(this.#filePath, line, "utf8");
  }

  get(id: string): AuditEntry | undefined {
    return this.#memory.get(id);
  }

  recent(limit?: number): AuditEntry[] {
    return this.#memory.recent(limit);
  }

  clear(): void {
    this.#memory.clear();
  }
}
