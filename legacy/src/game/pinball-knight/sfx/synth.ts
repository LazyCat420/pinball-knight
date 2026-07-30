/**
 * The two primitives every sting is built from.
 *
 * Moved verbatim from the old `audio.ts`. The ONLY change is the destination:
 * these connect to the category bus rather than straight to `ctx.destination`,
 * which is what makes a master volume possible at all. Envelopes, curves and
 * timings are untouched, and `sfx-snapshot.test.ts` asserts that.
 *
 * Everything is synthesized — square waves, fast envelopes and filtered noise
 * bursts are exactly what an NES sounded like, and it means the repo carries
 * zero audio files. That is the house rule, not an accident of convenience.
 */
import type { Bus } from "./bus";
import { safely } from "./bus";

export interface Beep {
  type: OscillatorType;
  f0: number;
  f1?: number; // glide target
  dur: number;
  vol: number;
  at?: number; // start offset, seconds
}

/** One oscillator with a gain envelope and an optional exponential glide. */
export function beep(b: Bus, { type, f0, f1, dur, vol, at = 0 }: Beep): void {
  safely(() => {
    const t = b.c.currentTime + at;
    const osc = b.c.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(f0, t);
    if (f1 !== undefined) osc.frequency.exponentialRampToValueAtTime(Math.max(f1, 1), t + dur);

    const g = b.c.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);

    osc.connect(g);
    g.connect(b.out);
    osc.start(t);
    osc.stop(t + dur + 0.02);
    osc.onended = () => {
      osc.disconnect();
      g.disconnect();
    };
  });
}

/** A filtered white-noise burst — every percussive, breathy or gritty sound. */
export function burst(b: Bus, dur: number, vol: number, filterType: BiquadFilterType, freq: number, at = 0): void {
  safely(() => {
    const t = b.c.currentTime + at;
    const len = Math.max(1, Math.floor(b.c.sampleRate * dur));
    const buf = b.c.createBuffer(1, len, b.c.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;

    const src = b.c.createBufferSource();
    src.buffer = buf;
    const filter = b.c.createBiquadFilter();
    filter.type = filterType;
    filter.frequency.value = freq;
    const g = b.c.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);

    src.connect(filter);
    filter.connect(g);
    g.connect(b.out);
    src.start(t);
    src.stop(t + dur);
    src.onended = () => {
      src.disconnect();
      filter.disconnect();
      g.disconnect();
    };
  });
}
