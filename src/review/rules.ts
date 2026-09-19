import { readFile } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";

export async function loadReviewerRules(cwd: string, rulesFiles?: readonly string[]): Promise<string | undefined> {
  if (!rulesFiles || rulesFiles.length === 0) return undefined;
  const loaded: string[] = [];
  for (const file of rulesFiles) {
    const fullPath = isAbsolute(file) ? file : resolve(cwd, file);
    try {
      const content = await readFile(fullPath, "utf8");
      if (content.trim()) {
        loaded.push(`# Rules from ${file}\n\n${content.trim()}`);
      }
    } catch {
      // Ignored if missing or unreadable
    }
  }
  return loaded.length > 0 ? loaded.join("\n\n---\n\n") : undefined;
}
