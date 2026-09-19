export interface FileSnapshot {
  path: string;
  exists: boolean;
  content: string;
  truncated: boolean;
  fullContent?: string;
  readError?: string;
  binary?: boolean;
  oversized?: boolean;
}

export interface FileDiff {
  path: string;
  kind: "created" | "modified" | "deleted" | "unchanged" | "unavailable";
  before: FileSnapshot;
  after: FileSnapshot;
  unifiedDiff: string;
  truncated: boolean;
}

export interface DiffBundle {
  files: FileDiff[];
  text: string;
  truncated: boolean;
}
