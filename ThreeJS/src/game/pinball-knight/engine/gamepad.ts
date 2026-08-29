/**
 * GAMEPAD — Xbox/PlayStation/generic pads, via the standard Gamepad API.
 *
 * The mapping targets the "standard" layout every modern pad reports, and is
 * chosen so the dungeon's two modes both work without a mode switch:
 *
 *   left stick   move (analog — a half-deflection walks)
 *   right stick  aim: the bow points where you push, and in the FPS rampage it
 *                turns the camera
 *   A / cross    dodge roll — and HOLD is the plunger pull, same as Space
 *   B / circle   THE FLIPPER BUTTON — tap to swing, hold to cradle (same as F)
 *   X / square   attack (hold = heavy charge, same as holding LMB)
 *   RT           attack alias, because a trigger is where a shoulder-shooter
 *                player's finger already is
 *   LT           sprint
 *   LB / RB      the two active skills (Q / E)
 *   Y / triangle rampage
 *   D-pad        belt slots 1-4
 *   stick click  swap weapon (Tab)
 *   Start        menu · Back  map
 *
 * `readPad` is PURE — it takes anything shaped like a Gamepad, so the mapping
 * and the deadzone maths are testable without a browser or a physical pad,
 * which is the only way any of this gets verified in CI.
 */
import { applyDeadzone, pressKey, type VirtualPad } from "./virtual-pad";

/** Minimal shape of what we read — lets tests pass plain objects. */
export interface PadLike {
  axes: readonly number[];
  buttons: readonly { pressed: boolean }[];
  connected?: boolean;
  id?: string;
}

/** Standard-mapping button indices. */
export const BTN = {
  A: 0,
  B: 1,
  X: 2,
  Y: 3,
  LB: 4,
  RB: 5,
  LT: 6,
  RT: 7,
  BACK: 8,
  START: 9,
  L3: 10,
  R3: 11,
  DUP: 12,
  DDOWN: 13,
  DLEFT: 14,
  DRIGHT: 15,
} as const;

/** Sticks rest a little off-centre on worn hardware; 0.22 is the usual floor. */
export const STICK_DEADZONE = 0.22;
/** How far the aim stick must move before it takes over from the mouse cursor. */
export const AIM_DEADZONE = 0.35;

/** Discrete presses, in the order they are checked. Each maps to the key the
 *  game's existing keydown switch already handles (see virtual-pad.pressKey). */
const TAP_BINDINGS: ReadonlyArray<{ btn: number; key: string }> = [
  { btn: BTN.LB, key: "q" },
  { btn: BTN.RB, key: "e" },
  { btn: BTN.Y, key: "r" },
  { btn: BTN.START, key: "i" },
  { btn: BTN.BACK, key: "m" },
  { btn: BTN.L3, key: "Tab" },
  { btn: BTN.R3, key: "Tab" },
  { btn: BTN.DUP, key: "1" },
  { btn: BTN.DRIGHT, key: "2" },
  { btn: BTN.DDOWN, key: "3" },
  { btn: BTN.DLEFT, key: "4" },
];

const pressed = (p: PadLike, i: number): boolean => p.buttons[i]?.pressed ?? false;

/**
 * Fold one pad's live state into `out`, and return the discrete keys whose
 * buttons were freshly pressed this frame (edges against `prev`).
 *
 * `prev` is the previous frame's button-pressed array, or NULL for the first
 * poll of a pad. The distinction matters: `[]` means "known, nothing was
 * pressed" (so anything down now is an edge), while `null` means "we have never
 * seen this pad" — a button already held at connect time is HELD, not freshly
 * pressed, and firing an edge there would cast a skill the player never asked
 * for the instant they plug in.
 *
 * Returning the taps rather than dispatching them keeps this function pure —
 * the caller decides whether to fire them, which is what lets a test assert the
 * mapping without a window.
 */
export function readPad(pad: PadLike | null | undefined, out: VirtualPad, prev: readonly boolean[] | null): { taps: string[]; buttons: boolean[] } {
  if (!pad || pad.connected === false) return { taps: [], buttons: [] };

  const move = applyDeadzone(pad.axes[0] ?? 0, pad.axes[1] ?? 0, STICK_DEADZONE);
  // A pad and the keyboard can both be live (a stream setup, or a test); the
  // LARGER deflection wins rather than summing, so they never fight into a
  // faster-than-possible diagonal.
  if (Math.hypot(move.x, move.y) > Math.hypot(out.moveX, out.moveZ)) {
    out.moveX = move.x;
    out.moveZ = move.y;
  }

  const aim = applyDeadzone(pad.axes[2] ?? 0, pad.axes[3] ?? 0, AIM_DEADZONE);
  if (Math.hypot(aim.x, aim.y) > Math.hypot(out.aimX, out.aimY)) {
    out.aimX = aim.x;
    out.aimY = aim.y;
  }

  const attack = pressed(pad, BTN.X) || pressed(pad, BTN.RT);
  const dodge = pressed(pad, BTN.A);
  out.attack ||= attack;
  out.dodge ||= dodge;
  out.sprint ||= pressed(pad, BTN.LT);
  // B/circle is the flipper button. It lives HERE and not in TAP_BINDINGS
  // because it needs its HELD state as well as its edge — a held flipper stays
  // up and cradles — and TAP_BINDINGS only ever synthesises a keydown+keyup
  // pair, which cannot express a hold.
  out.flip ||= pressed(pad, BTN.B);

  // Rising edges — see the `prev: null` contract above.
  const buttons: boolean[] = [];
  for (let i = 0; i < pad.buttons.length; i++) buttons[i] = pressed(pad, i);
  const edge = (i: number): boolean => prev !== null && buttons[i] === true && prev[i] !== true;

  if (edge(BTN.X) || edge(BTN.RT)) out.attackTap = true;
  if (edge(BTN.A)) out.dodgeTap = true;
  if (edge(BTN.B)) out.flipTap = true;

  const taps: string[] = [];
  for (const b of TAP_BINDINGS) if (edge(b.btn)) taps.push(b.key);
  return { taps, buttons };
}

/**
 * Poll every connected pad each frame and fold them into `out`.
 *
 * Multiple pads are merged rather than picking "player 1": on a machine with a
 * stale ghost pad reported alongside a real one (common on Windows) picking the
 * first would silently pick the dead one.
 */
export function createGamepadPoller(out: VirtualPad): { poll(): void; connected(): boolean; debug(): unknown } {
  // undefined at index k = pad k has never been polled (see readPad's contract).
  let prev: Array<boolean[] | undefined> = [];
  let seen = false;
  let lastTaps: string[] = [];
  let polls = 0;
  return {
    poll() {
      if (typeof navigator === "undefined" || !navigator.getGamepads) return;
      polls++;
      const pads = navigator.getGamepads();
      seen = false;
      for (let k = 0; k < pads.length; k++) {
        const pad = pads[k];
        // An EMPTY slot forgets its pad, per slot. Clearing only when every pad
        // is gone is not enough: with a second pad still connected, a stale
        // prev[0] would be compared against a DIFFERENT pad plugged into slot 0
        // later, and a button held at that moment reads as a fresh press — the
        // phantom-action-on-connect that `prev: null` exists to prevent.
        if (!pad) {
          prev[k] = undefined;
          continue;
        }
        seen = true;
        const res = readPad(pad as PadLike, out, prev[k] ?? null);
        prev[k] = res.buttons;
        if (res.taps.length) lastTaps = res.taps;
        for (const key of res.taps) pressKey(key);
      }
      // Trailing slots the browser stopped reporting entirely (the array itself
      // shrank) are dropped too — the loop above never visits those indices.
      if (prev.length > pads.length) prev.length = pads.length;
    },
    connected() {
      return seen;
    },
    /** Read-back for the `__dungeonInput` QA hook — a pad cannot be asserted on
     *  any other way from a headless harness. */
    debug() {
      return { polls, connected: seen, lastTaps, prevKnown: prev.map((b) => (b ? b.length : -1)) };
    },
  };
}
