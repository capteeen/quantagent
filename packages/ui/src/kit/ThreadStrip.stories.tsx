import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react";
import type { WorkerName } from "@quantagent/core/types";
import { workersAll, workersMix } from "./fixtures";
import { ThreadStrip } from "./ThreadStrip";

const meta: Meta<typeof ThreadStrip> = { title: "Kit/ThreadStrip", component: ThreadStrip };
export default meta;
type S = StoryObj<typeof ThreadStrip>;

export const BeforeLaunch: S = { args: {} };
export const AllPending: S = { args: { workers: workersAll("pending"), onSelect: () => {} } };
export const AllRunning: S = { args: { workers: workersAll("running"), onSelect: () => {} } };
export const AllCandidates: S = { args: { workers: workersAll("candidates"), onSelect: () => {} } };
export const AllAwaitingApproval: S = { args: { workers: workersAll("awaitingApproval"), onSelect: () => {} } };
export const AllDone: S = { args: { workers: workersAll("done"), onSelect: () => {} } };
export const AllFailed: S = { args: { workers: workersAll("failed"), onSelect: () => {} } };
export const MidLaunchMix: S = { args: { workers: workersMix(), onSelect: () => {} } };

export const Selectable: S = {
  render: () => {
    const [selected, setSelected] = useState<WorkerName | null>("Artist");
    return <ThreadStrip workers={workersMix()} selected={selected} onSelect={(w) => setSelected(w === selected ? null : w)} />;
  },
};
