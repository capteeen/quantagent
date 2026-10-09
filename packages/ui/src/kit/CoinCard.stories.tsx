import type { Meta, StoryObj } from "@storybook/react";
import { CoinCard } from "./CoinCard";
import { LAUNCH_FAILED, LAUNCH_LIVE, LAUNCH_PENDING, SHIELD_CLEAR, SHIELD_FLAGGED, X_POST_ID } from "./fixtures";

const meta: Meta<typeof CoinCard> = { title: "Kit/CoinCard", component: CoinCard };
export default meta;
type S = StoryObj<typeof CoinCard>;

export const PendingLaunch: S = { args: { launch: LAUNCH_PENDING } };
export const PendingLaunchNamed: S = { args: { launch: LAUNCH_PENDING, name: "Qubit Frog", ticker: "QFROG", logo: { status: "loading" } } };

export const Live: S = {
  args: {
    launch: LAUNCH_LIVE,
    name: "Qubit Frog",
    ticker: "QFROG",
    // A real logo only exists after the Artist generates one; the story shows the slot with a failed fetch rather than a placeholder image.
    logo: { status: "failed", error: "no logo in this story: the Artist has not run" },
    xThread: { status: "ready", value: { url: `https://x.com/i/web/status/${X_POST_ID}`, postId: X_POST_ID } },
    walletBalance: { status: "ready", value: 0.4321 },
    shield: { status: "ready", value: SHIELD_CLEAR },
    onOpenShield: () => {},
  },
};

export const LiveLoading: S = {
  args: {
    launch: LAUNCH_LIVE,
    name: "Qubit Frog",
    ticker: "QFROG",
    logo: { status: "loading" },
    xThread: { status: "loading" },
    walletBalance: { status: "loading" },
    shield: { status: "loading" },
  },
};

export const LivePartialFailures: S = {
  args: {
    launch: LAUNCH_LIVE,
    name: "Qubit Frog",
    ticker: "QFROG",
    logo: { status: "failed", error: "image provider returned 503 after 3 retries" },
    xThread: { status: "failed", error: "X: 403 duplicate content" },
    walletBalance: { status: "failed", error: "rpc timeout" },
    shield: { status: "failed", error: "helius webhook down" },
  },
};

export const LiveShieldFlagged: S = {
  args: {
    launch: LAUNCH_LIVE,
    name: "Qubit Frog",
    ticker: "QFROG",
    walletBalance: { status: "ready", value: 0.1 },
    shield: { status: "ready", value: SHIELD_FLAGGED },
    onOpenShield: () => {},
  },
};

export const LaunchFailed: S = { args: { launch: LAUNCH_FAILED, name: "Qubit Frog", ticker: "QFROG" } };
