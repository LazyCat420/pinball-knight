/**
 * Keyboard + mouse input for the dungeon.
 *
 * WASD / arrows to move, LEFT-CLICK to attack (hold = heavy) toward the cursor,
 * SPACE or right-click to dodge, Shift to sprint. The room's own input is
 * already muted while we run (core calls setInputOwner), so listening on window
 * here is safe.
 */

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
   * Keyboard turn axis for the FPS ultimate: -1 (turn left) .. +1 (turn right),
   * from Q/E and the left/right arrows. Lets rampage be driven with the keyboard
   * alone (and headlessly), independent of mouse-look.
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
  let attackQueued = false;
  let attackHeld = false;
  let dodgeQueued = false;
  let dodgeDown = false; // held state of Space / right-click (the plunger pull)
  let sprint = false;
  let mouseDx = 0;
  let mouseDy = 0;
  let cursorX = -1;
  let cursorY = -1;
  let cursorSeen = false;

  const onKeyDown = (e: KeyboardEvent) => {
    const key = e.key.toLowerCase();
    if (MOVE_KEYS[key] || ATTACK_KEYS.has(key) || DODGE_KEYS.has(key) || TURN_LEFT.has(key) || TURN_RIGHT.has(key)) e.preventDefault();
    if (MOVE_KEYS[key] || TURN_LEFT.has(key) || TURN_RIGHT.has(key)) down.add(key);
    if (ATTACK_KEYS.has(key)) {
      if (!e.repeat) attackQueued = true;
      attackHeld = true;
    }
    if (DODGE_KEYS.has(key)) {
      if (!e.repeat) dodgeQueued = true;
      dodgeDown = true; // held → the plunger pull
    }
    if (e.key === "Shift") sprint = true;
  };

  const onKeyUp = (e: KeyboardEvent) => {
    const key = e.key.toLowerCase();
    down.delete(key);
    if (ATTACK_KEYS.has(key)) attackHeld = false;
    if (DODGE_KEYS.has(key)) dodgeDown = false;
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

  // A tab-out mid-keypress would leave keys stuck down forever.
  const onBlur = () => {
    down.clear();
    attackHeld = false;
    dodgeDown = false;
    sprint = false;
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
      return { x, z };
    },
    consumeAttack() {
      const want = attackQueued || attackHeld;
      attackQueued = false;
      return want;
    },
    consumeAttackTap() {
      const want = attackQueued;
      attackQueued = false;
      return want;
    },
    attackHeldNow() {
      return attackHeld;
    },
    sprintHeld() {
      return sprint;
    },
    consumeDodge() {
      const want = dodgeQueued;
      dodgeQueued = false;
      return want;
    },
    dodgeHeld() {
      return dodgeDown;
    },
    turnAxis() {
      let t = 0;
      for (const key of down) {
        if (TURN_LEFT.has(key)) t -= 1;
        if (TURN_RIGHT.has(key)) t += 1;
      }
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
