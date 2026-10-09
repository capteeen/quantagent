import type { Meta, StoryObj } from "@storybook/react";
import { EmptyState } from "./EmptyState";

const meta: Meta<typeof EmptyState> = { title: "Kit/EmptyState", component: EmptyState };
export default meta;
type S = StoryObj<typeof EmptyState>;

export const Empty: S = { args: { title: "No launches yet." } };
export const WithDetail: S = { args: { title: "No approvals pending.", detail: "Workers ask here before money or reputation moves." } };
export const WithAction: S = { args: { title: "No events.", detail: "The stream is connected; nothing has happened.", action: { label: "Refresh", onClick: () => {} } } };
export const Failed: S = { args: { failed: true, title: "Event stream disconnected.", detail: "SSE closed with 502; reconnecting.", action: { label: "Reconnect now", onClick: () => {} } } };
