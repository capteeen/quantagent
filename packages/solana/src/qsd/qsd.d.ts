/**
 * Ambient declarations for the qsd-market packages. They are NOT linked in
 * this workspace; these shapes exist so the boundary in ./index.ts typechecks.
 * They describe the minimum this package calls and are UNVERIFIED against the
 * real qsd-market source. When qsd-market is linked, delete this file and let
 * the packages' own types take over (the integrator owns that step).
 */

declare module "@qsd/crypto" {
  export interface MerkleIdentity {
    root: string;
  }
  export function buildIdentity(input: {
    name: string;
    ticker: string;
    lore: string;
    logoUrl: string;
    onChainStep?: (chain: number, depth: number) => void;
    onTreeLevelFused?: (level: number) => void;
  }): Promise<MerkleIdentity>;
  export function sign(input: {
    identityRoot: string;
    onSignChainStop?: (chain: number, depth: number) => void;
  }): Promise<{ signature: string }>;
}

declare module "@qsd/quantum" {
  export interface QsdQuantumProof {
    provider: string;
    entropyHex: string;
    attestation: string;
    drawHash: string;
    requestedAt: string;
    receivedAt: string;
    selectedIndex: number;
  }
  export function draw(input: { candidateIds: string[]; context: string }): Promise<QsdQuantumProof>;
}

declare module "@qsd/protocol" {
  export function anchor(input: {
    identityRoot: string;
    signature: string;
    cluster: "devnet" | "mainnet-beta";
  }): Promise<{ anchorTx: string }>;
  export function register(input: { coinCa: string; identityRoot: string; cluster: "devnet" | "mainnet-beta" }): Promise<void>;
}
