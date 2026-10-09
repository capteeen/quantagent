/**
 * Per-launch agent wallet. The keypair is generated server-side, stored
 * encrypted (AES-256-GCM, AGENT_WALLET_KEY) and never leaves this module
 * unencrypted. `signAndSend` is the ONLY signing path, and it enforces the
 * SOL budget before every signature: a transaction whose estimated cost
 * would push spend over budget throws BudgetExceeded and is never signed.
 */

import { Keypair, LAMPORTS_PER_SOL, PublicKey, type VersionedTransaction } from "@solana/web3.js";
import { BudgetExceeded, type WorkerName } from "@quantagent/core/types";
import type { Cluster, Rpc } from "../cluster";
import { envOf, type Env } from "../env";
import { decryptSecretKey, encryptSecretKey, loadWalletKey } from "./crypto";
import type { AgentWalletRecord, KeyStore } from "./keystore";

export function solToLamports(sol: number): bigint {
  if (!Number.isFinite(sol) || sol < 0) throw new Error(`invalid SOL amount ${sol}`);
  return BigInt(Math.round(sol * LAMPORTS_PER_SOL));
}

export function lamportsToSol(lamports: bigint): number {
  return Number(lamports) / LAMPORTS_PER_SOL;
}

export interface OpenAgentWalletInput {
  launchId: string;
  cluster: Cluster;
  /** Total SOL this wallet may spend across its life. Used only when creating. */
  budgetSol: number;
  keyStore: KeyStore;
  env?: Env;
}

export interface SignAndSendInput {
  tx: VersionedTransaction;
  /** Worker charged for this spend (BudgetExceeded names it). */
  worker: WorkerName;
  /** Conservative estimate of SOL leaving the wallet (amount + fees). */
  estimatedCostSol: number;
  rpc: Rpc;
  /** Extra signers besides the agent wallet (e.g. the mint keypair on create). */
  extraSigners?: Keypair[];
  skipPreflight?: boolean;
}

export class AgentWallet {
  private constructor(
    readonly launchId: string,
    readonly cluster: Cluster,
    private readonly keypair: Keypair,
    private readonly keyStore: KeyStore,
    private budget: bigint,
    private spent: bigint,
  ) {}

  /** Creates the wallet for the launch, or loads it when it already exists. */
  static async open(input: OpenAgentWalletInput): Promise<AgentWallet> {
    const env = envOf(input.env);
    const key = loadWalletKey(env);
    const existing = await input.keyStore.get(input.launchId);
    if (existing) {
      if (existing.cluster !== input.cluster) {
        throw new Error(
          `wallet for launch ${input.launchId} was created on ${existing.cluster}, refusing to use it on ${input.cluster}`,
        );
      }
      const secret = decryptSecretKey(existing.encryptedSecretKey, key, existing.launchId);
      const kp = Keypair.fromSecretKey(secret);
      if (kp.publicKey.toBase58() !== existing.publicKey) throw new Error("stored wallet public key mismatch");
      return new AgentWallet(existing.launchId, existing.cluster, kp, input.keyStore, existing.budgetLamports, existing.spentLamports);
    }
    const kp = Keypair.generate();
    const record: AgentWalletRecord = {
      launchId: input.launchId,
      publicKey: kp.publicKey.toBase58(),
      encryptedSecretKey: encryptSecretKey(kp.secretKey, key, input.launchId),
      cluster: input.cluster,
      budgetLamports: solToLamports(input.budgetSol),
      spentLamports: 0n,
      createdAt: new Date().toISOString(),
    };
    await input.keyStore.put(record);
    return new AgentWallet(record.launchId, record.cluster, kp, input.keyStore, record.budgetLamports, 0n);
  }

  get publicKey(): PublicKey {
    return this.keypair.publicKey;
  }

  get address(): string {
    return this.keypair.publicKey.toBase58();
  }

  get budgetSol(): number {
    return lamportsToSol(this.budget);
  }

  get spentSol(): number {
    return lamportsToSol(this.spent);
  }

  get remainingSol(): number {
    return lamportsToSol(this.budget - this.spent);
  }

  /** Reserve budget; throws BudgetExceeded without touching the store's balance. */
  async reserve(worker: WorkerName, sol: number): Promise<bigint> {
    const lamports = solToLamports(sol);
    const res = await this.keyStore.addSpent(this.launchId, lamports);
    this.budget = res.budgetLamports;
    if (!res.ok) {
      throw new BudgetExceeded(worker, "sol", lamportsToSol(res.budgetLamports), lamportsToSol(res.spentLamports + lamports));
    }
    this.spent = res.spentLamports;
    return lamports;
  }

  private async adjust(deltaLamports: bigint): Promise<void> {
    const res = await this.keyStore.addSpent(this.launchId, deltaLamports);
    this.budget = res.budgetLamports;
    if (res.ok) this.spent = res.spentLamports;
  }

  /**
   * Budget check → sign → send → confirm. After confirmation the reservation
   * is reconciled against the real balance change so `spentSol` reflects what
   * actually left the wallet (never below the amount reserved for a confirmed
   * buy, never charging for SOL that came back on a sell).
   */
  async signAndSend(input: SignAndSendInput): Promise<string> {
    const reserved = await this.reserve(input.worker, input.estimatedCostSol);
    let before: number | null = null;
    try {
      before = await input.rpc.getBalance(this.keypair.publicKey, "confirmed");
    } catch {
      before = null;
    }
    try {
      input.tx.sign([...(input.extraSigners ?? []), this.keypair]);
      const raw = input.tx.serialize();
      const latest = await input.rpc.getLatestBlockhash("confirmed");
      const signature = await input.rpc.sendRawTransaction(raw, {
        skipPreflight: input.skipPreflight ?? false,
        preflightCommitment: "confirmed",
        maxRetries: 3,
      });
      const conf = await input.rpc.confirmTransaction(
        {
          signature,
          blockhash: input.tx.message.recentBlockhash,
          lastValidBlockHeight: latest.lastValidBlockHeight,
        },
        "confirmed",
      );
      if (conf.value.err) {
        throw new Error(`transaction ${signature} failed on-chain: ${JSON.stringify(conf.value.err)}`);
      }
      if (before !== null) {
        try {
          const after = await input.rpc.getBalance(this.keypair.publicKey, "confirmed");
          const actual = BigInt(Math.max(0, before - after));
          await this.adjust(actual - reserved);
        } catch {
          /* keep the conservative reservation */
        }
      }
      return signature;
    } catch (err) {
      await this.adjust(-reserved);
      throw err;
    }
  }

  async balanceSol(rpc: Rpc): Promise<number> {
    const lamports = await rpc.getBalance(this.keypair.publicKey, "confirmed");
    return lamports / LAMPORTS_PER_SOL;
  }
}
