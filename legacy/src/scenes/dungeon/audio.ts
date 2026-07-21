/**
 * Procedural SFX — fully synthesized, zero audio files, which is both the house
 * rule (see mouse-game/audio.ts) and, conveniently, very 8-bit: square waves,
 * fast envelopes and noise bursts are exactly what an NES sounded like.
 *
 * Every function is fire-and-forget and fail-silent — audio must never be able
 * to break the game.
 */
import { getAudioCtx } from "../../utils/audio-manager";
import { clamp01 } from "../../utils/math";

/** One mute gate for every sting: ctx() returns null while muted, and every
 * sfx function already fail-silents on a null context. Set from the menu's
 * Settings tab (persisted via settings-save.ts). */
let sfxMuted = false;
export function setSfxMuted(v: boolean): void {
  sfxMuted = v;
}
export function isSfxMuted(): boolean {
  return sfxMuted;
}

function ctx(): AudioContext | null {
  if (sfxMuted) return null;
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

/**
 * Node creation is guarded, not just context acquisition.
 *
 * The module contract is "fail-silent — audio must never be able to break the
 * game", but only ctx() used to be wrapped. A context that resolves and then
 * throws on createOscillator/createBuffer (an exhausted context, a hostile or
 * partial implementation, a browser that has torn the context down mid-frame)
 * would throw straight into the game loop from whatever was mid-swing. Every
 * sting runs its body through here so the promise actually holds.
 */
function safely(fn: () => void): void {
  try {
    fn();
  } catch (_e) {
    // Silence is the correct failure mode for a sound effect.
  }
}

function beep(c: AudioContext, { type, f0, f1, dur, vol, at = 0 }: Beep): void {
  safely(() => {
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
  });
}

function burst(c: AudioContext, dur: number, vol: number, filterType: BiquadFilterType, freq: number, at = 0): void {
  safely(() => {
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
  });
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

// ── Coin absorb ─────────────────────────────────────────────────
/**
 * A pentatonic ladder, a stagger and a voice cap. One kill mints 2-6 coins that
 * land within a few hundred ms of each other, so the naive thing — fire the same
 * chime per coin — produces a buzz (identical partials stacking in phase), not a
 * jingle. Instead each coin in a cluster takes the NEXT rung of the ladder and is
 * scheduled COIN_STEP later than the one before, which turns a burst into a
 * rising arpeggio. The ladder resets after a quiet gap so a lone coin is always
 * the low, warm root note.
 */
const COIN_LADDER = [1046.5, 1174.7, 1396.9, 1568.0, 1864.7, 2093.0];
/** Hard ceiling on chimes per cluster — the rest bank silently. */
const COIN_VOICES = 5;
const COIN_STEP = 0.055; // seconds between successive coins in one cluster
const COIN_RESET = 0.35; // silence this long starts a fresh ladder
let coinIdx = 0;
let coinClusterAt = -1;

/** A coin absorbed into the knight — a bright struck chime with an octave tail. */
export function sfxCoin(): void {
  const c = ctx();
  if (!c) return;
  const now = c.currentTime;
  if (now - coinClusterAt > COIN_RESET) {
    coinIdx = 0;
    coinClusterAt = now;
  }
  if (coinIdx >= COIN_VOICES) return; // cluster full — adding more only muddies it
  // Schedule relative to the cluster's start so coins arriving in the SAME frame
  // still come out spaced, then detune a hair so no two are bit-identical.
  const at = Math.max(0, coinClusterAt + coinIdx * COIN_STEP - now);
  const f = COIN_LADDER[Math.min(coinIdx, COIN_LADDER.length - 1)] * (0.99 + Math.random() * 0.02);
  coinIdx++;
  beep(c, { type: "triangle", f0: f, dur: 0.07, vol: 0.07, at });
  beep(c, { type: "triangle", f0: f * 2, dur: 0.1, vol: 0.04, at: at + 0.045 });
}

/** Something you owned just fell apart — a dry crack and clatter. */
export function sfxBreak(): void {
  const c = ctx();
  if (!c) return;
  burst(c, 0.08, 0.22, "highpass", 1800);
  burst(c, 0.16, 0.12, "bandpass", 700, 0.05);
  beep(c, { type: "square", f0: 140, f1: 60, dur: 0.12, vol: 0.1, at: 0.03 });
}

/**
 * ARRIVAL on a new floor — a low gate-swing that opens into a two-note chord.
 *
 * Deliberately the mirror of sfxStairs: that one ASCENDS (you're leaving, going
 * down), this one settles onto a held root (you've arrived, this is the place
 * now). They fire within a second or so of each other across a descent, so if
 * both rose they'd read as one long confusing run.
 *
 * Kept under the plunger BOING that fires a beat later in startLevel — the
 * launch is the moment the player acts on, and an arrival sting that buries it
 * would be worse than no arrival sting.
 */
export function sfxLevelStart(): void {
  const c = ctx();
  if (!c) return;
  // Stone gate grinding open.
  burst(c, 0.34, 0.09, "lowpass", 420);
  beep(c, { type: "sawtooth", f0: 78, f1: 62, dur: 0.3, vol: 0.09 });
  // …settling onto a root + fifth.
  beep(c, { type: "triangle", f0: 196, dur: 0.34, vol: 0.09, at: 0.16 });
  beep(c, { type: "triangle", f0: 294, dur: 0.3, vol: 0.06, at: 0.22 });
}

/**
 * A floor MODIFIER is in play — an ominous two-note drop under the toast.
 * Modifiers are announced in text; a floor that is quietly half-lit or crawling
 * reads as a bug unless something marks the moment. Scheduled a little late so
 * it lands after the arrival sting rather than on top of it.
 */
export function sfxModifier(): void {
  const c = ctx();
  if (!c) return;
  beep(c, { type: "sawtooth", f0: 233, f1: 220, dur: 0.26, vol: 0.1, at: 0.45 });
  beep(c, { type: "sawtooth", f0: 156, f1: 147, dur: 0.42, vol: 0.11, at: 0.62 });
  burst(c, 0.5, 0.05, "lowpass", 320, 0.62);
}

/**
 * An OVERLORD is on this floor — a low brass-ish swell. Louder and longer than
 * the modifier sting: a boss floor is the biggest thing the descent card can
 * tell you, and it previously said it in text only.
 */
export function sfxBossReveal(): void {
  const c = ctx();
  if (!c) return;
  [
    [98, 0],
    [123, 0.1],
    [147, 0.2],
  ].forEach(([f, at]) => beep(c, { type: "sawtooth", f0: f, dur: 0.75 - at, vol: 0.1, at: at + 0.3 }));
  burst(c, 0.7, 0.08, "lowpass", 260, 0.35);
}

/** Found the stairs — a little ascending fanfare. */
export function sfxStairs(): void {
  const c = ctx();
  if (!c) return;
  const notes = [392, 494, 587, 784];
  notes.forEach((f, i) => beep(c, { type: "square", f0: f, dur: 0.12, vol: 0.1, at: i * 0.09 }));
}

/** You died. */
/** Spin pad — a rising slot-machine whirl. */
export function sfxSpin(): void {
  const c = ctx();
  if (!c) return;
  beep(c, { type: "square", f0: 220, f1: 880, dur: 0.16, vol: 0.16 });
  beep(c, { type: "square", f0: 330, f1: 1320, dur: 0.14, vol: 0.1, at: 0.05 });
}

/** Target bullseye — a bright double DING. */
export function sfxTarget(): void {
  const c = ctx();
  if (!c) return;
  beep(c, { type: "triangle", f0: 1320, dur: 0.08, vol: 0.2 });
  beep(c, { type: "triangle", f0: 1760, dur: 0.12, vol: 0.16, at: 0.07 });
}

/** Trapdoor — a wooden creak, then the drop whoosh. */
export function sfxTrapdoor(): void {
  const c = ctx();
  if (!c) return;
  beep(c, { type: "sawtooth", f0: 140, f1: 70, dur: 0.18, vol: 0.14 });
  burst(c, 0.35, 0.16, "lowpass", 500, 0.12);
  beep(c, { type: "sine", f0: 500, f1: 90, dur: 0.4, vol: 0.12, at: 0.15 });
}

/** Bumper goblin — a rubbery BOING, lower and sillier than the bumper ping. */
export function sfxGoblin(): void {
  const c = ctx();
  if (!c) return;
  beep(c, { type: "sine", f0: 180, f1: 420, dur: 0.1, vol: 0.2 });
  beep(c, { type: "sine", f0: 420, f1: 240, dur: 0.14, vol: 0.14, at: 0.08 });
}

/** The Magician's cackle — a descending, delighted arpeggio. */
export function sfxCackle(): void {
  const c = ctx();
  if (!c) return;
  [880, 740, 620, 520, 440].forEach((f, k) => {
    beep(c, { type: "square", f0: f, f1: f * 0.92, dur: 0.09, vol: 0.12, at: k * 0.07 });
  });
}

/** Freeze ray — a crystalline downward shimmer. */
export function sfxFreeze(): void {
  const c = ctx();
  if (!c) return;
  beep(c, { type: "triangle", f0: 1760, f1: 440, dur: 0.5, vol: 0.14 });
  burst(c, 0.4, 0.06, "highpass", 3000, 0.05);
}

/** The Oracle Frog — a fat contented croak. */
export function sfxRibbit(): void {
  const c = ctx();
  if (!c) return;
  beep(c, { type: "sawtooth", f0: 110, f1: 160, dur: 0.14, vol: 0.16 });
  beep(c, { type: "sawtooth", f0: 90, f1: 140, dur: 0.18, vol: 0.14, at: 0.14 });
}

/**
 * The rolling cart's bell — two bright struck tones. `near` is 0..1 by
 * proximity, so a distant cart is a faint hint and a close one is a beacon;
 * it's the only way to know the merchant is on the floor at all.
 */
export function sfxCartBell(near: number): void {
  const c = ctx();
  if (!c) return;
  const vol = 0.03 + 0.11 * clamp01(near);
  beep(c, { type: "triangle", f0: 1568, f1: 1480, dur: 0.16, vol });
  beep(c, { type: "triangle", f0: 2093, f1: 1976, dur: 0.22, vol: vol * 0.7, at: 0.11 });
}

export function sfxGameOver(): void {
  const c = ctx();
  if (!c) return;
  const notes = [330, 262, 196, 131];
  notes.forEach((f, i) => beep(c, { type: "square", f0: f, dur: 0.22, vol: 0.12, at: i * 0.17 }));
  burst(c, 0.5, 0.06, "lowpass", 300, 0.55);
}
