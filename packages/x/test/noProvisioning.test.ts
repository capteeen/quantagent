/**
 * SPEC §5: "NO account provisioning anywhere in the codebase. The Voice posts
 * only from accounts the user connected." This test greps the package for any
 * hint of account creation and fails if it finds one.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const FORBIDDEN = ["signup", "sign_up", "sign-up", "register", "createAccount", "create_account", "createUser"];
const ROOT = join(__dirname, "..");

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === "dist") continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|js|mjs|cjs|json|md)$/.test(name)) out.push(p);
  }
  return out;
}

describe("no account provisioning", () => {
  const files = [...walk(join(ROOT, "src")), join(ROOT, "README.md"), join(ROOT, "package.json")];

  it("package source, README and manifest contain no account-creation vocabulary", () => {
    const hits: string[] = [];
    for (const f of files) {
      const text = readFileSync(f, "utf8").toLowerCase();
      for (const word of FORBIDDEN) {
        if (text.includes(word.toLowerCase())) hits.push(`${f}: "${word}"`);
      }
    }
    expect(hits).toEqual([]);
  });

  it("README states that the Voice posts only from accounts the user connected", () => {
    const readme = readFileSync(join(ROOT, "README.md"), "utf8");
    expect(readme).toMatch(/posts only from accounts the user connected/i);
  });

  it("the only X endpoints touched are user-context ones (no account lifecycle endpoints)", () => {
    const src = files.filter((f) => f.endsWith(".ts")).map((f) => readFileSync(f, "utf8")).join("\n");
    expect(src).not.toMatch(/\/i\/flow\//);
    expect(src).not.toMatch(/account\/(create|verify_credentials)/);
  });
});
