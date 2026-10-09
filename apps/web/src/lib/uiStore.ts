/** Small cross-component UI state (wallet adapter errors, sound toggle). */
import { create } from "zustand";

interface UiStore {
  walletError: string | null;
  setWalletError(message: string | null): void;
  sound: boolean;
  setSound(on: boolean): void;
}

export const useUiStore = create<UiStore>((set) => ({
  walletError: null,
  setWalletError: (walletError) => set({ walletError }),
  sound: false,
  setSound: (sound) => set({ sound }),
}));
