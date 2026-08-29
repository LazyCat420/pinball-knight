/**
 * CIRCUITS — the floor's highway loops.
 *
 * The complaint this answers, in the player's words: the floor has plenty of
 * boosters and bumpers, but a booster throws you somewhere and nothing catches
 * you. Measured before this existed, over 80 floors: **64.8% of every launcher
 * on the floor threw the knight at nothing**, and the deepest hand-off chain
 * averaged 4.7 parts — which is just `CHAIN_LINKS`, the one pass that ever
 * built a chain deliberately.
 *
 * A circuit is a long loop of corridor furnished so that each part throws you
 * into the next, with junctions where two loops meet and off-ramps where you
 * can leave. Not one ring: several, intertwined, so the player picks which
 * highway to ride rather than being posted around a fixed track.
 *
 * ── The soft-lock, and why this is not one ─────────────────────────────────
 *
 * `flow-loops.ts` deletes every closed ring of shoves, and it is right to: a
 * ring where every member re-launches is unescapable, the runtime BOOSTER_JAM
 * guard cannot see it (from a pad's view a feedback loop looks exactly like a
 * player enjoying a fast lap), and 130 launchers were sitting in one.
 *
 * **A circuit is a closed loop of GEOMETRY ridden by an OPEN chain of shoves.**
 * The corridor comes back on itself; the chain of forced shoves does not. It
 * terminates at an off-ramp — a part that does not launch — so the successor
 * graph stays acyclic and `decorate.test`'s "no closed loop of shoves" gate
 * passes UNCHANGED. That test is the proof this design works, not a casualty
 * of it.
 *
 * The invariant that actually matters is "the player cannot be held against
 * their will", and that is a property of the successor graph, not of the
 * corridor's shape. A circuit whose last member coasts is escapable by standing
 * still, which is the strongest guarantee available and needs no runtime
 * machinery. (There is none available anyway: boosters set speed absolutely, so
 * there is no per-lap decay to exhaust.)
 *
 * ── Why the hand-off is by construction ────────────────────────────────────
 *
 * The chain seeder places a part and HOPES the next tile works out; it breaks
 * on a dead end, a straight with no runway, an occupied landing. This walks the
 * other way round: from a part, follow its exit ray along the ring to the last
 * tile still reachable, and put the next part THERE. The successor relation is
 * not checked afterwards, it is how the position was chosen.
 *
 * DOM- and three-free, and it takes no draws from the shared floor rng.
 */
import { type Grid, type TilePos, at, idx, T_FLOOR, T_STAIRS, T_WALL } from "./generator";
import { isDownhill, openRunway, phiAt, UNREACHED } from "./flow-orient";
import type { PinballPartSpot } from "./decorate";

/**
 * How far a shove carries. Matches `flow-loops.RAY` and decorate's
 * `DUEL_RANGE` — the same physical claim about friction, stated once per module
 * because each is private to its own.
 */
const RAY = 12;

/** Open floor a launcher needs ahead of it, or it is firing into rock. */
const MIN_RUNWAY = 3;

/**
 * The shortest loop worth calling a highway, in tiles.
 *
 * ~2.5 seconds at BOOSTER_SPEED. Below that a "lap" reads as a corner you
 * happened to come back around, which is the opposite of the intended feeling.
 */
const MIN_RING = 20;

/**
 * How far apart, ALONG THE ARTERY, a detour's two ends must be before the loop
 * it closes is a real alternative route rather than a bulge in the corridor.
 *
 * Without this the search returns thousands of two-tile pockets: any corridor
 * one tile wider than a lane technically closes a cycle.
 */
const MIN_ARTERY_SEP = 4;

const CARDS: ReadonlyArray<readonly [number, number]> = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

function open(g: Grid, i: number, j: number): boolean {
  const t = at(g, i, j);
  return t === T_FLOOR || t === T_STAIRS;
}

/** A ring, plus everything laid on it. */
export interface Circuit {
  id: number;
  /** The closed loop of corridor, in traversal order. */
  ring: TilePos[];
  /** Every part this circuit laid, in chain order. */
  links: PinballPartSpot[];
  /** Parts that deliberately do NOT launch — where the chain of shoves ends
   *  and the player is free. Never fewer than two. */
  offRamps: PinballPartSpot[];
  /** Ring tiles shared with another circuit — where you can switch highways. */
  interchanges: TilePos[];
}

/**
 * Find loops of corridor that pass through the artery.
 *
 * ── Why this and not the alternate-route merge ─────────────────────────────
 *
 * `alternateRoutes` looks like the obvious ring source — extra downhill roads
 * that merge back into the artery — but it is a LOLLIPOP, not a loop:
 * `ALT_ROUTE_GAP` puts a new road's head 6+ tiles from every already-routed
 * tile, so the far end deliberately does NOT rejoin. Building on it would have
 * meant assuming a closure the generator specifically avoids.
 *
 * ── The search ────────────────────────────────────────────────────────────
 *
 * A ring through the artery is: leave the artery at index a, travel through
 * corridor that is NOT artery, come back to the artery at index b with
 * |a - b| large. That is a shortest-cycle-through-a-set problem, and the
 * standard multi-source BFS solves it in one linear pass: seed every
 * off-artery neighbour of every artery tile, tagged with its artery index, then
 * grow. When two frontiers carrying DIFFERENT distant tags meet, the two paths
 * back to their seeds plus the artery segment between them is the ring.
 *
 * One pass finds every candidate; the caller takes the longest ones.
 */
export function findRings(g: Grid, artery: readonly TilePos[], used?: Set<number>): TilePos[][] {
  if (artery.length < MIN_ARTERY_SEP) return [];
  const onArtery = new Map<number, number>();
  artery.forEach((t, k) => {
    // A route can revisit a tile; the FIRST index is the one that keeps the
    // separation test meaningful.
    if (!onArtery.has(idx(g, t.i, t.j))) onArtery.set(idx(g, t.i, t.j), k);
  });

  // tag[tile] = the artery index this tile's shortest off-artery path came
  // from; prev[tile] = the tile it came from, for path reconstruction.
  const tag = new Map<number, number>();
  const prev = new Map<number, number>();
  const queue: TilePos[] = [];

  for (const [k, t] of artery.entries()) {
    for (const [di, dj] of CARDS) {
      const ni = t.i + di;
      const nj = t.j + dj;
      const key = idx(g, ni, nj);
      if (!open(g, ni, nj) || onArtery.has(key) || used?.has(key)) continue;
      if (tag.has(key)) continue;
      tag.set(key, k);
      prev.set(key, idx(g, t.i, t.j));
      queue.push({ i: ni, j: nj });
    }
  }

  const pos = new Map<number, TilePos>();
  for (const t of queue) pos.set(idx(g, t.i, t.j), t);

  /** Walk `prev` back to the artery tile the path started from. */
  const pathBack = (key: number): TilePos[] => {
    const out: TilePos[] = [];
    let cur: number | undefined = key;
    const seen = new Set<number>();
    while (cur !== undefined && !onArtery.has(cur) && !seen.has(cur)) {
      seen.add(cur);
      const t = pos.get(cur);
      if (!t) break;
      out.push(t);
      cur = prev.get(cur);
    }
    return out.reverse();
  };

  const rings: TilePos[][] = [];
  const seenPair = new Set<string>();

  /**
   * Close a ring between two artery indices, given the two detour paths that
   * reach the meeting point.
   *
   * `low`/`high` are the two artery indices and `fromLow`/`fromHigh` the paths
   * leading OUT of each (artery-adjacent tile first, meeting tile last). The
   * loop is then: along the artery from low to high, out along `fromHigh` to
   * where the frontiers met, and back down `fromLow` reversed to the artery.
   * Written once because getting the two orders right in two places is how a
   * ring ends up with a discontinuity in the middle that only shows up as a
   * link chain that mysteriously stops.
   */
  const close = (low: number, high: number, fromLow: TilePos[], fromHigh: TilePos[]): void => {
    const pairKey = `${low}:${high}`;
    if (seenPair.has(pairKey)) return;
    seenPair.add(pairKey);
    const ring = [...artery.slice(low, high + 1), ...fromHigh, ...[...fromLow].reverse()];
    if (ring.length >= MIN_RING) rings.push(ring);
  };

  for (let head = 0; head < queue.length; head++) {
    const t = queue[head];
    const key = idx(g, t.i, t.j);
    const myTag = tag.get(key)!;
    for (const [di, dj] of CARDS) {
      const ni = t.i + di;
      const nj = t.j + dj;
      const nk = idx(g, ni, nj);
      if (!open(g, ni, nj) || used?.has(nk)) continue;

      const arteryIdx = onArtery.get(nk);
      if (arteryIdx !== undefined) {
        // The detour ran straight back onto the artery. Rare — the tiles beside
        // the artery are all seeded, so a frontier usually meets another
        // frontier first (below) — but it fires where a side passage rejoins
        // through a tile nothing else claimed.
        if (Math.abs(arteryIdx - myTag) < MIN_ARTERY_SEP) continue;
        const detour = pathBack(key);
        if (myTag < arteryIdx) close(myTag, arteryIdx, detour, []);
        else close(arteryIdx, myTag, [], detour);
        continue;
      }

      const otherTag = tag.get(nk);
      if (otherTag !== undefined) {
        // ── TWO FRONTIERS MEET — the case that actually finds the loops ────
        //
        // Both tiles are off-artery corridor reached from DIFFERENT points on
        // the artery. Splice their two paths together and the result is a route
        // that leaves the artery at one index and rejoins at another: a loop.
        //
        // Handling only the artery-rejoin case above finds almost nothing, and
        // for a structural reason rather than a tuning one: every tile beside
        // the artery is seeded before the walk starts, so a frontier from index
        // 0 can never REACH an artery tile at index 60 — the ground around it
        // is already claimed with tag 60, and the walk bails on "already
        // tagged". Measured with only that branch: 0 rings on 8 of 8 floors.
        if (Math.abs(otherTag - myTag) < MIN_ARTERY_SEP) continue;
        const mine = pathBack(key);
        const theirs = pathBack(nk);
        if (myTag < otherTag) close(myTag, otherTag, mine, theirs);
        else close(otherTag, myTag, theirs, mine);
        continue;
      }

      tag.set(nk, myTag);
      prev.set(nk, key);
      pos.set(nk, { i: ni, j: nj });
      queue.push({ i: ni, j: nj });
    }
  }

  rings.sort((x, y) => y.length - x.length);
  return rings;
}

/** The cardinal step from `a` to `b`, or null if they are not neighbours. */
function stepDir(a: TilePos, b: TilePos): readonly [number, number] | null {
  const di = Math.sign(b.i - a.i);
  const dj = Math.sign(b.j - a.j);
  if (Math.abs(di) + Math.abs(dj) !== 1) return null;
  return [di, dj];
}

/**
 * Walk forward along the ring from `k` until it TURNS or `RAY` runs out.
 *
 * The tile returned is where the next part goes, and returning it is what makes
 * the hand-off structural: the current part fires along `dir`, and this tile is
 * on that ray with clear floor between, so the successor relation holds by
 * construction rather than by a check that might fail.
 */
function nextLinkIndex(ring: TilePos[], k: number, dir: readonly [number, number]): number {
  const n = ring.length;
  let last = k;
  for (let s = 1; s <= RAY; s++) {
    const cur = ring[(k + s) % n];
    const p = ring[(k + s - 1) % n];
    const d = stepDir(p, cur);
    if (!d) break; // the ring's own path broke — stop short, do not guess
    if (d[0] !== dir[0] || d[1] !== dir[1]) return (k + s - 1) % n; // the bend
    last = (k + s) % n;
  }
  return last;
}

/** Open cardinal neighbours of a tile — how `classifyTopology` counts legs. */
function openLegs(g: Grid, t: TilePos): number {
  return CARDS.filter(([di, dj]) => at(g, t.i + di, t.j + dj) === T_FLOOR).length;
}

/**
 * Can the player LEAVE the ring here, and does leaving make progress?
 *
 * Both halves matter. A branch that exists but climbs away from the stairs is
 * not an exit, it is a longer way round — and a circuit you can enter but not
 * progress from is worse than no circuit at all.
 */
function offRampDir(
  g: Grid,
  phi: Int32Array,
  t: TilePos,
  onRing: Set<number>,
): readonly [number, number] | null {
  let best: readonly [number, number] | null = null;
  let bestRun = MIN_RUNWAY - 1;
  for (const [di, dj] of CARDS) {
    const ni = t.i + di;
    const nj = t.j + dj;
    if (!open(g, ni, nj) || onRing.has(idx(g, ni, nj))) continue;
    if (!isDownhill(g, phi, t.i, t.j, di, dj)) continue;
    const run = openRunway(g, t.i, t.j, di, dj, RAY);
    if (run > bestRun) {
      bestRun = run;
      best = [di, dj];
    }
  }
  return best;
}

export interface CircuitOpts {
  /** Tiles already spoken for. */
  occupied: (i: number, j: number) => boolean;
  start: TilePos;
  stairs: TilePos;
  /** Maximum circuits to lay. */
  maxCircuits: number;
  /** Maximum parts across all circuits — derived from density headroom by the
   *  caller, never a constant, or the busiest seeds break the density gate. */
  budget: number;
  /** Tiles per link. Defaults to decorate's PAD_STRIDE. */
  stride?: number;
  /** Parts already on the floor, for the no-orphan check. */
  existing?: readonly PinballPartSpot[];
}

/**
 * Lay circuits over the floor's routes, returning what was laid.
 *
 * Parts are RETURNED, not pushed: the caller runs the acyclicity pre-check over
 * the combined array before committing, and a pass that had already mutated
 * `parts` could not be rejected. The router does not get an exemption from the
 * soft-lock guards; it pre-satisfies them.
 */
export function authorCircuits(
  g: Grid,
  phi: Int32Array,
  routes: ReadonlyArray<ReadonlyArray<TilePos>>,
  opts: CircuitOpts,
): Circuit[] {
  const circuits: Circuit[] = [];
  if (opts.maxCircuits <= 0 || opts.budget <= 0 || !routes.length) return circuits;

  const stride = opts.stride ?? 8;
  const usedDetour = new Set<number>();
  // Every ring tile laid so far, across circuits — the interchange test.
  const ringTiles = new Map<number, number>();
  let spent = 0;
  let nextId = 1;

  for (const route of routes) {
    if (circuits.length >= opts.maxCircuits || spent >= opts.budget) break;
    const rings = findRings(g, route, usedDetour);

    for (const ring of rings) {
      if (circuits.length >= opts.maxCircuits || spent >= opts.budget) break;
      const c = layCircuit(g, phi, ring, nextId, ringTiles, opts, opts.budget - spent, stride);
      if (!c) continue;
      circuits.push(c);
      nextId++;
      spent += c.links.length;
      for (const t of c.ring) {
        const key = idx(g, t.i, t.j);
        ringTiles.set(key, c.id);
        // Only the DETOUR is consumed: later circuits are meant to re-use the
        // artery, because a shared artery IS the interchange. Excluding it
        // would produce disjoint loops — the opposite of intertwined.
        if (!route.some((r) => r.i === t.i && r.j === t.j)) usedDetour.add(key);
      }
    }
  }
  return circuits;
}

/**
 * Furnish one ring, or decline it.
 *
 * Declines rather than half-builds. The two conditions are the ones that make a
 * circuit worth having at all: enough links to read as a route, and at least
 * two off-ramps so the player is never posted around a track they cannot leave.
 */
function layCircuit(
  g: Grid,
  phi: Int32Array,
  ring: TilePos[],
  id: number,
  ringTiles: Map<number, number>,
  opts: CircuitOpts,
  budget: number,
  stride: number,
): Circuit | null {
  const n = ring.length;
  const onRing = new Set(ring.map((t) => idx(g, t.i, t.j)));
  const interchanges: TilePos[] = [];
  for (const t of ring) if (ringTiles.has(idx(g, t.i, t.j))) interchanges.push(t);

  const links: PinballPartSpot[] = [];
  const offRamps: PinballPartSpot[] = [];
  const placedAt = new Set<number>();

  const placeable = (t: TilePos): boolean =>
    !(t.i === opts.stairs.i && t.j === opts.stairs.j) &&
    Math.abs(t.i - opts.start.i) + Math.abs(t.j - opts.start.j) >= 4 &&
    !opts.occupied(t.i, t.j) &&
    !placedAt.has(idx(g, t.i, t.j)) &&
    phiAt(g, phi, t.i, t.j) < UNREACHED;

  // Start where the ring is furthest downhill — the tile a player descending
  // the artery meets first, so the circuit is entered rather than stumbled into.
  let k = 0;
  let bestPhi = Infinity;
  for (let t = 0; t < n; t++) {
    const p = phiAt(g, phi, ring[t].i, ring[t].j);
    if (p < bestPhi) {
      bestPhi = p;
      k = t;
    }
  }

  let guard = 0;
  while (links.length < budget && guard++ < n) {
    const cur = ring[k];
    const nxt = ring[(k + 1) % n];
    const dir = stepDir(cur, nxt);
    if (!dir) break;

    if (placeable(cur)) {
      const legs = openLegs(g, cur);
      const shared = ringTiles.has(idx(g, cur.i, cur.j));
      const ramp = offRampDir(g, phi, cur, onRing);

      // ── WHERE THE CHAIN MUST STOP ──────────────────────────────────────
      // An INTERCHANGE (this tile is on another circuit's ring too) and an
      // OFF-RAMP both mean the player gets to choose, and a launcher would
      // choose for them — it would shove them onward before they could take
      // the other road. So both get a part that moves the player without
      // committing a direction, which also terminates the successor chain and
      // is what keeps the shove graph acyclic.
      const mustYield = shared || (ramp !== null && offRamps.length < 2);
      if (mustYield) {
        const spot: PinballPartSpot =
          legs >= 3
            ? { i: cur.i, j: cur.j, kind: "bumper", dirI: 0, dirJ: 0, dir2I: 0, dir2J: 0, circuit: id }
            : {
                i: cur.i,
                j: cur.j,
                kind: "deflector",
                dirI: -dir[0],
                dirJ: -dir[1],
                dir2I: dir[0],
                dir2J: dir[1],
                circuit: id,
              };
        // A deflector's legs must be PERPENDICULAR — it banks one leg onto
        // another. On a straight run there is no bend to bank, so a bumper is
        // the only honest non-launcher, and it needs a junction to be legal
        // (`decorate.test` pins "bumper => 3+ open ways").
        if (spot.kind === "deflector" && dir[0] === -spot.dirI && dir[1] === -spot.dirJ) {
          // legs are opposed, not perpendicular — not a corner. Skip the tile.
        } else if (spot.kind === "bumper" || legs >= 3) {
          links.push(spot);
          placedAt.add(idx(g, cur.i, cur.j));
          if (ramp) offRamps.push(spot);
        }
      } else if (openRunway(g, cur.i, cur.j, dir[0], dir[1], MIN_RUNWAY) >= MIN_RUNWAY) {
        const spot: PinballPartSpot = {
          i: cur.i,
          j: cur.j,
          kind: "booster",
          dirI: dir[0],
          dirJ: dir[1],
          dir2I: 0,
          dir2J: 0,
          circuit: id,
        };
        links.push(spot);
        placedAt.add(idx(g, cur.i, cur.j));
      }
    }

    // ── THE HAND-OFF, BY CONSTRUCTION ────────────────────────────────────
    // Advance to where this part's shove actually PUTS the player: along the
    // exit ray to the bend or to RAY, whichever comes first. That tile is on
    // the ray with clear floor between, so the next part placed there is a
    // successor by geometry rather than by luck.
    const jump = nextLinkIndex(ring, k, dir);
    const advanced = (jump - k + n) % n;
    // A bend on the very next tile gives `advanced === 0`. Falling back to a
    // fixed stride there was a BLIND jump — eight tiles along a ring that has
    // already turned, so the part left behind fired at nothing and the next one
    // was not on its ray. Step one tile instead: the bend is where the corner
    // part belongs, and reaching it is the whole point.
    k = (k + Math.max(1, Math.min(advanced || 1, RAY))) % n;
    if (k === 0 && guard > 1) break; // came all the way round
  }

  // A bend in the ring is where a corner part belongs, and the walk above only
  // ever lays straights and yields. Upgrade every link that sits on a genuine
  // perpendicular turn, so a circuit reads as a highway with twists rather than
  // a polygon of straight pads.
  upgradeBends(g, phi, ring, links);
  pruneOrphanLinks(g, ring, links, opts.existing);

  if (links.length < 4) return null;
  if (offRamps.length < 2) return null;
  return { id, ring, links, offRamps, interchanges };
}

/** The kinds that THROW the player, and so can be said to feed something.
 *  Matches `flow-loops.LAUNCHERS` — a `deflector` banks rather than launches,
 *  which is exactly why it is the demotion target below. */
const LAUNCHERS = new Set(["ramp", "booster", "boostcorner", "spring", "slingshot", "flipper", "jumppad"]);

/**
 * THE HARD INVARIANT: no link may throw the player at nothing.
 *
 * The walk above chooses each link's position from the previous link's exit
 * ray, so the hand-off ought to hold by construction — but "ought to" is not a
 * guarantee. A tile can be unplaceable (occupied, too near the start, already
 * taken), the ring's own path can break, and `upgradeBends` can rewrite a
 * facing afterwards. Measured with only the constructive argument: circuit
 * launchers fed at 44.3%, not the ~100% the argument predicted.
 *
 * So it is CHECKED and repaired, cheapest first, using the ladder the rest of
 * the pipeline already uses: a launcher with no successor becomes a corner if
 * it sits on a bend, a bumper if it sits on a junction, and is removed
 * otherwise. All three outcomes are non-launchers, so the repair can never
 * create a new orphan and one pass is enough.
 *
 * `existing` is the parts already on the floor. Passing them in makes the check
 * CONSERVATIVE in the right direction: later passes only ever ADD parts, so a
 * successor found now stays found, and one missed now is a link demoted that
 * might have been fine. Under-counting is the safe error.
 */
function pruneOrphanLinks(
  g: Grid,
  ring: TilePos[],
  links: PinballPartSpot[],
  existing: readonly PinballPartSpot[] = [],
): void {
  const n = ring.length;
  const indexOfTile = new Map<number, number>();
  ring.forEach((t, k) => indexOfTile.set(t.i * 100003 + t.j, k));

  for (let pass = 0; pass < 2; pass++) {
    const byTile = new Set<number>();
    for (const q of [...existing, ...links]) byTile.add(idx(g, q.i, q.j));

    for (const p of links) {
      if (!LAUNCHERS.has(p.kind)) continue;
      // A corner is entered on `dir` and LEAVES on `dir2` — read the outgoing
      // leg off the part, the same way `exitRay` does, or the check judges a
      // direction the part never fires in.
      const di = p.kind === "boostcorner" ? p.dir2I : p.dirI;
      const dj = p.kind === "boostcorner" ? p.dir2J : p.dirJ;
      if (Math.abs(di) + Math.abs(dj) !== 1) continue;

      let fed = false;
      for (let s = 1; s <= RAY && !fed; s++) {
        const ni = p.i + di * s;
        const nj = p.j + dj * s;
        if (!open(g, ni, nj)) break;
        const key = idx(g, ni, nj);
        if (byTile.has(key) && !(ni === p.i && nj === p.j)) fed = true;
      }
      if (fed) continue;

      // Demote. A bend keeps the twist (a deflector banks, preserving speed);
      // a junction keeps the carom; anything else loses the part.
      const k = indexOfTile.get(p.i * 100003 + p.j);
      const into = k === undefined ? null : stepDir(ring[(k - 1 + n) % n], ring[k]);
      const outOf = k === undefined ? null : stepDir(ring[k], ring[(k + 1) % n]);
      if (into && outOf && into[0] * outOf[0] + into[1] * outOf[1] === 0) {
        p.kind = "deflector";
        p.dirI = -into[0];
        p.dirJ = -into[1];
        p.dir2I = outOf[0];
        p.dir2J = outOf[1];
      } else if (openLegs(g, p) >= 3) {
        p.kind = "bumper";
        p.dirI = 0;
        p.dirJ = 0;
        p.dir2I = 0;
        p.dir2J = 0;
      } else {
        p.kind = "REMOVE" as PinballPartSpot["kind"];
      }
    }
    for (let x = links.length - 1; x >= 0; x--) if ((links[x].kind as string) === "REMOVE") links.splice(x, 1);
  }
}

/**
 * Turn straight pads that sit on a bend into CORNER boosters.
 *
 * Same ladder the station spine uses, and deliberately so: the corner booster
 * gets first refusal on any turn with room for a boosted exit, and the
 * deflector is the fallback for a corner too tight — a deflector preserves
 * speed but adds none. Legs are `(-in, +out)`, the convention `exitRay` reads
 * and `classifyTopology` records.
 */
function upgradeBends(g: Grid, phi: Int32Array, ring: TilePos[], links: PinballPartSpot[]): void {
  const n = ring.length;
  const indexOfTile = new Map<number, number>();
  ring.forEach((t, k) => indexOfTile.set(t.i * 100003 + t.j, k));

  for (const p of links) {
    if (p.kind !== "booster") continue;
    const k = indexOfTile.get(p.i * 100003 + p.j);
    if (k === undefined) continue;
    const into = stepDir(ring[(k - 1 + n) % n], ring[k]);
    const outOf = stepDir(ring[k], ring[(k + 1) % n]);
    if (!into || !outOf) continue;
    // PERPENDICULAR, not merely different: a 180° "corner" records both legs as
    // the same vector, which is a U-turn with nothing to bank.
    if (into[0] * outOf[0] + into[1] * outOf[1] !== 0) continue;
    if (at(g, p.i - into[0], p.j - into[1]) === T_WALL) continue;
    if (at(g, p.i + outOf[0], p.j + outOf[1]) === T_WALL) continue;

    const canBoost =
      openRunway(g, p.i, p.j, outOf[0], outOf[1], MIN_RUNWAY) >= MIN_RUNWAY &&
      isDownhill(g, phi, p.i, p.j, outOf[0], outOf[1]);
    p.kind = canBoost ? "boostcorner" : "deflector";
    p.dirI = -into[0];
    p.dirJ = -into[1];
    p.dir2I = outOf[0];
    p.dir2J = outOf[1];
  }
}
