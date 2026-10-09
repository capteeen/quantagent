/**
 * Error types for @quantagent/x. Every failure is a typed, inspectable error.
 * Nothing in this package swallows a failure: calls either resolve with a real
 * X API result or reject with one of these.
 */

export type HeaderMap = Record<string, string>;

/** A non-2xx response from the X API. */
export class XApiError extends Error {
  override readonly name: string = "XApiError";
  constructor(
    public readonly status: number,
    public readonly route: string,
    public readonly body: unknown,
    public readonly headers: HeaderMap = {},
  ) {
    super(`X API ${route} responded ${status}: ${summarize(body)}`);
  }
  get isRateLimited(): boolean {
    return this.status === 429;
  }
  get isServerError(): boolean {
    return this.status >= 500;
  }
  /** 402/403 on v2 almost always means the app's tier does not include this endpoint. */
  get isTierError(): boolean {
    return this.status === 402 || this.status === 403;
  }
  get isAuthError(): boolean {
    return this.status === 401;
  }
}

/** The monthly call budget is exhausted; posting is paused until it resets. */
export class XBudgetPaused extends Error {
  override readonly name = "XBudgetPaused";
  constructor(
    public readonly used: number,
    public readonly limit: number,
    public readonly resetsAt: string,
  ) {
    super(`X monthly call budget exhausted (${used}/${limit}); posting paused until ${resetsAt}`);
  }
}

/** A write failed after all retries and was placed on the dead-letter queue. */
export class XDeadLettered extends Error {
  override readonly name = "XDeadLettered";
  constructor(
    public readonly dlqId: string,
    public readonly op: string,
    public override readonly cause: unknown,
  ) {
    super(`X ${op} failed and was dead-lettered as ${dlqId}: ${errorMessage(cause)}`);
  }
}

/** A thread stopped part-way. `posted` are the real posts that went out before the failure. */
export class XThreadFailed extends Error {
  override readonly name = "XThreadFailed";
  constructor(
    public readonly posted: { id: string; url: string }[],
    public readonly failedIndex: number,
    public override readonly cause: unknown,
    public readonly dlqId?: string,
  ) {
    super(
      `X thread stopped at post ${failedIndex + 1} after ${posted.length} succeeded: ${errorMessage(cause)}` +
        (dlqId ? ` (remaining posts dead-lettered as ${dlqId})` : ""),
    );
  }
}

/** No connected tokens exist for this account id. The user has to connect the account first. */
export class XAccountNotConnected extends Error {
  override readonly name = "XAccountNotConnected";
  constructor(public readonly accountId: string) {
    super(`X account ${accountId} is not connected; the user must authorize it via OAuth 2.0 PKCE first`);
  }
}

export function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

function summarize(body: unknown): string {
  if (body == null) return "(no body)";
  if (typeof body === "string") return body.slice(0, 300);
  if (typeof body === "object") {
    const b = body as Record<string, unknown>;
    const parts: string[] = [];
    if (typeof b["title"] === "string") parts.push(b["title"]);
    if (typeof b["detail"] === "string") parts.push(b["detail"]);
    if (Array.isArray(b["errors"])) {
      for (const e of b["errors"] as unknown[]) {
        if (e && typeof e === "object" && typeof (e as Record<string, unknown>)["message"] === "string") {
          parts.push((e as Record<string, unknown>)["message"] as string);
        }
      }
    }
    if (parts.length) return parts.join(" — ").slice(0, 300);
    try {
      return JSON.stringify(body).slice(0, 300);
    } catch {
      return "(unserializable body)";
    }
  }
  return String(body);
}
