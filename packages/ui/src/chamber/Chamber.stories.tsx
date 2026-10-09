/**
 * THE CHAMBER in Storybook: every strand state and the full collapse, driven only by the
 * recorded fixture (src/fixtures/launch.recorded.json). No story invents an event.
 */
import { useEffect, useMemo, useState } from "react";
import type { Meta, StoryObj } from "@storybook/react";
import { WORKER_NAMES, type QuantagentEvent, type WorkerName } from "@quantagent/core/types";
import { Chamber, type ChamberMode } from "./Chamber";
import { createChamberStore } from "./store";
import recorded from "../fixtures/launch.recorded.json";

const events = recorded as QuantagentEvent[];

interface Args {
  mode: ChamberMode;
  framing: "spec" | "fit";
  reducedMotion: boolean;
  /** Apply the fixture up to this seq immediately (-1: none). */
  upTo: number;
  /** Then play the rest of the fixture at real timings × speed (0: do not play). */
  speed: number;
  sound: boolean;
}

function Playback({ mode, framing, reducedMotion, upTo, speed, sound }: Args) {
  const store = useMemo(() => createChamberStore(), []);
  const [tapped, setTapped] = useState<string>("");
  useEffect(() => {
    store.reset();
    const now = events.filter((e) => e.seq <= upTo);
    store.applyMany(now);
    if (speed <= 0) return;
    const rest = events.filter((e) => e.seq > upTo);
    if (rest.length === 0) return;
    const t0 = Date.parse(rest[0]!.at);
    const timers = rest.map((e) => window.setTimeout(() => store.apply(e), (Date.parse(e.at) - t0) / speed));
    return () => timers.forEach((t) => window.clearTimeout(t));
  }, [store, upTo, speed]);
  return (
    <div style={{ width: 390, height: 844, position: "relative" }}>
      <Chamber
        mode={mode}
        store={store}
        framing={framing}
        reducedMotion={reducedMotion}
        sound={sound}
        governor={false}
        onTapWorker={(w) => setTapped(`worker: ${w}`)}
        onTapProof={(w, p) => setTapped(`proof: ${w} ${p.drawHash.slice(0, 8)}`)}
        onLive={() => setTapped("live")}
      />
      <div style={{ position: "absolute", left: 8, bottom: 8, fontSize: 11, color: "#6B7684", fontFamily: "JetBrains Mono, monospace" }}>{tapped}</div>
    </div>
  );
}

const meta: Meta<Args> = {
  title: "Chamber/Chamber",
  render: (args) => <Playback {...args} />,
  args: { mode: "launch", framing: "fit", reducedMotion: false, upTo: -1, speed: 1, sound: false },
  argTypes: {
    mode: { control: "select", options: ["idle", "launch", "live", "coin"] },
    framing: { control: "select", options: ["spec", "fit"] },
  },
  parameters: { layout: "fullscreen" },
};
export default meta;

type Story = StoryObj<Args>;

const seqOf = (pred: (e: QuantagentEvent) => boolean) => events.find(pred)?.seq ?? -1;
const stageSeq = (stage: string) => seqOf((e) => e.type === "Launcher.qsdStage" && e.payload.stage === stage);

export const Idle: Story = { args: { mode: "idle", speed: 0 } };
export const FullLaunch: Story = { args: { mode: "launch", speed: 1 } };
export const FullLaunchFast: Story = { args: { mode: "launch", speed: 4 } };
export const Ignition: Story = { args: { upTo: seqOf((e) => e.type === "Launch.started"), speed: 0 } };
export const Running: Story = { args: { upTo: 60, speed: 0 } };
export const Fan: Story = { name: "Candidates (fan)", args: { upTo: seqOf((e) => e.type === "Worker.candidates" && e.worker === "Ideator"), speed: 0 } };
export const Collapse: Story = { name: "The collapse (§6.4)", args: { upTo: seqOf((e) => e.type === "Orchestrator.collapsed") - 1, speed: 1 } };
export const AwaitingApproval: Story = { args: { upTo: seqOf((e) => e.type === "Worker.awaitingApproval" && e.worker === "Voice"), speed: 0 } };
export const KeyGeneration: Story = { args: { upTo: stageSeq("keyGeneration") - 1, speed: 2 } };
export const MerkleTree: Story = { args: { upTo: stageSeq("merkleTree") - 1, speed: 1 } };
export const Superposition: Story = { args: { upTo: stageSeq("superposition"), speed: 0 } };
export const QuantumDraw: Story = { args: { upTo: stageSeq("quantumDraw") - 1, speed: 1 } };
export const Signing: Story = { args: { upTo: stageSeq("signing") - 1, speed: 1 } };
export const Anchoring: Story = { args: { upTo: stageSeq("anchoring") - 1, speed: 1 } };
export const Convergence: Story = { name: "Launch.live (§6.6)", args: { upTo: seqOf((e) => e.type === "Launch.live") - 1, speed: 1 } };
export const CoinPage: Story = { args: { mode: "coin", upTo: events.length, speed: 0 } };
export const ReducedMotion: Story = { args: { reducedMotion: true, upTo: seqOf((e) => e.type === "Orchestrator.collapsed") - 1, speed: 1 } };

/** A failed strand: the fixture has none (the recorded launch succeeded), so this story appends one real Worker.failed event. */
export const Failed: Story = {
  render: (args) => <FailedStrand {...args} />,
  args: { upTo: 60, speed: 0 },
};
function FailedStrand(args: Args) {
  const store = useMemo(() => createChamberStore(), []);
  useEffect(() => {
    store.reset();
    store.applyMany(events.filter((e) => e.seq <= args.upTo));
    const base = events[0]!;
    const failed: WorkerName = "Trader";
    store.apply({ ...base, id: "story_failed", seq: 100000, type: "Worker.failed", worker: failed, payload: { reason: "RPC unreachable" } } as QuantagentEvent);
  }, [store, args.upTo]);
  return (
    <div style={{ width: 390, height: 844 }}>
      <Chamber mode="launch" store={store} framing={args.framing} reducedMotion={args.reducedMotion} governor={false} />
    </div>
  );
}

export const StrandStates: Story = {
  name: "All eight strands (tap to select)",
  render: (args) => <Playback {...args} />,
  args: { upTo: seqOf((e) => e.type === "Worker.done" && e.worker === WORKER_NAMES[0]), speed: 0 },
};
