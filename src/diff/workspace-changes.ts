import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface WorkspaceBaseline {
  kind: "git";
  cwd: string;
  changedFiles: Set<string>;
}

export interface WorkspaceChanges {
  files: string[];
  undeclared: string[];
}

async function gitChangedFiles(cwd: string): Promise<Set<string> | undefined> {
  try {
    const { stdout: root } = await execFileAsync("git", ["rev-parse", "--show-toplevel"], { cwd });
    if (root.trim() !== cwd.replace(/[\\/]+$/, "")) return undefined;
    const { stdout } = await execFileAsync("git", ["status", "--porcelain=v1", "-z", "--untracked-files=all"], {
      cwd,
      maxBuffer: 4 * 1024 * 1024,
    });
    const files = new Set<string>();
    for (const record of stdout.split("\0")) {
      if (!record) continue;
      const path = record.slice(3).trim();
      if (path) files.add(path.replace(/\\/g, "/"));
    }
    return files;
  } catch {
    return undefined;
  }
}

export class WorkspaceChangeDetector {
  async capture(cwd: string): Promise<WorkspaceBaseline | undefined> {
    const changedFiles = await gitChangedFiles(cwd);
    return changedFiles ? { kind: "git", cwd, changedFiles } : undefined;
  }

  async detect(baseline: WorkspaceBaseline | undefined, declaredFiles: readonly string[]): Promise<WorkspaceChanges | undefined> {
    if (!baseline) return undefined;
    const current = await gitChangedFiles(baseline.cwd);
    if (!current) return undefined;
    const files = [...current].filter((path) => !baseline.changedFiles.has(path)).sort();
    const declared = new Set(declaredFiles.map((path) => path.replace(/\\/g, "/").replace(/^\.\//, "")));
    return { files, undeclared: files.filter((path) => !declared.has(path)) };
  }
}
