"use client";
import { useState, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { WalletContext } from "@/lib/wallet";
import { useUiStore } from "@/lib/uiStore";

export function Providers({ children }: { children: ReactNode }) {
  const [client] = useState(() => new QueryClient({ defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false, staleTime: 2_000 } } }));
  const setWalletError = useUiStore((s) => s.setWalletError);
  return (
    <QueryClientProvider client={client}>
      <WalletContext onError={setWalletError}>{children}</WalletContext>
    </QueryClientProvider>
  );
}
