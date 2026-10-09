"use client";
/**
 * Wallet connection: Solana Mobile Wallet Adapter first; wallets that implement
 * the Wallet Standard register themselves with the provider as a fallback.
 * The owner wallet only identifies the owner here; the agent wallet is server-side.
 */
import { useMemo, type ReactNode } from "react";
import { WalletProvider, useWallet } from "@solana/wallet-adapter-react";
import { WalletReadyState, type Adapter, type WalletError, type WalletName } from "@solana/wallet-adapter-base";
import {
  SolanaMobileWalletAdapter,
  createDefaultAddressSelector,
  createDefaultAuthorizationResultCache,
  createDefaultWalletNotFoundHandler,
} from "@solana-mobile/wallet-adapter-mobile";

export const PUBLIC_CLUSTER = (process.env["NEXT_PUBLIC_SOLANA_CLUSTER"] === "devnet" ? "devnet" : "mainnet-beta") as "devnet" | "mainnet-beta";

type MobileConfig = ConstructorParameters<typeof SolanaMobileWalletAdapter>[0];

export function buildMobileAdapter(origin: string): Adapter {
  const chain = (PUBLIC_CLUSTER === "mainnet-beta" ? "solana:mainnet" : "solana:devnet") as MobileConfig extends { chain: infer C } ? C : never;
  const config = {
    addressSelector: createDefaultAddressSelector(),
    appIdentity: { name: "quantagent", uri: origin, icon: "/icon.svg" },
    authorizationResultCache: createDefaultAuthorizationResultCache(),
    chain,
    onWalletNotFound: createDefaultWalletNotFoundHandler(),
  } as MobileConfig;
  return new SolanaMobileWalletAdapter(config);
}

export function WalletContext({ children, onError }: { children: ReactNode; onError?: (message: string) => void }) {
  const wallets = useMemo<Adapter[]>(() => {
    if (typeof window === "undefined") return [];
    try {
      return [buildMobileAdapter(window.location.origin)];
    } catch (err) {
      onError?.(`mobile wallet adapter unavailable: ${err instanceof Error ? err.message : String(err)}`);
      return [];
    }
  }, [onError]);
  return (
    <WalletProvider wallets={wallets} autoConnect onError={(e: WalletError) => onError?.(e.message || e.name)}>
      {children}
    </WalletProvider>
  );
}

export interface WalletChoice {
  name: WalletName;
  ready: boolean;
}

/** Wallets the user can tap: the mobile adapter plus installed/loadable Wallet Standard wallets. */
export function useWalletChoices(): WalletChoice[] {
  const { wallets } = useWallet();
  return wallets
    .filter((w) => w.readyState === WalletReadyState.Installed || w.readyState === WalletReadyState.Loadable)
    .map((w) => ({ name: w.adapter.name, ready: true }));
}
