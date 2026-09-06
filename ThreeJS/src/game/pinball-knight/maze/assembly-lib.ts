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
 *  - **A machine that HOLDS the ball must say where it lets go.** A capture is
 *    the one place flow stops rather than bends, so the release is a decision
 *    the machine makes, not a continuation of the shot the player made. An
 *    authored `eject` is that decision; without one the definition has stated
 *    a softlock (`capture-no-release`).
 *  - **Every ride declares where a FAILED ride lands.** A port tagged
 *    `RECOVERY_TAG`. The pipeline has always had rescue — the duel breaker,
 *    the flow-loop breaker, the booster-jam guard — and rescue can only guess.
 *    A landing declared here is the machine answering in advance
 *    (`no-recovery`). Four machines predate the rule and are named in
 *    `RECOVERY_GRANDFATHERED` with the reason each was left alone.
 *
 * Footprints are in CELLS (1 cell = 2×2 tiles after thickenWalls), matching the
 * prefab authoring space. Kept small — 2 to 5 cells a side — because these are
 * machines set INTO a maze, not a replacement for it.
 *
 * Adding a machine: define it, add it to `MACHINES`, and the library test will
 * automatically check its parts sit on carved floor, its ports sit on its
 * boundary, and its exits do not fire into its own rebounders.
 */
import { type Assembly, RECOVERY_TAG, N, S, E, W, O } from "./assembly";
// The maw's own trigger threshold, imported rather than transcribed: the scoop
// below sets its entry `minSpeed` FROM the mechanic, so the two cannot drift
// apart into a machine that asks for a speed the mechanic no longer needs.
import { MAW_SWALLOW_SPEED } from "../entities/maw";

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
 * THE GARGOYLE SCOOP — a stone face that swallows the ball and decides where
 * it comes back out.
 *
 * The library's first CAPTURE. Every machine above it bends, accelerates or
 * scatters a ball that never stops moving; this one stops it. That is the
 * difference between a shot and a set piece: up to the mouth the trajectory is
 * the player's, after it the trajectory is the machine's.
 *
 * ── Why it is shaped like this ─────────────────────────────────────────────
 *
 * **The bank guards the mouth.** Three drop targets stand across the approach
 * at `cj: 1` with the maw behind them at `cj: 2`. Before the bank falls the
 * scoop is a wall you score off; after it falls the scoop is a mouth. That is
 * the classic state-gated door — the same shape as `TARGET_BANK`, except that
 * here what is behind it is a mechanism rather than a reward. Only the middle
 * target sits on the straight line the runway guarantees; the flanking two are
 * ricochet work, which is what clearing a real bank takes.
 *
 * **The mouth faces the shooter.** `maw` reads `dir` as its OUTWARD face and
 * swallows along the opposite vector (`canMawSwallow` builds the throat as
 * `-part.dir` and requires the player's heading inside a 45° cone of it). The
 * ball arrives travelling S, so the face points N. Authoring it the other way
 * round produces a maw that can only be entered from behind — a mechanism that
 * is never triggered and never errors.
 *
 * **`minSpeed` is the maw's real threshold, not a guess.** Below
 * `MAW_SWALLOW_SPEED` (10.0) `canMawSwallow` returns false and the ball rolls
 * over the stone face: the whole machine is scenery. An entry port with
 * `minSpeed: 0` lets the router hang this off a corner where the shot can
 * never arrive fast enough, and nothing downstream would ever say so. Hence
 * also `wantsRunway: 6`, the longest demand in the library — a maw without a
 * straight run at it is a maw that does not fire.
 *
 * **Two exits, because the choice IS the mechanic.** Enter the mouth, come out
 * west or east. Both are `eject`: momentum is discarded and replaced, which is
 * the only honest flow for a ball that was stopped, and which makes either
 * exit a reliable link for the router to chain onward from. One exit would be
 * a scoop; two is a decision.
 *
 * **The landing.** A shot that arrives under 10 u/s does not get swallowed —
 * it bounces off the face and rolls back up the approach. That failure is
 * authored rather than left to the runtime's rescue passes: the recovery port
 * sits on the mouth cell firing N, back out the way the shot came. It costs
 * the router nothing, because `wantsRunway` already demands open floor in
 * exactly that direction.
 */
const GARGOYLE_SCOOP: Assembly = {
  name: "gargoyle-scoop",
  w: 3,
  h: 3,
  floor: [
    [1, 0],
    [0, 1],
    [1, 1],
    [2, 1],
    [0, 2],
    [1, 2],
    [2, 2],
  ],
  parts: [
    { ci: 0, cj: 1, kind: "target", dir: N, role: "score", seq: 0 },
    { ci: 1, cj: 1, kind: "target", dir: N, role: "score", seq: 1 },
    { ci: 2, cj: 1, kind: "target", dir: N, role: "score", seq: 2 },
    // Faces N, swallows S. See the note above — this is the one field that
    // decides whether the mechanism can be triggered at all.
    { ci: 1, cj: 2, kind: "maw", dir: N, role: "capture", seq: 3 },
  ],
  ports: [
    // The entry is FIRST on purpose: `scoreAt` anchors the whole footprint on
    // `ports.find(p => p.way !== "out")`, so the machine hangs off the road by
    // its mouth rather than by whichever exit happened to be authored first.
    { ci: 1, cj: 0, dir: S, way: "in", flow: "ballistic", minSpeed: MAW_SWALLOW_SPEED, tag: "mouth" },
    { ci: 0, cj: 2, dir: W, way: "out", flow: "eject", tag: "gullet-west" },
    { ci: 2, cj: 2, dir: E, way: "out", flow: "eject", tag: "gullet-east" },
    { ci: 1, cj: 0, dir: N, way: "out", flow: "eject", tag: RECOVERY_TAG },
  ],
  wantsRunway: 6,
};

/**
 * Seq stride between the reactor's lanes.
 *
 * `AssemblyRef` carries `{id, name, role, seq}` and nothing else, so three
 * loops inside ONE machine have exactly one channel to distinguish themselves
 * by: the sequence number. Banding it — 0-9 left, 10-19 centre, 20-29 right —
 * lets a scoring rule say "he alternated between three distinct loops" instead
 * of "he hit six things in order", which is the difference between a combo and
 * a counter.
 *
 * Exported because the test derives lane membership from it. A test that
 * hard-codes 10 agrees with itself forever if the library renumbers.
 */
export const LOOP_LANE_STRIDE = 10;

/**
 * THE LOOP REACTOR — three loop shots in one machine, and they are three
 * DIFFERENT shots.
 *
 * A real table's loops are the skill shots: you shoot the left orbit, then the
 * right, then the centre lane, and the table rewards you for having chosen
 * three different things. That reward is impossible to score if the three
 * shots are indistinguishable in the data, which is the whole design problem
 * this machine exists to solve — hence `LOOP_LANE_STRIDE`, three distinct
 * mouth tags, and three genuinely different lane shapes:
 *
 *  · LEFT   (seq 0-1)   booster up the riser, deflector throwing WEST out.
 *  · CENTRE (seq 10-11) a spinner you shoot THROUGH, then a magnetic strip
 *    that carries the ball across on another layer — a `transfer`, the first
 *    in the library. The centre lane has no corner: it is a lane, not an orbit,
 *    and pretending otherwise would make it the left loop mirrored.
 *  · RIGHT  (seq 20-21) booster up the riser, deflector throwing EAST out.
 *
 * Three mouths on the south face, three exits on three different vectors (W,
 * N, E). Nothing crosses anything: two exits firing at each other inside one
 * footprint is the launch-duel shape the pipeline spends real effort breaking,
 * and `SLING_PAIR` is already withheld from the router for exactly that.
 *
 * **The dividers are uncarved on purpose.** `ci: 1` and `ci: 3` are not in
 * `floor`, and that is the lane divider a real playfield puts between parallel
 * lanes. It is also why the machine fits: the placer reads `floor` as a
 * REQUIREMENT (these cells must already be walkable), so six carved cells in a
 * 5×2 box asks far less of a floor than ten would.
 *
 * **Both legs on both corners.** `deflector` is entered on `dir` and leaves on
 * `dir2`; one leg resolves to a throw along (0,0) and the knight is caught and
 * never released. That bug shipped twice in this file — see `TWO_LEG_KINDS`.
 *
 * **One eject.** The library's own rule is that a chain of ballistic hand-offs
 * bleeds speed and eventually dies. The centre transfer is the link that
 * re-imposes a known vector, so a route through this machine survives.
 *
 * **The landing.** A loop shot that dies rolls back down the lane it went up.
 * The recovery port says so — south out of the centre mouth — instead of
 * leaving the runtime to work it out from the flow field.
 */
const LOOP_REACTOR: Assembly = {
  name: "loop-reactor",
  w: 5,
  h: 2,
  floor: [
    [0, 0],
    [0, 1],
    [2, 0],
    [2, 1],
    [4, 0],
    [4, 1],
  ],
  parts: [
    { ci: 0, cj: 1, kind: "booster", dir: N, role: "drive", seq: 0 },
    { ci: 0, cj: 0, kind: "deflector", dir: N, dir2: W, role: "turn", seq: 1 },
    { ci: 2, cj: 1, kind: "spinpad", dir: N, role: "score", seq: LOOP_LANE_STRIDE },
    { ci: 2, cj: 0, kind: "magstrip", dir: N, role: "transfer", seq: LOOP_LANE_STRIDE + 1 },
    { ci: 4, cj: 1, kind: "booster", dir: N, role: "drive", seq: 2 * LOOP_LANE_STRIDE },
    { ci: 4, cj: 0, kind: "deflector", dir: N, dir2: E, role: "turn", seq: 2 * LOOP_LANE_STRIDE + 1 },
  ],
  ports: [
    { ci: 0, cj: 1, dir: N, way: "in", flow: "ballistic", minSpeed: 6, tag: "loop-left" },
    { ci: 2, cj: 1, dir: N, way: "in", flow: "ballistic", minSpeed: 4, tag: "lane-centre" },
    { ci: 4, cj: 1, dir: N, way: "in", flow: "ballistic", minSpeed: 6, tag: "loop-right" },
    { ci: 0, cj: 0, dir: W, way: "out", flow: "ballistic", tag: "left-return" },
    { ci: 2, cj: 0, dir: N, way: "out", flow: "eject", tag: "centre-transfer" },
    { ci: 4, cj: 0, dir: E, way: "out", flow: "ballistic", tag: "right-return" },
    { ci: 2, cj: 1, dir: S, way: "out", flow: "eject", tag: RECOVERY_TAG },
  ],
  wantsRunway: 4,
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
  GARGOYLE_SCOOP,
  LOOP_REACTOR,
];

/** Look one up by name (tests, debug tooling, forced placement). */
export function machineNamed(name: string): Assembly | undefined {
  return MACHINES.find((m) => m.name === name);
}
