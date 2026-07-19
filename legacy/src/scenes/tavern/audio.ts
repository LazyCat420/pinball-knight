/**
 * Tavern sound. Procedural, like the rest of the game's audio — no files.
 *
 * The dungeon's `audio.ts` is all one-shot combat stingers; the tavern needs the
 * opposite: a continuous bed that says "you are somewhere safe and occupied",
 * plus a couple of one-shots tied to what you can see happening.
 *
 * The bed is a filtered noise loop (hearth roar) with a low hum under it
 * (machinery through the walls). Both fade in and out, because a room tone that
 * starts or stops abruptly is more noticeable than one that was never there.
 *
 * Fail-silent throughout: audio must never be able to break the room.
 */
import { getAudioCtx } from "../../utils/audio-manager";

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

interface Bed {
  stop(): void;
}

let bed: Bed | null = null;

/** Seconds to fade the room tone up on entry and down on exit. */
const FADE = 1.2;

/**
 * Start the tavern's room tone. Safe to call twice; the second call is a no-op.
 *
 * Browsers block audio until a user gesture, so this can legitimately produce
 * nothing on the first visit — hence no error path, and hence the caller never
 * checks a return value.
 */
export function startTavernAmbience(): void {
  if (bed) return;
  const c = ctx();
  if (!c) return;

  try {
    // ── Hearth ── two seconds of noise, looped, low-passed into a fire roar.
    const len = Math.floor(c.sampleRate * 2);
    const buf = c.createBuffer(1, len, c.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) {
      // Brownish noise: integrating white noise tilts the spectrum down, which
      // is much closer to a fire than flat white hiss.
      data[i] = (data[i - 1] ?? 0) * 0.96 + (Math.random() * 2 - 1) * 0.08;
    }
    const fire = c.createBufferSource();
    fire.buffer = buf;
    fire.loop = true;

    const fireFilter = c.createBiquadFilter();
    fireFilter.type = "lowpass";
    fireFilter.frequency.value = 420;

    const fireGain = c.createGain();
    fireGain.gain.setValueAtTime(0, c.currentTime);
    fireGain.gain.linearRampToValueAtTime(0.05, c.currentTime + FADE);

    // A slow wobble on the cutoff so the fire breathes instead of sitting flat.
    const lfo = c.createOscillator();
    lfo.type = "sine";
    lfo.frequency.value = 0.23;
    const lfoGain = c.createGain();
    lfoGain.gain.value = 120;
    lfo.connect(lfoGain);
    lfoGain.connect(fireFilter.frequency);

    fire.connect(fireFilter);
    fireFilter.connect(fireGain);
    fireGain.connect(c.destination);

    // ── Machinery ── a low hum, the dungeon running somewhere below.
    const hum = c.createOscillator();
    hum.type = "sine";
    hum.frequency.value = 54;
    const humGain = c.createGain();
    humGain.gain.setValueAtTime(0, c.currentTime);
    humGain.gain.linearRampToValueAtTime(0.022, c.currentTime + FADE);
    hum.connect(humGain);
    humGain.connect(c.destination);

    fire.start();
    lfo.start();
    hum.start();

    bed = {
      stop(): void {
        const t = c.currentTime;
        fireGain.gain.cancelScheduledValues(t);
        humGain.gain.cancelScheduledValues(t);
        fireGain.gain.setValueAtTime(fireGain.gain.value, t);
        humGain.gain.setValueAtTime(humGain.gain.value, t);
        fireGain.gain.linearRampToValueAtTime(0, t + FADE * 0.5);
        humGain.gain.linearRampToValueAtTime(0, t + FADE * 0.5);
        // Stop AFTER the fade, or the tail is a click.
        const end = t + FADE * 0.5 + 0.05;
        fire.stop(end);
        lfo.stop(end);
        hum.stop(end);
        fire.onended = () => {
          fire.disconnect();
          fireFilter.disconnect();
          fireGain.disconnect();
        };
        hum.onended = () => {
          hum.disconnect();
          humGain.disconnect();
        };
      },
    };
  } catch {
    bed = null;
  }
}

export function stopTavernAmbience(): void {
  try {
    bed?.stop();
  } catch {
    // a bed that won't stop is not worth throwing over
  }
  bed = null;
}

/** The smith's hammer landing — a bright metal ping over a dull thud. */
export function sfxAnvil(): void {
  const c = ctx();
  if (!c) return;
  try {
    const t = c.currentTime;

    // The strike: a short noise burst, band-passed high, for the "tink".
    const len = Math.floor(c.sampleRate * 0.18);
    const buf = c.createBuffer(1, len, c.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = c.createBufferSource();
    src.buffer = buf;
    const bp = c.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = 3200;
    bp.Q.value = 2.5;
    const g = c.createGain();
    g.gain.setValueAtTime(0.09, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.18);
    src.connect(bp);
    bp.connect(g);
    g.connect(c.destination);
    src.start(t);
    src.onended = () => {
      src.disconnect();
      bp.disconnect();
      g.disconnect();
    };

    // The ring: a decaying tone a beat under the strike.
    const osc = c.createOscillator();
    osc.type = "triangle";
    osc.frequency.setValueAtTime(880, t);
    osc.frequency.exponentialRampToValueAtTime(620, t + 0.3);
    const og = c.createGain();
    og.gain.setValueAtTime(0, t);
    og.gain.linearRampToValueAtTime(0.05, t + 0.006);
    og.gain.exponentialRampToValueAtTime(0.001, t + 0.34);
    osc.connect(og);
    og.connect(c.destination);
    osc.start(t);
    osc.stop(t + 0.36);
    osc.onended = () => {
      osc.disconnect();
      og.disconnect();
    };
  } catch {
    // fail-silent
  }
}

/** Stepping into a station's radius — a soft, non-intrusive confirm. */
export function sfxStationFocus(): void {
  const c = ctx();
  if (!c) return;
  try {
    const t = c.currentTime;
    const osc = c.createOscillator();
    osc.type = "sine";
    osc.frequency.setValueAtTime(520, t);
    osc.frequency.exponentialRampToValueAtTime(780, t + 0.09);
    const g = c.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.035, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.14);
    osc.connect(g);
    g.connect(c.destination);
    osc.start(t);
    osc.stop(t + 0.16);
    osc.onended = () => {
      osc.disconnect();
      g.disconnect();
    };
  } catch {
    // fail-silent
  }
}

/** Pulling the plunger — the descent. A wind-up, then release. */
export function sfxPlunger(): void {
  const c = ctx();
  if (!c) return;
  try {
    const t = c.currentTime;
    const osc = c.createOscillator();
    osc.type = "sawtooth";
    osc.frequency.setValueAtTime(180, t);
    osc.frequency.exponentialRampToValueAtTime(70, t + 0.22);
    osc.frequency.exponentialRampToValueAtTime(900, t + 0.42);
    const g = c.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.07, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.5);
    osc.connect(g);
    g.connect(c.destination);
    osc.start(t);
    osc.stop(t + 0.52);
    osc.onended = () => {
      osc.disconnect();
      g.disconnect();
    };
  } catch {
    // fail-silent
  }
}
