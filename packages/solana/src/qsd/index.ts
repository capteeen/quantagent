/**
 * QSD protocol boundary.
 *
 * SPEC §7 says: import @qsd/crypto, @qsd/quantum, @qsd/protocol from
 * qsd-market and never reimplement them. qsd-market is out of scope for this
 * build, so this module is a declared boundary only: `loadQsd()` resolves the
 * three packages at runtime and throws NotImplemented when they are absent.
 * The Launcher treats the QSD stage as optional and surfaces the reason.
 */

import { NotImplemented } from "@quantagent/core/types";
import type { QsdLaunchHandlers, QsdLaunchResult } from "@quantagent/core/types/clients";
import type { Identity } from "@quantagent/core/types";
import type { Cluster } from "../cluster";

export const QSD_PACKAGES = ["@qsd/crypto", "@qsd/quantum", "@qsd/protocol"] as const;
export type QsdPackageName = (typeof QSD_PACKAGES)[number];

export interface QsdModules {
  crypto: typeof import("@qsd/crypto");
  quantum: typeof import("@qsd/quantum");
  protocol: typeof import("@qsd/protocol");
}

export const QSD_NOT_LINKED = () =>
  new NotImplemented("QSD protocol", "qsd-market is not linked in this workspace", [
    "link qsd-market into the pnpm workspace so @qsd/crypto, @qsd/quantum and @qsd/protocol resolve",
  ]);

function isModuleNotFound(err: unknown): boolean {
  const e = err as { code?: string; message?: string } | undefined;
  if (!e) return false;
  if (e.code === "ERR_MODULE_NOT_FOUND" || e.code === "MODULE_NOT_FOUND" || e.code === "ERR_PACKAGE_PATH_NOT_EXPORTED") return true;
  const m = e.message ?? "";
  return /cannot find (module|package)|failed to (resolve|load)|not found/i.test(m);
}

/** Dynamically import the three qsd-market packages; NotImplemented when any is missing. */
export async function loadQsd(importer: (name: string) => Promise<unknown> = (n) => import(/* @vite-ignore */ n)): Promise<QsdModules> {
  const loaded: Partial<Record<QsdPackageName, unknown>> = {};
  for (const name of QSD_PACKAGES) {
    try {
      loaded[name] = await importer(name);
    } catch (err) {
      if (isModuleNotFound(err)) throw QSD_NOT_LINKED();
      throw err;
    }
  }
  return {
    crypto: loaded["@qsd/crypto"] as QsdModules["crypto"],
    quantum: loaded["@qsd/quantum"] as QsdModules["quantum"],
    protocol: loaded["@qsd/protocol"] as QsdModules["protocol"],
  };
}

export interface QsdContext {
  cluster: Cluster;
  importer?: (name: string) => Promise<unknown>;
}

/** identity → superposition → draw → sign → anchor, all inside qsd-market. */
export async function qsdLaunch(
  input: { identity: Identity; logoUrl: string },
  handlers: QsdLaunchHandlers,
  ctx: QsdContext,
): Promise<QsdLaunchResult> {
  const qsd = await loadQsd(ctx.importer);
  handlers.onStage("keyGeneration", { name: input.identity.name, ticker: input.identity.ticker });
  const identity = await qsd.crypto.buildIdentity({
    name: input.identity.name,
    ticker: input.identity.ticker,
    lore: input.identity.lore,
    logoUrl: input.logoUrl,
    onChainStep: handlers.onChainStep,
    onTreeLevelFused: handlers.onTreeLevelFused,
  });
  handlers.onStage("merkleTree", { identityRoot: identity.root });
  handlers.onStage("superposition", { identityRoot: identity.root });
  const proof = await qsd.quantum.draw({ candidateIds: [identity.root], context: `qsd:${identity.root}` });
  handlers.onStage("quantumDraw", { drawHash: proof.drawHash, provider: proof.provider });
  const { signature } = await qsd.crypto.sign({ identityRoot: identity.root, onSignChainStop: handlers.onSignChainStop });
  handlers.onStage("signing", { signature });
  const { anchorTx } = await qsd.protocol.anchor({ identityRoot: identity.root, signature, cluster: ctx.cluster });
  handlers.onStage("anchoring", { anchorTx });
  return { identityRoot: identity.root, proof, signature, anchorTx };
}

export async function registerWithQsd(input: { coinCa: string; identityRoot: string }, ctx: QsdContext): Promise<void> {
  const qsd = await loadQsd(ctx.importer);
  await qsd.protocol.register({ coinCa: input.coinCa, identityRoot: input.identityRoot, cluster: ctx.cluster });
}
