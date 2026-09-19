import { lstat, realpath } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";

export interface ResolvedTarget {
  requestedPath: string;
  absolutePath: string;
  canonicalPath: string;
  withinWorkspace: boolean;
  exists: boolean;
  symlink: boolean;
}

export async function resolveMutationTarget(cwd: string, requestedPath: string): Promise<ResolvedTarget> {
  const workspace = await realpath(cwd).catch(() => resolve(cwd));
  const absolutePath = isAbsolute(requestedPath) ? resolve(requestedPath) : resolve(cwd, requestedPath);
  let exists = true;
  let symlink = false;
  try { symlink = (await lstat(absolutePath)).isSymbolicLink(); } catch { exists = false; }
  const canonicalPath = exists ? await realpath(absolutePath).catch(() => absolutePath) : await canonicalizeMissing(absolutePath);
  const rel = relative(workspace, canonicalPath);
  const withinWorkspace = rel === "" || (!rel.startsWith(".."+sep) && rel !== ".." && !isAbsolute(rel));
  return { requestedPath, absolutePath, canonicalPath, withinWorkspace, exists, symlink };
}

async function canonicalizeMissing(path: string): Promise<string> {
  let cursor = path;
  const tail: string[] = [];
  while (true) {
    try {
      const parent = await realpath(cursor);
      return resolve(parent, ...tail.reverse());
    } catch {
      const next = dirname(cursor);
      if (next === cursor) return path;
      tail.push(cursor.slice(next.length).replace(/^[/\\]+/, ""));
      cursor = next;
    }
  }
}
