import { describe, expect, it } from "vitest";
import { NotImplemented } from "@quantagent/core/types";
import { parseFrame } from "@/lib/sse";
import { readSession, sessionSetCookie, signSession, verifySession, SESSION_COOKIE } from "@/server/session";
import { listDocs, renderMarkdown } from "@/server/docs";

describe("session cookie", () => {
  const env = { SESSION_SECRET: "s3cret" };
  it("round-trips a signed account id and rejects tampering or a missing secret", () => {
    const v = signSession("42", env);
    expect(verifySession(v, env)).toBe("42");
    expect(verifySession("43." + v.split(".")[1], env)).toBeNull();
    expect(verifySession(v, { SESSION_SECRET: "other" })).toBeNull();
    expect(verifySession(v, {})).toBeNull();
    expect(() => signSession("42", {})).toThrow(NotImplemented);
    expect(() => signSession("42", {})).toThrow(/SESSION_SECRET/);
    expect(verifySession(signSession("7", { X_TOKEN_KEY: "fallback" }), { X_TOKEN_KEY: "fallback" })).toBe("7");
  });
  it("reads the cookie header and sets an HttpOnly cookie", () => {
    const set = sessionSetCookie("42", env);
    expect(set).toMatch(/^qa_session=.+; Path=\/; Max-Age=\d+; HttpOnly; SameSite=Lax$/);
    const value = /qa_session=([^;]+)/.exec(set)![1]!;
    expect(readSession(`other=1; ${SESSION_COOKIE}=${value}`, env)).toBe("42");
    expect(readSession(null, env)).toBeNull();
  });
});

describe("sse frame parsing", () => {
  it("parses id/event/data and multi-line data", () => {
    expect(parseFrame(["id: 7", "event: Worker.done", 'data: {"a":1}'])).toEqual({ id: "7", event: "Worker.done", data: '{"a":1}' });
    expect(parseFrame(["data: a", "data: b"])).toEqual({ data: "a\nb" });
    expect(parseFrame([": ping"])).toBeNull();
    expect(parseFrame(["retry: 2000"])).toEqual({ event: "__retry", data: "2000" });
  });
});

describe("/how docs", () => {
  it("lists the repo docs verbatim as HTML", () => {
    const docs = listDocs();
    expect(docs.map((d) => d.file)).toContain("trading.md");
    const trading = docs.find((d) => d.file === "trading.md")!;
    expect(trading.title).toBe("Trader rules");
    expect(trading.html).toContain("<h1");
    expect(renderMarkdown("# T\n\n- a\n- b")).toContain("<li>a</li>");
  });
});
