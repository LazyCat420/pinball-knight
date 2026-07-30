/**
 * SLOT MACHINE SOUND. Procedural, like everything else in this game — there are
 * no audio files anywhere in the repo and there is not going to be one.
 *
 * The sound design here is doing a specific job. A slot machine's whole appeal
 * is a fixed rhythm: COMMIT (lever), TENSION (whir), and then three separate
 * RESOLUTIONS (chunk, chunk, chunk) with a widening gap between them. The
 * payout is decided before the first frame of animation — see `slots-game.ts` —
 * so the audio is the only thing actually generating suspense, and it earns
 * that by being a *sequence* rather than a texture.
 *
 * Hence the details that look fussy:
 *   · each reel stop is pitched a step higher than the last, so three identical
 *     mechanical events read as a countdown rather than a stutter;
 *   · the near-miss riser is the longest cue in the file, because the 0.7s
 *     between the second and third reel landing is the emotional core of the
 *     entire game and silence there wastes it;
 *   · the loss motif is a deliberate comic "wah wah" instead of a harsh buzz.
 *     Losing is the common case; punishing it makes the machine unpleasant to
 *     sit at, and the machine needs you to sit at it.
 *
 * House rules, matched to `../audio.ts`: context via `getAudioCtx()`, resume if
 * suspended, EVERYTHING wrapped so audio can never break the game, nodes
 * disconnected in `onended`, gains kept in the 0.02–0.09 band. Nothing here
 * returns a success flag, because a browser that hasn't seen a user gesture yet
 * will legitimately produce silence and that is not an error.
 *
 * NB: there is no global SFX mute or master gain in `utils/audio-manager.ts` to
 * route through — the only volume control in the codebase belongs to the
 * YouTube intro-music player. Every gain below is therefore absolute, and
 * chosen to sit under the tavern's room tone rather than over it.
 */
import { sfxCtx as ctx, sfxDestination } from "../../../utils/audio-manager";

/**
 * Schedule one note and clean it up after itself.
 *
 * Every cue below is a handful of these. Written as a helper because the
 * disconnect-in-onended bookkeeping is the part that gets forgotten, and a slot
 * machine can be played dozens of times per visit — leaked nodes here would
 * accumulate faster than anywhere else in the game.
 */
function note(
  c: AudioContext,
  opts: {
    type: OscillatorType;
    /** Start, in seconds from now. */
    at: number;
    dur: number;
    freq: number;
    /** Optional glide target by the end of the note. */
    to?: number;
    gain: number;
    /** Cents. Two notes a few cents apart is what makes a lead sound wobbly. */
    detune?: number;
  },
): void {
  const t = c.currentTime + opts.at;
  const osc = c.createOscillator();
  osc.type = opts.type;
  if (opts.detune) osc.detune.setValueAtTime(opts.detune, t);
  osc.frequency.setValueAtTime(opts.freq, t);
  if (opts.to !== undefined) osc.frequency.exponentialRampToValueAtTime(Math.max(1, opts.to), t + opts.dur);
  const g = c.createGain();
  // Attack off zero rather than straight to full: a square wave snapped on at
  // full amplitude clicks, and a click on every note reads as a broken speaker.
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

/** A one-shot noise burst through a filter — the body of every mechanical hit. */
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

/**
 * THE COMMIT — a heavy lever thrown, then the spring dragging it back.
 *
 * Two events, not one: a dead low clunk (the mechanism catching) followed by a
 * rising twang (the return spring). The gap between them is what makes it feel
 * like a lever rather than a button, and the button is what the player actually
 * pressed — so the sound is carrying the whole "one-armed bandit" fiction.
 */
export function sfxLeverPull(): void {
  const c = ctx();
  if (!c) return;
  try {
    // The throw: metal sliding, low and gritty.
    thump(c, { at: 0, dur: 0.14, gain: 0.075, filter: "lowpass", freq: 700, curve: 0.6 });
    note(c, { type: "sine", at: 0, dur: 0.16, freq: 150, to: 55, gain: 0.08 });

    // The catch: a hard, short click at the end of travel.
    thump(c, { at: 0.13, dur: 0.05, gain: 0.06, filter: "bandpass", freq: 2400, q: 1.4, curve: 2 });

    // The spring: a twang that rises as the tension comes off.
    note(c, { type: "sawtooth", at: 0.15, dur: 0.28, freq: 190, to: 520, gain: 0.035 });
    note(c, { type: "sawtooth", at: 0.15, dur: 0.28, freq: 190, to: 520, gain: 0.02, detune: 14 });
  } catch {
    // fail-silent
  }
}

/** Handle for the spin bed, so the caller can stop it when the reels do. */
export interface ReelSpin {
  stop(): void;
}

/**
 * THE TENSION — drum whir plus the tick of the reel passing its stops.
 *
 * A looped noise bed alone sounds like a fan. What makes it a *reel* is the
 * periodic tick, so there is a square LFO chopping a band-passed layer at reel
 * speed on top of the smooth bed. Safe to stop twice; the second call no-ops.
 */
export function sfxReelSpin(): ReelSpin {
  const dead: ReelSpin = { stop: () => {} };
  const c = ctx();
  if (!c) return dead;
  try {
    const t = c.currentTime;

    // ── Bed ── half a second of noise, looped, band-passed into a drum whir.
    const len = Math.floor(c.sampleRate * 0.5);
    const buf = c.createBuffer(1, len, c.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) {
      // Brownish rather than white: integrating tilts the spectrum down, which
      // is much closer to a spinning drum than flat hiss.
      d[i] = (d[i - 1] ?? 0) * 0.94 + (Math.random() * 2 - 1) * 0.1;
    }
    const src = c.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    const bp = c.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = 900;
    bp.Q.value = 0.7;
    const bedGain = c.createGain();
    bedGain.gain.setValueAtTime(0, t);
    bedGain.gain.linearRampToValueAtTime(0.03, t + 0.08);
    src.connect(bp);
    bp.connect(bedGain);
    bedGain.connect(sfxDestination(c));

    // ── Tick ── a square LFO gating a buzz, so you hear individual stops go by.
    const buzz = c.createOscillator();
    buzz.type = "sawtooth";
    buzz.frequency.setValueAtTime(78, t);
    const tickGain = c.createGain();
    tickGain.gain.setValueAtTime(0.014, t);
    const lfo = c.createOscillator();
    lfo.type = "square";
    lfo.frequency.setValueAtTime(19, t); // ≈ the reel's symbols-per-second
    const lfoDepth = c.createGain();
    lfoDepth.gain.setValueAtTime(0.012, t);
    lfo.connect(lfoDepth);
    lfoDepth.connect(tickGain.gain);
    buzz.connect(tickGain);
    tickGain.connect(sfxDestination(c));

    src.start(t);
    buzz.start(t);
    lfo.start(t);

    let stopped = false;
    return {
      stop(): void {
        if (stopped) return;
        stopped = true;
        try {
          const now = c.currentTime;
          bedGain.gain.cancelScheduledValues(now);
          bedGain.gain.setValueAtTime(bedGain.gain.value, now);
          bedGain.gain.linearRampToValueAtTime(0, now + 0.07);
          tickGain.gain.cancelScheduledValues(now);
          tickGain.gain.setValueAtTime(0.014, now);
          tickGain.gain.linearRampToValueAtTime(0, now + 0.07);
          // Stop AFTER the fade or the tail is a click.
          const end = now + 0.09;
          src.stop(end);
          buzz.stop(end);
          lfo.stop(end);
          src.onended = () => {
            src.disconnect();
            bp.disconnect();
            bedGain.disconnect();
          };
          buzz.onended = () => {
            buzz.disconnect();
            tickGain.disconnect();
          };
          lfo.onended = () => {
            lfo.disconnect();
            lfoDepth.disconnect();
          };
        } catch {
          // a bed that won't stop is not worth throwing over
        }
      },
    };
  } catch {
    return dead;
  }
}

/** Semitone-ish multipliers per reel — reel 3 lands highest, so it reads last. */
const STOP_PITCH = [1, 1.19, 1.42];

/**
 * A REEL LANDING — a solid mechanical CHUNK.
 *
 * Pitched up per reel on purpose. Three identical impacts read as one stuttery
 * noise; a rising three-note figure reads as "one… two… three" and tells the
 * player without any UI where they are in the spin.
 */
export function sfxReelStop(index: number): void {
  const c = ctx();
  if (!c) return;
  try {
    const k = STOP_PITCH[Math.min(STOP_PITCH.length - 1, Math.max(0, index | 0))];
    // The impact body.
    note(c, { type: "sine", at: 0, dur: 0.12, freq: 165 * k, to: 62 * k, gain: 0.085 });
    // The mechanism: a short, hard, dry rattle with no ring.
    thump(c, { at: 0, dur: 0.06, gain: 0.055, filter: "lowpass", freq: 1500 * k, curve: 2 });
    // A little metal on top so it's a machine and not a footstep.
    thump(c, { at: 0.005, dur: 0.04, gain: 0.03, filter: "bandpass", freq: 3000 * k, q: 3, curve: 2.5 });
  } catch {
    // fail-silent
  }
}

/**
 * THE NEAR MISS — two reels matched and the third is still turning.
 *
 * The longest and most deliberate cue in the file. It has to do three things at
 * once: rise (so it feels unresolved), get louder (so it feels like it's coming
 * toward you), and beat faster (so it feels like a countdown). Detuned pairs
 * give it the wobble; the tremolo LFO speeds up across the cue.
 *
 * Timed at ~0.72s to land just as the third reel stops — see STOP_AT in
 * `slots-game.ts`. If that gap changes, this should follow it, because a riser
 * that resolves early is worse than no riser at all.
 */
export function sfxNearMiss(): void {
  const c = ctx();
  if (!c) return;
  try {
    const t = c.currentTime;
    const dur = 0.72;

    const out = c.createGain();
    out.gain.setValueAtTime(0.0008, t);
    out.gain.exponentialRampToValueAtTime(0.055, t + dur * 0.85);
    out.gain.exponentialRampToValueAtTime(0.0008, t + dur);
    out.connect(sfxDestination(c));

    // Tremolo, accelerating — the "heartbeat" under the rise.
    const trem = c.createGain();
    trem.gain.setValueAtTime(0.7, t);
    const lfo = c.createOscillator();
    lfo.type = "sine";
    lfo.frequency.setValueAtTime(5, t);
    lfo.frequency.linearRampToValueAtTime(16, t + dur);
    const lfoDepth = c.createGain();
    lfoDepth.gain.setValueAtTime(0.3, t);
    lfo.connect(lfoDepth);
    lfoDepth.connect(trem.gain);
    trem.connect(out);

    // Two saws a few cents apart, sweeping up nearly two octaves.
    const oscs: OscillatorNode[] = [];
    for (const cents of [-9, 9]) {
      const o = c.createOscillator();
      o.type = "sawtooth";
      o.detune.setValueAtTime(cents, t);
      o.frequency.setValueAtTime(230, t);
      o.frequency.exponentialRampToValueAtTime(780, t + dur);
      o.connect(trem);
      oscs.push(o);
    }

    lfo.start(t);
    for (const o of oscs) o.start(t);
    lfo.stop(t + dur + 0.03);
    for (const o of oscs) o.stop(t + dur + 0.03);

    oscs[0].onended = () => {
      for (const o of oscs) o.disconnect();
      trem.disconnect();
      out.disconnect();
    };
    lfo.onended = () => {
      lfo.disconnect();
      lfoDepth.disconnect();
    };
  } catch {
    // fail-silent
  }
}

/** A small win — a bright three-note coin chime. Short, so it never overstays. */
export function sfxWinSmall(): void {
  const c = ctx();
  if (!c) return;
  try {
    const seq = [784, 988, 1319]; // G5 B5 E6
    seq.forEach((f, i) => {
      note(c, { type: "triangle", at: i * 0.06, dur: 0.16, freq: f, gain: 0.05 });
      // A square an octave up, quiet, for the metallic coin edge.
      note(c, { type: "square", at: i * 0.06, dur: 0.09, freq: f * 2, gain: 0.014 });
    });
  } catch {
    // fail-silent
  }
}

/**
 * THE JACKPOT JINGLE — and it is meant to be a bit stupid.
 *
 * An arpeggio up the major triad, then a held top note played by two squares
 * nine cents apart with a slow vibrato, which is the cheapest possible way to
 * make a lead sound drunk and pleased with itself. A bouncing bass line
 * underneath and a final flourish. Under 1.6s: a jingle you cannot skip is only
 * charming the first three times, and this machine gets played a lot.
 */
export function sfxJackpotJingle(): void {
  const c = ctx();
  if (!c) return;
  try {
    // ── The run up ── C5 E5 G5 C6 E6 G6, fast and cheerful.
    const run = [523, 659, 784, 1047, 1319, 1568];
    run.forEach((f, i) => {
      note(c, { type: "square", at: i * 0.075, dur: 0.13, freq: f, gain: 0.035 });
    });

    // ── The bass ── a daft oom-pah under it.
    [131, 196, 131, 196].forEach((f, i) => {
      note(c, { type: "square", at: i * 0.11, dur: 0.1, freq: f, gain: 0.03 });
    });

    // ── The held top note ── two detuned squares, wobbling.
    const t = c.currentTime + 0.46;
    const out = c.createGain();
    out.gain.setValueAtTime(0, t);
    out.gain.linearRampToValueAtTime(0.045, t + 0.02);
    out.gain.setValueAtTime(0.045, t + 0.6);
    out.gain.exponentialRampToValueAtTime(0.0008, t + 0.86);
    out.connect(sfxDestination(c));

    const vib = c.createOscillator();
    vib.type = "sine";
    vib.frequency.setValueAtTime(7.5, t);
    const vibDepth = c.createGain();
    vibDepth.gain.setValueAtTime(26, t); // cents-ish, applied to frequency in Hz
    vib.connect(vibDepth);

    const leads: OscillatorNode[] = [];
    for (const cents of [-9, 11]) {
      const o = c.createOscillator();
      o.type = "square";
      o.detune.setValueAtTime(cents, t);
      o.frequency.setValueAtTime(1047, t);
      vibDepth.connect(o.frequency);
      o.connect(out);
      leads.push(o);
    }

    vib.start(t);
    for (const o of leads) o.start(t);
    vib.stop(t + 0.9);
    for (const o of leads) o.stop(t + 0.9);
    leads[0].onended = () => {
      for (const o of leads) o.disconnect();
      out.disconnect();
    };
    vib.onended = () => {
      vib.disconnect();
      vibDepth.disconnect();
    };

    // ── The flourish ── a cheeky little tag on the end.
    [1568, 1319, 1047, 2093].forEach((f, i) => {
      note(c, { type: "square", at: 1.16 + i * 0.08, dur: i === 3 ? 0.3 : 0.09, freq: f, gain: 0.03 });
    });
  } catch {
    // fail-silent
  }
}

/**
 * A LOSS — the deflating "wah wah".
 *
 * Comic rather than punitive, and quiet. Losing is by far the most common
 * outcome (RTP is ~90%, and most spins return nothing at all), so this cue is
 * the one the player hears most. A harsh buzzer here would make the machine
 * genuinely unpleasant to sit at within about six spins.
 */
export function sfxLose(): void {
  const c = ctx();
  if (!c) return;
  try {
    // Two sagging notes, each bending down as it dies.
    note(c, { type: "square", at: 0, dur: 0.2, freq: 330, to: 294, gain: 0.032 });
    note(c, { type: "square", at: 0.18, dur: 0.34, freq: 262, to: 175, gain: 0.032 });
    // A soft low sigh under the second one so it lands rather than just stops.
    note(c, { type: "triangle", at: 0.18, dur: 0.4, freq: 131, to: 88, gain: 0.028 });
  } catch {
    // fail-silent
  }
}
