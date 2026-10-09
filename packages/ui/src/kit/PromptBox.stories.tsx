import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react";
import { PromptBox, type PromptBoxProps } from "./PromptBox";

function Live(props: Partial<PromptBoxProps> & { initial?: string; initialSurprise?: boolean }) {
  const [value, setValue] = useState(props.initial ?? "");
  const [surprise, setSurprise] = useState(props.initialSurprise ?? false);
  return (
    <PromptBox
      {...props}
      value={value}
      surprise={surprise}
      onChange={(v) => {
        setValue(v);
        if (v) setSurprise(false);
      }}
      onSurprise={() => setSurprise(true)}
    />
  );
}

const meta: Meta<typeof Live> = { title: "Kit/PromptBox", component: Live };
export default meta;
type S = StoryObj<typeof Live>;

export const Empty: S = { args: {} };
export const Typed: S = { args: { initial: "a coin about a frozen frog" } };
export const SurprisePressed: S = { args: { initialSurprise: true } };
export const Disabled: S = { args: { initial: "a coin about a frozen frog", disabled: true } };
export const Failed: S = { args: { error: "Say what the coin is about, or tap surprise me." } };
