/**
 * ROULETTE SOUND — procedural, no files, fail-silent.
 *
 * House rules, matched to `./audio.ts` and `../audio.ts`: context via
 * `getAudioCtx()`, resumed if suspended, EVERY cue wrapped so audio can never
 * break the game, every node disconnected in `onended`, gains kept in the
 * 0.02-0.09 band so this sits under the tavern's room tone rather than over it.
 * Nothing returns a success flag, because a browser that has not seen a user
 * gesture yet will legitimately produce silence and that is not an error.
 *
 * `note` and `thump` are deliberately duplicated from `./audio.ts` rather than
 * exported from it: that file belongs to the slot machine and is being worked
 * on separately, and a shared private helper hoisted across two games is how
 * one game's tuning silently changes the other's.
 *
 * ── What a roulette wheel actually sounds like ──────────────────────────────
 * Three layers, and the middle one is the whole cue:
 *   · the ROTOR, a continuous low bearing hum that barely changes.
 *   · the BALL on the track — not a tone but a RATTLE, a fast periodic tick as
 *     it runs over the track's seam. Its rate is the ball's revolutions per
 *     second, so as the ball slows the tick rate falls, and that falling rate
 *     is how a player at a real table knows the drop is coming without looking.
 *     `RouletteSound.setBall` drives that rate straight from the simulation's
 *     angular velocity, so the sound cannot drift from the picture.
 *   · the impacts: one hard metallic strike on a deflector, then a scatter of
 *     softer, higher clicks across the frets, then the seat.
 */
import { sfxCtx as ctx, sfxDestination } from "../../../utils/audio-manager";

/** Schedule one note and clean it up after itself. */
function note(
  c: AudioContext,
  opts: { type: OscillatorType; at: number; dur: number; freq: number; to?: number; gain: number },
): void {
  const t = c.currentTime + opts.at;
  const osc = c.createOscillator();
  osc.type = opts.type;
  osc.frequency.setValueAtTime(opts.freq, t);
  if (opts.to !== undefined) osc.frequency.exponentialRampToValueAtTime(Math.max(1, opts.to), t + opts.dur);
  const g = c.createGain();
  // Off zero rather than straight to full — a wave snapped on at full
  // amplitude clicks, and a click on every note reads as a broken speaker.
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(opts.gain, t + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0008, t + opts.dur);
  osc.connect(g);
  g.connect(sfxDestination(c));
  osc.start(t);
  osc.stop(t + opts.dur + 0.02);
  osc.onended = () => {
    osc.disconnect();
    g.disconnect();
  };
}

/** A one-shot filtered noise burst — the body of every mechanical hit. */
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
  g.connect(sfxDestination(c));
  src.start(t);
  src.onended = () => {
    src.disconnect();
    f.disconnect();
    g.disconnect();
  };
}

export interface RouletteSound {
  /**
   * Track the live ball.
   *
   * `revs` is revolutions per second (the tick rate) and `energy` is 0..1 for
   * how loud the rattle should be. Safe to call every frame.
   */
  setBall(revs: number, energy: number): void;
  /** Fade everything out. Safe to call twice; the second call no-ops. */
  stop(): void;
}

const DEAD: RouletteSound = { setBall: () => {}, stop: () => {} };

/**
 * The wheel bed: rotor hum plus the ball's rattle on the track.
 *
 * The rattle is a band-passed noise loop gated by a SQUARE LFO whose frequency
 * is the ball's rev rate. A smooth bed on its own is just a fan; the gate is
 * what makes it a ball running over a seam, and slewing the gate frequency down
 * as the ball decays is the deceleration cue.
 */
export function sfxWheelSpin(): RouletteSound {
  const c = ctx();
  if (!c) return DEAD;
  try {
    const t = c.currentTime;

    // ── Rotor hum ── brown noise, low-passed hard. Nearly subliminal.
    const len = Math.floor(c.sampleRate * 0.5);
    const buf = c.createBuffer(1, len, c.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (d[i - 1] ?? 0) * 0.96 + (Math.random() * 2 - 1) * 0.08;
    const hum = c.createBufferSource();
    hum.buffer = buf;
    hum.loop = true;
    const lp = c.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 260;
    const humGain = c.createGain();
    humGain.gain.setValueAtTime(0, t);
    humGain.gain.linearRampToValueAtTime(0.026, t + 0.25);
    hum.connect(lp);
    lp.connect(humGain);
    humGain.connect(sfxDestination(c));

    // ── Ball rattle ── the same noise, band-passed high and chopped by the LFO.
    const rat = c.createBufferSource();
    rat.buffer = buf;
    rat.loop = true;
    const bp = c.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = 2400;
    bp.Q.value = 2.4;
    const ratGain = c.createGain();
    ratGain.gain.setValueAtTime(0, t);
    const lfo = c.createOscillator();
    lfo.type = "square";
    lfo.frequency.setValueAtTime(12, t);
    const lfoDepth = c.createGain();
    lfoDepth.gain.setValueAtTime(0.03, t);
    lfo.connect(lfoDepth);
    lfoDepth.connect(ratGain.gain);
    rat.connect(bp);
    bp.connect(ratGain);
    ratGain.connect(sfxDestination(c));

    hum.start(t);
    rat.start(t);
    lfo.start(t);

    let stopped = false;
    return {
      setBall(revs: number, energy: number): void {
        if (stopped) return;
        try {
          const now = c.currentTime;
          // Ramp rather than set: stepping the gate frequency once per animation
          // frame is audible as a stutter, a short glide is not.
          const f = Math.max(2, Math.min(40, revs * 3));
          lfo.frequency.linearRampToValueAtTime(f, now + 0.05);
          const e = Math.max(0, Math.min(1, energy));
          lfoDepth.gain.linearRampToValueAtTime(0.008 + e * 0.03, now + 0.05);
          bp.frequency.linearRampToValueAtTime(1200 + e * 1800, now + 0.05);
        } catch {
          // a bed that will not follow is still a bed
        }
      },
      stop(): void {
        if (stopped) return;
        stopped = true;
        try {
          const now = c.currentTime;
          for (const g of [humGain, ratGain]) {
            g.gain.cancelScheduledValues(now);
            g.gain.setValueAtTime(g.gain.value, now);
            g.gain.linearRampToValueAtTime(0, now + 0.12);
          }
          lfoDepth.gain.cancelScheduledValues(now);
          lfoDepth.gain.linearRampToValueAtTime(0, now + 0.12);
          // Stop AFTER the fade, or the tail is a click.
          const end = now + 0.15;
          hum.stop(end);
          rat.stop(end);
          lfo.stop(end);
          hum.onended = () => {
            hum.disconnect();
            lp.disconnect();
            humGain.disconnect();
          };
          rat.onended = () => {
            rat.disconnect();
            bp.disconnect();
            ratGain.disconnect();
          };
          lfo.onended = () => {
            lfo.disconnect();
            lfoDepth.disconnect();
          };
        } catch {
          // a bed that will not stop is not worth throwing over
        }
      },
    };
  } catch {
    return DEAD;
  }
}

/** The croupier's launch — a rising whip as the ball is sent round the track. */
export function sfxBallLaunch(): void {
  const c = ctx();
  if (!c) return;
  try {
    thump(c, { at: 0, dur: 0.34, gain: 0.05, filter: "bandpass", freq: 1500, q: 1.1, curve: 0.4 });
    note(c, { type: "triangle", at: 0, dur: 0.3, freq: 220, to: 760, gain: 0.03 });
  } catch {
    // silence is an acceptable outcome
  }
}

/**
 * THE DROP — the ball falling off the track.
 *
 * A falling sweep, which is the opposite contour to the launch on purpose: the
 * two bookend the orbit, and the player learns the shape after one spin.
 */
export function sfxBallDrop(): void {
  const c = ctx();
  if (!c) return;
  try {
    note(c, { type: "triangle", at: 0, dur: 0.26, freq: 620, to: 180, gain: 0.035 });
    thump(c, { at: 0.02, dur: 0.2, gain: 0.04, filter: "lowpass", freq: 900, curve: 1.6 });
  } catch {
    // silence is an acceptable outcome
  }
}

/** A DEFLECTOR strike — hard, metallic, and the loudest thing in the spin. */
export function sfxDeflector(): void {
  const c = ctx();
  if (!c) return;
  try {
    thump(c, { at: 0, dur: 0.09, gain: 0.06, filter: "bandpass", freq: 3200, q: 5, curve: 2.4 });
    note(c, { type: "square", at: 0, dur: 0.07, freq: 1180, to: 700, gain: 0.022 });
  } catch {
    // silence is an acceptable outcome
  }
}

/**
 * A FRET click — the ball crossing a pocket separator.
 *
 * Pitched up slightly with each successive click. The bounces come in a burst
 * and identical clicks smear into one noise; a rising sequence reads as
 * individual events and, more usefully, as the ball running out of room.
 */
export function sfxFret(index: number): void {
  const c = ctx();
  if (!c) return;
  try {
    const k = 1 + Math.min(6, index) * 0.13;
    thump(c, { at: 0, dur: 0.045, gain: 0.035, filter: "bandpass", freq: 2100 * k, q: 7, curve: 3 });
  } catch {
    // silence is an acceptable outcome
  }
}

/** The ball SEATING — a small dull knock, then it is riding round. */
export function sfxSeat(): void {
  const c = ctx();
  if (!c) return;
  try {
    thump(c, { at: 0, dur: 0.1, gain: 0.045, filter: "lowpass", freq: 620, curve: 2 });
    note(c, { type: "sine", at: 0.01, dur: 0.14, freq: 300, to: 190, gain: 0.028 });
  } catch {
    // silence is an acceptable outcome
  }
}

/**
 * A WIN. `multiplier` is the total return, so 2 is even money and 18 is a
 * straight-up — the fanfare grows with it, because paying an 18x the same way
 * as a coin flip wastes the rarest moment the game has.
 */
export function sfxRouletteWin(multiplier: number): void {
  const c = ctx();
  if (!c) return;
  try {
    // Major triad, then the fifth above for anything better than even money.
    const root = 392; // G4
    note(c, { type: "square", at: 0, dur: 0.14, freq: root, gain: 0.03 });
    note(c, { type: "square", at: 0.1, dur: 0.14, freq: root * 1.26, gain: 0.03 });
    note(c, { type: "square", at: 0.2, dur: 0.22, freq: root * 1.5, gain: 0.032 });
    if (multiplier >= 3) note(c, { type: "square", at: 0.32, dur: 0.3, freq: root * 2, gain: 0.034 });
    if (multiplier >= 10) {
      note(c, { type: "square", at: 0.46, dur: 0.42, freq: root * 2.52, gain: 0.036 });
      note(c, { type: "triangle", at: 0.46, dur: 0.5, freq: root * 3, gain: 0.026 });
    }
  } catch {
    // silence is an acceptable outcome
  }
}

/** A LOSS — two notes down, short. Long enough to register, not to punish. */
export function sfxRouletteLose(): void {
  const c = ctx();
  if (!c) return;
  try {
    note(c, { type: "triangle", at: 0, dur: 0.16, freq: 262, gain: 0.026 });
    note(c, { type: "triangle", at: 0.13, dur: 0.28, freq: 196, to: 165, gain: 0.024 });
  } catch {
    // silence is an acceptable outcome
  }
}
