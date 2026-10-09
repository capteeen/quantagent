/**
 * Policy test: the Recruiter never DMs and never follows. The X client exposes neither,
 * and this folder's source must not even ask for them.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const DIR = __dirname;
const FORBIDDEN: { name: string; re: RegExp }[] = [
  // "follow" as an action (follow, follows, followed, following). The reach metric is read as `followers`.
  { name: "follow", re: /\bfollow(s|ed|ing)?\b/i },
  { name: "direct_message", re: /direct_message/i },
  { name: "dm(", re: /\bdm\s*\(/i },
  { name: "sendDm", re: /send_?dm|dm_?events|createDm/i },
];

describe("recruiter policy", () => {
  const sources = readdirSync(DIR).filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"));

  it("has source files to check", () => {
    expect(sources.length).toBeGreaterThan(0);
  });

  for (const file of sources) {
    it(`${file} never follows or DMs`, () => {
      const text = readFileSync(join(DIR, file), "utf8");
      for (const { name, re } of FORBIDDEN) {
        const m = text.match(re);
        expect(m, `${file} contains "${name}" (${m?.[0]})`).toBeNull();
      }
    });
  }
});
