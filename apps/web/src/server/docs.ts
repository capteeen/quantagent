/**
 * /how renders /docs/*.md verbatim. The directory is found by walking up from the
 * process cwd to the workspace root (pnpm-workspace.yaml), so it works from
 * apps/web and from the repo root. Read at request time; an empty dir is empty.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { marked } from "marked";
import type { DocEntry } from "./types";

export function findRepoRoot(from: string = process.cwd()): string | null {
  let dir = path.resolve(from);
  for (let i = 0; i < 8; i++) {
    if (existsSync(path.join(dir, "pnpm-workspace.yaml"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

export function docsDir(from?: string): string | null {
  const root = findRepoRoot(from);
  if (!root) return null;
  const dir = path.join(root, "docs");
  return existsSync(dir) && statSync(dir).isDirectory() ? dir : null;
}

function titleOf(markdown: string, fallback: string): string {
  const m = /^#\s+(.+?)\s*$/m.exec(markdown);
  return m?.[1] ?? fallback;
}

export function renderMarkdown(markdown: string): string {
  return marked.parse(markdown, { async: false, gfm: true }) as string;
}

/** Every .md file in /docs, sorted by name. Returns [] when the dir is missing or empty. */
export function listDocs(from?: string): DocEntry[] {
  const dir = docsDir(from);
  if (!dir) return [];
  return readdirSync(dir)
    .filter((f) => f.toLowerCase().endsWith(".md"))
    .sort()
    .map((file) => {
      const markdown = readFileSync(path.join(dir, file), "utf8");
      const slug = file.replace(/\.md$/i, "");
      return { slug, file, title: titleOf(markdown, slug), html: renderMarkdown(markdown) };
    });
}
