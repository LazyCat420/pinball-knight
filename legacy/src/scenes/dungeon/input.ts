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

// Attack = J or left-click. Space is now the DODGE key (freed from attack), so
// the roll gets its own dedicated tap and attack stays on J / mouse.
const ATTACK_KEYS = new Set(["j"]);
const DODGE_KEYS = new Set([" "]);
// FPS look-turn keys: q/e plus the left/right arrows (left = turn left).
const TURN_LEFT = new Set(["q", "arrowleft"]);
const TURN_RIGHT = new Set(["e", "arrowright"]);

export function createInput(attackSurface: HTMLElement): InputHandle {
  const down = new Set<string>();
  let attackQueued = false;
  let attackHeld = false;
  let dodgeQueued = false;
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
    if (DODGE_KEYS.has(key) && !e.repeat) dodgeQueued = true;
    if (e.key === "Shift") sprint = true;
  };

  const onKeyUp = (e: KeyboardEvent) => {
    const key = e.key.toLowerCase();
    down.delete(key);
    if (ATTACK_KEYS.has(key)) attackHeld = false;
    if (e.key === "Shift") sprint = false;
  };

  const onMouseDown = (e: MouseEvent) => {
    if (e.button === 0) {
      attackQueued = true;
      // capture the aim point on the click itself, so the very first shot
      // fires toward the cursor even if the mouse hasn't moved yet
      cursorX = e.clientX;
      cursorY = e.clientY;
      cursorSeen = true;
    }
  };

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
    sprint = false;
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
      window.removeEventListener("mousemove", onMouseMove);
    },
  };
}
