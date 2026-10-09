import type { Meta, StoryObj } from "@storybook/react";
import { EVENTS } from "./fixtures";
import { LogRow } from "./LogRow";

const meta: Meta<typeof LogRow> = { title: "Kit/LogRow", component: LogRow };
export default meta;
type S = StoryObj<typeof LogRow>;

const find = (type: string) => EVENTS.find((e) => e.type === type)!;

export const LaunchStarted: S = { args: { event: find("Launch.started") } };
export const WorkerProgress: S = { args: { event: find("Worker.progress") } };
export const Candidates: S = { args: { event: find("Worker.candidates") } };
export const Collapsed: S = { args: { event: find("Orchestrator.collapsed") } };
export const DeployedWithLinks: S = { args: { event: find("Launcher.deployed"), cluster: "devnet" } };
export const Posted: S = { args: { event: find("Voice.posted") } };
export const Published: S = { args: { event: find("Builder.published") } };
export const Failed: S = { args: { event: find("Worker.failed") } };
export const TradeRejected: S = { args: { event: find("Trader.rejected") } };

export const FullLog: S = {
  render: () => (
    <div>
      {EVENTS.map((e) => (
        <LogRow key={e.id} event={e} />
      ))}
    </div>
  ),
};
