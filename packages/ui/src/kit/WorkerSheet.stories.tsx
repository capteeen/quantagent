import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react";
import { EVENTS, WORKER_STATES, workersMix } from "./fixtures";
import { ThreadStrip } from "./ThreadStrip";
import { WorkerSheet, type WorkerSheetProps } from "./WorkerSheet";

/** The strip above, the sheet open for one worker; close and re-tap to reopen. */
function Opened(props: Omit<WorkerSheetProps, "open" | "onClose">) {
  const [open, setOpen] = useState(true);
  const workers = workersMix();
  if (props.state) workers[props.worker] = props.state;
  return (
    <>
      <ThreadStrip workers={workers} selected={open ? props.worker : null} onSelect={() => setOpen(true)} />
      <WorkerSheet {...props} open={open} onClose={() => setOpen(false)} />
    </>
  );
}

const meta: Meta<typeof Opened> = { title: "Kit/WorkerSheet", component: Opened };
export default meta;
type S = StoryObj<typeof Opened>;

export const NotStarted: S = { args: { worker: "Recruiter", events: EVENTS } };
export const Pending: S = { args: { worker: "Trader", state: WORKER_STATES.pending, events: EVENTS } };
export const Running: S = { args: { worker: "Ideator", state: WORKER_STATES.running, events: EVENTS } };
export const Candidates: S = { args: { worker: "Ideator", state: WORKER_STATES.candidates, events: EVENTS } };
export const AwaitingApproval: S = { args: { worker: "Voice", state: WORKER_STATES.awaitingApproval, events: EVENTS } };
export const DoneWithProof: S = { args: { worker: "Ideator", state: WORKER_STATES.done, events: EVENTS } };
export const Failed: S = { args: { worker: "Artist", state: WORKER_STATES.failed, events: EVENTS } };
export const QrngUnavailableUserPicks: S = {
  args: {
    worker: "Ideator",
    state: WORKER_STATES.candidates,
    events: EVENTS,
    collapseUnavailableReason: "ANU QRNG unreachable (timeout after 3 attempts)",
    onPick: () => {},
  },
};
