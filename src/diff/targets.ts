import { isAbsolute, resolve } from "node:path";

function asPath(value: unknown, cwd: string): string | undefined {
  if (typeof value !== "string" || value.length === 0) return undefined;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) return undefined;
  const clean = value.replace(/:[0-9]+(?:-[0-9]+)?$|:[a-z]+$|#[a-f0-9]+$/i, "").trim();
  if (!clean) return undefined;
  return isAbsolute(clean) ? clean : resolve(cwd, clean);
}

export function extractMutationTargets(toolName: string, input: Record<string, unknown>, cwd: string): string[] {
  if (toolName === "write") {
    const path = asPath(input.path, cwd);
    return path ? [path] : [];
  }
  if (toolName !== "edit") return [];

  const found = new Set<string>();

  if (typeof input.input === "string") {
    const sectionRegex = /^\[([^\s#\]]+)(?:#[a-zA-Z0-9]+)?\]/gm;
    let m: RegExpExecArray | null;
    while ((m = sectionRegex.exec(input.input)) !== null) {
      const path = asPath(m[1]!, cwd);
      if (path) found.add(path);
    }
    const mvRegex = /^\s*MV\s+([^\s\n\r]+)/gm;
    while ((m = mvRegex.exec(input.input)) !== null) {
      const path = asPath(m[1]!, cwd);
      if (path) found.add(path);
    }
  }
  const visit = (value: unknown, depth: number): void => {
    if (depth > 5) return;
    if (Array.isArray(value)) {
      for (const item of value) visit(item, depth + 1);
      return;
    }
    if (!value || typeof value !== "object") return;
    const record = value as Record<string, unknown>;
    for (const key of ["path", "file", "filePath", "filename"]) {
      const path = asPath(record[key], cwd);
      if (path) found.add(path);
    }
    for (const key of ["edits", "files", "patches", "operations", "changes"]) {
      if (record[key] !== undefined) visit(record[key], depth + 1);
    }
  };
  visit(input, 0);
  return [...found];
}
