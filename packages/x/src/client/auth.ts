/**
 * Supplies a valid OAuth 2.0 user access token for one connected account,
 * refreshing through the TokenStore when it is about to expire or X says 401.
 */
import { XAccountNotConnected } from "../errors";
import type { FetchLike, OAuthConfig } from "../oauth/oauth";
import { refreshTokens, tokensToStored } from "../oauth/oauth";
import type { StoredTokens, TokenStore } from "../oauth/tokenStore";

export interface AccessTokenProvider {
  readonly accountId: string;
  /** Current access token, refreshed first if it expires within the skew. */
  token(): Promise<string>;
  /** Forces a refresh (after a 401). */
  refresh(): Promise<string>;
  /** @handle if known. */
  handle(): Promise<string | undefined>;
}

export interface StoreTokenProviderOptions {
  accountId: string;
  store: TokenStore;
  oauth: OAuthConfig;
  fetch?: FetchLike;
  now?: () => number;
  /** Refresh when fewer than this many ms remain. Default 60s. */
  skewMs?: number;
}

export class StoreTokenProvider implements AccessTokenProvider {
  readonly accountId: string;
  private readonly fetchImpl: FetchLike;
  private readonly now: () => number;
  private readonly skew: number;
  private inflight: Promise<StoredTokens> | null = null;

  constructor(private readonly opts: StoreTokenProviderOptions) {
    this.accountId = opts.accountId;
    this.fetchImpl = opts.fetch ?? fetch;
    this.now = opts.now ?? Date.now;
    this.skew = opts.skewMs ?? 60_000;
  }

  private async current(): Promise<StoredTokens> {
    const t = await this.opts.store.get(this.accountId);
    if (!t) throw new XAccountNotConnected(this.accountId);
    return t;
  }

  async token(): Promise<string> {
    const t = await this.current();
    const expiresAt = Date.parse(t.expiresAt);
    if (Number.isFinite(expiresAt) && expiresAt - this.now() < this.skew && t.refreshToken) {
      return (await this.doRefresh(t)).accessToken;
    }
    return t.accessToken;
  }

  async refresh(): Promise<string> {
    const t = await this.current();
    if (!t.refreshToken) throw new XAccountNotConnected(this.accountId);
    return (await this.doRefresh(t)).accessToken;
  }

  async handle(): Promise<string | undefined> {
    const t = await this.opts.store.get(this.accountId);
    return t?.handle;
  }

  private doRefresh(t: StoredTokens): Promise<StoredTokens> {
    // Coalesce concurrent refreshes: X rotates refresh tokens, so two parallel
    // refreshes would invalidate each other.
    if (!this.inflight) {
      this.inflight = (async () => {
        try {
          const tr = await refreshTokens(this.opts.oauth, { refreshToken: t.refreshToken as string }, this.fetchImpl);
          const who: { id: string; username?: string } = { id: this.accountId };
          if (t.handle !== undefined) who.username = t.handle;
          const stored = tokensToStored(tr, who, this.now);
          if (stored.refreshToken === undefined) stored.refreshToken = t.refreshToken as string;
          await this.opts.store.put(stored);
          return stored;
        } finally {
          this.inflight = null;
        }
      })();
    }
    return this.inflight;
  }
}

/** For tests or callers that already hold a token: no store, no refresh. */
export class StaticTokenProvider implements AccessTokenProvider {
  constructor(
    readonly accountId: string,
    private readonly accessToken: string,
    private readonly username?: string,
  ) {}
  async token(): Promise<string> {
    return this.accessToken;
  }
  async refresh(): Promise<string> {
    throw new XAccountNotConnected(this.accountId);
  }
  async handle(): Promise<string | undefined> {
    return this.username;
  }
}
