/**
 * Procedural SFX — fully synthesized, zero audio files, which is both the house
 * rule (see mouse-game/audio.ts) and, conveniently, very 8-bit: square waves,
 * fast envelopes and noise bursts are exactly what an NES sounded like.
 *
 * Every function is fire-and-forget and fail-silent — audio must never be able
 * to break the game.
 */
import { getAudioCtx } from "../../utils/audio-manager";

function ctx(): AudioContext | null {
  try {
    const c = getAudioCtx();
    if (!c) return null;
    if (c.state === "suspended") c.resume();
    return c;
  } catch (_e) {
    return null;
  }
}

interface Beep {
  type: OscillatorType;
  f0: number;
  f1?: number; // glide target
  dur: number;
  vol: number;
  at?: number; // start offset, seconds
}

function beep(c: AudioContext, { type, f0, f1, dur, vol, at = 0 }: Beep): void {
  const t = c.currentTime + at;
  const osc = c.createOscillator();
  osc.type = type;
  osc.frequency.setValueAtTime(f0, t);
  if (f1 !== undefined) osc.frequency.exponentialRampToValueAtTime(Math.max(f1, 1), t + dur);

  const g = c.createGain();
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(vol, t + 0.008);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);

  osc.connect(g);
  g.connect(c.destination);
  osc.start(t);
  osc.stop(t + dur + 0.02);
  osc.onended = () => {
    osc.disconnect();
    g.disconnect();
  };
}

function burst(c: AudioContext, dur: number, vol: number, filterType: BiquadFilterType, freq: number, at = 0): void {
  const t = c.currentTime + at;
  const len = Math.max(1, Math.floor(c.sampleRate * dur));
  const buf = c.createBuffer(1, len, c.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;

  const src = c.createBufferSource();
  src.buffer = buf;
  const filter = c.createBiquadFilter();
  filter.type = filterType;
  filter.frequency.value = freq;
  const g = c.createGain();
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);

  src.connect(filter);
  filter.connect(g);
  g.connect(c.destination);
  src.start(t);
  src.stop(t + dur);
  src.onended = () => {
    src.disconnect();
    filter.disconnect();
    g.disconnect();
  };
}

/** Sword swing — a fast air whoosh. */
export function sfxSwing(): void {
  const c = ctx();
  if (!c) return;
  burst(c, 0.09, 0.12, "bandpass", 1600);
  beep(c, { type: "square", f0: 330, f1: 140, dur: 0.08, vol: 0.05 });
}

/**
 * Dodge-roll — a low, quick body whoosh: filtered noise sweeping down. The pitch
 * is jittered ±8% per roll so a flurry of dodges doesn't machine-gun the exact
 * same sample (research: randomise repeated action SFX to avoid fatigue).
 */
export function sfxRoll(): void {
  const c = ctx();
  if (!c) return;
  const p = 0.92 + Math.random() * 0.16; // 0.92..1.08
  burst(c, 0.16, 0.11, "lowpass", 700 * p);
  beep(c, { type: "sine", f0: 260 * p, f1: 90 * p, dur: 0.14, vol: 0.05 });
}

/** Pop bumper — a bright arcade PING that rises with a slight random pitch. */
export function sfxBumper(): void {
  const c = ctx();
  if (!c) return;
  const p = 0.94 + Math.random() * 0.12;
  beep(c, { type: "square", f0: 620 * p, f1: 980 * p, dur: 0.08, vol: 0.09 });
  beep(c, { type: "sine", f0: 1240 * p, f1: 1240 * p, dur: 0.05, vol: 0.05 });
}

/** Spring/plunger — a rubbery BOING: a fast down-up pitch flick. */
export function sfxSpring(): void {
  const c = ctx();
  if (!c) return;
  beep(c, { type: "triangle", f0: 180, f1: 640, dur: 0.16, vol: 0.1 });
  beep(c, { type: "sine", f0: 90, f1: 320, dur: 0.12, vol: 0.06 });
}

/** Heavy swing — a slower, weightier whoosh than a light swing. */
export function sfxHeavy(): void {
  const c = ctx();
  if (!c) return;
  burst(c, 0.16, 0.16, "bandpass", 1100);
  beep(c, { type: "square", f0: 260, f1: 90, dur: 0.14, vol: 0.08 });
}

/** Gunshot — a sharp crack with a low thump under it. */
export function sfxGun(): void {
  const c = ctx();
  if (!c) return;
  burst(c, 0.05, 0.3, "highpass", 2200);
  burst(c, 0.12, 0.18, "lowpass", 600);
  beep(c, { type: "square", f0: 220, f1: 60, dur: 0.09, vol: 0.12 });
}

/** Bowstring — a taut twang and the arrow's hiss. */
export function sfxBow(): void {
  const c = ctx();
  if (!c) return;
  beep(c, { type: "triangle", f0: 480, f1: 180, dur: 0.12, vol: 0.14 });
  burst(c, 0.14, 0.08, "bandpass", 3000, 0.02);
}

/** Flamethrower puff — a soft roar. Fired per trigger tick, so it's kept short and quiet. */
export function sfxFlame(): void {
  const c = ctx();
  if (!c) return;
  burst(c, 0.12, 0.07, "lowpass", 900);
  burst(c, 0.09, 0.04, "bandpass", 1700, 0.01);
}

/** Blade connects with something rotten. */
export function sfxHit(): void {
  const c = ctx();
  if (!c) return;
  burst(c, 0.1, 0.2, "lowpass", 900);
  beep(c, { type: "square", f0: 190, f1: 70, dur: 0.11, vol: 0.14 });
}

/** Zombie goes down for good. */
export function sfxZombieDie(): void {
  const c = ctx();
  if (!c) return;
  beep(c, { type: "sawtooth", f0: 160, f1: 36, dur: 0.35, vol: 0.14 });
  burst(c, 0.25, 0.1, "lowpass", 500, 0.05);
}

/** A zombie notices you. Throttled by the caller — a chorus every frame is noise. */
export function sfxGroan(): void {
  const c = ctx();
  if (!c) return;
  beep(c, { type: "triangle", f0: 82, f1: 55, dur: 0.4, vol: 0.11 });
  beep(c, { type: "triangle", f0: 110, f1: 66, dur: 0.3, vol: 0.06, at: 0.08 });
}

/** You got bitten. */
export function sfxHurt(): void {
  const c = ctx();
  if (!c) return;
  beep(c, { type: "square", f0: 220, f1: 110, dur: 0.09, vol: 0.16 });
  beep(c, { type: "square", f0: 165, f1: 82, dur: 0.12, vol: 0.14, at: 0.07 });
}

/** Scooped something off the floor — a bright little blip. */
export function sfxPickup(): void {
  const c = ctx();
  if (!c) return;
  beep(c, { type: "square", f0: 523, f1: 784, dur: 0.09, vol: 0.1 });
  beep(c, { type: "square", f0: 784, dur: 0.08, vol: 0.08, at: 0.07 });
}

/** Something you owned just fell apart — a dry crack and clatter. */
export function sfxBreak(): void {
  const c = ctx();
  if (!c) return;
  burst(c, 0.08, 0.22, "highpass", 1800);
  burst(c, 0.16, 0.12, "bandpass", 700, 0.05);
  beep(c, { type: "square", f0: 140, f1: 60, dur: 0.12, vol: 0.1, at: 0.03 });
}

/** Found the stairs — a little ascending fanfare. */
export function sfxStairs(): void {
  const c = ctx();
  if (!c) return;
  const notes = [392, 494, 587, 784];
  notes.forEach((f, i) => beep(c, { type: "square", f0: f, dur: 0.12, vol: 0.1, at: i * 0.09 }));
}

/** You died. */
export function sfxGameOver(): void {
  const c = ctx();
  if (!c) return;
  const notes = [330, 262, 196, 131];
  notes.forEach((f, i) => beep(c, { type: "square", f0: f, dur: 0.22, vol: 0.12, at: i * 0.17 }));
  burst(c, 0.5, 0.06, "lowpass", 300, 0.55);
}
