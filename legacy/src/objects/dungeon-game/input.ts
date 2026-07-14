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

export function createInput(attackSurface: HTMLElement): InputHandle {
  const down = new Set<string>();
  let attackQueued = false;
  let attackHeld = false;

  const onKeyDown = (e: KeyboardEvent) => {
    const key = e.key.toLowerCase();
    if (MOVE_KEYS[key] || ATTACK_KEYS.has(key)) e.preventDefault(); // stop page scroll
    if (MOVE_KEYS[key]) down.add(key);
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

  // A tab-out mid-keypress would leave keys stuck down forever.
  const onBlur = () => {
    down.clear();
    attackHeld = false;
  };

  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("keyup", onKeyUp);
  window.addEventListener("blur", onBlur);
  attackSurface.addEventListener("mousedown", onMouseDown);

  return {
    axis() {
      let x = 0;
      let z = 0;
      for (const key of down) {
        const v = MOVE_KEYS[key];
        x += v[0];
        z += v[1];
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
    dispose() {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
      attackSurface.removeEventListener("mousedown", onMouseDown);
    },
  };
}
