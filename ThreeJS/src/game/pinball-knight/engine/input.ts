/**
 * Input for the dungeon: keyboard + mouse, GAMEPAD, and the on-screen TOUCH pad.
 *
 * WASD / arrows to move, LEFT-CLICK to attack (hold = heavy) toward the cursor,
 * SPACE or right-click to dodge, Shift to sprint, F for THE FLIPPER BUTTON (tap
 * to swing the nearest paddle, hold to cradle). The room's own input is
 * already muted while we run (core calls setInputOwner), so listening on window
 * here is safe.
 *
 * The two newer sources do not get their own path through the game. They both
 * fill a `VirtualPad` (virtual-pad.ts) — the same six continuous things a
 * keyboard says — and this module MERGES that into the keyboard state behind
 * the existing InputHandle. So `updatePlayer`, the pinball ride and the FPS
 * rampage all keep reading exactly the interface they always read, and a bug in
 * the pad mapping cannot reach gameplay logic.
 *
 * Merging rule for the analog axis: the LARGER deflection wins, never the sum.
 * A keyboard and a stick can be live at once (a pad plugged in while someone
 * rests a hand on WASD), and summing them would produce a faster-than-possible
 * diagonal.
 */
import { emptyPad, resetPad, type VirtualPad } from "./virtual-pad";
import { createGamepadPoller } from "./gamepad";

export interface InputHandle {
  /** Normalised movement axis, -1..1 per component. +z is south (toward the camera). */
  axis(): { x: number; z: number };
  /**
   * True if an attack is wanted this frame. Taps are queued (so a click
   * between frames never gets lost) and holding the key auto-swings as soon
   * as the cooldown allows.
   */
  consumeAttack(): boolean;
  /** True while the attack key/button is HELD (drives heavy-attack charging). */
  attackHeldNow(): boolean;
  /**
   * True once if the attack was freshly PRESSED since the last call — a discrete
   * tap edge only, NOT the held state (unlike consumeAttack, which also returns
   * true while held so ranged auto-fires). Melee charge logic needs the edge so
   * a hold charges instead of spamming light swings.
   */
  consumeAttackTap(): boolean;
  /** True while a movement modifier (Shift) is held — sprint. */
  sprintHeld(): boolean;
  /** True once if a dodge (Space) was tapped since the last call — a queued tap. */
  consumeDodge(): boolean;
  /** True while the dodge key/button (Space / right-click) is HELD — the plunger pull. */
  dodgeHeld(): boolean;
  /**
   * True once if THE FLIPPER BUTTON (F / pad B) was freshly pressed — a queued
   * tap edge, same contract as consumeDodge.
   */
  consumeFlip(): boolean;
  /**
   * True while the flipper button is HELD. Separate from the tap because the
   * hold is its own verb: a held paddle stays up and CRADLES the knight rather
   * than launching, and releasing it fires. See entities/flippers.ts.
   */
  flipHeld(): boolean;
  /**
   * Turn axis for the FPS ultimate: -1 (turn left) .. +1 (turn right), from Q/E
   * on the keyboard OR the right stick's X on a pad. Lets rampage be driven with
   * the keyboard alone (and headlessly), independent of mouse-look.
   *
   * The pad contribution is ANALOG (a half-pushed stick turns at half speed),
   * which is why this returns a float and not a sign. The keyboard's ±1 is the
   * endpoint of the same curve.
   */
  turnAxis(): number;
  /**
   * Pull the accumulated relative mouse movement since the last call and reset
   * it — the FPS look integrates this. {dx, dy} in pixels.
   */
  consumeMouseDelta(): { dx: number; dy: number };
  /**
   * The last known cursor position in CLIENT pixels (viewport-relative), or null
   * if the mouse has never moved over the page this session. Ranged aiming
   * projects the player to screen and fires toward this point.
   */
  aimScreen(): { x: number; y: number } | null;
  /**
   * The analog AIM vector in screen space (right stick / touch), magnitude
   * 0..1, or null when nothing is aiming. Takes precedence over `aimScreen`:
   * a pad has no cursor, so ranged fire and the pinball steer read the stick
   * direction directly (the caller runs it through screenDirToWorld, exactly
   * as it already does for the movement axis).
   */
  aimStick(): { x: number; y: number } | null;
  /** Poll the hardware pad. Called once per frame by the game loop — the
   *  Gamepad API is pull-only, it never fires events for stick movement. */
  poll(): void;
  /** The shared pad surface, so the touch overlay can write into it. */
  pad: VirtualPad;
  /** Live input state for the `__dungeonInput` QA hook. A controller and a
   *  touch overlay have no other read-back from a headless harness. */
  debug(): unknown;
  /**
   * Drop any queued taps and accumulated mouse deltas WITHOUT touching held
   * state. Modals call this on close: the window keydown listener still runs
   * while an overlay is up, so the Space that dismissed a card reader would
   * otherwise sit queued and fire a dodge roll the instant the sim resumes.
   */
  clearTransient(): void;
  dispose(): void;
}

// Exported for `input.test.ts`, which asserts no key is bound to both movement
// and turning — see the note on TURN_LEFT below for why that matters.
export const MOVE_KEYS: Record<string, [number, number]> = {
  w: [0, -1],
  arrowup: [0, -1],
  s: [0, 1],
  arrowdown: [0, 1],
  a: [-1, 0],
  arrowleft: [-1, 0],
  d: [1, 0],
  arrowright: [1, 0],
};

// Mouse-aim scheme: attack is LEFT-CLICK (hold = heavy) toward the cursor, dodge
// is SPACE or right-click. No keyboard attack key (the old J is retired) — the
// mouse owns aiming + attacking, which is what an iso ARPG wants.
const ATTACK_KEYS = new Set<string>();
const DODGE_KEYS = new Set([" "]);
// THE FLIPPER BUTTON. F was free: Space is dodge AND the plunger pull AND the
// lane change, the mouse owns attack and aim, Q/E are the abilities, R is
// rampage, Shift is sprint, 1-4 the belt, Tab the weapon swap, M the map.
const FLIP_KEYS = new Set(["f"]);
// FPS look-turn keys: q/e ONLY.
//
// The left/right arrows used to be in here as well as in MOVE_KEYS. Both sets
// are read from the same `down` set — `axis()` for movement, `turnAxis()` for
// the FPS camera — so holding Left strafed left AND rotated the camera left on
// the same frame. That compound motion is almost certainly what the
// long-standing "control inversion" note in ROADMAP §6 / VERIFY_CHECKLIST §6
// was reacting to: there is no sign error anywhere in the movement or aim math
// (both route through screenDirToWorld with the same convention), the arrows
// were just bound to two things at once.
//
// Arrows stay as the movement alias for WASD, which is what they do in iso mode
// and what players expect; q/e keep the turn, which is the conventional FPS
// binding. Anything added here must NOT also appear in MOVE_KEYS — `input.test.ts`
// asserts that.
export const TURN_LEFT = new Set(["q"]);
export const TURN_RIGHT = new Set(["e"]);

export function createInput(attackSurface: HTMLElement): InputHandle {
  const down = new Set<string>();
  // TWO pads, because the two sources report differently and must not overwrite
  // each other. Touch is EVENT-driven: it writes on pointerdown/move and the
  // value is meant to persist until the next event. A gamepad is POLL-driven:
  // its state must be rebuilt from scratch every frame, or it is monotonic
  // (see resetPad). Keeping them apart lets each behave correctly, and `axis()`
  // simply takes whichever is pushed hardest.
  const pad = emptyPad(); // touch overlay writes here
  const gp = emptyPad(); // rebuilt by the poller each frame
  const gamepads = createGamepadPoller(gp);
  let attackQueued = false;
  let attackHeld = false;
  let dodgeQueued = false;
  let dodgeDown = false; // held state of Space / right-click (the plunger pull)
  let flipQueued = false;
  let flipDown = false; // held state of F / pad B (the flipper cradle)
  let sprint = false;
  let mouseDx = 0;
  let mouseDy = 0;
  let cursorX = -1;
  let cursorY = -1;
  let cursorSeen = false;

  const onKeyDown = (e: KeyboardEvent) => {
    const key = e.key.toLowerCase();
    if (MOVE_KEYS[key] || ATTACK_KEYS.has(key) || DODGE_KEYS.has(key) || FLIP_KEYS.has(key) || TURN_LEFT.has(key) || TURN_RIGHT.has(key)) e.preventDefault();
    if (MOVE_KEYS[key] || TURN_LEFT.has(key) || TURN_RIGHT.has(key)) down.add(key);
    if (ATTACK_KEYS.has(key)) {
      if (!e.repeat) attackQueued = true;
      attackHeld = true;
    }
    if (DODGE_KEYS.has(key)) {
      if (!e.repeat) dodgeQueued = true;
      dodgeDown = true; // held → the plunger pull
    }
    if (FLIP_KEYS.has(key)) {
      if (!e.repeat) flipQueued = true;
      flipDown = true; // held → the paddle stays up, and cradles
    }
    if (e.key === "Shift") sprint = true;
  };

  const onKeyUp = (e: KeyboardEvent) => {
    const key = e.key.toLowerCase();
    down.delete(key);
    if (ATTACK_KEYS.has(key)) attackHeld = false;
    if (DODGE_KEYS.has(key)) dodgeDown = false;
    if (FLIP_KEYS.has(key)) flipDown = false;
    if (e.key === "Shift") sprint = false;
  };

  const onMouseDown = (e: MouseEvent) => {
    if (e.button === 0) {
      attackQueued = true;
      attackHeld = true; // holding LMB charges a heavy attack (mouse = primary attack)
      // capture the aim point on the click itself, so the very first shot
      // fires toward the cursor even if the mouse hasn't moved yet
      cursorX = e.clientX;
      cursorY = e.clientY;
      cursorSeen = true;
    } else if (e.button === 2) {
      dodgeQueued = true; // right-click = dodge roll
      dodgeDown = true; // held right-click also pulls the plunger
    }
  };
  const onMouseUp = (e: MouseEvent) => {
    if (e.button === 0) attackHeld = false;
    if (e.button === 2) dodgeDown = false;
  };
  // Free the right mouse button for dodge (no browser context menu over the game).
  const onContextMenu = (e: MouseEvent) => e.preventDefault();

  // Relative mouse movement drives FPS look. When the pointer is locked the
  // deltas come through movementX/Y; unlocked they still accumulate so mouse
  // aiming works even without a pointer-lock grant (headless included).
  // Absolute clientX/Y drives top-down ranged AIMING (the bow points at the
  // cursor). Both live on the same handler so one listener serves both modes.
  const onMouseMove = (e: MouseEvent) => {
    mouseDx += e.movementX || 0;
    mouseDy += e.movementY || 0;
    cursorX = e.clientX;
    cursorY = e.clientY;
    cursorSeen = true;
  };

  // A tab-out mid-keypress would leave keys stuck down forever — and the same
  // is true of a pad button or a thumb that lifted off-screen.
  const onBlur = () => {
    down.clear();
    attackHeld = false;
    dodgeDown = false;
    flipDown = false;
    sprint = false;
    resetPad(pad);
    resetPad(gp);
  };

  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("keyup", onKeyUp);
  window.addEventListener("blur", onBlur);
  attackSurface.addEventListener("mousedown", onMouseDown);
  window.addEventListener("mouseup", onMouseUp);
  attackSurface.addEventListener("contextmenu", onContextMenu);
  window.addEventListener("mousemove", onMouseMove);

  return {
    axis() {
      let x = 0;
      let z = 0;
      for (const key of down) {
        const v = MOVE_KEYS[key];
        if (v) {
          x += v[0];
          z += v[1];
        }
      }
      // Clamp opposing keys, normalise diagonals so they aren't √2 faster.
      x = Math.sign(x);
      z = Math.sign(z);
      if (x !== 0 && z !== 0) {
        x *= Math.SQRT1_2;
        z *= Math.SQRT1_2;
      }
      // Larger deflection wins (see the header) — a stick at 40% walks, and a
      // keyboard's ±1 is just that curve's endpoint.
      let best = { x, z };
      for (const src of [pad, gp]) {
        if (Math.hypot(src.moveX, src.moveZ) > Math.hypot(best.x, best.z)) best = { x: src.moveX, z: src.moveZ };
      }
      return best;
    },
    consumeAttack() {
      const want = attackQueued || attackHeld || pad.attack || gp.attack || pad.attackTap || gp.attackTap;
      attackQueued = false;
      pad.attackTap = false;
      gp.attackTap = false;
      return want;
    },
    consumeAttackTap() {
      const want = attackQueued || pad.attackTap || gp.attackTap;
      attackQueued = false;
      pad.attackTap = false;
      gp.attackTap = false;
      return want;
    },
    attackHeldNow() {
      return attackHeld || pad.attack || gp.attack;
    },
    sprintHeld() {
      return sprint || pad.sprint || gp.sprint;
    },
    consumeDodge() {
      const want = dodgeQueued || pad.dodgeTap || gp.dodgeTap;
      dodgeQueued = false;
      pad.dodgeTap = false;
      gp.dodgeTap = false;
      return want;
    },
    dodgeHeld() {
      return dodgeDown || pad.dodge || gp.dodge;
    },
    consumeFlip() {
      const want = flipQueued || pad.flipTap || gp.flipTap;
      flipQueued = false;
      pad.flipTap = false;
      gp.flipTap = false;
      return want;
    },
    flipHeld() {
      return flipDown || pad.flip || gp.flip;
    },
    turnAxis() {
      let t = 0;
      for (const key of down) {
        if (TURN_LEFT.has(key)) t -= 1;
        if (TURN_RIGHT.has(key)) t += 1;
      }
      // The RIGHT STICK turns the FPS camera. Without this a pad could move in
      // rampage but never look: `aimX` fed ranged aiming and the pinball steer
      // only, and the FPS camera read `turnAxis` — which was keyboard-only. With
      // no way to turn, the strafe axis is the ONLY lateral control, which is
      // what "I can't go left or right in rampage" actually was.
      //
      // Larger deflection wins over the keyboard rather than summing, matching
      // the rule `axis()` uses — so Q plus a stick can't turn faster than either.
      const stickTurn = Math.abs(gp.aimX) > Math.abs(pad.aimX) ? gp.aimX : pad.aimX;
      if (Math.abs(stickTurn) > Math.abs(t)) t = stickTurn;
      return t;
    },
    consumeMouseDelta() {
      const d = { dx: mouseDx, dy: mouseDy };
      mouseDx = 0;
      mouseDy = 0;
      return d;
    },
    aimScreen() {
      return cursorSeen ? { x: cursorX, y: cursorY } : null;
    },
    aimStick() {
      const a = Math.hypot(gp.aimX, gp.aimY) > Math.hypot(pad.aimX, pad.aimY) ? gp : pad;
      return Math.hypot(a.aimX, a.aimY) > 0 ? { x: a.aimX, y: a.aimY } : null;
    },
    poll() {
      // Rebuild the pad's continuous state from scratch — see resetPad.
      resetPad(gp);
      gamepads.poll();
    },
    debug() {
      return { keys: [...down], touch: { ...pad }, gamepad: { ...gp }, poller: gamepads.debug() };
    },
    pad,
    clearTransient() {
      attackQueued = false;
      dodgeQueued = false;
      flipQueued = false;
      pad.attackTap = false;
      pad.dodgeTap = false;
      pad.flipTap = false;
      gp.attackTap = false;
      gp.dodgeTap = false;
      gp.flipTap = false;
      mouseDx = 0;
      mouseDy = 0;
    },
    dispose() {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
      attackSurface.removeEventListener("mousedown", onMouseDown);
      window.removeEventListener("mouseup", onMouseUp);
      attackSurface.removeEventListener("contextmenu", onContextMenu);
      window.removeEventListener("mousemove", onMouseMove);
    },
  };
}
