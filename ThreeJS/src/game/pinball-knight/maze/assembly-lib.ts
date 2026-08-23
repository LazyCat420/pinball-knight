/**
 * THE MACHINE LIBRARY — real pinball assemblies, as data.
 *
 * Each entry is one of the named mechanisms a physical table is built from,
 * reduced to this engine's vocabulary. The names are the real ones on purpose:
 * when a floor plays badly it should be possible to say "the orbit's exit dumps
 * into the slingshot" and have that mean something checkable.
 *
 * ── The design rules these encode (from real playfield practice) ───────────
 *
 *  - **A shot is a straight, unobstructed run to an entry port.** Machines that
 *    want to be shot AT declare `wantsRunway`; the placer keeps their approach
 *    clear. A machine you cannot reach in a straight line is furniture.
 *  - **Momentum is preserved through ballistic ports and replaced by eject
 *    ports.** A chain of ballistic hand-offs bleeds speed and eventually dies;
 *    an eject port re-imposes a known vector. Long chains need an eject.
 *  - **Impact ports (bumpers, slingshots) are chaos, not links.** They are
 *    marked so the router refuses to build a "combo" through them.
 *  - **Exits must not dump into a rebounder.** A real table's worst feel bug is
 *    an orbit that spits the ball at a slingshot tip; here that is a port whose
 *    exit lands on an impact part, and `assembly-check.ts` fails it.
 *
 * Footprints are in CELLS (1 cell = 2×2 tiles after thickenWalls), matching the
 * prefab authoring space. Kept small — 2 to 5 cells a side — because these are
 * machines set INTO a maze, not a replacement for it.
 *
 * Adding a machine: define it, add it to `MACHINES`, and the library test will
 * automatically check its parts sit on carved floor, its ports sit on its
 * boundary, and its exits do not fire into its own rebounders.
 */
import { type Assembly, N, S, E, W, O } from "./assembly";

/**
 * THE ORBIT — a lane that wraps a corner and returns the ball travelling the
 * other way. The signature "flow" shot: enter one side, come out somewhere
 * useful, having kept your speed.
 *
 * Boosters at both ends and a deflector on the bend: the deflector is what
 * makes it an orbit rather than two unrelated lanes. Ballistic throughout —
 * an orbit that stopped the ball would not be an orbit.
 */
const ORBIT: Assembly = {
  name: "orbit",
  w: 4,
  h: 3,
  floor: [
    [0, 0],
    [1, 0],
    [2, 0],
    [3, 0],
    [3, 1],
    [3, 2],
    [2, 2],
    [1, 2],
    [0, 2],
  ],
  parts: [
    { ci: 1, cj: 0, kind: "booster", dir: E, role: "drive", seq: 0 },
    // Both bends carry BOTH legs: in along `dir`, out along `dir2`. The upper
    // corner is entered heading E and leaves heading S; the lower is entered
    // heading S and leaves heading W. Authored with one leg each, these
    // resolved to a zero-vector throw — the orbit caught the knight and never
    // let go. See `TWO_LEG_KINDS` and `corner-missing-leg`.
    { ci: 3, cj: 0, kind: "deflector", dir: E, dir2: S, role: "turn", seq: 1 },
    { ci: 3, cj: 2, kind: "deflector", dir: S, dir2: W, role: "turn", seq: 2 },
    { ci: 1, cj: 2, kind: "booster", dir: W, role: "drive", seq: 3 },
  ],
  ports: [
    { ci: 0, cj: 0, dir: E, way: "in", flow: "ballistic", minSpeed: 6, tag: "upper" },
    { ci: 0, cj: 2, dir: W, way: "out", flow: "ballistic", tag: "return" },
  ],
  wantsRunway: 4,
};

/**
 * THE RAMP-AND-RETURN — a ramp that throws the ball up the lane and a habitrail
 * that brings it back. On a real table the RETURN is the part that matters:
 * a ramp whose ball comes back to you is a combo, a ramp that dumps it into the
 * pops is a coin flip.
 *
 * The return leg ejects rather than throwing ballistically, so the hand-off
 * happens at a known speed regardless of how hard the ramp was hit.
 */
const RAMP_RETURN: Assembly = {
  name: "ramp-return",
  w: 3,
  h: 3,
  floor: [
    [0, 0],
    [1, 0],
    [2, 0],
    [2, 1],
    [0, 2],
    [1, 2],
    [2, 2],
  ],
  parts: [
    { ci: 0, cj: 0, kind: "ramp", dir: E, role: "drive", seq: 0 },
    // The bend is at the END of the ramp's run (2,0), not one cell down it.
    // Authored at (2,1) this sat mid-straight on the descent — a corner part on
    // a cell with no corner, which is why its single leg looked plausible.
    // Entered heading E off the ramp, thrown S down to the return lane.
    { ci: 2, cj: 0, kind: "deflector", dir: E, dir2: S, role: "turn", seq: 1 },
    { ci: 2, cj: 2, kind: "spring", dir: W, role: "drive", seq: 2 },
  ],
  ports: [
    { ci: 0, cj: 0, dir: E, way: "in", flow: "ballistic", minSpeed: 8, tag: "ramp" },
    { ci: 0, cj: 2, dir: W, way: "out", flow: "eject", tag: "return" },
  ],
  wantsRunway: 5,
};

/**
 * THE DROP-TARGET BANK — three targets in a row that must be cleared, opening
 * the way behind them. The classic state-gated door: before the bank falls it
 * is a wall you score off, after it falls it is a lane.
 *
 * `seq` is the 1-2-3 order the runtime already understands from the shipped
 * bank machinery. A terminus by design — it has no exit port, because what is
 * behind it is the reward, not another machine.
 */
const TARGET_BANK: Assembly = {
  name: "target-bank",
  w: 3,
  h: 2,
  floor: [
    [0, 0],
    [1, 0],
    [2, 0],
    [0, 1],
    [1, 1],
    [2, 1],
  ],
  parts: [
    { ci: 0, cj: 1, kind: "target", dir: N, role: "score", seq: 0 },
    { ci: 1, cj: 1, kind: "target", dir: N, role: "score", seq: 1 },
    { ci: 2, cj: 1, kind: "target", dir: N, role: "score", seq: 2 },
  ],
  ports: [{ ci: 1, cj: 0, dir: S, way: "in", flow: "ballistic", tag: "face" }],
  wantsRunway: 4,
};

/**
 * THE POP NEST — three bumpers in a triangle, the table's chaos engine.
 *
 * Real-table rule encoded here: a pop nest must be RUBBER-BOUNDED and have a
 * DEFINED EXIT. Ringing pops in steel with no way out "kills the action" — the
 * ball rattles pointlessly instead of being spat somewhere. So the nest carves
 * an open chamber and declares one impact-flagged exit: you know the ball
 * leaves, you do not know exactly when.
 */
const POP_NEST: Assembly = {
  name: "pop-nest",
  w: 3,
  h: 3,
  floor: [
    [0, 0],
    [1, 0],
    [2, 0],
    [0, 1],
    [1, 1],
    [2, 1],
    [0, 2],
    [1, 2],
    [2, 2],
  ],
  parts: [
    { ci: 1, cj: 0, kind: "bumper", dir: O, role: "rebound" },
    { ci: 0, cj: 2, kind: "bumper", dir: O, role: "rebound" },
    { ci: 2, cj: 2, kind: "bumper", dir: O, role: "rebound" },
  ],
  ports: [
    { ci: 1, cj: 1, dir: S, way: "in", flow: "ballistic", tag: "mouth" },
    // Impact: the ball WILL come out, but not on a schedule you can chain.
    { ci: 1, cj: 2, dir: S, way: "out", flow: "impact", tag: "spill" },
  ],
};

/**
 * THE SLINGSHOT PAIR — two angled kickers facing a shared lane, the thing that
 * keeps a ball alive and adds unpredictability at the same time.
 *
 * Both are impact ports: a slingshot's whole job is an unpredictable rebound.
 * This machine deliberately has NO out port — a ball leaves it by being flung,
 * not by being handed on, and pretending otherwise would let the router build
 * a combo through the least predictable part on the table.
 */
const SLING_PAIR: Assembly = {
  name: "sling-pair",
  w: 3,
  h: 2,
  floor: [
    [0, 0],
    [1, 0],
    [2, 0],
    [0, 1],
    [1, 1],
    [2, 1],
  ],
  parts: [
    { ci: 0, cj: 1, kind: "slingshot", dir: E, role: "rebound", seq: 0 },
    { ci: 2, cj: 1, kind: "slingshot", dir: W, role: "rebound", seq: 1 },
  ],
  ports: [{ ci: 1, cj: 0, dir: S, way: "in", flow: "ballistic", tag: "lane" }],
};

/**
 * THE KICKER LANE (scoop) — swallows the ball and spits it out along an
 * authored vector. The reliable link: however the ball arrived, it leaves the
 * same way every time, which is what makes long chains survivable.
 *
 * A spring is the engine's nearest thing to a scoop's kickout coil.
 */
const KICKER_LANE: Assembly = {
  name: "kicker-lane",
  w: 2,
  h: 2,
  floor: [
    [0, 0],
    [1, 0],
    [0, 1],
    [1, 1],
  ],
  parts: [
    { ci: 0, cj: 1, kind: "spring", dir: E, role: "drive", seq: 0 },
    { ci: 1, cj: 0, kind: "rollover", dir: O, role: "score" },
  ],
  ports: [
    { ci: 0, cj: 0, dir: S, way: "in", flow: "ballistic", tag: "mouth" },
    { ci: 1, cj: 1, dir: E, way: "out", flow: "eject", tag: "kickout" },
  ],
};

/**
 * THE SPINNER GATE — a lane you shoot THROUGH, scoring as you pass. Guards an
 * orbit mouth on a real table, which is why it is a straight pass-through with
 * matching in/out directions and no turn.
 */
const SPINNER_GATE: Assembly = {
  name: "spinner-gate",
  w: 3,
  h: 1,
  floor: [
    [0, 0],
    [1, 0],
    [2, 0],
  ],
  parts: [
    { ci: 1, cj: 0, kind: "spinpad", dir: E, role: "score" },
    { ci: 2, cj: 0, kind: "booster", dir: E, role: "drive" },
  ],
  ports: [
    { ci: 0, cj: 0, dir: E, way: "in", flow: "ballistic", minSpeed: 5, tag: "mouth" },
    { ci: 2, cj: 0, dir: E, way: "out", flow: "ballistic", tag: "through" },
  ],
  wantsRunway: 4,
};

/**
 * THE ROLLOVER LANES — a parallel array you complete by rolling each one. The
 * shipped `lane`/`laneSeq` machinery's authored form. Pass-through in both
 * directions, so it composes on either side.
 */
const ROLLOVER_BANK: Assembly = {
  name: "rollover-bank",
  w: 3,
  h: 2,
  floor: [
    [0, 0],
    [1, 0],
    [2, 0],
    [0, 1],
    [1, 1],
    [2, 1],
  ],
  parts: [
    { ci: 0, cj: 0, kind: "rollover", dir: S, role: "score", seq: 0 },
    { ci: 1, cj: 0, kind: "rollover", dir: S, role: "score", seq: 1 },
    { ci: 2, cj: 0, kind: "rollover", dir: S, role: "score", seq: 2 },
  ],
  ports: [
    { ci: 1, cj: 0, dir: S, way: "in", flow: "ballistic", tag: "lanes" },
    { ci: 1, cj: 1, dir: S, way: "out", flow: "ballistic", tag: "below" },
  ],
};

/**
 * The library. Order is not significant — the placer draws from a shuffle bag.
 */
export const MACHINES: readonly Assembly[] = [
  ORBIT,
  RAMP_RETURN,
  TARGET_BANK,
  POP_NEST,
  SLING_PAIR,
  KICKER_LANE,
  SPINNER_GATE,
  ROLLOVER_BANK,
];

/** Look one up by name (tests, debug tooling, forced placement). */
export function machineNamed(name: string): Assembly | undefined {
  return MACHINES.find((m) => m.name === name);
}
