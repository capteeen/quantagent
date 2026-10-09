import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react";
import type { ApprovalDecision } from "@quantagent/core/types";
import { ApprovalCard } from "./ApprovalCard";
import { APPROVAL, APPROVAL_TRADE } from "./fixtures";

const meta: Meta<typeof ApprovalCard> = { title: "Kit/ApprovalCard", component: ApprovalCard };
export default meta;
type S = StoryObj<typeof ApprovalCard>;

export const PendingPost: S = { args: { approval: APPROVAL, onDecide: () => {} } };
export const PendingTrade: S = { args: { approval: APPROVAL_TRADE, onDecide: () => {} } };
export const Submitting: S = { args: { approval: APPROVAL, onDecide: () => {}, submitting: true } };
export const Failed: S = { args: { approval: APPROVAL, onDecide: () => {}, error: "bus unreachable: ECONNREFUSED" } };
export const ResolvedApproved: S = { args: { approval: APPROVAL, onDecide: () => {}, resolved: "approve" } };
export const ResolvedEdited: S = { args: { approval: APPROVAL, onDecide: () => {}, resolved: "edit" } };
export const ResolvedSkipped: S = { args: { approval: APPROVAL, onDecide: () => {}, resolved: "skip" } };

/** Swipe right to approve, left to skip, tap to edit; the decision is shown below. */
export const Interactive: S = {
  render: () => {
    const [resolved, setResolved] = useState<ApprovalDecision | undefined>(undefined);
    const [draft, setDraft] = useState<unknown>(undefined);
    return (
      <div className="flex flex-col gap-3">
        <ApprovalCard
          approval={APPROVAL}
          resolved={resolved}
          onDecide={(d, edited) => {
            setResolved(d);
            setDraft(edited);
          }}
        />
        <pre className="text-[11px] text-muted">{resolved ? JSON.stringify({ decision: resolved, draft }, null, 2) : "no decision yet"}</pre>
      </div>
    );
  },
};
