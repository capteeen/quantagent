import type { Meta, StoryObj } from "@storybook/react";
import { SHIELD_CLEAR, SHIELD_FLAGGED } from "./fixtures";
import { ShieldReport } from "./ShieldReport";

const meta: Meta<typeof ShieldReport> = { title: "Kit/ShieldReport", component: ShieldReport };
export default meta;
type S = StoryObj<typeof ShieldReport>;

export const NotReported: S = { args: { state: "none" } };
export const Scanning: S = { args: { state: "scanning" } };
export const Failed: S = { args: { state: "failed", error: "pump.fun search 429 rate limited" } };
export const Clear: S = { args: { state: "ready", report: SHIELD_CLEAR, reportedAt: "2026-10-09T12:03:00.000Z" } };
export const ClearPendingLaunch: S = { args: { state: "ready", report: { ...SHIELD_CLEAR, canonicalCa: null } } };
export const Flagged: S = { args: { state: "ready", report: SHIELD_FLAGGED, reportedAt: "2026-10-09T12:03:00.000Z", cluster: "devnet" } };
