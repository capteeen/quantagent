/**
 * The Launcher handoff contract, SPEC §6.5. The chamber hosts a launch sequence INSIDE its
 * own render loop (same renderer, same post-processing) and feeds it the QSD state folded
 * from Launcher.* events.
 *
 * qsd-market's <LaunchSequence /> is imported through an adapter so it is never forked: the
 * package is not linked in this repo yet, so the default adapter is EventDrivenLaunchSequence,
 * which renders the same six stages from the same events. When @qsd/market is linked, wrap
 * its component in a LaunchSequenceAdapter and pass it to <Chamber launchSequence={...} />.
 */
import type { ComponentType } from "react";
import type { QsdStage } from "@quantagent/core/types";
import type { QsdState } from "../types";

export const QSD_STAGES: readonly QsdStage[] = ["keyGeneration", "merkleTree", "superposition", "quantumDraw", "signing", "anchoring"];

export function stageIndex(stage: QsdStage | undefined): number {
  return stage === undefined ? -1 : QSD_STAGES.indexOf(stage);
}

export interface LaunchSequenceProps {
  /** Folded Launcher.* events: the only input. */
  qsd: QsdState;
  reducedMotion: boolean;
}

export interface LaunchSequenceAdapter {
  /** Where the sequence comes from, for logs and docs ("event-driven" or "qsd-market"). */
  readonly id: string;
  /** Rendered inside the chamber's <Canvas>, so it may use useFrame and the shared renderer. */
  readonly Sequence: ComponentType<LaunchSequenceProps>;
}
