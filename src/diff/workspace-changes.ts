import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const MAX_FINGERPRINT_BYTES = 16 * 1024 * 1024;

export type WorkspaceEffectKind = "created" | "modified" | "deleted" | "renamed";

export interface WorkspaceEffect {
  kind: WorkspaceEffectKind;
  path: string;
  originalPath?: string | undefined;
  declared: boolean;
}

interface GitStatusEntry {
  indexStatus: string;
  worktreeStatus: string;
  path: string;
  originalPath?: string | undefined;
}

export interface WorkspaceBaseline {
  kind: "git";
  cwd: string;
  gitRoot: string;
  entries: Map<string, string>;
}

export interface WorkspaceChanges {
  files: string[];
  undeclared: string[];
  effects: WorkspaceEffect[];
}

function normalizePath(path: string): string {
  return path.replace(/\\/g, "/").replace(/^\.\//, "");
}

function isInside(root: string, path: string): boolean {
  const rel = relative(root, path);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

function parsePorcelainV1Z(stdout: string): GitStatusEntry[] {
  const records = stdout.split("\0");
  const entries: GitStatusEntry[] = [];
  for (let i = 0; i < records.length; i++) {
    const record = records[i];
    if (!record || record.length < 3) continue;
    const indexStatus = record[0]!;
    const worktreeStatus = record[1]!;
    const path = normalizePath(record.slice(3));
    if (!path) continue;
    if (indexStatus === "R" || indexStatus === "C") {
      const originalPath = normalizePath(records[++i] ?? "");
      entries.push({ indexStatus, worktreeStatus, path, ...(originalPath ? { originalPath } : {}) });
    } else {
      entries.push({ indexStatus, worktreeStatus, path });
    }
  }
  return entries;
}

async function fingerprint(path: string): Promise<string> {
  try {
    const info = await stat(path);
    if (!info.isFile()) return `non-file:${info.size}:${info.mtimeMs}`;
    if (info.size > MAX_FINGERPRINT_BYTES) return `large:${info.size}:${info.mtimeMs}`;
    const content = await readFile(path);
    return createHash("sha256").update(content).digest("hex");
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && (error as { code?: unknown }).code === "ENOENT") return "missing";
    return `error:${error instanceof Error ? error.message : String(error)}`;
  }
}

async function gitState(cwd: string): Promise<{ gitRoot: string; status: GitStatusEntry[]; entries: Map<string, string> } | undefined> {
  try {
    const { stdout: rootOut } = await execFileAsync("git", ["rev-parse", "--show-toplevel"], { cwd });
    const gitRoot = rootOut.trim();
    if (!gitRoot || !isInside(gitRoot, cwd)) return undefined;
    const { stdout } = await execFileAsync("git", ["status", "--porcelain=v1", "-z", "--untracked-files=all"], {
      cwd: gitRoot,
      maxBuffer: 4 * 1024 * 1024,
    });
    const workspacePrefix = normalizePath(relative(gitRoot, cwd));
    const status = parsePorcelainV1Z(stdout).filter((entry) => {
      const current = resolve(gitRoot, entry.path);
      const original = entry.originalPath ? resolve(gitRoot, entry.originalPath) : undefined;
      return isInside(cwd, current) || Boolean(original && isInside(cwd, original));
    }).map((entry) => ({
      ...entry,
      path: normalizePath(relative(cwd, resolve(gitRoot, entry.path))),
      ...(entry.originalPath ? { originalPath: normalizePath(relative(cwd, resolve(gitRoot, entry.originalPath))) } : {}),
    }));
    void workspacePrefix;
    const paths = new Set<string>();
    for (const entry of status) {
      paths.add(entry.path);
      if (entry.originalPath) paths.add(entry.originalPath);
    }
    const entries = new Map<string, string>();
    await Promise.all([...paths].map(async (path) => entries.set(path, await fingerprint(resolve(cwd, path)))));
    return { gitRoot, status, entries };
  } catch {
    return undefined;
  }
}

function declaredMatcher(declaredFiles: readonly string[]): (path: string) => boolean {
  const declared = declaredFiles.map(normalizePath);
  return (path) => {
    const normalized = normalizePath(path);
    return declared.some((item) => normalized === item || normalized.startsWith(item.replace(/\/$/, "") + "/"));
  };
}

function effectKind(entry: GitStatusEntry, before: string | undefined, after: string | undefined): WorkspaceEffectKind {
  if (entry.originalPath || entry.indexStatus === "R") return "renamed";
  if (before === undefined || before === "missing") return "created";
  if (after === undefined || after === "missing" || entry.indexStatus === "D" || entry.worktreeStatus === "D") return "deleted";
  return "modified";
}

export class WorkspaceChangeDetector {
  async capture(cwd: string): Promise<WorkspaceBaseline | undefined> {
    const state = await gitState(cwd);
    return state ? { kind: "git", cwd, gitRoot: state.gitRoot, entries: state.entries } : undefined;
  }

  async detect(baseline: WorkspaceBaseline | undefined, declaredFiles: readonly string[]): Promise<WorkspaceChanges | undefined> {
    if (!baseline) return undefined;
    const current = await gitState(baseline.cwd);
    if (!current || current.gitRoot !== baseline.gitRoot) return undefined;
    const isDeclared = declaredMatcher(declaredFiles);
    const currentByPath = new Map(current.status.map((entry) => [entry.path, entry]));
    const paths = new Set([...baseline.entries.keys(), ...current.entries.keys()]);
    const effects: WorkspaceEffect[] = [];
    for (const path of [...paths].sort()) {
      const before = baseline.entries.get(path);
      const after = current.entries.get(path);
      if (before === after) continue;
      const entry = currentByPath.get(path) ?? { indexStatus: "D", worktreeStatus: " ", path };
      const declared = isDeclared(path) || Boolean(entry.originalPath && isDeclared(entry.originalPath));
      effects.push({
        kind: effectKind(entry, before, after),
        path,
        ...(entry.originalPath ? { originalPath: entry.originalPath } : {}),
        declared,
      });
    }
    const files = [...new Set(effects.map((effect) => effect.path))].sort();
    const undeclared = [...new Set(effects.filter((effect) => !effect.declared).map((effect) => effect.path))].sort();
    return { files, undeclared, effects };
  }
}
