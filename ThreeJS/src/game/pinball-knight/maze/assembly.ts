/**
 * ASSEMBLIES — authored multi-part pinball machines that survive generation.
 *
 * A real pinball table is not a scatter of parts. It is a handful of MACHINES
 * — a ramp that feeds an orbit, a bank of drop targets guarding a scoop, a
 * slingshot pair that returns the ball to the flippers — and the machines feed
 * each other. The route between them is the table. This module is the data
 * model for that: a named group of parts with AUTHORED RELATIVE FACINGS, so a
 * booster reliably fires INTO the ramp behind it rather than wherever the
 * corridor happened to point.
 *
 * ── Why this exists (read before "simplifying" it) ─────────────────────────
 *
 * Three problems in the shipped pipeline, all of which this replaces:
 *
 *  1. **Facings were never authored.** A prefab anchor was `{i, j, kind}` and
 *     nothing else; direction was re-derived from local corridor topology when
 *     the anchor was consumed, twenty passes later. Two parts placed side by
 *     side had no relationship — a chain was a coincidence, not a guarantee.
 *     Here a part carries `dirI/dirJ` in the assembly's OWN frame, and
 *     `rotateAssembly` turns the vectors with the glyphs, so a machine means
 *     the same thing in all eight orientations.
 *
 *  2. **Group identity was ad-hoc and threefold.** `orbit`/`orbitSeq`,
 *     `bank`/`seq` and `lane`/`laneSeq` were three incompatible encodings of
 *     the same idea, each a pair of optional fields on a part spot, each
 *     understood by exactly one consumer. `AssemblyRef` is the one encoding:
 *     an id, a role, and a sequence index. The old fields stay for now as the
 *     runtime's scoring hooks read them, but new groups use this.
 *
 *  3. **Authored intent did not survive.** Parts land at pass 14 of 20, and
 *     passes 17-20 then de-clump (deleting parts closer than Chebyshev 3),
 *     re-aim launch parts, and break duels. A machine authored with two
 *     bumpers a tile apart was silently pulled apart. Assemblies are placed
 *     EARLY and reserve their footprint, and grouped parts are exempt from
 *     de-clumping and runway re-aim — but NOT from `breakLaunchDuels`, which
 *     guards a genuine soft-lock (a ball ping-ponging between two launchers is
 *     unrecoverable, and 54.5% of floors used to carry one). Aesthetics yield
 *     to authoring; the soft-lock guard does not.
 *
 * ── Ports: how machines chain ──────────────────────────────────────────────
 *
 * An assembly declares PORTS — labelled tiles on its boundary where a ball is
 * meant to enter or leave, each with a direction. That is what makes these
 * composable rather than merely co-located: a placer can ask "does this
 * machine's exit line up with that machine's entrance" instead of guessing
 * from geometry. Ports are pure data and carry no behaviour; the router in
 * `assembly-place.ts` is what matches them up.
 *
 * Everything here is pure: no THREE, no DOM, no grid mutation. That is
 * deliberate — the whole module is unit-testable, and the rotation algebra
 * (the part most likely to harbour a sign error) is pinned by tests rather
 * than discovered in a playtest.
 */
import type { PartSpotKind } from "./decorate";

/** A unit cardinal in assembly-local space. Diagonals are not authorable: the
 *  part facings the engine understands are cardinals, and a diagonal would be
 *  silently snapped somewhere unpredictable at consume time. */
export interface Dir {
  di: number;
  dj: number;
}

/** The four cardinals, named for readability in assembly definitions. */
export const N: Dir = { di: 0, dj: -1 };
export const S: Dir = { di: 0, dj: 1 };
export const E: Dir = { di: 1, dj: 0 };
export const W: Dir = { di: -1, dj: 0 };
/** No facing — for parts whose behaviour is omnidirectional (bumpers, oil). */
export const O: Dir = { di: 0, dj: 0 };

/**
 * What a part is FOR inside its machine. Roles are the vocabulary the router
 * and the runtime reason about, and they are deliberately about FLOW rather
 * than about the part kind: a booster and a spring are both `drive`, and a
 * scorer cares that a target is a `score` regardless of which kind it is.
 */
export type PartRole =
  /** Accelerates the ball along the machine's through-line. */
  | "drive"
  /** Turns the ball — a bend, deflector or flipper. */
  | "turn"
  /** Pays out when hit: targets, rollovers, lamps. */
  | "score"
  /** Bounces the ball back into play — bumpers, slingshots. */
  | "rebound"
  /** Hazard: costs the player something. */
  | "hazard"
  /** Structural decoration with no flow role. */
  | "dress";

/**
 * The kinds that are entered on one leg and leave on ANOTHER, and so cannot be
 * authored with a single facing.
 *
 * `boostcorner` and `deflector` both read `dir2` at runtime
 * (`entities/pinball-collide.ts`), and a machine is nothing but authored
 * facings — so a corner with one leg is a machine that does not work. That is
 * not hypothetical: the library shipped `ORBIT` and `RAMP_RETURN` with
 * single-legged deflectors, which resolve to `throwDir = (0, 0)` — a grab-throw
 * along a zero vector, i.e. the knight is caught and never released. It never
 * surfaced because nothing placed them. `corner-missing-leg` in
 * `assembly-check.ts` is what stops the next one.
 */
export const TWO_LEG_KINDS: ReadonlySet<PartSpotKind> = new Set(["boostcorner", "deflector"]);

/** One part inside an assembly, in the assembly's own cell-local frame. */
export interface AssemblyPart {
  /** Cell offset from the assembly's top-left, before rotation. */
  ci: number;
  cj: number;
  kind: PartSpotKind;
  /** Which way this part fires/faces, in the assembly's frame. `O` = none. */
  dir: Dir;
  /**
   * The SECOND leg, for the corner kinds — the way out, where `dir` is the way
   * in. Required for everything in `TWO_LEG_KINDS` and meaningless elsewhere.
   *
   * It rotates and mirrors with `dir`, and it is part of `signatureOf`. Both
   * are load-bearing: turn the glyphs without turning this vector and an
   * S-bend's two orientations become the same machine, which silently halves
   * the orientation pool for exactly the twisty shapes this exists to author.
   */
  dir2?: Dir;
  role: PartRole;
  /** Order within the machine — a drop-target bank's 1-2-3, an orbit's lap
   *  order. Undefined for parts whose order is meaningless. */
  seq?: number;
}

/** Which way a port faces relative to the machine: a ball ENTERS through an
 *  `in` port travelling along `dir`, and LEAVES through an `out` port along
 *  `dir`. `both` is a lane usable in either direction. */
export type PortWay = "in" | "out" | "both";

/**
 * HOW a port moves the ball. Taken from real playfield vocabulary, because the
 * distinction is load-bearing for chaining rather than decorative:
 *
 *  - `ballistic` — momentum is PRESERVED. A ramp or orbit exit throws the ball
 *    onward at whatever speed it arrived with, so a slow entry produces a slow,
 *    possibly dying exit. Chains built on ballistic ports have to care about
 *    speed; a real table's "weak ramp shot that rolls back down" is this.
 *  - `eject` — momentum is DISCARDED and REPLACED by an authored vector. A
 *    scoop, kicker or up-kicker swallows the ball and spits it out the same way
 *    every time regardless of how it arrived. These are the reliable links: a
 *    chain through an eject port always works.
 *  - `impact` — the ball REBOUNDS unpredictably (bumpers, slingshots, standup
 *    targets). Deliberately not chainable: an impact port is where flow is
 *    meant to become chaos.
 *
 * The practical rule this encodes: never author a long combo through ballistic
 * ports only, and never author one through an impact port at all.
 */
export type PortFlow = "ballistic" | "eject" | "impact";

/**
 * A labelled connection point on the machine's boundary.
 *
 * The direction is the ball's TRAVEL vector, not the outward normal of the
 * footprint — those differ for an entrance (a ball entering the west side is
 * travelling EAST) and confusing them is the obvious way to build a router
 * that connects machines back-to-front. Travel vector is the one that composes:
 * an `out` port with dir E chains to an `in` port with dir E.
 */
export interface AssemblyPort {
  ci: number;
  cj: number;
  dir: Dir;
  way: PortWay;
  /** How the ball is moved through this port. Defaults to `ballistic`, the
   *  conservative assumption (momentum preserved, so speed must be checked). */
  flow?: PortFlow;
  /**
   * Minimum arrival speed for an `in` port to actually work, in u/s. A ramp
   * that needs 8 u/s and gets 3 rejects the ball — on a real table that is the
   * shot rolling back down the ramp. 0/undefined = accepts anything.
   */
  minSpeed?: number;
  /** Optional label for authoring clarity ("main", "return", "skill"). */
  tag?: string;
}

/**
 * A named machine. `w`/`h` are the footprint in CELLS (the same space prefabs
 * are authored in: one cell is 2×2 tiles after `thickenWalls`).
 *
 * `floor` lists the cells the machine needs CARVED. Like a prefab stamp this is
 * carve-only — an assembly never adds wall — which is what keeps the
 * "every floor tile reachable" pipeline invariant true by construction rather
 * than by a check that has to be re-run.
 */
export interface Assembly {
  name: string;
  w: number;
  h: number;
  /** Cells to carve to floor, as [ci, cj] pairs. */
  floor: ReadonlyArray<readonly [number, number]>;
  parts: ReadonlyArray<AssemblyPart>;
  ports: ReadonlyArray<AssemblyPort>;
  /**
   * How badly this machine wants a straight approach. A router should not drop
   * a high-speed orbit at the end of a twisty dead-end. 0 = happy anywhere.
   */
  wantsRunway?: number;
}

/** How a placed part points back at the machine it belongs to. One encoding,
 *  replacing orbit/orbitSeq + bank/seq + lane/laneSeq. */
export interface AssemblyRef {
  /** Per-floor unique id of the placed machine. */
  id: number;
  /** Which machine definition it came from — for scoring and telemetry. */
  name: string;
  role: PartRole;
  /** Position within the machine, if the machine has an order. */
  seq?: number;
}

/**
 * Normalize a signed zero to +0.
 *
 * JavaScript's `-0 !== +0` under `Object.is`/deep-equality, and negating a
 * cardinal's zero component (`-d.dj` where `dj` is 0) produces `-0`. Left
 * alone it leaks two ways, both nasty: a `-0` facing compares unequal to an
 * identical `+0` facing, and `${-0}` stringifies to `"0"` in some paths and
 * `"-0"` in others, so signature keys stop matching. Neither shows up as a
 * crash — they show up as a machine that mysteriously fails to de-dupe or a
 * facing comparison that is false for no visible reason.
 */
function nz(n: number): number {
  return n === 0 ? 0 : n;
}

/** Rotate a cardinal 90° clockwise in grid space (+i right, +j down). */
export function rotateDir(d: Dir): Dir {
  return { di: nz(-d.dj), dj: nz(d.di) };
}

/** Mirror a cardinal left↔right (i negated, j untouched). */
export function mirrorDir(d: Dir): Dir {
  return { di: nz(-d.di), dj: nz(d.dj) };
}

/**
 * Rotate a whole machine 90° clockwise.
 *
 * Cell `(ci, cj)` in a `w × h` machine lands at `(h - 1 - cj, ci)`, and every
 * facing turns with it. This pairing is the entire point of the module: rotate
 * the glyphs without rotating the vectors and a machine's parts keep their
 * shape while firing in the wrong directions — which is exactly the failure the
 * old topology-derived facings produced, only harder to see.
 */
export function rotateAssembly(a: Assembly): Assembly {
  const rc = (ci: number, cj: number): [number, number] => [a.h - 1 - cj, ci];
  return {
    name: a.name,
    w: a.h,
    h: a.w,
    floor: a.floor.map(([ci, cj]) => rc(ci, cj)),
    parts: a.parts.map((p) => {
      const [ci, cj] = rc(p.ci, p.cj);
      return { ...p, ci, cj, dir: rotateDir(p.dir), ...(p.dir2 ? { dir2: rotateDir(p.dir2) } : {}) };
    }),
    ports: a.ports.map((p) => {
      const [ci, cj] = rc(p.ci, p.cj);
      return { ...p, ci, cj, dir: rotateDir(p.dir) };
    }),
    wantsRunway: a.wantsRunway,
  };
}

/** Mirror a machine left↔right, facings included. */
export function mirrorAssembly(a: Assembly): Assembly {
  const mc = (ci: number): number => a.w - 1 - ci;
  return {
    name: a.name,
    w: a.w,
    h: a.h,
    floor: a.floor.map(([ci, cj]) => [mc(ci), cj] as const),
    parts: a.parts.map((p) => ({
      ...p,
      ci: mc(p.ci),
      dir: mirrorDir(p.dir),
      ...(p.dir2 ? { dir2: mirrorDir(p.dir2) } : {}),
    })),
    ports: a.ports.map((p) => ({ ...p, ci: mc(p.ci), dir: mirrorDir(p.dir) })),
    wantsRunway: a.wantsRunway,
  };
}

/**
 * Every distinct orientation of a machine — 4 rotations of it and of its
 * mirror, de-duped.
 *
 * De-duping keys on the PARTS AND PORTS, not just the carved shape: two
 * orientations of a symmetric footprint are genuinely different machines if
 * their parts fire different ways, and collapsing them would quietly halve the
 * variety of exactly the shapes (rings, crosses, corridors) most likely to be
 * authored. The prefab-level `variantsOf` keys on the glyph grid alone, which
 * is correct there because those shapes carry no direction at all.
 */
export function orientationsOf(a: Assembly): Assembly[] {
  const out: Assembly[] = [];
  const seen = new Set<string>();
  for (const base of [a, mirrorAssembly(a)]) {
    let v = base;
    for (let r = 0; r < 4; r++) {
      const key = signatureOf(v);
      if (!seen.has(key)) {
        seen.add(key);
        out.push(v);
      }
      v = rotateAssembly(v);
    }
  }
  return out;
}

/**
 * A stable string identity for an orientation: footprint + carved cells +
 * every part's cell, kind and facing + every port.
 *
 * The CARVED CELLS have to be in here. Without them a 3×1 lane and its mirror
 * hash identically — both are "three cells in a row with a booster at one end
 * firing east" once the parts are sorted, because sorting throws away which
 * end. The footprint's handedness only survives if the shape itself is part of
 * the key. Getting this wrong silently halves the orientation pool for every
 * asymmetric machine, which is a variety bug that would never surface as an
 * error — only as floors that feel repetitive.
 */
export function signatureOf(a: Assembly): string {
  const floor = a.floor
    .map(([ci, cj]) => `${ci},${cj}`)
    .sort()
    .join(";");
  const parts = a.parts
    .map((p) => `${p.ci},${p.cj},${p.kind},${p.dir.di},${p.dir.dj},${p.dir2?.di ?? ""},${p.dir2?.dj ?? ""}`)
    .sort()
    .join(";");
  const ports = a.ports
    .map((p) => `${p.ci},${p.cj},${p.dir.di},${p.dir.dj},${p.way}`)
    .sort()
    .join(";");
  return `${a.w}x${a.h}|${floor}|${parts}|${ports}`;
}

/**
 * Do two ports chain — can a ball leaving `from` reliably arrive at `to`?
 *
 * Three independent conditions, all of them load-bearing:
 *  - `from` must be able to emit and `to` to accept (`both` does either);
 *  - neither may be an IMPACT port. A bumper or slingshot rebounds the ball
 *    unpredictably by design, so a "chain" through one is a coincidence that
 *    happens to have worked once. Impact ports are where flow is SUPPOSED to
 *    become chaos; treating one as a link produces exactly the unreliable,
 *    nonsense-looking routing this system exists to remove;
 *  - the travel directions must AGREE. A ball leaving eastward has to enter the
 *    next machine eastward too. Opposed directions mean the machines face each
 *    other, which is the launch-duel shape the runtime spends real effort
 *    breaking — never chain those deliberately.
 */
export function portsChain(from: AssemblyPort, to: AssemblyPort): boolean {
  if (from.way === "in" || to.way === "out") return false;
  if (from.flow === "impact" || to.flow === "impact") return false;
  return from.dir.di === to.dir.di && from.dir.dj === to.dir.dj;
}

/** Does this machine have any port that can emit? A machine with no `out`/
 *  `both` port is a terminus — legal (a scoop, a vault) but a router must know
 *  not to try to chain onward from it. */
export function hasExit(a: Assembly): boolean {
  return a.ports.some((p) => p.way !== "in");
}
