import type { ClientHealth, LaunchMeta as Meta, PostLaunchStatus } from "@/server/types";

const LABEL: Record<keyof ClientHealth, string> = {
  llm: "LLM",
  image: "images",
  x: "X account",
  solana: "Solana",
  hosting: "hosting",
  quantum: "quantum draw",
};

/** Which clients this launch ran with. An unavailable one shows the exact NotImplemented text and env vars. */
export function ClientsPanel({ clients }: { clients: ClientHealth }) {
  const entries = (Object.keys(LABEL) as (keyof ClientHealth)[]).map((k) => [k, clients[k]] as const);
  const missing = entries.filter(([, h]) => !h.ok);
  return (
    <div data-testid="clients-panel" className="rounded-xl border border-border bg-panel px-3 py-2 text-xs">
      <div className="flex flex-wrap gap-x-3 gap-y-1">
        {entries.map(([k, h]) => (
          <span key={k} className={h.ok ? "text-text" : "text-worker-shield"} title={h.ok ? h.detail : h.message}>
            <span aria-hidden className={`mr-1 inline-block h-2 w-2 rounded-full ${h.ok ? "bg-worker-trader" : "bg-worker-shield"}`} />
            {LABEL[k]}
          </span>
        ))}
      </div>
      {missing.length ? (
        <ul className="mt-2 flex flex-col gap-1 border-t border-border pt-2">
          {missing.map(([k, h]) => (
            <li key={k} className="text-worker-shield">
              <span className="text-muted">{LABEL[k]}: </span>
              {h.ok ? null : h.message}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

export function PostLaunchLine({ postLaunch }: { postLaunch: PostLaunchStatus }) {
  const text =
    postLaunch.status === "running"
      ? `post-launch runtime running (${postLaunch.queueName})`
      : postLaunch.status === "starting"
        ? "post-launch runtime starting"
        : postLaunch.status === "pending"
          ? `post-launch runtime: ${postLaunch.detail}`
          : postLaunch.status === "not-started"
            ? `post-launch runtime not started: ${postLaunch.detail}`
            : postLaunch.status === "stopped"
              ? "post-launch runtime stopped"
              : `post-launch runtime ${postLaunch.status}: ${postLaunch.error}${"needs" in postLaunch && postLaunch.needs.length ? ` (needs: ${postLaunch.needs.join(", ")})` : ""}`;
  const bad = postLaunch.status === "unavailable" || postLaunch.status === "failed";
  return (
    <div data-testid="post-launch" className={`text-xs ${bad ? "text-worker-shield" : "text-muted"}`}>
      {text}
    </div>
  );
}

export function MetaPanel({ meta }: { meta: Meta | null }) {
  if (!meta) return null;
  return (
    <div className="flex flex-col gap-2">
      <ClientsPanel clients={meta.clients} />
      <PostLaunchLine postLaunch={meta.postLaunch} />
    </div>
  );
}
