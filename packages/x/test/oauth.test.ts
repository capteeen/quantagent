import { describe, expect, it } from "vitest";
import { NotImplemented } from "@quantagent/core/types";
import { createTokenCipher } from "../src/oauth/crypto";
import {
  XOAuth,
  X_SCOPES,
  buildAuthorizeUrl,
  exchangeCode,
  oauthConfigFromEnv,
  refreshTokens,
  startAuthorization,
} from "../src/oauth/oauth";
import { challengeFor, createPkce, isValidVerifier } from "../src/oauth/pkce";
import { MemoryTokenStore } from "../src/oauth/tokenStore";
import { FakeClock, TEST_KEY, mockFetch } from "./helpers";

const config = { clientId: "client-abc", redirectUri: "https://quantagent.fun/x/callback" };

describe("PKCE", () => {
  it("creates an S256 pair with a valid verifier and matching challenge", () => {
    const p = createPkce();
    expect(p.method).toBe("S256");
    expect(isValidVerifier(p.verifier)).toBe(true);
    expect(p.challenge).toBe(challengeFor(p.verifier));
    // base64url, no padding
    expect(p.challenge).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it("matches the RFC 7636 appendix B vector", () => {
    expect(challengeFor("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk")).toBe(
      "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
    );
  });

  it("builds an authorize URL carrying every required scope", () => {
    const url = new URL(buildAuthorizeUrl(config, { state: "st", challenge: "ch" }));
    expect(url.origin + url.pathname).toBe("https://x.com/i/oauth2/authorize");
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("client_id")).toBe("client-abc");
    expect(url.searchParams.get("redirect_uri")).toBe(config.redirectUri);
    expect(url.searchParams.get("code_challenge")).toBe("ch");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("state")).toBe("st");
    const scopes = url.searchParams.get("scope")?.split(" ") ?? [];
    for (const s of ["tweet.read", "tweet.write", "users.read", "offline.access", "media.write"]) {
      expect(scopes).toContain(s);
    }
    expect([...X_SCOPES]).toEqual(scopes);
  });

  it("startAuthorization never leaks the verifier into the URL", () => {
    const req = startAuthorization(config);
    expect(req.url).not.toContain(req.verifier);
    expect(req.url).toContain(encodeURIComponent(req.state));
  });
});

describe("token exchange", () => {
  it("posts grant_type=authorization_code with the verifier and client_id (public client)", async () => {
    const f = mockFetch(() => ({
      json: { token_type: "bearer", access_token: "AT", refresh_token: "RT", expires_in: 7200, scope: "tweet.read tweet.write" },
    }));
    const verifier = createPkce().verifier;
    const tr = await exchangeCode(config, { code: "the-code", verifier }, f);
    expect(tr).toEqual({ accessToken: "AT", refreshToken: "RT", expiresIn: 7200, scopes: ["tweet.read", "tweet.write"], tokenType: "bearer" });
    const call = f.calls[0]!;
    expect(call.url.toString()).toBe("https://api.x.com/2/oauth2/token");
    const body = call.body as URLSearchParams;
    expect(body.get("grant_type")).toBe("authorization_code");
    expect(body.get("code")).toBe("the-code");
    expect(body.get("code_verifier")).toBe(verifier);
    expect(body.get("client_id")).toBe("client-abc");
    expect(body.get("redirect_uri")).toBe(config.redirectUri);
    expect(call.headers["authorization"]).toBeUndefined();
  });

  it("adds HTTP Basic auth for confidential clients", async () => {
    const f = mockFetch(() => ({ json: { access_token: "AT", expires_in: 10 } }));
    await exchangeCode({ ...config, clientSecret: "shh" }, { code: "c", verifier: createPkce().verifier }, f);
    expect(f.calls[0]!.headers["authorization"]).toBe("Basic " + Buffer.from("client-abc:shh").toString("base64"));
  });

  it("refresh posts grant_type=refresh_token", async () => {
    const f = mockFetch(() => ({ json: { access_token: "AT2", refresh_token: "RT2", expires_in: 7200 } }));
    const tr = await refreshTokens(config, { refreshToken: "RT1" }, f);
    expect(tr.accessToken).toBe("AT2");
    const body = f.calls[0]!.body as URLSearchParams;
    expect(body.get("grant_type")).toBe("refresh_token");
    expect(body.get("refresh_token")).toBe("RT1");
  });

  it("rejects a malformed verifier before touching the network", async () => {
    const f = mockFetch(() => ({ json: {} }));
    await expect(exchangeCode(config, { code: "c", verifier: "short" }, f)).rejects.toThrow(/verifier/);
    expect(f.calls.length).toBe(0);
  });

  it("surfaces token endpoint errors as XApiError", async () => {
    const f = mockFetch(() => ({ status: 400, json: { error: "invalid_request", error_description: "bad code" } }));
    await expect(exchangeCode(config, { code: "c", verifier: createPkce().verifier }, f)).rejects.toMatchObject({ name: "XApiError", status: 400 });
  });
});

describe("XOAuth connector", () => {
  it("start → complete stores encrypted tokens for the account that consented", async () => {
    const clock = new FakeClock();
    const f = mockFetch((call) => {
      if (call.url.pathname === "/2/oauth2/token") {
        return { json: { access_token: "plaintext-access-token-must-not-leak", refresh_token: "plaintext-refresh-token-must-not-leak", expires_in: 7200, scope: X_SCOPES.join(" ") } };
      }
      if (call.url.pathname === "/2/users/me") {
        expect(call.headers["authorization"]).toBe("Bearer plaintext-access-token-must-not-leak");
        return { json: { data: { id: "42", username: "projectx", name: "Project X", public_metrics: { followers_count: 9 } } } };
      }
      return { status: 404 };
    });
    const store = new MemoryTokenStore(createTokenCipher(TEST_KEY));
    const oauth = new XOAuth({ config, store, fetch: f, now: clock.now });
    const { url, state } = oauth.start();
    expect(url).toContain("code_challenge=");
    expect(oauth.pendingCount()).toBe(1);

    const stored = await oauth.complete({ code: "code-1", state });
    expect(stored.accountId).toBe("42");
    expect(stored.handle).toBe("projectx");
    expect(stored.refreshToken).toBe("plaintext-refresh-token-must-not-leak");
    expect(stored.expiresAt).toBe(new Date(clock.t + 7200 * 1000).toISOString());
    expect(oauth.pendingCount()).toBe(0);
    // The exchange used the verifier that matches the challenge in the URL.
    const body = f.calls[0]!.body as URLSearchParams;
    expect(challengeFor(body.get("code_verifier")!)).toBe(new URL(url).searchParams.get("code_challenge"));
    // At rest: ciphertext only.
    expect(JSON.stringify(store.rawRows())).not.toContain("plaintext-access-token-must-not-leak");
    expect(JSON.stringify(store.rawRows())).not.toContain("plaintext-refresh-token-must-not-leak");
    expect(await store.get("42")).toMatchObject({ accessToken: "plaintext-access-token-must-not-leak" });
  });

  it("rejects an unknown state and expires stale ones", async () => {
    const clock = new FakeClock();
    const store = new MemoryTokenStore(createTokenCipher(TEST_KEY));
    const oauth = new XOAuth({ config, store, fetch: mockFetch(() => ({ json: {} })), now: clock.now, pendingTtlMs: 1000 });
    await expect(oauth.complete({ code: "c", state: "nope" })).rejects.toThrow(/unknown or expired state/);
    const { state } = oauth.start();
    clock.advance(2000);
    await expect(oauth.complete({ code: "c", state })).rejects.toThrow(/unknown or expired state/);
  });

  it("refresh rotates tokens and keeps the old refresh token if X omits a new one", async () => {
    const clock = new FakeClock();
    const f = mockFetch(() => ({ json: { access_token: "AT2", expires_in: 100 } }));
    const store = new MemoryTokenStore(createTokenCipher(TEST_KEY));
    await store.put({ accountId: "42", handle: "p", accessToken: "AT1", refreshToken: "RT1", expiresAt: "x", scopes: [], updatedAt: "x" });
    const oauth = new XOAuth({ config, store, fetch: f, now: clock.now });
    const t = await oauth.refresh("42");
    expect(t.accessToken).toBe("AT2");
    expect(t.refreshToken).toBe("RT1");
    expect(t.handle).toBe("p");
  });
});

describe("oauthConfigFromEnv", () => {
  it("throws NotImplemented naming the missing variables", () => {
    try {
      oauthConfigFromEnv({});
      throw new Error("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(NotImplemented);
      expect((e as NotImplemented).needs).toEqual(["X_CLIENT_ID", "X_REDIRECT_URI"]);
    }
  });
  it("reads the three variables", () => {
    const c = oauthConfigFromEnv({ X_CLIENT_ID: "a", X_CLIENT_SECRET: "b", X_REDIRECT_URI: "https://r" });
    expect(c).toMatchObject({ clientId: "a", clientSecret: "b", redirectUri: "https://r" });
  });
});
