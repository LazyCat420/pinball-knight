/**
 * BLACKJACK SOUND. Procedural, like everything else here — there are no audio
 * files in this repo and there is not going to be one.
 *
 * A different design problem from the slot machine next door. Slots need
 * SUSPENSE, because the outcome is already decided and the audio is the only
 * thing generating drama. Blackjack needs INFORMATION: the player is making a
 * decision, and the sound's job is to tell them what just happened without
 * making them read the screen.
 *
 * So every cue here is short, dry and distinct:
 *   · the deal is a paper skid, not a musical note — it happens up to a dozen
 *     times a hand and anything pitched would turn into a melody;
 *   · the hole-card flip is the one card that gets a *snap*, because it is the
 *     one card the whole hand has been waiting for;
 *   · the dealer's draws tick UP in pitch as the total climbs, so "dealer is
 *     getting close" is audible before the number is read;
 *   · a bust is a dead thud with no tail at all. Anything ringing would sound
 *     like a reward.
 *
 * ── Why this file exists rather than reusing `./audio.ts` ───────────────────
 * That module is the slot cabinet's, and its `note`/`thump` primitives are
 * private to it. Exporting them would couple the two machines' sound design
 * together — the first time slots wanted a longer attack it would silently
 * change how every card lands. The primitives are ~30 lines; the coupling
 * would cost more than the duplication.
 *
 * House rules, matched to `./audio.ts`: context via `getAudioCtx()`, resume if
 * suspended, EVERYTHING wrapped so audio can never break the game, nodes
 * disconnected in `onended`, gains kept in the 0.02–0.09 band. Nothing returns
 * a success flag — a browser that hasn't seen a user gesture yet legitimately
 * produces silence, and that is not an error.
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

/** Schedule one note and clean up after itself. */
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
  // Off zero — a square snapped on at full amplitude clicks, and a click on
  // every card would read as a broken speaker.
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

/** A filtered noise burst — the body of every physical event in the game. */
function thump(
  c: AudioContext,
  opts: { at: number; dur: number; gain: number; filter: BiquadFilterType; freq: number; q?: number; curve?: number; sweepTo?: number },
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
  f.frequency.setValueAtTime(opts.freq, t);
  // A sweeping filter is what turns a static hiss into something MOVING, which
  // is the whole trick behind the card-skid sound.
  if (opts.sweepTo !== undefined) f.frequency.exponentialRampToValueAtTime(Math.max(20, opts.sweepTo), t + opts.dur);
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
 * A CARD DEALT — the skid of stock across felt, then the tap as it stops.
 *
 * Deliberately unpitched. This fires for every single card, up to a dozen in a
 * hand, and any tonal content at all would have the deal playing a tune. The
 * downward filter sweep is the movement; the tiny high tick at the end is the
 * corner catching the felt.
 */
export function sfxCardDeal(): void {
  const c = ctx();
  if (!c) return;
  try {
    // The skid: bright at the start, dulling as the card slows.
    thump(c, { at: 0, dur: 0.11, gain: 0.05, filter: "bandpass", freq: 3200, sweepTo: 900, q: 0.7, curve: 1.6 });
    // The landing tap.
    thump(c, { at: 0.09, dur: 0.04, gain: 0.035, filter: "lowpass", freq: 2200, curve: 3 });
  } catch {
    // fail-silent
  }
}

/**
 * THE HOLE CARD TURNING OVER — the one card that gets its own sound.
 *
 * A stiff flick (the corner released) and a slap (the card landing face up),
 * with a short rising body under it. This is the moment the hand resolves, and
 * it is the only card event with any pitch movement precisely so it cannot be
 * mistaken for another deal.
 */
export function sfxHoleFlip(): void {
  const c = ctx();
  if (!c) return;
  try {
    thump(c, { at: 0, dur: 0.05, gain: 0.045, filter: "highpass", freq: 1800, curve: 2.4 });
    note(c, { type: "triangle", at: 0.02, dur: 0.1, freq: 220, to: 480, gain: 0.03 });
    // The slap down.
    thump(c, { at: 0.1, dur: 0.07, gain: 0.055, filter: "lowpass", freq: 1400, curve: 2 });
    note(c, { type: "sine", at: 0.1, dur: 0.09, freq: 160, to: 90, gain: 0.04 });
  } catch {
    // fail-silent
  }
}

/**
 * CHIPS — clay discs knocking together.
 *
 * `count` is how many chips are landing, capped so a big bet doesn't turn into
 * a machine-gun. Each is a short band-passed click at a slightly different
 * pitch with an uneven gap, because chips falling in perfect time sound like a
 * metronome rather than like money.
 */
export function sfxChips(count = 3): void {
  const c = ctx();
  if (!c) return;
  try {
    const n = Math.max(1, Math.min(6, Math.round(count)));
    for (let i = 0; i < n; i++) {
      // Jittered spacing and pitch. Clay is a dull, high-mid click with a very
      // short tail — nothing like the metallic ring of a coin.
      const at = i * 0.045 + Math.random() * 0.016;
      const k = 0.9 + Math.random() * 0.35;
      thump(c, { at, dur: 0.035, gain: 0.04, filter: "bandpass", freq: 2300 * k, q: 2.6, curve: 2.4 });
      thump(c, { at, dur: 0.02, gain: 0.022, filter: "lowpass", freq: 700 * k, curve: 3 });
    }
  } catch {
    // fail-silent
  }
}

/**
 * A DOUBLE-DOWN — the chips, plus a short confident swell underneath.
 *
 * Doubling is the only moment the player voluntarily puts more gold on the
 * table, and it deserves to feel like a decision rather than like another
 * button press. The rising fifth is the entire "committed" gesture.
 */
export function sfxDouble(): void {
  const c = ctx();
  if (!c) return;
  try {
    sfxChips(4);
    note(c, { type: "triangle", at: 0.03, dur: 0.2, freq: 196, to: 294, gain: 0.045 });
    note(c, { type: "square", at: 0.03, dur: 0.18, freq: 392, to: 588, gain: 0.018 });
  } catch {
    // fail-silent
  }
}

/**
 * THE DEALER DRAWING — a tick that RISES with the dealer's total.
 *
 * `step` is how many cards the dealer has drawn so far. The pitch climbing is
 * doing real work: it tells the player the dealer is walking up toward 17
 * before they have read a single number, which is what makes a sequence of
 * draws feel like it is going somewhere instead of just taking time.
 */
export function sfxDealerTick(step: number): void {
  const c = ctx();
  if (!c) return;
  try {
    const k = 1 + Math.min(5, Math.max(0, step | 0)) * 0.14;
    note(c, { type: "square", at: 0, dur: 0.06, freq: 330 * k, gain: 0.022 });
    thump(c, { at: 0, dur: 0.03, gain: 0.02, filter: "bandpass", freq: 1800 * k, q: 3, curve: 3 });
  } catch {
    // fail-silent
  }
}

/**
 * A BUST — a dead thud, and nothing else.
 *
 * No tail, no ring, no pitch. Every other outcome in this file has some tone
 * to it; going over 21 is the one event that should sound like a door closing.
 */
export function sfxBust(): void {
  const c = ctx();
  if (!c) return;
  try {
    thump(c, { at: 0, dur: 0.16, gain: 0.075, filter: "lowpass", freq: 340, curve: 0.7 });
    note(c, { type: "sine", at: 0, dur: 0.2, freq: 110, to: 44, gain: 0.06 });
    // A short dry knock on top so it reads as an impact rather than a rumble.
    thump(c, { at: 0.01, dur: 0.05, gain: 0.03, filter: "bandpass", freq: 900, q: 1.2, curve: 3 });
  } catch {
    // fail-silent
  }
}

/**
 * A NATURAL — the fanfare, and the only genuinely musical cue in the game.
 *
 * Blackjack off the deal is the best thing that can happen at this table and it
 * happens under 5% of hands, so it can afford to be showy. Kept under a second:
 * the player is about to be dealt another hand.
 */
export function sfxBlackjack(): void {
  const c = ctx();
  if (!c) return;
  try {
    // A bright major arpeggio, then the octave held.
    [523, 659, 784, 1047].forEach((f, i) => {
      note(c, { type: "square", at: i * 0.065, dur: 0.13, freq: f, gain: 0.035 });
      note(c, { type: "triangle", at: i * 0.065, dur: 0.16, freq: f * 2, gain: 0.014 });
    });
    note(c, { type: "square", at: 0.28, dur: 0.42, freq: 1319, gain: 0.038 });
    note(c, { type: "square", at: 0.28, dur: 0.42, freq: 1319, gain: 0.022, detune: 11 });
    // Chips being pushed across for the 3:2.
    sfxChips(5);
  } catch {
    // fail-silent
  }
}

/** A won hand — brief and warm. Not the fanfare; that belongs to naturals. */
export function sfxWin(): void {
  const c = ctx();
  if (!c) return;
  try {
    [523, 784].forEach((f, i) => {
      note(c, { type: "triangle", at: i * 0.08, dur: 0.2, freq: f, gain: 0.045 });
    });
    sfxChips(3);
  } catch {
    // fail-silent
  }
}

/** A push — flat, unresolved, going nowhere. Exactly what a push is. */
export function sfxPush(): void {
  const c = ctx();
  if (!c) return;
  try {
    note(c, { type: "triangle", at: 0, dur: 0.22, freq: 294, gain: 0.035 });
    note(c, { type: "triangle", at: 0, dur: 0.22, freq: 294, gain: 0.02, detune: -12 });
  } catch {
    // fail-silent
  }
}

/**
 * A lost hand that wasn't a bust — a short sag.
 *
 * Quiet, because this is the most common outcome at the table and a punitive
 * sound here would make the game unpleasant within a handful of hands.
 */
export function sfxLoseHand(): void {
  const c = ctx();
  if (!c) return;
  try {
    note(c, { type: "square", at: 0, dur: 0.18, freq: 262, to: 220, gain: 0.028 });
    note(c, { type: "triangle", at: 0.14, dur: 0.26, freq: 175, to: 131, gain: 0.03 });
  } catch {
    // fail-silent
  }
}

/**
 * THE SHUFFLE — a riffle before the deal.
 *
 * Single deck reshuffled every round (see `blackjack.ts`), and this is the only
 * thing that tells the player that. Without it the game silently looks like a
 * continuous shoe, which would invite counting.
 */
export function sfxShuffle(): void {
  const c = ctx();
  if (!c) return;
  try {
    // A rapid burst of many tiny paper ticks — a riffle is a texture, not a hit.
    for (let i = 0; i < 14; i++) {
      thump(c, {
        at: i * 0.014 + Math.random() * 0.006,
        dur: 0.02,
        gain: 0.018,
        filter: "bandpass",
        freq: 2600 + Math.random() * 2200,
        q: 1.8,
        curve: 2.5,
      });
    }
    // The pack squared up on the table.
    thump(c, { at: 0.24, dur: 0.06, gain: 0.04, filter: "lowpass", freq: 1200, curve: 2 });
  } catch {
    // fail-silent
  }
}
