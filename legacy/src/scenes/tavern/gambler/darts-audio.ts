/**
 * DARTS SOUND. Procedural, like everything else — no audio files, ever.
 *
 * ── What this has to do that the other games don't ──────────────────────────
 * Slots is a spectator sport: you commit once and then listen. Darts is played
 * in real time against a moving bar, so its audio is a CONTROL SURFACE, not
 * decoration. The reticle tick is the important cue in the file — it is a
 * metronome the player can lock onto, and because it fires once per graduation
 * crossed rather than once per frame, it audibly speeds up when the stake goes
 * up or the third dart comes round. A player who has stopped watching the bar
 * can still hit treble-20 by ear. That is the mechanic, in sound.
 *
 * ── Distinct from the tavern's own sfxDart() ────────────────────────────────
 * `../audio.ts` already has `sfxDart()`, which the NPC in the corner throws on
 * a loop: one lowpassed noise burst at 900Hz plus a low body thump, deliberately
 * dull because it is meant to be heard across a room. The player's throw must
 * not sound like ambience, so `sfxStick` is a three-layer event — the sisal
 * chuff, a woody knock with a pitched body, and a little steel on top — and it
 * changes with what was hit. If the player's dart sounded like the NPC's, every
 * throw would read as background noise happening near them.
 *
 * House rules, matched to `./audio.ts`: context via `getAudioCtx()`, resume if
 * suspended, EVERY cue wrapped so audio can never break the game, nodes
 * disconnected in `onended`, gains inside the 0.02–0.09 band. Nothing returns a
 * success flag — a browser that has not yet seen a user gesture will correctly
 * produce silence, and that is not an error.
 *
 * The `note`/`thump` helpers are deliberate near-duplicates of the two in
 * `./audio.ts`. That file does not export them and is owned by the slots work;
 * copying ~35 lines is the cheaper mistake than reaching across and widening
 * another game's public surface to get at them.
 */
import { getAudioCtx } from "../../../utils/audio-manager";

function ctx(): AudioContext | null {
  try {
    const c = getAudioCtx();
    if (!c) return null;
    if (c.state === "suspended") c.resume();
    return c;
  } catch {
    return null;
  }
}

function note(
  c: AudioContext,
  opts: { type: OscillatorType; at: number; dur: number; freq: number; to?: number; gain: number; detune?: number },
): void {
  const t = c.currentTime + opts.at;
  const osc = c.createOscillator();
  osc.type = opts.type;
  if (opts.detune) osc.detune.setValueAtTime(opts.detune, t);
  osc.frequency.setValueAtTime(opts.freq, t);
  if (opts.to !== undefined) osc.frequency.exponentialRampToValueAtTime(Math.max(1, opts.to), t + opts.dur);
  const g = c.createGain();
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(opts.gain, t + 0.006);
  g.gain.exponentialRampToValueAtTime(0.0008, t + opts.dur);
  osc.connect(g);
  g.connect(c.destination);
  osc.start(t);
  osc.stop(t + opts.dur + 0.02);
  osc.onended = () => {
    osc.disconnect();
    g.disconnect();
  };
}

function thump(
  c: AudioContext,
  opts: { at: number; dur: number; gain: number; filter: BiquadFilterType; freq: number; q?: number; curve?: number },
): void {
  const t = c.currentTime + opts.at;
  const len = Math.max(1, Math.floor(c.sampleRate * opts.dur));
  const buf = c.createBuffer(1, len, c.sampleRate);
  const d = buf.getChannelData(0);
  const curve = opts.curve ?? 1;
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len) ** curve;
  const src = c.createBufferSource();
  src.buffer = buf;
  const f = c.createBiquadFilter();
  f.type = opts.filter;
  f.frequency.value = opts.freq;
  if (opts.q !== undefined) f.Q.value = opts.q;
  const g = c.createGain();
  g.gain.setValueAtTime(opts.gain, t);
  g.gain.exponentialRampToValueAtTime(0.0008, t + opts.dur);
  src.connect(f);
  f.connect(g);
  g.connect(c.destination);
  src.start(t);
  src.onended = () => {
    src.disconnect();
    f.disconnect();
    g.disconnect();
  };
}

/**
 * THE RETICLE TICK — the metronome, and the quietest thing in the casino.
 *
 * It fires up to ~60 times a throw, so it has to survive that repetition: any
 * tone at all becomes a drone, and any real volume becomes torture. Hence a 12ms
 * bandpassed click at gain 0.02 and nothing else. Pitched a fifth apart between
 * the two stages so the player can hear WHICH axis is live without looking —
 * "still aiming" and "about to throw" are different sounds.
 */
export function sfxReticleTick(stage: "x" | "y"): void {
  const c = ctx();
  if (!c) return;
  try {
    thump(c, { at: 0, dur: 0.012, gain: 0.02, filter: "bandpass", freq: stage === "x" ? 2100 : 3150, q: 6, curve: 3 });
  } catch {
    // fail-silent
  }
}

/** X LOCKED — a firm mechanical catch. Half of a commit, so it half-resolves. */
export function sfxLockAxis(): void {
  const c = ctx();
  if (!c) return;
  try {
    thump(c, { at: 0, dur: 0.05, gain: 0.055, filter: "bandpass", freq: 1500, q: 2, curve: 2.2 });
    note(c, { type: "square", at: 0, dur: 0.07, freq: 420, to: 300, gain: 0.03 });
  } catch {
    // fail-silent
  }
}

/**
 * THE RELEASE — the arm, not the impact.
 *
 * A short downward-swept band of noise: air moving past a thrown object. It has
 * to be over well before the dart lands, or it smears into the thud and the
 * throw loses its two-part shape.
 */
export function sfxThrow(): void {
  const c = ctx();
  if (!c) return;
  try {
    const t = c.currentTime;
    const dur = 0.16;
    const len = Math.floor(c.sampleRate * dur);
    const buf = c.createBuffer(1, len, c.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len) ** 0.5;
    const src = c.createBufferSource();
    src.buffer = buf;
    const bp = c.createBiquadFilter();
    bp.type = "bandpass";
    bp.Q.value = 1.1;
    // Sweeping DOWN, which is the cue that reads as "away from you".
    bp.frequency.setValueAtTime(2600, t);
    bp.frequency.exponentialRampToValueAtTime(700, t + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0008, t);
    g.gain.linearRampToValueAtTime(0.05, t + 0.03);
    g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
    src.connect(bp);
    bp.connect(g);
    g.connect(c.destination);
    src.start(t);
    src.onended = () => {
      src.disconnect();
      bp.disconnect();
      g.disconnect();
    };
  } catch {
    // fail-silent
  }
}

export type StickKind = "board" | "wire" | "miss";

/**
 * THE DART LANDING — three different events, because they mean different things.
 *
 * · board — sisal. A dry chuff plus a short woody knock with a pitched body.
 *   Satisfying, and the one the player should want to hear.
 * · wire  — a bright metallic ping over the knock. Reads as "that was close",
 *   which is exactly what clipping a wire is.
 * · miss  — no chuff at all, because nothing absorbed it: a hollow board-behind
 *   -the-board clatter and a descending tail. Deliberately the worst sound in
 *   the file, and the only cue with an obvious sag to it.
 */
export function sfxStick(kind: StickKind): void {
  const c = ctx();
  if (!c) return;
  try {
    if (kind === "miss") {
      thump(c, { at: 0, dur: 0.09, gain: 0.05, filter: "lowpass", freq: 420, curve: 1.4 });
      note(c, { type: "triangle", at: 0, dur: 0.22, freq: 150, to: 62, gain: 0.045 });
      thump(c, { at: 0.07, dur: 0.06, gain: 0.025, filter: "bandpass", freq: 800, q: 1.2, curve: 2 });
      return;
    }

    // The sisal absorbing it — short, dry, no ring.
    thump(c, { at: 0, dur: 0.045, gain: 0.05, filter: "bandpass", freq: 1750, q: 0.9, curve: 2.6 });
    // The body: a woody knock that gives the hit its weight.
    note(c, { type: "triangle", at: 0, dur: 0.1, freq: 320, to: 128, gain: 0.055 });
    // A trace of steel, so it is a metal point and not a fist.
    thump(c, { at: 0.004, dur: 0.03, gain: 0.022, filter: "highpass", freq: 4200, curve: 3 });

    if (kind === "wire") {
      // The ping. Two close partials so it beats slightly and sounds like wire.
      note(c, { type: "sine", at: 0.006, dur: 0.3, freq: 2760, gain: 0.03 });
      note(c, { type: "sine", at: 0.006, dur: 0.26, freq: 2810, gain: 0.022 });
      note(c, { type: "sine", at: 0.006, dur: 0.18, freq: 4150, gain: 0.012 });
    }
  } catch {
    // fail-silent
  }
}

/**
 * BULLSEYE — the only fanfare darts gets, and it is short on purpose.
 *
 * A bull is 50 and does not win the round by itself, so this cannot be a
 * jackpot jingle: it has to fit inside the gap before the next dart arms
 * (FLIGHT + the aim ramp) or it will still be playing over the next throw's
 * ticks and fight the metronome the player is steering by.
 */
export function sfxBullseye(): void {
  const c = ctx();
  if (!c) return;
  try {
    const run = [784, 1047, 1319, 1568]; // G5 C6 E6 G6
    run.forEach((f, i) => {
      note(c, { type: "square", at: i * 0.055, dur: 0.12, freq: f, gain: 0.036 });
      note(c, { type: "triangle", at: i * 0.055, dur: 0.16, freq: f / 2, gain: 0.022 });
    });
    // A ringing top note to land on, detuned into a small shimmer.
    note(c, { type: "square", at: 0.22, dur: 0.42, freq: 2093, gain: 0.026 });
    note(c, { type: "square", at: 0.22, dur: 0.42, freq: 2093, gain: 0.018, detune: 12 });
  } catch {
    // fail-silent
  }
}

/**
 * THE ROUND SETTLING — one cue, shaped by the multiplier.
 *
 * Rising and bright when the round paid, a short comic sag when it did not.
 * Same reasoning as the slot machine's loss motif: darts is played six times a
 * visit and a harsh buzzer on the losing rounds would make the board unpleasant
 * to stand at long before the visit limit did.
 */
export function sfxRoundEnd(mult: number): void {
  const c = ctx();
  if (!c) return;
  try {
    if (mult <= 0) {
      note(c, { type: "square", at: 0, dur: 0.18, freq: 300, to: 262, gain: 0.03 });
      note(c, { type: "triangle", at: 0.16, dur: 0.34, freq: 208, to: 110, gain: 0.03 });
      return;
    }
    if (mult <= 1) {
      // A push. Level, unresolved — you got your money back, nothing happened.
      note(c, { type: "triangle", at: 0, dur: 0.14, freq: 523, gain: 0.032 });
      note(c, { type: "triangle", at: 0.12, dur: 0.2, freq: 523, gain: 0.028 });
      return;
    }
    // A win, and the better the band the further the figure climbs.
    const steps = mult >= 2 ? [523, 659, 784, 1047, 1319] : mult >= 1.5 ? [523, 659, 784, 1047] : [523, 659, 784];
    steps.forEach((f, i) => {
      note(c, { type: "square", at: i * 0.07, dur: 0.15, freq: f, gain: 0.034 });
      note(c, { type: "triangle", at: i * 0.07, dur: 0.19, freq: f * 2, gain: 0.014 });
    });
  } catch {
    // fail-silent
  }
}
