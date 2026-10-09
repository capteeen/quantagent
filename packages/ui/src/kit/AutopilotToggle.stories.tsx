import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react";
import type { Autopilot } from "@quantagent/core/types";
import { AutopilotToggle } from "./AutopilotToggle";

const OFF: Autopilot = { posts: false, trades: false, recruiting: false };

const meta: Meta<typeof AutopilotToggle> = { title: "Kit/AutopilotToggle", component: AutopilotToggle };
export default meta;
type S = StoryObj<typeof AutopilotToggle>;

export const AllOff: S = { args: { autopilot: OFF, onChange: () => {} } };
export const PostsOn: S = { args: { autopilot: { ...OFF, posts: true }, onChange: () => {} } };
export const Pending: S = { args: { autopilot: OFF, onChange: () => {}, pending: { trades: true } } };
export const Failed: S = { args: { autopilot: OFF, onChange: () => {}, errors: { trades: "server rejected: launch not live" } } };
export const Disabled: S = { args: { autopilot: OFF, onChange: () => {}, disabled: true } };
export const PostsOnly: S = { args: { autopilot: OFF, onChange: () => {}, classes: ["posts"] } };

/** Tap a switch: enabling asks for a confirming tap, disabling is immediate. */
export const Interactive: S = {
  render: () => {
    const [ap, setAp] = useState<Autopilot>(OFF);
    return <AutopilotToggle autopilot={ap} onChange={(cls, on) => setAp((p) => ({ ...p, [cls]: on }))} />;
  },
};
