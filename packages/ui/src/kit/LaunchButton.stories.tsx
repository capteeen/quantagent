import type { Meta, StoryObj } from "@storybook/react";
import { LaunchButton } from "./LaunchButton";

const meta: Meta<typeof LaunchButton> = { title: "Kit/LaunchButton", component: LaunchButton };
export default meta;
type S = StoryObj<typeof LaunchButton>;

export const Idle: S = { args: { state: "idle", onLaunch: () => {} } };
export const DisabledWithReason: S = { args: { state: "disabled", reason: "Connect X and a wallet first." } };
export const DisabledNoPrompt: S = { args: { state: "disabled", reason: "Type one line, or tap surprise me." } };
export const DisabledNoBudget: S = { args: { state: "disabled", reason: "Agent wallet needs 0.35 SOL; it has 0.02." } };
export const Launching: S = { args: { state: "launching" } };
