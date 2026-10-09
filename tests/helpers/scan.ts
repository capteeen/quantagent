/**
 * Source scanning helpers: every package's src tree, read from disk, so grep-style
 * checks (randomness on selection paths, account creation, base58 leakage) are tests.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";

export const REPO_ROOT = resolve(import.meta.dirname, "..", "..");
export const PACKAGE_DIRS = ["core", "workers", "x", "solana", "ui"] as const;

export interface SourceFile {
  /** Path relative to the repo root, e.g. packages/x/src/oauth/pkce.ts */
  path: string;
  text: string;
}

function walk(dir: string, out: string[]): void {
  let entries: string[] = [];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const name of entries) {
    if (name === "node_modules" || name === "dist" || name === ".storybook" || name === ".next" || name === ".turbo" || name === "test-results") continue;
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (/\.(ts|tsx|js|mjs|cjs)$/.test(name)) out.push(p);
  }
}

/** All source files of every package (src + core/types), test files excluded unless asked. */
export function packageSources(opts: { includeTests?: boolean; includeApps?: boolean } = {}): SourceFile[] {
  const roots: string[] = [];
  for (const d of PACKAGE_DIRS) {
    roots.push(join(REPO_ROOT, "packages", d, "src"));
    if (d === "core") roots.push(join(REPO_ROOT, "packages", d, "types"));
  }
  if (opts.includeApps) roots.push(join(REPO_ROOT, "apps", "web"));
  const files: string[] = [];
  for (const r of roots) walk(r, files);
  return files
    .filter((f) => opts.includeTests || !/\.test\.(ts|tsx)$/.test(f))
    .map((f) => ({ path: relative(REPO_ROOT, f), text: readFileSync(f, "utf8") }));
}

export interface Hit {
  path: string;
  line: number;
  text: string;
}

/** Lines matching `re` across the files, with 1-based line numbers. */
export function grepLines(files: SourceFile[], re: RegExp): Hit[] {
  const hits: Hit[] = [];
  for (const f of files) {
    const lines = f.text.split("\n");
    lines.forEach((text, i) => {
      if (re.test(text)) hits.push({ path: f.path, line: i + 1, text: text.trim() });
    });
  }
  return hits;
}

/** Base58 alphabet, 32–44 chars: anything that could be mistaken for a Solana address. */
export const BASE58_ADDRESS_RE = /[1-9A-HJ-NP-Za-km-z]{32,44}/g;

/** Every address-shaped token in a text, deduped. Tokens embedded in longer base58 runs are not split. */
export function addressLikeTokens(text: string): string[] {
  const out = new Set<string>();
  for (const token of text.split(/[^1-9A-HJ-NP-Za-km-z]+/)) {
    if (token.length >= 32 && token.length <= 44) out.add(token);
  }
  return [...out];
}
