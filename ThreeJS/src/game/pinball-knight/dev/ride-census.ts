/**
 * RIDE CENSUS — where does every launcher actually SEND the player?
 *
 * The complaint this exists to answer, verbatim: *"maintain consistency with
 * the boosters and making sure that they make sense and they're not just
 * leading to nowhere"*. That is a claim about the DESTINATION of a launch, and
 * nothing in the tree measured destinations. `maze/floor-metrics.ts` counts
 * parts, `dev/pattern-census.ts` counts what GROUP a part belongs to, and
 * `openLaunchTargets` only asks whether a pad has MIN_RUNWAY open tiles ahead —
 * "not firing into a wall" is a much weaker property than "arrives somewhere
 * worth arriving at". A pad with nine tiles of empty corridor ahead passes the
 * runway check and is exactly the thing being complained about.
 *
 * So this traces the exit ray of every launcher and classifies the landing:
 *
 *   FEEDS     — a part sits on, or one tile short of, the landing tile. The
 *               launch hands off. This is the number that should be large.
 *   WALL      — fewer than MIN_RUNWAY open tiles ahead: it fires into rock.
 *   DUEL      — the landing carries a launcher pointing back down the ray. A
 *               ping-pong; `breakLaunchDuels` is supposed to have removed these.
 *   NOWHERE   — clear runway, nothing at the end. Momentum is spent on empty
 *               floor. The literal "leads to nowhere".
 *   VAULTS    — a jump pad or `vault` ramp, aimed at a wall ON PURPOSE, with
 *               floor found on the far side. Working as designed.
 *   BLINDJUMP — the same, with NO floor beyond the band. `startRampHop`
 *               "falls back to a flat dash when it finds no clear landing", so
 *               this is a jump that silently degrades to a shove.
 *
 * ── ⚠️ READ THIS BEFORE QUOTING `nowhere` ──────────────────────────────────
 *
 * **`nowhere` is a statement about `maxTrace`, not about the floor.** It was
 * first reported as "28% of every launcher leads nowhere" and that headline was
 * wrong. Swept at L24, 5 seeds, holding everything else fixed:
 *
 *   maxTrace     12     20     30     60    200
 *   nowhere     15%     7%     2%     0%     0%
 *
 * It collapses to ZERO. The median distance from a launcher to the next part
 * along its own exit ray is **3 tiles**; the tail simply runs past whatever
 * cutoff you picked. So a `nowhere` count is the number of launchers whose
 * receiver is further away than `maxTrace`, and nothing more. Choosing 12 and
 * reporting the result as a defect measured the constant, not the dungeon.
 *
 * That is why `maxTrace` is now an explicit PARAMETER with no default worth
 * trusting, and why `sweepTrace` exists: any finding stated in terms of
 * `nowhere` must be accompanied by the sweep that shows it does not evaporate.
 * If your number moves when `maxTrace` moves, you have measured the probe.
 *
 * `feeds`, `duel`, `blindjump` and `runwayViolations` do NOT have this problem —
 * they are properties of what is found, not of how far you looked.
 *
 * That last sentence was FALSE until `ride-census.test.ts` was written, and the
 * fourth false finding this file nearly produced. The near-miss slop read the
 * neighbours of the tile where the trace STOPPED, and on a ray the budget cut
 * short that tile moves as `maxTrace` moves — so a receiver could sit inside the
 * slop at one trace length and outside it at a longer one. Seed 4 did exactly
 * that: `feeds` [6, 8, 7, 7, 7, 7, 7] and `nowhere` [7, 5, 6, 6, 6, 6, 6] over
 * lengths [4, 8, 12, 20, 30, 60, 200] — looking further found FEWER hand-offs.
 * A truncated ray is now called `nowhere` outright (see `truncated` below), so
 * the sentence holds and the sweep is monotone: `nowhere` non-increasing in
 * `maxTrace`, every other bucket non-decreasing. `dev/ride-census.test.ts`
 * pins it.
 *
 * ── Two kinds this instrument must NOT accuse ──────────────────────────────
 *
 * The first version of this file reported `boostcurve` and `jumppad` as 100%
 * "fires into a wall", on every floor at every depth. Both were the tracer's
 * fault, and both are worth stating so the next person does not re-derive them:
 *
 *  · `boostcurve`'s heading is a **non-cardinal tangent** — an arbitrary-angle
 *    unit vector taken from the route it was placed along (see the long comment
 *    on the `boostcurve` handler in `entities/pinball-collide.ts`). Stepping
 *    `i + dirI * s` with a fractional `dirI` walks off the lane on the first
 *    step, so a straight integer ray CANNOT measure this kind. It is counted as
 *    `untraceable` rather than given a verdict it did not earn.
 *  · `jumppad` is aimed point-blank at a wall BY DESIGN — its handler flies the
 *    knight over the band with `startRampHop`. Its own source says so: "it is a
 *    launcher aimed point-blank at a wall". So "wall" is the correct reading and
 *    the wrong verdict; the question that actually matters for a jump is
 *    whether there is anywhere to LAND, which is what `vaults`/`blindjump` ask.
 *
 * ── The positive control, and why it is here ───────────────────────────────
 *
 * A tracer that walks the grid wrongly reports a confident number and looks
 * like a finding — as it just did, twice. So `rideCensus` also reports
 * `runwayViolations`: launchers that are NOT exempt from the A1 runway repair
 * and yet measure a runway below MIN_RUNWAY. `openLaunchTargets` guarantees
 * that cannot happen, so a non-zero count means THIS FILE is wrong, not the
 * floor. Read it before reading anything else here.
 *
 * Pure: grid + plan in, numbers out. No THREE, no DOM.
 */
import { type Grid, type TilePos, T_FLOOR, T_STAIRS, at } from "../maze/generator";
import type { LevelPlan, PinballPartSpot } from "../maze/decorate";

/**
 * The kinds that FIRE the player somewhere, mirroring `decorate.ts LAUNCH_KINDS`
 * plus the two corner kinds that redirect rather than accelerate.
 *
 * Deliberately duplicated rather than exported from `decorate.ts`: this is a
 * measuring instrument, and an instrument that shares a constant with the thing
 * it measures cannot detect a change in that constant. If the two drift, the
 * drift is itself the finding — `rideCensus` is not load-bearing for the game.
 */
export const RIDE_KINDS: ReadonlySet<string> = new Set([
  "ramp",
  "booster",
  "spring",
  "slingshot",
  "flipper",
  "jumppad",
  "boostcorner",
  "boostcurve",
]);

/** `decorate.ts MIN_RUNWAY` — open tiles a launcher needs or it fires at rock. */
export const MIN_RUNWAY = 3;

/**
 * Default trace length, used only when a caller does not say.
 *
 * There is no correct value — see the sweep in the header. 60 is chosen because
 * it is where `nowhere` reaches zero at L24, i.e. the length at which the
 * instrument stops manufacturing dead ends. A SHORTER trace is legitimate for
 * asking "does this launch feed something NEARBY", but that question must be
 * asked in those words and swept.
 */
const DEFAULT_MAX_TRACE = 60;

/** A part counts as a RECEIVER if it sits within this many tiles of the landing. */
const CATCH_SLOP = 1;

/** Wall tiles a vaulting launch is allowed to clear before its far side counts
 *  as unreachable. `startRampHop` flies a BAND, not a mountain. */
const MAX_BAND = 4;

export type RideResult = "feeds" | "wall" | "duel" | "nowhere" | "vaults" | "blindjump";

export interface RideVerdict {
  kind: string;
  i: number;
  j: number;
  runway: number;
  landing: TilePos | null;
  verdict: RideResult;
  /** The kind that catches this launch, when the verdict is `feeds`. */
  into?: string;
  /** True when this part is exempt from the A1 runway repair by design. */
  exempt: boolean;
  /** Which generator LAYER placed it — the question "whose launchers lead
   *  nowhere" is unanswerable without this, and it is the question that says
   *  where a fix belongs. */
  layer: "spine" | "circuit" | "machine" | "chain" | "chute" | "deal";
}

export type RideTally = Record<RideResult, number>;

export interface RideCensus {
  total: number;
  feeds: number;
  wall: number;
  duel: number;
  nowhere: number;
  vaults: number;
  blindjump: number;
  /**
   * Launchers a straight integer ray cannot follow (`boostcurve`, whose heading
   * is a fractional tangent). Reported, never scored — see the header.
   */
  untraceable: number;
  /** MUST be 0. Non-zero means the tracer is wrong — see the header. */
  runwayViolations: number;
  /** The trace length these numbers are relative to. `nowhere` is meaningless
   *  without it — see the sweep in the header. */
  maxTrace: number;
  /** Verdict counts split by part kind, so one bad kind is visible. */
  byKind: Record<string, RideTally>;
  /** Verdict counts split by the LAYER that placed the part. */
  byLayer: Record<string, RideTally>;
  verdicts: RideVerdict[];
}

/** Kinds whose heading is not a cardinal, so a straight ray means nothing. */
const UNTRACEABLE: ReadonlySet<string> = new Set(["boostcurve"]);

function emptyTally(): RideTally {
  return { feeds: 0, wall: 0, duel: 0, nowhere: 0, vaults: 0, blindjump: 0 };
}

function open(g: Grid, i: number, j: number): boolean {
  if (i < 0 || j < 0 || i >= g.w || j >= g.h) return false;
  const t = at(g, i, j);
  return t === T_FLOOR || t === T_STAIRS;
}

/**
 * The direction a part actually sends the player.
 *
 * A two-leg kind (`boostcorner`, `deflector`) is ENTERED along `dir` and LEAVES
 * along `dir2`, so tracing its `dir` measures the approach rather than the
 * departure — which is how a corner that banks perfectly into a target bank
 * would be scored as firing into the wall behind it.
 */
function exitDir(p: PinballPartSpot): [number, number] {
  if (p.kind === "boostcorner" && (p.dir2I !== 0 || p.dir2J !== 0)) return [p.dir2I, p.dir2J];
  return [p.dirI, p.dirJ];
}

/**
 * Census one floor's launchers.
 *
 * `plan.parts` is the authored plan, which is what the player meets: the runtime
 * adds nothing and removes nothing (`render/pinball-parts.ts` is a straight
 * translation), so measuring the plan and measuring the floor are the same
 * measurement.
 */
export function rideCensus(g: Grid, plan: LevelPlan, maxTrace: number = DEFAULT_MAX_TRACE): RideCensus {
  const byTile = new Map<number, PinballPartSpot>();
  for (const p of plan.parts) byTile.set(p.j * g.w + p.i, p);

  const out: RideCensus = {
    total: 0,
    feeds: 0,
    wall: 0,
    duel: 0,
    nowhere: 0,
    vaults: 0,
    blindjump: 0,
    untraceable: 0,
    runwayViolations: 0,
    maxTrace,
    byKind: {},
    byLayer: {},
    verdicts: [],
  };

  for (const p of plan.parts) {
    if (!RIDE_KINDS.has(p.kind)) continue;
    if (UNTRACEABLE.has(p.kind)) {
      out.untraceable++;
      continue;
    }
    const [di, dj] = exitDir(p);
    if (di === 0 && dj === 0) continue; // omnidirectional — it aims nowhere by design
    // A cardinal is the tracer's precondition. Anything else would walk off the
    // lane on step one and report a confident wall, which is the defect this
    // instrument already shipped once.
    if (Math.abs(di) + Math.abs(dj) !== 1) {
      out.untraceable++;
      continue;
    }
    out.total++;

    // Walk the ray. `runway` is open tiles AHEAD, so a pad flush against rock
    // measures 0 — the same convention `launchRunway` uses.
    let runway = 0;
    let landing: TilePos | null = null;
    let into: PinballPartSpot | undefined;
    for (let s = 1; s <= maxTrace; s++) {
      const i = p.i + di * s;
      const j = p.j + dj * s;
      if (!open(g, i, j)) break;
      runway = s;
      landing = { i, j };
      const hit = byTile.get(j * g.w + i);
      // The FIRST part along the ray is what catches the launch; anything
      // behind it is shadowed and never reached.
      if (hit && hit !== p) {
        into = hit;
        break;
      }
    }

    // ── The BUDGET ran out, so there is no landing to reason about ─────────
    //
    // A ray that walked `maxTrace` open tiles and was still in open floor did
    // not ARRIVE anywhere — it is where we stopped looking. Every verdict below
    // except this one reads the LANDING tile (the near-miss slop reads its
    // neighbours; `wall` reads how short the runway is; the vault band search
    // starts one past it), and on a truncated ray that tile is an artefact of
    // the constant rather than a place the player ends up.
    //
    // Measured, L24-shaped floor, seed 4: a booster at (12,18) traced with
    // maxTrace 8 stopped at (20,18) with open floor still ahead, found a
    // `boostcorner` inside the ±1 slop and scored FEEDS; at maxTrace 12 the same
    // booster ran to its real end at (21,18) — one tile further, rock beyond —
    // where the corner was out of slop, and scored NOWHERE. So looking FURTHER
    // reported one more dead end and one fewer hand-off: `nowhere` went
    // [7, 5, 6, 6, 6, 6, 6] over trace lengths [4, 8, 12, 20, 30, 60, 200],
    // and `feeds` went [6, 8, 7, 7, 7, 7, 7]. Both non-monotone, which is
    // exactly the artefact the header promises `feeds` cannot have and which
    // makes `sweepTrace` unreadable as evidence.
    //
    // Naming it is the whole fix: a truncated ray means "no receiver within
    // maxTrace", which IS `nowhere` as the header defines it. Each launcher's
    // verdict is then `nowhere` up to the trace length that reaches its real
    // terminus and fixed forever after, so `nowhere` is monotonically
    // non-increasing in `maxTrace` and every other bucket non-decreasing —
    // and `wall`/`runwayViolations` can no longer fire on a ray that was merely
    // cut short (at maxTrace < MIN_RUNWAY they otherwise fire on EVERY
    // launcher, which would make the positive control accuse the floor).
    const truncated =
      !into && runway === maxTrace && open(g, p.i + di * (runway + 1), p.j + dj * (runway + 1));

    // The exemptions `openLaunchTargets` itself honours: a vault ramp is aimed
    // at rock on purpose, a spine booster is supposed to have a wall ahead
    // because the turn is the point, a chute is the sealed plunger lane, and a
    // machine part's facing came from its assembly rather than the topology.
    const exempt = !!(p.vault || p.spine || p.chute || p.asm);

    // A JUMP is not a shot down a corridor. `jumppad` and a `vault`-flagged
    // ramp are aimed at rock deliberately and fly the band via `startRampHop`,
    // so the only question worth asking is whether the far side exists.
    const vaulting = p.kind === "jumppad" || p.vault;

    let verdict: RideResult;
    if (truncated) {
      // Nothing within `maxTrace`, and the corridor carries on past it. That is
      // the literal definition of `nowhere` in the header: a receiver further
      // away than the cutoff.
      verdict = "nowhere";
    } else if (vaulting && !into) {
      let landed: TilePos | null = null;
      // Skip the band, then look for floor. `startRampHop` needs somewhere to
      // set down; without it the handler degrades to a flat dash and the one
      // shot on the floor that jumps the maze silently becomes a shove.
      for (let s = Math.max(1, runway + 1); s <= runway + 1 + MAX_BAND; s++) {
        if (open(g, p.i + di * s, p.j + dj * s)) {
          landed = { i: p.i + di * s, j: p.j + dj * s };
          break;
        }
      }
      verdict = landed ? "vaults" : "blindjump";
      if (landed) landing = landed;
    } else if (into) {
      // A launcher pointing straight back down our own ray is a duel, not a
      // hand-off: the two of them trade the player forever.
      const [bi, bj] = exitDir(into);
      verdict = RIDE_KINDS.has(into.kind) && bi === -di && bj === -dj ? "duel" : "feeds";
    } else if (runway < MIN_RUNWAY) {
      verdict = "wall";
      if (!exempt) out.runwayViolations++;
    } else {
      // Clear runway, empty end. Look one tile further out for a near miss —
      // a pad that lands the player a tile short of a bumper is still a
      // hand-off in practice, and scoring it "nowhere" would overstate the
      // problem this census exists to size.
      let near: PinballPartSpot | undefined;
      for (let k = 1; k <= CATCH_SLOP && !near && landing; k++) {
        for (const [oi, oj] of [
          [di, dj],
          [dj, di],
          [-dj, -di],
        ] as Array<[number, number]>) {
          const q = byTile.get((landing.j + oj * k) * g.w + (landing.i + oi * k));
          if (q && q !== p) {
            near = q;
            break;
          }
        }
      }
      if (near) {
        into = near;
        verdict = "feeds";
      } else {
        verdict = "nowhere";
      }
    }

    const layer: RideVerdict["layer"] = p.spine
      ? "spine"
      : p.asm
        ? "machine"
        : p.circuit !== undefined
          ? "circuit"
          : p.chain
            ? "chain"
            : p.chute
              ? "chute"
              : "deal";

    out[verdict]++;
    const k = (out.byKind[p.kind] ??= emptyTally());
    k[verdict]++;
    const L = (out.byLayer[layer] ??= emptyTally());
    L[verdict]++;
    out.verdicts.push({ kind: p.kind, i: p.i, j: p.j, runway, landing, verdict, into: into?.kind, exempt, layer });
  }

  return out;
}

/**
 * Sweep the trace length and report `nowhere` at each.
 *
 * The guard against the mistake this file already made once: a `nowhere` figure
 * that shrinks as the sweep lengthens is an artefact of the cutoff, not a defect
 * in the floor. Quote the sweep, never a single row of it.
 */
export function sweepTrace(
  g: Grid,
  plan: LevelPlan,
  lengths: readonly number[] = [12, 20, 30, 60, 200],
): Array<{ maxTrace: number; nowhere: number; feeds: number; total: number }> {
  return lengths.map((maxTrace) => {
    const c = rideCensus(g, plan, maxTrace);
    return { maxTrace, nowhere: c.nowhere, feeds: c.feeds, total: c.total };
  });
}
