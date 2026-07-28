/**
 * TELEGRAPH CLIPS — the property that matters is COVERAGE, not plausibility.
 *
 * A movement policy that declares a tell and gets no pose is exactly the
 * failure this module exists to end, and it is a silent one: the actor still
 * renders, it just walks. So the test that earns its keep drives every handler
 * in `MOVEMENT_HANDLERS` over a real approach and asserts that the three
 * EVENT tells (crouch, stalk, burst) each actually occur — measured off the
 * handlers, not off a table restating what the handlers are supposed to do.
 */
import { describe, it, expect } from "vitest";
import { MOVEMENT_HANDLERS, MOVE_TELL, MOVEMENT_KINDS, type MoveActor, type MoveCtx, type Steer } from "../entities/movement";
import { clipForSteer } from "./tell-clips";
import { PACK_MIN } from "../constants";

/** A plain approach context at `dist`, with the player due east. */
function ctx(dist: number, over: Partial<MoveCtx> = {}): MoveCtx {
  return {
    dt: 1 / 60,
    pdx: dist,
    pdz: 0,
    pdist: dist,
    flowX: 1,
    flowZ: 0,
    contactRange: 1,
    los: true,
    packNear: 1,
    packCommitted: false,
    ...over,
  };
}

/** Run one policy for `secs` from `startDist`, collecting the clip each frame. */
function clipsOver(kind: (typeof MOVEMENT_KINDS)[number], startDist: number, secs: number, over: Partial<MoveCtx> = {}): string[] {
  const a: MoveActor = { x: 0, z: 0, speed: 3, movePhase: 0.2 };
  const seen: string[] = [];
  let dist = startDist;
  for (let i = 0; i < Math.round(secs * 60); i++) {
    const s: Steer = MOVEMENT_HANDLERS[kind](a, ctx(dist, over));
    const moving = s.vx !== 0 || s.vz !== 0;
    const c = clipForSteer(s, moving);
    if (c) seen.push(c);
    if (moving && !s.hold) dist = Math.max(0.6, dist - 3 * (s.mult ?? 1) * (1 / 60));
  }
  return seen;
}

describe("a policy's tell names a pose, not just a colour", () => {
  it("the leaper's wind-up plays the crouch", () => {
    const seen = clipsOver("leaper", 6, 3);
    expect(seen, "a leaper never crouched over 3s of approach").toContain("crouch");
  });

  it("and NOT while it is mid-pounce — the tell is raised on the release frame too", () => {
    // Release: the handler returns the leap tell with a full speed multiplier
    // and `hold` unset. A crouch pose on something travelling at 3.4x is a lie.
    const s: Steer = { vx: 1, vz: 0, mult: 3.4, locked: true, tell: { color: MOVE_TELL.leap, k: 1 } };
    expect(clipForSteer(s, true)).toBeNull();
  });

  it("the pack-hunter's stalk plays the wait gait", () => {
    const seen = clipsOver("packhunter", 9, 2);
    expect(seen, "a lone pack-hunter never stalked").toContain("wait");
  });

  it("and stops the moment the quorum lands — the surge is a walk, not a stalk", () => {
    const seen = clipsOver("packhunter", 9, 2, { packNear: PACK_MIN });
    expect(seen).not.toContain("wait");
  });

  it("the ambusher's commit plays the burst", () => {
    const seen = clipsOver("ambusher", 3, 2);
    expect(seen, "an ambusher in range with LOS never sprang").toContain("wake");
  });

  it("and the strafer's dart borrows the same burst — one read, one pose", () => {
    const seen = clipsOver("strafer", 6, 6);
    expect(seen).toContain("wake");
  });

  it("an approach FLAVOUR is not an event: flanker/orbiter keep walking", () => {
    for (const kind of ["flanker", "orbiter"] as const) {
      expect(clipsOver(kind, 8, 2), `${kind} hijacked a clip`).toEqual([]);
    }
  });

  it("a policy with no tell never overrides the caller", () => {
    for (const kind of ["chase", "kite", "rooted", "phase", "inert"] as const) {
      expect(clipsOver(kind, 8, 2), `${kind} has no telegraph but named a clip`).toEqual([]);
    }
  });

  it("REGRESSION: every tell colour in MOVE_TELL is decided, not defaulted", () => {
    // A seventh telegraph added to movement.ts should be a deliberate decision
    // here — either a pose or an explicit "no pose". This fails loudly when the
    // vocabulary grows, which is the only moment anyone would think to look.
    const decided = new Set([MOVE_TELL.leap, MOVE_TELL.pack, MOVE_TELL.commit, MOVE_TELL.flank, MOVE_TELL.strafe, MOVE_TELL.orbit]);
    for (const [name, hex] of Object.entries(MOVE_TELL)) {
      expect(decided.has(hex), `MOVE_TELL.${name} is not accounted for in clipForSteer`).toBe(true);
    }
  });
});
