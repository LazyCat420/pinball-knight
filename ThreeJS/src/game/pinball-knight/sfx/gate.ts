/**
 * Rate limiting for sound, in one place.
 *
 * ── WHAT THIS REPLACES ───────────────────────────────────────────────────────
 * Every caller that needed to stop a sting machine-gunning invented its own
 * guard, and two of the three were subtly wrong:
 *
 *   · `entities/hazards.ts` used `Math.random() < 0.3`, which is not a throttle
 *     at all — it sits inside a branch that has ALREADY set the vent's cooldown,
 *     so it is a 70% chance that a vent which just burned you makes no sound.
 *   · `entities/player.ts` piggybacked the VFX spark accumulator (`railSparkT`),
 *     so retuning a particle rate silently retimed the audio.
 *   · `sfxCoin` grew its own voice cap, stagger and ladder-reset inside the
 *     module — correct, but private and unreusable.
 *
 * ── THE CLOCK IS THE AUDIO CLOCK ─────────────────────────────────────────────
 * Keyed on `AudioContext.currentTime`, not `performance.now()`. The gate and the
 * scheduling then share one clock, and a suspended context (backgrounded tab,
 * autoplay block) does not burn through the budget while nothing is audible.
 *
 * ── GATE AT THE CALL SITE, NEVER INSIDE A STING ───────────────────────────────
 * `sfxFlame` is the fire vent AND the player's flamethrower AND the lava marble
 * transform. A gate inside it would suppress the weapon to fix the vent. The key
 * is per-site by convention: `gate("vent-flame", …)`, not `gate("flame", …)`.
 */
import { getAudioCtx } from "../../../utils/audio-manager";

/** Seconds, from the audio clock. Falls back to wall time only if there is no
 *  context — the gate must still work when muted so behaviour does not change
 *  the moment sound is switched off. */
function now(): number {
  const c = getAudioCtx();
  return c ? c.currentTime : Date.now() / 1000;
}

const last = new Map<string, number>();

/**
 * True at most once per `minGapS` for this key.
 *
 * The first call always passes: a gate whose first hit is swallowed makes the
 * one-shot case (a vent that just fired) silent, which is the bug it is meant to
 * prevent.
 */
export function gate(key: string, minGapS: number): boolean {
  const t = now();
  const prev = last.get(key);
  if (prev !== undefined && t - prev < minGapS) return false;
  last.set(key, t);
  return true;
}

interface Cluster {
  at: number;
  n: number;
}
const clusters = new Map<string, Cluster>();

/**
 * Voice allocation for a BURST of the same sound — coin pickups, shard hits.
 *
 * Returns the index within the current cluster (0-based), or -1 when the cluster
 * is full. An index rather than a boolean because callers use it musically: the
 * coin sting walks a pitch ladder by index, so twelve coins in one sweep play a
 * rising arpeggio instead of twelve copies of one note.
 *
 * The cluster resets once `windowS` has passed with no calls, so a second sweep
 * starts the ladder again from the bottom.
 */
export function voice(key: string, cap: number, windowS: number): number {
  const t = now();
  const c = clusters.get(key);
  if (!c || t - c.at > windowS) {
    clusters.set(key, { at: t, n: 1 });
    return 0;
  }
  c.at = t;
  if (c.n >= cap) return -1;
  const i = c.n;
  c.n++;
  return i;
}

/** Floor teardown, and test determinism — module state outlives a run otherwise. */
export function resetGates(): void {
  last.clear();
  clusters.clear();
}
