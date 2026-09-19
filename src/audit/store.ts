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
