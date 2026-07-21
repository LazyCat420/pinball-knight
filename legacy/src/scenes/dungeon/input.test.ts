import { describe, expect, it } from "vitest";
import { MOVE_KEYS, TURN_LEFT, TURN_RIGHT, createInput } from "./input";

describe("dungeon input bindings", () => {
  /**
   * The regression this exists for:
   *
   * `arrowleft`/`arrowright` were bound in MOVE_KEYS *and* in
   * TURN_LEFT/TURN_RIGHT. Both are read from the same held-key set — `axis()`
   * for movement, `turnAxis()` for the FPS camera — so in FPS mode holding Left
   * strafed left and rotated the camera left on the same frame.
   *
   * That compound motion is the most likely source of the "control inversion"
   * suspicion carried in ROADMAP §6 and VERIFY_CHECKLIST §6 for several
   * revisions. There is no sign error in the movement or aim math; the arrows
   * were simply doing two jobs at once.
   */
  it("binds no key to both movement and turning", () => {
    const turnKeys = [...TURN_LEFT, ...TURN_RIGHT];
    const doubleBound = turnKeys.filter((k) => k in MOVE_KEYS);
    expect(doubleBound).toEqual([]);
  });

  it("keeps the arrows as a movement alias for WASD", () => {
    // Iso mode has no turn, so arrows must still move or arrow-key players lose
    // movement entirely.
    expect(MOVE_KEYS["arrowleft"]).toEqual(MOVE_KEYS["a"]);
    expect(MOVE_KEYS["arrowright"]).toEqual(MOVE_KEYS["d"]);
    expect(MOVE_KEYS["arrowup"]).toEqual(MOVE_KEYS["w"]);
    expect(MOVE_KEYS["arrowdown"]).toEqual(MOVE_KEYS["s"]);
  });

  it("keeps q/e as the FPS turn keys", () => {
    expect(TURN_LEFT.has("q")).toBe(true);
    expect(TURN_RIGHT.has("e")).toBe(true);
  });

  it("has opposing movement axes that cancel", () => {
    // Guards against a sign typo in the movement table itself.
    expect(MOVE_KEYS["a"][0]).toBe(-MOVE_KEYS["d"][0]);
    expect(MOVE_KEYS["w"][1]).toBe(-MOVE_KEYS["s"][1]);
  });

  /**
   * The regression this exists for: the window keydown listener keeps running
   * while a modal (card reader / menu) is up, so the Space that DISMISSED the
   * modal sits queued as a dodge and fires a roll the instant the sim resumes.
   * Modals call clearTransient() on close; it must drain queued taps without
   * releasing held state (a held plunger pull should survive a toast).
   */
  it("clearTransient drains queued taps but keeps held state", () => {
    // node test env has no window/DOM — stub just enough to capture handlers.
    const handlers: Record<string, (e: unknown) => void> = {};
    const g = globalThis as { window?: unknown };
    g.window = {
      addEventListener: (type: string, fn: (e: unknown) => void) => {
        handlers[type] = fn;
      },
      removeEventListener: () => {},
    };
    const surface = { addEventListener: () => {}, removeEventListener: () => {} } as unknown as HTMLElement;
    try {
      const input = createInput(surface);
      handlers.keydown({ key: " ", repeat: false, preventDefault: () => {} });
      input.clearTransient();
      expect(input.consumeDodge()).toBe(false); // the queued tap is gone…
      expect(input.dodgeHeld()).toBe(true); // …but the key is still held
      handlers.keyup({ key: " " });
      expect(input.dodgeHeld()).toBe(false);
    } finally {
      delete g.window;
    }
  });
});
