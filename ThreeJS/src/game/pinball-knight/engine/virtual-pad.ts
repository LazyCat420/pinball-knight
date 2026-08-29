/**
 * VIRTUAL PAD — the shared surface a gamepad or an on-screen touch control
 * writes into, and that `input.ts` merges with the keyboard/mouse.
 *
 * Both new input sources describe the SAME six things a keyboard already says
 * (move, aim, attack, dodge, sprint, and a handful of discrete presses), so
 * neither of them needs its own path through the game. They fill this struct,
 * `createInput` ORs it into the keyboard state, and every consumer downstream —
 * `updatePlayer`, the pinball ride, the FPS rampage — keeps reading exactly the
 * InputHandle it always did.
 *
 * `move`/`aim` are ANALOG here: a stick at 40% deflection should walk, not run,
 * and the keyboard's ±1 is just the degenerate case of that.
 *
 * DISCRETE actions (abilities, belt slots, map, menu, weapon swap) deliberately
 * do NOT live here. Those are owned by core.ts's window `keydown` switch, and a
 * pad press is bridged by dispatching a synthetic KeyboardEvent (see
 * `pressKey`). That keeps ONE definition of "what E does" instead of a second
 * dispatch table that drifts from the first — the alternative was refactoring a
 * 3000-line file's key handler, which is a much larger blast radius for no
 * gameplay gain.
 */

/** Continuous, per-frame state contributed by a pad or the touch overlay. */
export interface VirtualPad {
  /** Analog move vector, screen space, magnitude 0..1. */
  moveX: number;
  moveZ: number;
  /** Analog aim vector, screen space, magnitude 0..1. Zero = not aiming. */
  aimX: number;
  aimY: number;
  /** Held states, OR'd with the keyboard/mouse equivalents. */
  attack: boolean;
  dodge: boolean;
  sprint: boolean;
  /** THE FLIPPER BUTTON — held, because a held flipper cradles (flippers.ts). */
  flip: boolean;
  /** Rising edges, consumed by InputHandle exactly like a queued key tap. */
  attackTap: boolean;
  dodgeTap: boolean;
  flipTap: boolean;
}

export function emptyPad(): VirtualPad {
  return { moveX: 0, moveZ: 0, aimX: 0, aimY: 0, attack: false, dodge: false, sprint: false, flip: false, attackTap: false, dodgeTap: false, flipTap: false };
}

/**
 * Zero the CONTINUOUS state, leaving queued taps alone.
 *
 * Called before every gamepad poll as well as on blur. A poll only ever ORs
 * bits IN (a held button, a stick deflection), so without a reset first the pad
 * is monotonic: press X once and the knight attacks forever, and a stick that
 * ever reached full deflection can never report a walk again. Taps are NOT
 * cleared here — those are consumed by the reader, not by the next poll, or a
 * press could be polled away before anything read it.
 */
export function resetPad(p: VirtualPad): void {
  p.moveX = 0;
  p.moveZ = 0;
  p.aimX = 0;
  p.aimY = 0;
  p.attack = false;
  p.dodge = false;
  p.sprint = false;
  p.flip = false;
}

/**
 * Fire a discrete action through the game's existing keyboard switch.
 *
 * Synthetic and therefore `isTrusted: false`, which is fine — nothing in this
 * game gates on trust, and the browser only refuses synthetic events for
 * privileged actions (which none of these are). Documented rather than hidden
 * because "the controller dispatches fake key events" is genuinely surprising
 * if you meet it cold.
 */
export function pressKey(key: string): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
  window.dispatchEvent(new KeyboardEvent("keyup", { key, bubbles: true }));
}

/**
 * A radial deadzone that RESCALES what is left, so the first pixel of stick
 * travel past the threshold maps to a near-zero speed instead of jumping
 * straight to `dead`. Without the rescale a 0.25 deadzone makes the slowest
 * possible walk a quarter of full speed, which reads as a broken stick.
 *
 * Returns a vector of magnitude 0..1.
 */
export function applyDeadzone(x: number, y: number, dead: number): { x: number; y: number } {
  const m = Math.hypot(x, y);
  if (m <= dead) return { x: 0, y: 0 };
  const scaled = Math.min(1, (m - dead) / (1 - dead));
  return { x: (x / m) * scaled, y: (y / m) * scaled };
}
