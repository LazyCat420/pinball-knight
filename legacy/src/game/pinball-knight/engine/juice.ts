/**
 * JUICE GOVERNOR — screen shake and hit-freeze, rate-limited under chains.
 *
 * ── The problem this solves (playtest report, not a benchmark) ─────────────
 *
 * "It lags when I go super fast and interact with multiple things."
 *
 * That is not frame-rate lag, and no amount of instancing or culling would
 * have fixed it. Two deliberate game-feel effects were re-arming without any
 * rate limit:
 *
 *  - **hitstop** — the fixed-step sim is PAUSED for a few tens of ms so an
 *    impact reads as a crunch (core.ts: `if (state.hitstopT > 0)` skips
 *    `simulate` entirely and clamps the accumulator so no time is banked).
 *  - **screen shake** — a camera offset that decays over its timer.
 *
 * Both were set with a bare `Math.max(state.X, value)` at fourteen call sites.
 * One bumper feels great. A ricochet through five of them in half a second
 * re-arms the freeze five times, and because each one PAUSES THE SIMULATION
 * the ball visibly stutters — the game stops, repeatedly, exactly when it
 * should feel fastest. The faster and better you play, the worse it gets.
 *
 * ── The rule ───────────────────────────────────────────────────────────────
 *
 * A single hit is untouched: land one bumper after a quiet moment and you get
 * precisely the crunch that shipped. What changes is the SECOND and later hit
 * inside a short window — those are damped, progressively, using the bounce
 * chain the pinball ride already tracks (`state.bounceCombo`).
 *
 * This is deliberately NOT "turn the effects down". The repo has been burned
 * before by quietly stripping shipped VFX to win a benchmark; gore and juice
 * are the game's feedback, not pollution. Peak impact is preserved. Only the
 * pathological case — freeze stacked on freeze until the sim barely advances —
 * is removed.
 *
 * ── Why a governor rather than editing fourteen call sites ─────────────────
 *
 * The call sites are spread across pinball-collide, player, boss and combat,
 * and each is a legitimate "this hit mattered" statement. Rewriting them all
 * with hand-tuned numbers would bury the policy in fourteen places and
 * guarantee the next new part forgets it. One choke point means a new part
 * gets the behaviour for free, and the policy can be tuned in one place.
 */
import { engineConfig } from "./config";
import { view } from "./view-state";

/**
 * How deep the current impact chain is.
 *
 * The engine cannot ask the game "how many things has the knight hit without
 * settling" — that is pinball content. So the game supplies the reading. The
 * default returns 0, meaning "no chain", which makes the governor behave as a
 * plain `Math.max` — the pre-governor behaviour, and a safe default for a game
 * that has no chain concept at all.
 */
let readChainDepth: () => number = () => 0;

/** Install the game's chain-depth reading. Called once at boot. */
export function setChainDepthSource(fn: () => number): void {
  readChainDepth = fn;
}

/**
 * Seconds since the last governed hit-freeze. Real time, not sim time — the
 * whole point is to measure the gap between crunches as the PLAYER experiences
 * it, and sim time does not advance during a freeze (which would make the gap
 * look like zero forever and defeat the limiter).
 */
let sinceHitstop = Infinity;
/** Seconds since the last governed shake, same reasoning. */
let sinceShake = Infinity;

/** Advance the governor's clocks. Called once per rendered frame from the core
 *  loop with REAL frame time, outside the fixed-step sim. */
export function tickJuice(realDt: number): void {
  sinceHitstop += realDt;
  sinceShake += realDt;
}

/** Reset between runs/floors so a new floor never inherits a stale chain. */
export function resetJuice(): void {
  sinceHitstop = Infinity;
  sinceShake = Infinity;
}

/**
 * How hard to damp, given how deep the current bounce chain is.
 *
 * `bounceCombo` is the pinball ride's own count of how many things you have
 * hit without settling, so it is exactly the "am I in a chain" signal — no new
 * state to keep in sync. Chain depth 0-1 is untouched (factor 1); beyond that
 * each step multiplies by the falloff, bottoming out at the floor so a deep
 * chain still registers SOMETHING. A completely silent hit reads as a bug.
 */
function chainFactor(falloff: number, floor: number): number {
  // bounceCombo lives on the PLAYER, not on state — it is per-knight ride
  // bookkeeping, reset when the chain lapses (see comboWindow). The engine
  // reaches it through the injected reader, not by importing the game.
  const depth = Math.max(0, readChainDepth() - 1);
  if (depth <= 0) return 1;
  return Math.max(floor, Math.pow(falloff, depth));
}

/**
 * Request screen shake of `amount` seconds.
 *
 * Outside a chain this is the old `Math.max` exactly. Inside one it is damped
 * by chain depth, and additionally skipped entirely if the previous shake is
 * still fresh AND at least as strong — re-arming a 0.14s shake on top of a
 * running 0.5s boss shake never did anything visible anyway.
 */
export function requestShake(amount: number): void {
  const { shakeChainFalloff, shakeChainFloor, shakeChainWindow } = engineConfig.juice;
  const scaled = amount * chainFactor(shakeChainFalloff, shakeChainFloor);
  if (sinceShake < shakeChainWindow && view.shakeT >= scaled) return;
  view.shakeT = Math.max(view.shakeT, scaled);
  sinceShake = 0;
}

/**
 * Request a hit-freeze of `amount` seconds.
 *
 * This is the one that actually caused the reported stutter, so it is limited
 * harder than shake, on three independent axes:
 *
 *  1. **A minimum gap.** Two freezes closer together than `HITSTOP_MIN_GAP`
 *     are not two crunches, they are one stutter. The second is dropped.
 *  2. **Chain damping**, as for shake.
 *  3. **A hard ceiling on what can be PENDING.** Even a legitimate request is
 *     clamped so the sim can never be paused for longer than
 *     `HITSTOP_MAX_PENDING` at a stretch. This is the backstop that makes the
 *     pathological case structurally impossible rather than merely unlikely.
 */
export function requestHitstop(amount: number): void {
  const {
    hitstopMinGap,
    hitstopChainFalloff,
    hitstopChainFloor,
    hitstopMaxPending,
  } = engineConfig.juice;
  if (sinceHitstop < hitstopMinGap) return;
  const scaled = amount * chainFactor(hitstopChainFalloff, hitstopChainFloor);
  const next = Math.max(view.hitstopT, scaled);
  view.hitstopT = Math.min(next, hitstopMaxPending);
  sinceHitstop = 0;
}

/** Test seam: how long since each governed effect last fired. */
export function juiceDebug(): { sinceHitstop: number; sinceShake: number } {
  return { sinceHitstop, sinceShake };
}
