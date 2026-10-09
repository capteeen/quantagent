"use client";
/**
 * The two connections. Each collapses to a chip once connected (ConnectCard's
 * "connected" state). Failures show the real message; nothing is assumed.
 */
import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useWallet } from "@solana/wallet-adapter-react";
import type { WalletName } from "@solana/wallet-adapter-base";
import { ConnectCard } from "@quantagent/ui/kit";
import { api, errorText } from "@/lib/api";
import { useUiStore } from "@/lib/uiStore";
import { useWalletChoices } from "@/lib/wallet";
import type { MeReport, Unavailable } from "@/server/types";

export function XConnect({ me, meError, xError }: { me: MeReport | undefined; meError: unknown; xError?: string | null | undefined }) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const connect = () => {
    setBusy(true);
    window.location.assign("/api/x/oauth/start");
  };
  const disconnect = async () => {
    try {
      await api.disconnectX();
      await qc.invalidateQueries({ queryKey: ["me"] });
    } catch (err) {
      setLocalError(errorText(err));
    }
  };

  if (me?.account) {
    return <ConnectCard kind="x" state="connected" id={me.account.handle ?? me.account.accountId} onDisconnect={() => void disconnect()} />;
  }
  const failure: string | null = localError ?? xError ?? unavailableText(me?.accountError) ?? (meError ? errorText(meError) : null);
  if (failure) return <ConnectCard kind="x" state="failed" error={failure} onRetry={connect} />;
  if (busy) return <ConnectCard kind="x" state="connecting" />;
  return <ConnectCard kind="x" state="disconnected" onConnect={connect} />;
}

function unavailableText(u: Unavailable | undefined): string | null {
  return u ? u.message : null;
}

export function WalletConnect() {
  const { publicKey, connected, connecting, select, connect, disconnect, wallet } = useWallet();
  const choices = useWalletChoices();
  const walletError = useUiStore((s) => s.walletError);
  const setWalletError = useUiStore((s) => s.setWalletError);
  const [picking, setPicking] = useState(false);
  const [pending, setPending] = useState<WalletName | null>(null);

  useEffect(() => {
    if (!pending || !wallet || wallet.adapter.name !== pending || connected || connecting) return;
    setPending(null);
    connect().catch((err: unknown) => setWalletError(err instanceof Error ? err.message : String(err)));
  }, [pending, wallet, connected, connecting, connect, setWalletError]);

  if (connected && publicKey) {
    return (
      <ConnectCard
        kind="wallet"
        state="connected"
        id={publicKey.toBase58()}
        onDisconnect={() => {
          disconnect().catch((err: unknown) => setWalletError(err instanceof Error ? err.message : String(err)));
        }}
      />
    );
  }
  if (connecting || pending) return <ConnectCard kind="wallet" state="connecting" />;
  if (walletError) {
    return (
      <ConnectCard
        kind="wallet"
        state="failed"
        error={walletError}
        onRetry={() => {
          setWalletError(null);
          setPicking(true);
        }}
      />
    );
  }
  if (picking) {
    if (choices.length === 0) {
      return (
        <ConnectCard
          kind="wallet"
          state="failed"
          error="No Solana wallet is reachable from this browser: open this page in a Mobile Wallet Adapter wallet (Phantom, Solflare, Seed Vault) or install a Wallet Standard browser wallet."
          onRetry={() => setPicking(false)}
        />
      );
    }
    return (
      <div data-testid="wallet-picker" className="flex flex-col gap-2 rounded-xl border border-border bg-panel p-3">
        <div className="text-xs text-muted">Choose a wallet</div>
        {choices.map((c) => (
          <button
            key={c.name}
            type="button"
            onClick={() => {
              setPicking(false);
              setPending(c.name);
              select(c.name);
            }}
            className="inline-flex min-h-hit items-center justify-between rounded-lg border border-border bg-void px-3 text-sm text-text active:bg-border"
          >
            <span>{c.name}</span>
            <span className="text-xs text-muted">tap</span>
          </button>
        ))}
        <button type="button" onClick={() => setPicking(false)} className="inline-flex min-h-hit items-center justify-center rounded-lg text-xs text-muted">
          cancel
        </button>
      </div>
    );
  }
  return <ConnectCard kind="wallet" state="disconnected" onConnect={() => setPicking(true)} />;
}
