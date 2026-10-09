/**
 * THE CHAMBER public API (SPEC §6).
 *
 *   const store = createChamberStore();
 *   bus.subscribe((e) => store.apply(e));           // the only way anything moves
 *   <Chamber mode="launch" store={store} onTapWorker={openSheet} onTapProof={openProof} />
 */
export { Chamber, type ChamberMode, type ChamberProps } from "./Chamber";
export {
  createChamberStore,
  foldEvent,
  initialChamberState,
  serializeChamberState,
  useChamber,
  candidateLabel,
  CORE_ROUGHNESS_CLEAR,
  CORE_ROUGHNESS_CLOUDED,
  type ChamberStore,
  type CreateChamberStoreOptions,
} from "./store";
export type {
  ChamberActions,
  ChamberEffect,
  ChamberSettings,
  ChamberState,
  ChamberStoreState,
  CoreState,
  EffectKind,
  LaunchPhase,
  QsdState,
  StrandState,
  StrandStatus,
} from "./types";
export { QSD_CHAINS, QSD_DEPTH, QSD_LINKS, MERKLE_LEAVES, MERKLE_LEVELS } from "./types";
export { MS, SPEED, EASING_CSS, ease, motionDurations, type MotionDurations } from "./motion";
export { COLLAPSE, collapseFrame, ringAt, type CollapseFrame, type CollapseOptions } from "./collapse/timeline";
export { CONVERGENCE, convergenceFrame, type ConvergenceFrame } from "./convergence/timeline";
export { fanGhosts, type Ghost } from "./collapse/fan";
export * as layout from "./layout";
export { ChamberSound, HUM_HZ, HUM_OCTAVE_HZ, C6_HZ, C6_MS, type ChamberSoundOptions } from "./sound";
export { PERF_LADDER, PERF_MAX_TIER, perfSettings, stepLadder, initialLadder, type PerfSettings, type PerfStep, type LadderState } from "./perf/degradation";
export { FrameTimeMonitor, medianOf } from "./perf/frameMonitor";
export { prefersReducedMotion, usePrefersReducedMotion } from "./perf/reducedMotion";
export { QSD_STAGES, stageIndex, type LaunchSequenceAdapter, type LaunchSequenceProps } from "./qsd/LaunchSequenceAdapter";
export { EventDrivenLaunchSequence, eventDrivenLaunchSequence } from "./qsd/EventDrivenLaunchSequence";
