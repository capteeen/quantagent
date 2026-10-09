import type { Meta, StoryObj } from "@storybook/react";
import { ConnectCard } from "./ConnectCard";
import { OWNER_WALLET } from "./fixtures";

const meta: Meta<typeof ConnectCard> = {
  title: "Kit/ConnectCard",
  component: ConnectCard,
};
export default meta;
type S = StoryObj<typeof ConnectCard>;

export const XDisconnected: S = { args: { kind: "x", state: "disconnected", onConnect: () => {} } };
export const XConnecting: S = { args: { kind: "x", state: "connecting", onCancel: () => {} } };
export const XConnectedChip: S = { args: { kind: "x", state: "connected", id: "yourproject", onDisconnect: () => {} } };
export const XFailed: S = { args: { kind: "x", state: "failed", error: "OAuth callback rejected: invalid_state", onRetry: () => {} } };

export const WalletDisconnected: S = { args: { kind: "wallet", state: "disconnected", onConnect: () => {} } };
export const WalletConnecting: S = { args: { kind: "wallet", state: "connecting" } };
export const WalletConnectedChip: S = { args: { kind: "wallet", state: "connected", id: OWNER_WALLET, onDisconnect: () => {} } };
export const WalletFailed: S = { args: { kind: "wallet", state: "failed", error: "Mobile wallet adapter: user rejected the session", onRetry: () => {} } };

export const BothAsOnScreen: S = {
  render: () => (
    <div className="flex flex-col gap-3">
      <ConnectCard kind="x" state="connected" id="yourproject" onDisconnect={() => {}} />
      <ConnectCard kind="wallet" state="disconnected" onConnect={() => {}} />
    </div>
  ),
};
