/**
 * One OrchestratorService per Node process, kept on globalThis so Next's dev
 * server (which re-evaluates modules on edit) does not lose running launches.
 */
import { createBusFromEnv } from "@quantagent/core";
import { createSolanaClient } from "@quantagent/solana";
import { createWorkers } from "@quantagent/workers";
import { buildSharedClients } from "./clients";
import { OrchestratorService } from "./service";

const KEY = "__quantagent_service__";

type Holder = { [KEY]?: Promise<OrchestratorService> };

async function build(): Promise<OrchestratorService> {
  const env = process.env;
  const [bus, shared] = await Promise.all([createBusFromEnv(env), buildSharedClients(env)]);
  return new OrchestratorService({
    env,
    bus,
    shared,
    createWorkers: () => createWorkers(),
    createSolana: ({ launchId, cluster, budgetSol }) =>
      createSolanaClient({ launchId, cluster, budgetSol, keyStore: shared.wallets.keyStore, hub: shared.hub, env: env as Record<string, string | undefined> }),
  });
}

export function getService(): Promise<OrchestratorService> {
  const g = globalThis as unknown as Holder;
  if (!g[KEY]) g[KEY] = build();
  return g[KEY];
}
