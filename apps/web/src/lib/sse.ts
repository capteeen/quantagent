/**
 * A text/event-stream reader over fetch. The browser's EventSource cannot
 * receive frames with arbitrary `event:` names without a listener per name,
 * and the bus names every frame after its event type, so this parses the
 * stream itself and resumes with Last-Event-ID on reconnect.
 */
export interface SseMessage {
  id?: string;
  event?: string;
  data: string;
}

export type SseState = "connecting" | "open" | "reconnecting" | "closed";

export interface SseOptions {
  lastEventId?: string | undefined;
  onMessage: (m: SseMessage) => void;
  onState?: (s: SseState, error?: string) => void;
  fetch?: typeof fetch;
  /** Initial reconnect delay; the server's `retry:` overrides it. */
  retryMs?: number;
  maxRetryMs?: number;
}

/** Parses one complete frame (lines without the trailing blank line). */
export function parseFrame(lines: string[]): SseMessage | null {
  let id: string | undefined;
  let event: string | undefined;
  const data: string[] = [];
  let retry: number | undefined;
  for (const raw of lines) {
    if (!raw || raw.startsWith(":")) continue;
    const i = raw.indexOf(":");
    const field = i < 0 ? raw : raw.slice(0, i);
    let value = i < 0 ? "" : raw.slice(i + 1);
    if (value.startsWith(" ")) value = value.slice(1);
    if (field === "id") id = value;
    else if (field === "event") event = value;
    else if (field === "data") data.push(value);
    else if (field === "retry" && /^\d+$/.test(value)) retry = Number(value);
  }
  if (data.length === 0 && id === undefined && event === undefined) {
    return retry !== undefined ? { event: "__retry", data: String(retry) } : null;
  }
  const m: SseMessage = { data: data.join("\n") };
  if (id !== undefined) m.id = id;
  if (event !== undefined) m.event = event;
  return m;
}

/** Connects and keeps reconnecting until the returned function is called. */
export function connectSse(url: string, opts: SseOptions): () => void {
  const fetchImpl = opts.fetch ?? fetch;
  const controller = new AbortController();
  let lastEventId = opts.lastEventId;
  let retryMs = opts.retryMs ?? 1000;
  const maxRetry = opts.maxRetryMs ?? 10_000;
  let stopped = false;

  const setState = (s: SseState, err?: string) => {
    if (!stopped) opts.onState?.(s, err);
  };

  const run = async () => {
    let attempt = 0;
    while (!stopped) {
      setState(attempt === 0 ? "connecting" : "reconnecting");
      let failure: string | undefined;
      try {
        const headers: Record<string, string> = { accept: "text/event-stream" };
        if (lastEventId !== undefined) headers["last-event-id"] = lastEventId;
        const res = await fetchImpl(url, { headers, signal: controller.signal, cache: "no-store", credentials: "same-origin" });
        if (!res.ok || !res.body) {
          const text = await res.text().catch(() => "");
          failure = `HTTP ${res.status}${text ? ` ${text.slice(0, 200)}` : ""}`;
          if (res.status === 404 || res.status === 400) {
            setState("closed", failure);
            return;
          }
        } else {
          setState("open");
          attempt = 0;
          const reader = res.body.getReader();
          const decoder = new TextDecoder();
          let buffer = "";
          let frame: string[] = [];
          for (;;) {
            const { value, done } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            let nl = buffer.indexOf("\n");
            while (nl >= 0) {
              let line = buffer.slice(0, nl);
              if (line.endsWith("\r")) line = line.slice(0, -1);
              buffer = buffer.slice(nl + 1);
              if (line === "") {
                const m = parseFrame(frame);
                frame = [];
                if (m) {
                  if (m.event === "__retry") retryMs = Math.min(maxRetry, Number(m.data));
                  else {
                    if (m.id !== undefined) lastEventId = m.id;
                    opts.onMessage(m);
                  }
                }
              } else frame.push(line);
              nl = buffer.indexOf("\n");
            }
          }
          failure = "stream ended";
        }
      } catch (err) {
        if (stopped || controller.signal.aborted) return;
        failure = err instanceof Error ? err.message : String(err);
      }
      if (stopped) return;
      attempt += 1;
      const wait = Math.min(maxRetry, retryMs * Math.min(8, 2 ** Math.max(0, attempt - 1)));
      setState("reconnecting", failure);
      await new Promise<void>((r) => setTimeout(r, wait));
    }
  };

  void run();
  return () => {
    stopped = true;
    controller.abort();
    opts.onState?.("closed");
  };
}
