/**
 * Procedural chamber sound, SPEC §6.1. OFF by default. No audio files.
 *
 *   - a 55Hz cryogenic hum with a soft octave (110Hz) harmonic whose level rises with
 *     total worker activity
 *   - a pure C6 (1046.5Hz, 300ms, soft attack) on every collapse
 *
 * The AudioContext is created lazily on enable(), which must come from a user gesture.
 */
export const HUM_HZ = 55;
export const HUM_OCTAVE_HZ = 110;
export const C6_HZ = 1046.5;
export const C6_MS = 300;
export const C6_ATTACK_MS = 40;

type Ctx = AudioContext;

export interface ChamberSoundOptions {
  /** Injectable for tests. Defaults to window.AudioContext. */
  contextFactory?: () => Ctx;
}

export class ChamberSound {
  private ctx: Ctx | null = null;
  private hum: OscillatorNode | null = null;
  private octave: OscillatorNode | null = null;
  private humGain: GainNode | null = null;
  private octaveGain: GainNode | null = null;
  private master: GainNode | null = null;
  private activity = 0;
  private readonly factory: () => Ctx;
  public collapses = 0;

  constructor(opts: ChamberSoundOptions = {}) {
    this.factory =
      opts.contextFactory ??
      (() => {
        const W = globalThis as unknown as { AudioContext?: new () => Ctx; webkitAudioContext?: new () => Ctx };
        const C = W.AudioContext ?? W.webkitAudioContext;
        if (!C) throw new Error("Web Audio is not available");
        return new C();
      });
  }

  get enabled(): boolean {
    return this.ctx !== null;
  }

  /** Start the hum. Call from a user gesture. Safe to call twice. */
  enable(): void {
    if (this.ctx) return;
    let ctx: Ctx;
    try {
      ctx = this.factory();
    } catch {
      return;
    }
    this.ctx = ctx;
    const master = ctx.createGain();
    master.gain.value = 0.0001;
    master.connect(ctx.destination);
    const hum = ctx.createOscillator();
    hum.type = "sine";
    hum.frequency.value = HUM_HZ;
    const humGain = ctx.createGain();
    humGain.gain.value = 0.18;
    hum.connect(humGain).connect(master);
    const octave = ctx.createOscillator();
    octave.type = "sine";
    octave.frequency.value = HUM_OCTAVE_HZ;
    const octaveGain = ctx.createGain();
    octaveGain.gain.value = 0;
    octave.connect(octaveGain).connect(master);
    hum.start();
    octave.start();
    master.gain.setTargetAtTime(1, ctx.currentTime, 0.6);
    this.hum = hum;
    this.octave = octave;
    this.humGain = humGain;
    this.octaveGain = octaveGain;
    this.master = master;
    this.setActivity(this.activity);
    if (ctx.state === "suspended") void ctx.resume().catch(() => undefined);
  }

  /** 0..1 total worker activity: scales the octave harmonic (0 → 0.12) and lifts the hum a little. */
  setActivity(a: number): void {
    this.activity = Math.max(0, Math.min(1, a));
    if (!this.ctx || !this.octaveGain || !this.humGain) return;
    const t = this.ctx.currentTime;
    this.octaveGain.gain.setTargetAtTime(0.12 * this.activity, t, 0.4);
    this.humGain.gain.setTargetAtTime(0.18 + 0.08 * this.activity, t, 0.4);
  }

  /** The C6 tone on a collapse: 300ms, soft attack. No-op while disabled. */
  collapse(): void {
    this.collapses++;
    const ctx = this.ctx;
    if (!ctx || !this.master) return;
    const osc = ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.value = C6_HZ;
    const g = ctx.createGain();
    const t0 = ctx.currentTime;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(0.25, t0 + C6_ATTACK_MS / 1000);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + C6_MS / 1000);
    osc.connect(g).connect(this.master);
    osc.start(t0);
    osc.stop(t0 + C6_MS / 1000 + 0.02);
  }

  disable(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    try {
      this.hum?.stop();
      this.octave?.stop();
      this.hum?.disconnect();
      this.octave?.disconnect();
      this.master?.disconnect();
      void ctx.close().catch(() => undefined);
    } catch {
      /* already closed */
    }
    this.ctx = null;
    this.hum = this.octave = null;
    this.humGain = this.octaveGain = this.master = null;
  }
}
