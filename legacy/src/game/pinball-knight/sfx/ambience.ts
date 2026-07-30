/**
 * SUSTAINED SOUND — the first thing in this game that does not end by itself.
 *
 * Every other sting is a one-shot: it schedules an envelope, hands the nodes to
 * the clock and forgets them. A burning puddle is not that. It is a STATE, it
 * lasts as long as the fire does, and its sound has to start, follow the fire's
 * strength, and stop — three moments a one-shot never has.
 *
 * ── POLL-DRIVEN, WITH A DEAD-MAN'S SWITCH ────────────────────────────────────
 * `ambience(id, level)` is called EVERY FRAME while a source is alive, and each
 * call re-arms a fade to silence a fraction of a second in the future. Refresh
 * it and the fade is pushed forward and never happens; stop calling and the
 * voice dies on its own, ON THE AUDIO CLOCK.
 *
 * That last part is the whole design, and it is why there is no stop() to call
 * and no reaper to run. Everything that could otherwise strand a live loop —
 * floor descent, death, the pause menu, `dispose()`, a thrown exception in the
 * middle of the sim, and above all a HIDDEN TAB, where rAF stops but the audio
 * context keeps running — is the same event from here: nothing refreshed, so the
 * ramp that was already scheduled runs and the voice goes quiet. A design that
 * needed a `stopFireLoop()` would need one at every one of those sites, and
 * would leak sound the first time somebody added a seventh.
 *
 * ⚠️ This is exactly why the fade-out is SCHEDULED rather than run by a timer.
 * `utils/audio-manager.ts`'s `stopWaterSound` uses `setTimeout` and is the
 * counter-example this module was written not to be: a JS timer does not fire in
 * a throttled background tab, so the loop it is supposed to stop keeps playing.
 * Anything on `AudioParam` timing keeps its promise while the page is asleep.
 *
 * ── LEVEL IS ACCUMULATED, NOT ASSIGNED ───────────────────────────────────────
 * Six fires in a room are one fire sound, louder — not six voices beating
 * against each other. Callers add their own contribution and the loudest total
 * for the frame wins; `ambience()` is safe to call once per source per frame.
 */
import { bus, safely, type Bus } from "./bus";

/**
 * What can hum. Deliberately short: a bed is only worth having for something
 * that persists and that the player can walk toward.
 *
 * NOT here, and each for a reason: `steam` is an EVENT (the slick-quenches-fire
 * beat), not a state, and already has its puff; `frost` and `tar` are silent in
 * the world they came from; the lightning rod already ticks its own sting on the
 * beat that matters, and a hum under it would just mask that.
 */
export type AmbienceId = "fire" | "water";

/**
 * Seconds of silence after the last refresh before a voice is fully faded.
 *
 * Comfortably longer than a frame at any playable rate (a 20 fps frame is 50 ms)
 * so an ordinary poll never dips the level, and short enough that walking away
 * from a fire is heard as leaving rather than as a bug.
 */
const HOLD = 0.35;
/** Level-follow time. Long enough that a flickering source does not chatter. */
const FOLLOW = 0.12;
/** Fade-in on the first frame of a voice — a bed that snaps on is a click. */
const ATTACK = 0.25;

/**
 * Ceiling on a bed's gain.
 *
 * Beds sit UNDER the game — a sustained sound at sting level is exhausting
 * within a minute, and it masks the stings themselves, which are the sounds
 * carrying information.
 */
const PEAK = 0.09;

interface Voice {
  src: AudioBufferSourceNode;
  gain: GainNode;
  /** The context it belongs to — a node from a replaced context is dead. */
  ctx: AudioContext;
}

const voices = new Map<AmbienceId, Voice>();
let noiseBuf: AudioBuffer | null = null;
let noiseCtx: AudioContext | null = null;

/**
 * Two seconds of brown-ish noise, looped.
 *
 * Integrating white noise tilts the spectrum down, which is far closer to fire
 * and water than flat hiss — the same trick the tavern hearth uses. Built once
 * per context because it is ~90k samples and both beds share it; the filters
 * below are what make them sound different.
 */
function noise(c: AudioContext): AudioBuffer {
  if (noiseBuf && noiseCtx === c) return noiseBuf;
  const len = Math.floor(c.sampleRate * 2);
  const buf = c.createBuffer(1, len, c.sampleRate);
  const d = buf.getChannelData(0);
  let last = 0;
  for (let i = 0; i < len; i++) {
    last = last * 0.96 + (Math.random() * 2 - 1) * 0.08;
    d[i] = last;
  }
  noiseCtx = c;
  noiseBuf = buf;
  return buf;
}

/** The filter chain that turns one noise loop into a named bed. */
function build(b: Bus, id: AmbienceId): Voice | null {
  const c = b.c;
  const src = c.createBufferSource();
  src.buffer = noise(c);
  src.loop = true;

  const gain = c.createGain();
  gain.gain.setValueAtTime(0, c.currentTime);

  if (id === "fire") {
    // A roar with a crackle over it: low-passed body, plus a resonant band that
    // wanders under an LFO so the flame is never quite the same twice.
    const body = c.createBiquadFilter();
    body.type = "lowpass";
    body.frequency.value = 720;
    const crackle = c.createBiquadFilter();
    crackle.type = "bandpass";
    crackle.frequency.value = 2100;
    crackle.Q.value = 0.7;
    const lfo = c.createOscillator();
    lfo.type = "sine";
    lfo.frequency.value = 0.37;
    const lfoAmt = c.createGain();
    lfoAmt.gain.value = 260;
    lfo.connect(lfoAmt).connect(crackle.frequency);
    lfo.start();
    src.connect(body).connect(crackle).connect(gain);
  } else {
    // Water: a narrower band, lower, with a slow swell on the LEVEL rather than
    // the frequency — lapping, not a filter sweep.
    const band = c.createBiquadFilter();
    band.type = "bandpass";
    band.frequency.value = 1150;
    band.Q.value = 0.55;
    src.connect(band).connect(gain);
  }

  gain.connect(b.out);
  src.start();
  return { src, gain, ctx: c };
}

/**
 * Sound this bed at `level` (0..1) for one frame. Call every frame it is alive.
 *
 * Fail-silent and gate-respecting: `bus()` returns null when this game is muted,
 * when the app is globally silenced, or at volume 0 — BEFORE any node is built —
 * so a muted run never allocates a loop it will have to remember to stop.
 */
export function ambience(id: AmbienceId, level: number): void {
  safely(() => {
    const lvl = Math.max(0, Math.min(1, level));
    const b = bus("ambience");
    if (!b) {
      // Muted mid-loop: the scheduled fade already silenced anything live, but
      // the nodes must not survive to be re-used against a stale gate.
      if (voices.size) stopAll();
      return;
    }
    let v = voices.get(id);
    // A GainNode belongs to ONE AudioContext. If the context was replaced, the
    // cached voice is inert and reconnecting it throws.
    if (v && v.ctx !== b.c) {
      voices.delete(id);
      v = undefined;
    }
    if (!v) {
      if (lvl <= 0) return; // nothing to start
      const made = build(b, id);
      if (!made) return;
      voices.set(id, made);
      v = made;
    }
    const t = v.ctx.currentTime;
    const g = v.gain.gain;
    // Cancel first: last frame left a ramp-to-zero scheduled, and adding on top
    // of it would fight it instead of replacing it.
    g.cancelScheduledValues(t);
    g.setValueAtTime(g.value, t);
    g.linearRampToValueAtTime(lvl * PEAK, t + (g.value < 0.0005 ? ATTACK : FOLLOW));
    // ── THE DEAD-MAN'S SWITCH ──
    // Re-armed every frame and therefore never reached while the source lives.
    // This single line is what makes descent, death, pause, teardown and a
    // hidden tab all safe without a hook in any of them.
    g.linearRampToValueAtTime(0, t + HOLD);
  });
}

function stopAll(): void {
  for (const v of voices.values()) {
    try {
      v.src.stop();
      v.src.disconnect();
      v.gain.disconnect();
    } catch {
      // A node from a dead context throws on stop; nothing to do about it.
    }
  }
  voices.clear();
}

/**
 * Drop every bed immediately. Floor teardown and test determinism ONLY.
 *
 * Not part of the normal lifecycle: the scheduled fade is what stops a bed in
 * play, and adding stop calls to gameplay paths is how the loop that "somebody
 * forgot to stop" gets born. See the header.
 */
export function resetAmbience(): void {
  stopAll();
  noiseBuf = null;
  noiseCtx = null;
}

/** Live bed count. For tests and the debug readout — not a control. */
export function ambienceVoices(): number {
  return voices.size;
}
