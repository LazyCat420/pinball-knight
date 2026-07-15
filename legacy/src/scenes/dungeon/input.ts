/**
 * Keyboard + mouse input for the dungeon.
 *
 * WASD / arrows to move, Space / J / left-click to attack. The room's own
 * input is already muted while we run (core calls setInputOwner), so listening
 * on window here is safe.
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
  dispose(): void;
}

const MOVE_KEYS: Record<string, [number, number]> = {
  w: [0, -1],
  arrowup: [0, -1],
  s: [0, 1],
  arrowdown: [0, 1],
  a: [-1, 0],
  arrowleft: [-1, 0],
  d: [1, 0],
  arrowright: [1, 0],
};

const ATTACK_KEYS = new Set([" ", "j"]);
// FPS look-turn keys: q/e plus the left/right arrows (left = turn left).
const TURN_LEFT = new Set(["q", "arrowleft"]);
const TURN_RIGHT = new Set(["e", "arrowright"]);

export function createInput(attackSurface: HTMLElement): InputHandle {
  const down = new Set<string>();
  let attackQueued = false;
  let attackHeld = false;
  let mouseDx = 0;
  let mouseDy = 0;

  const onKeyDown = (e: KeyboardEvent) => {
    const key = e.key.toLowerCase();
    if (MOVE_KEYS[key] || ATTACK_KEYS.has(key) || TURN_LEFT.has(key) || TURN_RIGHT.has(key)) e.preventDefault();
    if (MOVE_KEYS[key] || TURN_LEFT.has(key) || TURN_RIGHT.has(key)) down.add(key);
    if (ATTACK_KEYS.has(key)) {
      if (!e.repeat) attackQueued = true;
      attackHeld = true;
    }
  };

  const onKeyUp = (e: KeyboardEvent) => {
    const key = e.key.toLowerCase();
    down.delete(key);
    if (ATTACK_KEYS.has(key)) attackHeld = false;
  };

  const onMouseDown = (e: MouseEvent) => {
    if (e.button === 0) attackQueued = true;
  };

  // Relative mouse movement drives FPS look. When the pointer is locked the
  // deltas come through movementX/Y; unlocked they still accumulate so mouse
  // aiming works even without a pointer-lock grant (headless included).
  const onMouseMove = (e: MouseEvent) => {
    mouseDx += e.movementX || 0;
    mouseDy += e.movementY || 0;
  };

  // A tab-out mid-keypress would leave keys stuck down forever.
  const onBlur = () => {
    down.clear();
    attackHeld = false;
  };

  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("keyup", onKeyUp);
  window.addEventListener("blur", onBlur);
  attackSurface.addEventListener("mousedown", onMouseDown);
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
    dispose() {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
      attackSurface.removeEventListener("mousedown", onMouseDown);
      window.removeEventListener("mousemove", onMouseMove);
    },
  };
}
