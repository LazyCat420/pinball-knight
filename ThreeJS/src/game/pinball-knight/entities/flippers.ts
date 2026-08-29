/**
 * THE FLIPPER BUTTON — the verb the flipper never had.
 *
 * Before this module, `PART_HANDLERS.flipper` was a radius test that fired on
 * contact:
 *
 *     if (d2 > FLIPPER_RADIUS * FLIPPER_RADIUS) return;   // ...and launch
 *
 * That is a kicker with aim-assist. A pinball player has three verbs and the
 * part offered none of them: no button, no hold, no timing. The art half was
 * fixed first (the paddle is a real flipper silhouette now, and it sweeps
 * across the floor instead of tipping up like a drawbridge), which made the
 * gap louder rather than quieter — the part looked like a flipper and promised
 * something the code could not do.
 *
 * ## The three verbs
 *
 *   TAP (F / pad B)   The nearest ready paddle within FLIPPER_REACH swings NOW.
 *                     Touch it during the first FLIPPER_ACTIVE seconds of that
 *                     swing and you launch at FLIPPER_SPEED with a named shot
 *                     and a payout. That window is the timing skill.
 *
 *   HOLD              The paddle stops at the top of its arc instead of easing
 *                     back. A knight who reaches a held paddle is CRADLED:
 *                     momentum killed, parked on the bat. Release to fire —
 *                     and the move stick bends the exit, so a cradle is how you
 *                     AIM a launch instead of taking whatever angle you arrived
 *                     at. This is the trap-and-aim a real table is played with.
 *
 *   NOTHING           Contact still fires the paddle, at FLIPPER_PASSIVE_SPEED.
 *
 * ## Why passive contact survives, and is not a compromise
 *
 * `flipper` is a member of `LAUNCH_KINDS` and `FORWARD_FLOW_KINDS` in
 * maze/decorate.ts. Level generation counts flippers when it proves a floor's
 * routes are traversable under momentum, and `maze/circuit.test.ts` and
 * `maze/track-socket.test.ts` both assert against that set. A press-only
 * flipper would silently invalidate those guarantees on every floor the game
 * can generate — a player who never learns the button would meet dead routes
 * the generator believed it had connected.
 *
 * So the button does not switch the part on. It switches it UP: 12 → 18, one
 * and a half times, plus the gold and the named shot. Every floor stays
 * traversable; the button is what makes a floor traversable *well*.
 *
 * ## What lives here and what does not
 *
 * This module owns COMMAND and CLOCK: which paddle the button reaches, and how
 * a swing ages. The CONSEQUENCE of touching one — the launch itself, the
 * cradle, the payout — stays in `PART_HANDLERS.flipper`, next to every other
 * part's contact rule. That split is deliberate: it keeps this module free of
 * any import from entities/pinball-collide.ts, which imports the constants and
 * `swingIsLive` from here. One direction only, no cycle.
 */
import { state, type PinballPart } from "../state";
import { FLIPPER_REACH, FLIPPER_ACTIVE, FLIPPER_SWING, FLIPPER_COOLDOWN } from "../constants";
import type { InputHandle } from "../engine/input";
import { showPickupNote } from "../ui";
import { sfxSpring } from "../sfx";

/**
 * True while `part` is inside the live half of a commanded swing.
 *
 * The window is FLIPPER_ACTIVE (0.16 s), shorter than the paddle's full travel
 * FLIPPER_SWING (0.22 s), because what should pay is the paddle ACCELERATING.
 * The back of the arc is follow-through: a knight who arrives during it has
 * mistimed the shot and gets the passive launch, which is exactly the
 * distinction a real flipper makes between a shot and a dribble.
 */
export function swingIsLive(part: PinballPart): boolean {
  // A HELD paddle is never live, and this line is load-bearing rather than
  // defensive. `updateFlippers` parks a held paddle at exactly FLIPPER_ACTIVE,
  // which satisfies the `<=` below — so without the guard a paddle the player
  // is holding up reports a live timed window for as long as they hold it, and
  // "hold F" would be strictly better than timing a tap. The handler happens to
  // test `isHeldUp` first today, so the bug was invisible; it would have
  // reappeared the moment anyone reordered those two checks.
  if (part.held) return false;
  return part.swingT !== undefined && part.swingT >= 0 && part.swingT <= FLIPPER_ACTIVE;
}

/** True while `part` is up and waiting — held at the top of its arc. */
export function isHeldUp(part: PinballPart): boolean {
  return part.held === true;
}

/**
 * Fire the paddle nearest the knight, if one is in reach and ready.
 *
 * NEAREST rather than all-in-range on purpose. Flipping every paddle in the
 * room would make the button a panic button — mash it and something eventually
 * throws you somewhere — which is the opposite of a shot you chose. One press,
 * one paddle, and it is the one you walked up to.
 *
 * Returns the paddle it fired, or null if nothing was in reach.
 */
export function swingNearest(): PinballPart | null {
  const p = state.player;
  if (!p) return null;
  let best: PinballPart | null = null;
  let bestD2 = FLIPPER_REACH * FLIPPER_REACH;
  for (const part of state.pinballParts) {
    if (part.kind !== "flipper") continue;
    // A paddle already mid-swing is not re-commandable: without this, holding
    // the button through the auto-repeat of a key would restart the window
    // every frame and the "timed" launch would be free.
    if (part.swingT !== undefined) continue;
    if (part.cooldownT > 0) continue;
    const dx = p.x - part.x;
    const dz = p.z - part.z;
    const d2 = dx * dx + dz * dz;
    if (d2 > bestD2) continue;
    bestD2 = d2;
    best = part;
  }
  if (!best) return null;
  best.swingT = 0;
  best.hitT = 0; // the animator's flare rides the same clock as a struck part
  state.vfx?.sparks(best.x, 0.35, best.z, best.dirX, best.dirZ, 6);
  sfxSpring();
  return best;
}

/**
 * Teach the button, once.
 *
 * There is nowhere else this could go: the dungeon has no controls screen, and
 * `showControlsHint` in ui.ts is one of the eight no-ops with zero call sites.
 * A verb nobody is told about is a verb nobody uses, and this one is invisible
 * — the part looks the same whether or not you know you can press anything.
 *
 * Once per SESSION rather than per floor. Per-floor would need a reset hook
 * that nothing else needs (the parts array is replaced wholesale on every
 * floor change), and being told twice is worse than being told once.
 */
let hintShown = false;

function hintOnce(): void {
  if (hintShown) return;
  hintShown = true;
  showPickupNote("\u{1F3CF} F — FLIP · hold to CRADLE");
}

/**
 * Read the button and age every commanded swing.
 *
 * Called once per frame from `updatePlayer`, BEFORE the owners that can take
 * over the knight (roll, hop, wall-launch, the pinball ride). A flipper you
 * pressed on the way into a ride must still be swinging when you get there —
 * gating this behind those early returns would make the button work only while
 * standing still, which is the one moment it is useless.
 */
export function updateFlippers(dt: number, input: InputHandle): void {
  const held = input.flipHeld();
  if (input.consumeFlip()) swingNearest();

  const p = state.player;
  for (const part of state.pinballParts) {
    if (part.kind !== "flipper") continue;
    // First paddle this session that the button could actually reach: say so.
    if (p && !hintShown) {
      const hx = p.x - part.x;
      const hz = p.z - part.z;
      if (hx * hx + hz * hz <= FLIPPER_REACH * FLIPPER_REACH) hintOnce();
    }
    if (part.swingT === undefined) continue;
    part.swingT += dt;

    // HELD: freeze the paddle at the top once it has finished travelling. The
    // swing clock stops with it, so `swingIsLive` is false for a held paddle —
    // a hold is a cradle, not an infinite timed window.
    if (held && part.swingT >= FLIPPER_ACTIVE) {
      part.held = true;
      part.swingT = FLIPPER_ACTIVE;
      continue;
    }

    if (part.held) {
      // Released. A paddle that caught nobody just drops; one holding the
      // knight is fired by PART_HANDLERS.flipper on the very next contact
      // sweep, which is this frame — `cradled` is its signal and it clears it.
      part.held = false;
      if (!part.cradled) part.swingT = undefined;
      continue;
    }

    // The swing ran its course untouched.
    if (part.swingT > FLIPPER_SWING) {
      part.swingT = undefined;
      part.cradled = false;
    }
  }
}

/**
 * Let go of the knight without launching them — the escape hatch for a cradle
 * whose player walked off the bat. `PART_HANDLERS.flipper` calls this; it is
 * here so the cradle's whole lifecycle reads in one file.
 */
export function releaseCradle(part: PinballPart, launched: boolean): void {
  part.cradled = false;
  part.held = false;
  part.swingT = undefined;
  if (launched) part.cooldownT = FLIPPER_COOLDOWN;
}

/** The toast a cradle shows once, when it catches. */
export function noteCradled(): void {
  showPickupNote("🏏 CRADLED — release to fire");
}
