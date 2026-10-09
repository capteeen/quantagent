import { describe, expect, it } from "vitest";
import { FrameTimeMonitor, medianOf } from "../src/chamber/perf/frameMonitor";
import {
  DEGRADE_HOLD_MS,
  PERF_LADDER,
  PERF_MAX_TIER,
  initialLadder,
  perfSettings,
  stepLadder,
  type LadderState,
} from "../src/chamber/perf/degradation";

describe("degradation ladder (SPEC §6.7)", () => {
  it("degrades in order particles → bloom radius → DOF → iridescence → aberration", () => {
    expect(PERF_LADDER).toEqual(["particles", "bloomRadius", "dof", "iridescence", "aberration"]);
    const full = perfSettings(0);
    expect(full.vapourCount).toBe(200);
    expect(full.bloomRadius).toBe(0.6);
    expect(full.dof).toBe(true);
    expect(full.iridescence).toBe(0.6);
    expect(full.aberration).toBe(true);
    const t1 = perfSettings(1);
    expect(t1.vapourCount).toBeLessThan(200);
    expect(t1.bloomRadius).toBe(0.6);
    const t2 = perfSettings(2);
    expect(t2.bloomRadius).toBeLessThan(0.6);
    expect(t2.dof).toBe(true);
    expect(perfSettings(3).dof).toBe(false);
    expect(perfSettings(3).iridescence).toBe(0.6);
    expect(perfSettings(4).iridescence).toBe(0);
    expect(perfSettings(4).aberration).toBe(true);
    expect(perfSettings(5).aberration).toBe(false);
  });

  it("never degrades strand count, pulse fidelity, the collapse, or the chain link count", () => {
    for (let t = 0; t <= PERF_MAX_TIER; t++) {
      const s = perfSettings(t);
      expect(s.strandCount).toBe(8);
      expect(s.chainLinks).toBe(1072);
      expect(s.sparkCount).toBe(30);
    }
  });

  it("steps down after the median sits under 55fps for the hold, with hysteresis", () => {
    let s = initialLadder();
    s = stepLadder(s, 60, 0);
    expect(s.tier).toBe(0);
    s = stepLadder(s, 50, 1000);
    expect(s.tier).toBe(0);
    s = stepLadder(s, 50, 1000 + DEGRADE_HOLD_MS - 1);
    expect(s.tier).toBe(0);
    s = stepLadder(s, 50, 1000 + DEGRADE_HOLD_MS);
    expect(s.tier).toBe(1);
    // 56fps is inside the hysteresis band: no change either way
    s = stepLadder(s, 56, 5000);
    s = stepLadder(s, 56, 50000);
    expect(s.tier).toBe(1);
    // never beyond the ladder
    let m: LadderState = { ...s, tier: PERF_MAX_TIER };
    m = stepLadder(m, 10, 0);
    m = stepLadder(m, 10, 100000);
    expect(m.tier).toBe(PERF_MAX_TIER);
  });
});

describe("frame-time monitor", () => {
  it("reports the rolling median", () => {
    const m = new FrameTimeMonitor(5);
    expect(m.median()).toBeNull();
    for (const d of [16, 16, 17, 40, 16]) m.push(d);
    expect(m.median()).toBe(16);
    expect(m.fps()).toBeCloseTo(62.5);
    for (const d of [40, 40, 40]) m.push(d);
    expect(m.median()).toBe(40);
    m.push(NaN);
    m.push(-1);
    expect(m.samples).toBe(5);
    expect(medianOf([3, 1, 2])).toBe(2);
    expect(medianOf([4, 1, 2, 3])).toBe(2.5);
  });
});
