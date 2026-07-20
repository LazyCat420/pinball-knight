import { describe, expect, it } from "vitest";
import { MOVE_KEYS, TURN_LEFT, TURN_RIGHT } from "./input";

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
});
