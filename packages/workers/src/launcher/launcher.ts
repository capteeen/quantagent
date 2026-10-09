/**
 * B4 LAUNCHER
 * Waits for Ideator.named and Artist.logoReady (either order). The wait also ends when
 * the producer of a missing input dies (Worker.failed of the Ideator before the name,
 * of the Artist before the logo, or Launch.failed): the Launcher then fails with that
 * reason instead of hanging the launch. Then:
 *   1. QSD sequence via ctx.clients.solana.qsdLaunch — OUT OF SCOPE by the user's
 *      decision: when the client throws NotImplemented the stage is skipped with
 *      Worker.progress { step: "qsd-skipped" } and the launch continues on pump.fun
 *      without the cryptographic sequence (identityRoot ""). Any other error fails
 *      the worker. When it does run, every stage is emitted (Launcher.qsdStage,
 *      chainStep, treeLevelFused, signChainStop) so the chamber renders it.
 *   2. deployPumpFun with the dev buy (options.devBuySol; default 0.1).
 *   3. Launcher.deployed { coinCa, txSignature, identityRoot } and Launcher.devBuy.
 */

import { NotImplemented } from "@quantagent/core/types";
import type { Identity, ImageAsset, QuantagentEvent, QuantumProof } from "@quantagent/core/types";
import type { QsdLaunchHandlers, QsdLaunchResult } from "@quantagent/core/types/clients";
import type { StartResult, Worker, WorkerContext } from "../context";
import { errorText, isBase58Address, requireClient } from "../shared";

export const QSD_SKIPPED_REASON = "QSD protocol not linked; launching on pump.fun without the cryptographic sequence";
export const DEFAULT_DEV_BUY_SOL = 0.1;

export interface LauncherOutputs extends Record<string, unknown> {
  coinCa: string;
  txSignature: string;
  devBuySignature: string;
  devBuySol: number;
  identityRoot: string;
  qsd: "ran" | "skipped";
  proof: QuantumProof | null;
  anchorTx: string | null;
  qsdSignature: string | null;
}

export class LauncherWorker implements Worker {
  readonly name = "Launcher" as const;
  private identity: Identity | undefined;
  private logo: ImageAsset | undefined;
  private siteUrl: string | undefined;
  private xUrl: string | undefined;
  private stopped = false;
  private wake: (() => void) | undefined;
  /** Set when a missing input can never arrive (its producer failed). */
  private inputFailure: string | undefined;

  async start(ctx: WorkerContext): Promise<StartResult> {
    const solana = requireClient(ctx, "solana", "Launcher.deploy");
    ctx.progress("await.inputs", "waiting for Ideator.named and Artist.logoReady before touching the chain");
    await this.waitForInputs(ctx);
    if (this.stopped) return;
    const identity = this.identity as Identity;
    const logo = this.logo as ImageAsset;
    ctx.progress("inputs.ready", `identity ${identity.name} ($${identity.ticker}) and logo ${logo.url} are in; preparing the launch`, {
      identity,
      logoUrl: logo.url,
    });

    // 1. QSD cryptographic sequence (skippable when the protocol is not linked).
    let qsd: QsdLaunchResult | null = null;
    const handlers: QsdLaunchHandlers = {
      onStage: (stage, detail) => ctx.emit({ type: "Launcher.qsdStage", reason: `QSD stage ${stage}`, payload: { stage, detail } }),
      onChainStep: (chain, depth) =>
        ctx.emit({ type: "Launcher.chainStep", reason: `hash chain ${chain} advanced to depth ${depth}`, payload: { chain, depth } }),
      onTreeLevelFused: (level) => ctx.emit({ type: "Launcher.treeLevelFused", reason: `merkle level ${level} fused`, payload: { level } }),
      onSignChainStop: (chain, depth) =>
        ctx.emit({ type: "Launcher.signChainStop", reason: `signature chain ${chain} stopped at depth ${depth}`, payload: { chain, depth } }),
    };
    ctx.progress("qsd", "running the QSD sequence: identity key → merkle tree → superposition → quantum draw → signing → anchoring");
    try {
      qsd = await solana.qsdLaunch({ identity, logoUrl: logo.url }, handlers);
      ctx.progress("qsd.done", `QSD anchored identity root ${qsd.identityRoot} in tx ${qsd.anchorTx}`, {
        identityRoot: qsd.identityRoot,
        anchorTx: qsd.anchorTx,
        signature: qsd.signature,
        proof: qsd.proof,
      });
    } catch (err) {
      if (err instanceof NotImplemented) {
        ctx.progress("qsd-skipped", QSD_SKIPPED_REASON, { reason: QSD_SKIPPED_REASON, because: err.message, needs: err.needs });
      } else {
        throw err;
      }
    }
    if (this.stopped) return;

    // 2. pump.fun deploy with the dev buy (not gated: it is the launch itself).
    const devBuySol = ctx.options.devBuySol ?? DEFAULT_DEV_BUY_SOL;
    const siteUrl = this.siteUrl ?? "";
    ctx.progress("deploy", `deploying ${identity.name} ($${identity.ticker}) on pump.fun (${solana.cluster}) with a ${devBuySol} SOL dev buy`, {
      cluster: solana.cluster,
      devBuySol,
      siteUrl,
      ...(this.xUrl ? { xUrl: this.xUrl } : {}),
    });
    const deployed = await solana.deployPumpFun({
      identity,
      logoUrl: logo.url,
      siteUrl,
      ...(this.xUrl ? { xUrl: this.xUrl } : {}),
      devBuySol,
    });
    if (!isBase58Address(deployed.coinCa)) {
      throw new Error(`pump.fun deploy returned a malformed mint address "${deployed.coinCa}"; refusing to announce it`);
    }

    // 3. Announce. The CA on this event is the only CA anyone may show.
    const identityRoot = qsd?.identityRoot ?? "";
    ctx.emit({
      type: "Launcher.deployed",
      reason: `${identity.name} ($${identity.ticker}) is live on pump.fun at ${deployed.coinCa} (tx ${deployed.txSignature})${qsd ? "" : "; QSD skipped"}`,
      payload: { coinCa: deployed.coinCa, txSignature: deployed.txSignature, identityRoot },
    });
    ctx.emit({
      type: "Launcher.devBuy",
      reason: `dev buy of ${devBuySol} SOL confirmed in tx ${deployed.devBuySignature}`,
      payload: { txSignature: deployed.devBuySignature, sol: devBuySol },
    });

    if (qsd) {
      try {
        await solana.registerWithQsd({ coinCa: deployed.coinCa, identityRoot });
        ctx.progress("qsd.registered", `registered ${deployed.coinCa} against identity root ${identityRoot}`);
      } catch (err) {
        ctx.progress("qsd.register.failed", `QSD registration failed after deploy: ${errorText(err)}`, { error: errorText(err) });
      }
    }

    const outputs: LauncherOutputs = {
      coinCa: deployed.coinCa,
      txSignature: deployed.txSignature,
      devBuySignature: deployed.devBuySignature,
      devBuySol,
      identityRoot,
      qsd: qsd ? "ran" : "skipped",
      proof: qsd?.proof ?? null,
      anchorTx: qsd?.anchorTx ?? null,
      qsdSignature: qsd?.signature ?? null,
    };
    return outputs;
  }

  on(event: QuantagentEvent): void {
    switch (event.type) {
      case "Ideator.named":
        this.identity = event.payload.identity;
        this.wake?.();
        return;
      case "Artist.logoReady":
        this.logo = event.payload.asset;
        this.wake?.();
        return;
      case "Builder.published":
        this.siteUrl = event.payload.url;
        return;
      case "Voice.posted":
        if (event.payload.kind === "thread" && !this.xUrl) this.xUrl = event.payload.url;
        return;
      case "Worker.failed":
        if (event.worker === "Ideator" && !this.identity) this.inputGone(`Ideator failed before naming the coin: ${event.payload.reason}`);
        else if (event.worker === "Artist" && !this.logo) this.inputGone(`Artist failed before a logo was ready: ${event.payload.reason}`);
        return;
      case "Launch.failed":
        if (!this.identity || !this.logo) this.inputGone(`launch failed before the inputs were ready: ${event.payload.reason}`);
        return;
      default:
        return;
    }
  }

  /** A missing input will never arrive: end the wait with the reason. */
  private inputGone(reason: string): void {
    if (this.inputFailure) return;
    this.inputFailure = reason;
    this.wake?.();
  }

  async stop(): Promise<void> {
    this.stopped = true;
    this.wake?.();
  }

  private waitForInputs(ctx: WorkerContext): Promise<void> {
    return new Promise((resolve, reject) => {
      const check = () => {
        if (this.stopped || (this.identity && this.logo)) {
          ctx.signal.removeEventListener("abort", onAbort);
          this.wake = undefined;
          resolve();
          return true;
        }
        if (this.inputFailure) {
          ctx.signal.removeEventListener("abort", onAbort);
          this.wake = undefined;
          reject(new Error(this.inputFailure));
          return true;
        }
        return false;
      };
      const onAbort = () => {
        this.wake = undefined;
        reject(ctx.signal.reason instanceof Error ? ctx.signal.reason : new Error("Launcher aborted while waiting for inputs"));
      };
      if (check()) return;
      ctx.signal.addEventListener("abort", onAbort, { once: true });
      this.wake = () => void check();
    });
  }
}

export function createLauncher(): LauncherWorker {
  return new LauncherWorker();
}
