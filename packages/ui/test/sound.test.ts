import { describe, expect, it, vi } from "vitest";
import { C6_HZ, ChamberSound, HUM_HZ, HUM_OCTAVE_HZ } from "../src/chamber/sound";

function fakeContext() {
  const oscillators: { type: string; frequency: { value: number }; started: boolean; stopped: boolean }[] = [];
  const param = () => ({
    value: 0,
    setValueAtTime: vi.fn(),
    linearRampToValueAtTime: vi.fn(),
    exponentialRampToValueAtTime: vi.fn(),
    setTargetAtTime: vi.fn(),
  });
  const node = () => {
    const n: Record<string, unknown> = {};
    n["connect"] = () => n;
    n["disconnect"] = () => undefined;
    return n;
  };
  const ctx = {
    currentTime: 0,
    state: "running",
    destination: node(),
    resume: () => Promise.resolve(),
    close: () => Promise.resolve(),
    createGain: () => ({ ...node(), gain: param() }),
    createOscillator: () => {
      const o = { ...node(), type: "sine", frequency: { value: 0 }, started: false, stopped: false, start() { o.started = true; }, stop() { o.stopped = true; } };
      oscillators.push(o);
      return o;
    },
  };
  return { ctx: ctx as unknown as AudioContext, oscillators };
}

describe("chamber sound (SPEC §6.1): procedural, off by default", () => {
  it("is off by default and does not touch Web Audio until enabled", () => {
    const f = fakeContext();
    const factory = vi.fn(() => f.ctx);
    const s = new ChamberSound({ contextFactory: factory });
    expect(s.enabled).toBe(false);
    s.collapse();
    s.setActivity(0.5);
    expect(factory).not.toHaveBeenCalled();
    expect(f.oscillators).toHaveLength(0);
  });

  it("enable starts a 55Hz hum with a 110Hz octave; collapse plays a C6 (1046.5Hz)", () => {
    const f = fakeContext();
    const s = new ChamberSound({ contextFactory: () => f.ctx });
    s.enable();
    expect(s.enabled).toBe(true);
    expect(f.oscillators.map((o) => o.frequency.value)).toEqual([HUM_HZ, HUM_OCTAVE_HZ]);
    expect(HUM_HZ).toBe(55);
    s.collapse();
    expect(f.oscillators).toHaveLength(3);
    expect(f.oscillators[2]!.frequency.value).toBe(C6_HZ);
    expect(f.oscillators[2]!.started).toBe(true);
    expect(f.oscillators[2]!.stopped).toBe(true);
    s.disable();
    expect(s.enabled).toBe(false);
  });

  it("survives an environment without Web Audio", () => {
    const s = new ChamberSound({
      contextFactory: () => {
        throw new Error("no audio");
      },
    });
    s.enable();
    expect(s.enabled).toBe(false);
  });
});
