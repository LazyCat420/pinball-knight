/**
 * TRACK GROWTH — the circuit is GROWN, not scavenged.
 *
 * ── Why this module exists ────────────────────────────────────────────────
 *
 * The shipped pipeline authors the maze first and then goes looking for a
 * racing line inside it:
 *
 *     generateMaze → carveRooms → pickEndpoints → widenMainArtery → arcSweeps
 *
 * So the "track" is a CONSEQUENCE of a random maze and inherits every wiggle
 * and dead-end that maze happened to produce. Three symptoms follow directly,
 * and all three are visible on any floor:
 *
 *  1. Curves land where the maze left a gap, not where the ball actually goes,
 *     so ramps and boosters read as fragments pointing nowhere.
 *  2. There is no room for a real curve. `artery-banks.ts` censused 22,713
 *     open tiles: 81.8% have an open radius of ZERO, and radius-4 fillets fit
 *     4 times in 40 floors. The maze commits the space before anyone asks the
 *     track what it needs.
 *  3. Nothing makes the floor READ as a circuit, because nothing ever was one.
 *
 * This module inverts that. The circuit is authored FIRST, as a graph with
 * guaranteed loops, and the maze is grown into what's left over.
 *
 * ── Why slime mould ───────────────────────────────────────────────────────
 *
 * A hand-authored circuit would be identical every floor. A purely random one
 * is what we already have. Physarum polycephalum growth gives us the third
 * thing: a network that is different every level, organic rather than gridded,
 * and — critically — NATURALLY LOOPY.
 *
 * The real organism solves this by feedback: protoplasm flows between food
 * sources, tubes that carry flow THICKEN, tubes that don't ATROPHY. Redundant
 * connections survive wherever two routes are comparably good, which is
 * exactly the "interconnected highways" property we want, and is precisely
 * what a spanning tree (and therefore a maze generator) destroys by
 * construction.
 *
 * The model here is the standard Tero–Takagi–Nakagawa conductivity model:
 *
 *     Q_ij = D_ij (p_i − p_j) / L_ij          flow through a tube
 *     dD_ij/dt = f(|Q_ij|) − μ D_ij           thicken with flow, decay always
 *
 * with pressures solved from Kirchhoff conservation at every node. `f` is
 * sigmoidal-ish (see FLOW_GAIN) so strong tubes reinforce faster than weak
 * ones — that's what sharpens a diffuse mesh into distinct highways instead of
 * leaving everything a uniform grey.
 *
 * DELIBERATELY DOM- and three-free, and seeded: a floor must regenerate
 * identically from (level, runSeed) or co-op peers desync. No Math.random on
 * any path here.
 */
import type { TilePos } from "./generator";

/** A junction in the growing network. Positions are in TILE space (floats). */
export interface TrackNode {
  id: number;
  x: number;
  z: number;
  /** Food sources anchor the network and are never pruned. */
  food: boolean;
}

/** A tube between two nodes. `d` is conductivity — the thing that grows. */
export interface TrackEdge {
  a: number;
  b: number;
  /** Conductivity. High = a highway, low = about to atrophy. */
  d: number;
  /** Euclidean length in tiles, cached (it never changes). */
  len: number;
}

export interface TrackGraph {
  nodes: TrackNode[];
  edges: TrackEdge[];
}

/**
 * Physarum parameters. These are the numbers that decide whether the output
 * reads as "a few fat highways" or "grey mush", so they are named and
 * commented rather than inlined.
 */
export interface GrowOpts {
  /** Simulation steps. More = sharper separation between highway and capillary. */
  steps: number;
  /** Decay rate μ. Higher prunes harder, leaving fewer/fatter tubes. */
  decay: number;
  /** Flow-reinforcement exponent. >1 makes strong tubes win faster (sharpening). */
  gain: number;
  /** Total flow pushed through the network each step. */
  flow: number;
}

export const DEFAULT_GROW: GrowOpts = {
  steps: 140,
  // Tuned together with `gain`: at decay 0.10/gain 1.35 the network keeps ~2-4
  // independent cycles on a typical floor, which is the figure-eight-or-better
  // topology the design asks for. Raising decay past ~0.16 collapses it to a
  // tree (no loops at all) and the whole point is lost.
  decay: 0.07,
  gain: 1.35,
  flow: 1,
};

/**
 * Seed the network: food sources plus a scattering of relay nodes.
 *
 * Relays matter. With food-only nodes the solver connects them in near-straight
 * lines and the result is a spiderweb of chords — geometrically dull and, worse,
 * full of shallow angles that rasterize into unrideable zigzags. Relays give the
 * network intermediate points to route THROUGH, so surviving tubes bend.
 *
 * Poisson-ish rejection sampling (not a grid) keeps the layout organic while
 * still guaranteeing a minimum separation, so no two nodes fuse into one blob
 * when the graph is later smoothed into arcs.
 */
export function seedNodes(
  w: number,
  h: number,
  rng: () => number,
  opts: { foods: number; relays: number; margin?: number; minSep?: number },
): TrackNode[] {
  const nodes: TrackNode[] = [];
  const place = scatterPlacer(w, h, rng, nodes, opts);
  // Food first so they claim the good spread; relays fill between them.
  for (let i = 0; i < opts.foods; i++) place(true);
  for (let i = 0; i < opts.relays; i++) place(false);
  return nodes;
}

/**
 * The rejection sampler shared by every layout: place a node at a random point
 * at least `minSep` from every node already down, or give up after `tries`.
 *
 * Factored out so the structured layouts below can seed their FOOD nodes on a
 * shape and still scatter their relays by exactly the rule `seedNodes` uses —
 * the relays are what give the solver intermediate points to bend through, and
 * they want the same organic spacing whatever shape the food is on.
 */
function scatterPlacer(
  w: number,
  h: number,
  rng: () => number,
  nodes: TrackNode[],
  // `keepOut` is a PREDICATE, not a disc. It started as `{x, z, r}` for the
  // hub's plaza, and the moment the spine needed to protect a long thin
  // stadium there was no radius that expressed it: a disc big enough to cover
  // the boulevard also covers half the floor. A predicate lets each layout
  // state its own exclusion in its own geometry and costs the caller a closure.
  opts: { margin?: number; minSep?: number; keepOut?: (x: number, z: number) => boolean },
  tries = 40,
): (food: boolean) => boolean {
  const margin = opts.margin ?? Math.max(3, Math.min(w, h) * 0.12);
  const minSep = opts.minSep ?? Math.max(4, Math.min(w, h) * 0.16);
  const keepOut = opts.keepOut;
  const far = (x: number, z: number): boolean => {
    for (const n of nodes) if ((n.x - x) ** 2 + (n.z - z) ** 2 < minSep * minSep) return false;
    return true;
  };
  return (food: boolean): boolean => {
    for (let t = 0; t < tries; t++) {
      const x = margin + rng() * (w - 2 * margin);
      const z = margin + rng() * (h - 2 * margin);
      if (keepOut?.(x, z)) continue;
      if (!far(x, z)) continue;
      nodes.push({ id: nodes.length, x, z, food });
      return true;
    }
    return false;
  };
}

/**
 * How a floor's FOOD nodes are sited before the growth simulation runs.
 *
 * This is the archetype's real lever on macro topology, and the reason it lives
 * here rather than in a tile pass: Physarum reinforces routes BETWEEN food
 * sources, so where the food sits decides what the surviving circuit looks
 * like. Scatter food uniformly and you get the same organic mesh every floor,
 * whatever the level is called.
 *
 *   scatter — uniform Poisson-ish. The mesh; no imposed shape.
 *   spine   — food strung around one long thin STADIUM, so flow concentrates
 *             into a single boulevard with a return run.
 *   ring    — food on concentric rectangles, so progress reads as working
 *             inward through galleries.
 *   hub     — one food dead centre plus a ring around it, so legs radiate as
 *             spokes from a chamber the carver then opens into a plaza.
 *
 * Every layout still runs through the SAME growth and pruning, so all of the
 * downstream guarantees (connected, loopy, no dangling spurs) hold unchanged —
 * a layout biases the outcome, it does not bypass the machinery.
 */
export type NodeLayout = "scatter" | "spine" | "ring" | "hub";

export interface LayoutOpts {
  layout: NodeLayout;
  foods: number;
  relays: number;
  margin?: number;
  minSep?: number;
}

/** Site nodes for a layout. `scatter` is exactly `seedNodes`, draw for draw. */
export function layoutNodes(w: number, h: number, rng: () => number, opts: LayoutOpts): TrackNode[] {
  if (opts.layout === "scatter") return seedNodes(w, h, rng, opts);

  const margin = opts.margin ?? Math.max(3, Math.min(w, h) * 0.12);
  const minSep = opts.minSep ?? Math.max(4, Math.min(w, h) * 0.16);
  const nodes: TrackNode[] = [];
  const x0 = margin;
  const z0 = margin;
  const x1 = w - margin;
  const z1 = h - margin;
  // Structured food is placed on the shape whatever the spacing says — the
  // shape IS the point — but never closer than half the separation, or two
  // nodes fuse into one blob when the graph is smoothed into arcs.
  const clear = (x: number, z: number): boolean => {
    for (const n of nodes) if ((n.x - x) ** 2 + (n.z - z) ** 2 < (minSep * 0.5) ** 2) return false;
    return true;
  };
  const put = (x: number, z: number, food: boolean): void => {
    const cx = Math.max(x0, Math.min(x1, x));
    const cz = Math.max(z0, Math.min(z1, z));
    if (!clear(cx, cz)) return;
    nodes.push({ id: nodes.length, x: cx, z: cz, food });
  };
  /** Walk a polyline and drop `n` food nodes at equal arc length. */
  const alongPolyline = (pts: Array<[number, number]>, n: number): void => {
    const segs: number[] = [];
    let total = 0;
    for (let k = 1; k < pts.length; k++) {
      const d = Math.hypot(pts[k][0] - pts[k - 1][0], pts[k][1] - pts[k - 1][1]);
      segs.push(d);
      total += d;
    }
    if (total <= 0) return;
    for (let i = 0; i < n; i++) {
      let want = (total * i) / Math.max(1, n - 1);
      for (let k = 0; k < segs.length; k++) {
        if (want > segs[k] && k < segs.length - 1) {
          want -= segs[k];
          continue;
        }
        const t = segs[k] > 0 ? Math.min(1, want / segs[k]) : 0;
        put(pts[k][0] + (pts[k + 1][0] - pts[k][0]) * t, pts[k][1] + (pts[k + 1][1] - pts[k][1]) * t, true);
        break;
      }
    }
  };

  let keepOut: ((x: number, z: number) => boolean) | undefined;

  if (opts.layout === "spine") {
    // ── THE SPINE MUST BE A LOOP, and this is the whole lesson of the layout.
    //
    // The first version strung food along an open polyline — a straight run, an
    // elbow, a Z — which is exactly what a "spine" sounds like. It produced
    // nothing: measured over 10 seeds × 5 depths, lane share 0.016–0.056,
    // circuit rank 1.1, and 8-10 floors out of 10 failing the exit-distance
    // constraint with a stairwell 13 tiles from the spawn.
    //
    // The cause is topological and it is `pruneLeaves`. A path is ALL leaves:
    // its two ends have degree 1, so they are removed, which exposes the next
    // pair, cascading until only a cycle is left. Whatever the flow simulation
    // reinforced, the boulevard was deleted after the fact — and the pruner is
    // right to do it, because an open-ended road IS a road that dead-ends in
    // solid rock.
    //
    // So the spine is a STADIUM: one long thin closed circuit, out along one
    // side and back along the other. It reads as a boulevard at ground level
    // (the two runs are far enough apart to be separate roads), it survives
    // `pruneLeaves` by construction, and it gives the floor a genuine lap.
    const cx = (x0 + x1) / 2;
    const cz = (z0 + z1) / 2;
    // Four poses: along each axis and the two diagonals.
    const theta = (Math.floor(rng() * 4) * Math.PI) / 4;
    const cos = Math.abs(Math.cos(theta));
    const sin = Math.abs(Math.sin(theta));
    // Half-width of the stadium — the gap between the outbound and return runs.
    //
    // Widened from 0.16-0.24. The Spine runs the widest lanes in the game
    // (laneScale 1.25), and at the old half-width the two U-turns at the ends
    // were not hairpins, they were FILLED BOWLS: a turn of radius `half` swept
    // by a lane that wide leaves no island in the middle. Measured, that gave
    // the Spine the largest open blob of any archetype — 0.230 of walkable
    // against the Great Hall's 0.213 — so the floor whose card promises "one
    // long road · everything else is a pocket" was quietly the floor with the
    // biggest room, and the Hall's one structural feature lost to it.
    // A wider stadium keeps the ends as turns and the middle as rock.
    const half = Math.max(8, Math.min(x1 - x0, z1 - z0) * (0.22 + rng() * 0.08));
    // Longest half-length whose rotated bounding box still fits the margins.
    // Solving both extents at once rather than clamping afterwards keeps the
    // shape centred instead of shoved against a wall.
    const roomX = (x1 - x0) / 2;
    const roomZ = (z1 - z0) / 2;
    const lenX = cos > 1e-6 ? (roomX - half * sin) / cos : Infinity;
    const lenZ = sin > 1e-6 ? (roomZ - half * cos) / sin : Infinity;
    const len = Math.max(half + 4, Math.min(lenX, lenZ));
    const ux = Math.cos(theta);
    const uz = Math.sin(theta);
    // Perpendicular, for the two runs.
    const px = -uz;
    const pz = ux;
    const corner = (a: number, b: number): [number, number] => [cx + ux * len * a + px * half * b, cz + uz * len * a + pz * half * b];
    alongPolyline([corner(-1, -1), corner(1, -1), corner(1, 1), corner(-1, 1), corner(-1, -1)], opts.foods + 1);
    // ── KEEP THE RELAYS OUT OF THE INFIELD ──────────────────────────────────
    //
    // The stadium survives `pruneLeaves` by being a loop, but nothing was
    // stopping a relay landing INSIDE it — and a relay in the infield is a
    // node the mesh will happily chord across the middle of the boulevard,
    // giving the flow solver a shortcut that costs half the lap. The result is
    // a "spine" whose longest sustained straight varies wildly seed to seed:
    // censused over 36 floors, longest 3-wide road ran 0.463 of the long side
    // with an sd of 0.22 — i.e. some Spine floors had no boulevard at all,
    // which is the one thing the archetype promises.
    //
    // The exclusion is the stadium's own geometry (a capsule inset from the
    // runs), not a disc: no radius covers a long thin shape without also
    // covering the floor. Food is unaffected — it is already ON the stadium.
    const infield = Math.max(2, half - 3);
    keepOut = (x: number, z: number): boolean => {
      const dx = x - cx;
      const dz = z - cz;
      const along = dx * ux + dz * uz;
      const across = dx * px + dz * pz;
      return Math.abs(along) < len && Math.abs(across) < infield;
    };
  } else if (opts.layout === "ring") {
    // ── CONCENTRIC GALLERIES, AND THE CONSTRAINT THAT MAKES THEM GALLERIES ──
    //
    // `meshNeighbours` wires every node to its K NEAREST. So if the gap
    // between two rings is smaller than the gap between two food nodes ALONG a
    // ring, each node's nearest neighbours are the ones on the ring next door,
    // and the mesh comes out as RUNGS — a ladder — before the flow solver ever
    // runs. The concentric layout is then meshed away and what survives is
    // indistinguishable from a scatter web.
    //
    // That is what was happening. On a level-20 floor the old numbers put 20
    // food on a 342-tile outer ring (spacing ~17) with an inset of 8.4, so
    // every cross-ring neighbour was twice as close as every along-ring one.
    // Censused: the Ring Keep's concentric-banding score ran 1.75 against
    // 1.08-1.36 for archetypes with no rings at all (Cohen's d 0.88), and it
    // was the confusion sink of a blind classifier — warrens, spine and
    // greathall floors were all misread as Ring Keeps.
    //
    // So the inset is derived FROM the spacing rather than from the ring
    // count, and the ring count drops until both fit inside the floor. Fix
    // topology in topology-land: no amount of tile-level work downstream can
    // put a gallery back once the mesh has decided it is a rung.
    const span = Math.min(x1 - x0, z1 - z0);
    /** Food on ring `r` of `n` — outer rings are longer roads and get more. */
    const shareOf = (r: number, n: number): number => Math.max(3, Math.round((opts.foods * (n - r)) / ((n * (n + 1)) / 2)));
    let rings = Math.max(2, Math.min(3, Math.round(Math.min(w, h) / 34) + 1));
    let inset = 0;
    for (; rings >= 2; rings--) {
      // Widest along-ring spacing over the rings we would draw. The outermost
      // is the longest road but also gets the most food, so it is not
      // automatically the loosest — measure them all.
      let worst = 0;
      let placedGuess = 0;
      for (let r = 0; r < rings; r++) {
        const n = Math.min(shareOf(r, rings), Math.max(1, opts.foods - placedGuess));
        placedGuess += n;
        // Perimeter of ring r under the inset we are about to solve for is
        // itself inset-dependent, so use the outermost perimeter as the upper
        // bound: it can only overestimate the spacing, which is the safe
        // direction for a separation constraint.
        worst = Math.max(worst, (2 * (x1 - x0 + z1 - z0)) / Math.max(1, n));
      }
      // 1.25x, not 1.0: equal is a coin flip in a K-nearest tie, and a tie
      // broken the wrong way is a rung.
      inset = Math.max(span / (2 * (rings + 1)), worst * 1.25);
      // Every ring must still enclose real area, or the innermost "gallery"
      // is a dot in the middle of the floor.
      if (inset * (rings - 1) * 2 < span * 0.62) break;
    }
    rings = Math.max(2, rings);
    let placed = 0;
    for (let r = 0; r < rings && placed < opts.foods; r++) {
      const a0 = x0 + inset * r;
      const b0 = z0 + inset * r;
      const a1 = x1 - inset * r;
      const b1 = z1 - inset * r;
      if (a1 - a0 < 6 || b1 - b0 < 6) break; // a ring with no room left is not a gallery
      const n = Math.min(shareOf(r, rings), opts.foods - placed);
      alongPolyline(
        [
          [a0, b0],
          [a1, b0],
          [a1, b1],
          [a0, b1],
          [a0, b0],
        ],
        n + 1, // the closing point coincides with the opener; one extra covers it
      );
      placed += n;
    }
    // Relays scattered between the galleries are the same defect as relays in
    // the spine's infield: they are exactly the intermediate points a chord
    // needs to cut from one gallery to the next. Keep them within a band of a
    // ring so they bend the galleries instead of bridging them — the gates
    // between rings are then the few the flow solver genuinely wants, which is
    // what "the way in is inward" means.
    const band = inset * 0.34;
    keepOut = (x: number, z: number): boolean => {
      for (let r = 0; r < rings; r++) {
        const a0 = x0 + inset * r;
        const b0 = z0 + inset * r;
        const a1 = x1 - inset * r;
        const b1 = z1 - inset * r;
        if (a1 - a0 < 6 || b1 - b0 < 6) break;
        // Chebyshev distance to the rectangle's outline.
        const dx = Math.max(a0 - x, 0, x - a1);
        const dz = Math.max(b0 - z, 0, z - b1);
        const outside = Math.max(dx, dz);
        const inside = x > a0 && x < a1 && z > b0 && z < b1 ? Math.min(x - a0, a1 - x, z - b0, b1 - z) : 0;
        if (Math.max(outside, inside) <= band) return false; // near a gallery — allowed
      }
      return true;
    };
  } else {
    // hub — a chamber with spokes. The centre node is what the carver later
    // opens into the plaza, so it must be FOOD: relays get pruned, food never is.
    const cx = (x0 + x1) / 2 + (rng() - 0.5) * (x1 - x0) * 0.1;
    const cz = (z0 + z1) / 2 + (rng() - 0.5) * (z1 - z0) * 0.1;
    put(cx, cz, true);
    const ringR = Math.min(x1 - x0, z1 - z0) * 0.3;
    const spokes = Math.max(4, Math.min(8, opts.foods - 2));
    const phase = rng() * Math.PI * 2;
    for (let s = 0; s < spokes; s++) {
      const a = phase + (s / spokes) * Math.PI * 2;
      put(cx + Math.cos(a) * ringR, cz + Math.sin(a) * ringR * ((z1 - z0) / (x1 - x0)), true);
    }
    // The rest of the food goes out near the walls, so the plaza has an outer
    // world to be the centre OF rather than sitting alone in rock.
    for (let s = 0; s < Math.max(0, opts.foods - spokes - 1); s++) {
      const a = phase + 0.4 + (s / Math.max(1, opts.foods - spokes - 1)) * Math.PI * 2;
      put(cx + Math.cos(a) * (x1 - x0) * 0.45, cz + Math.sin(a) * (z1 - z0) * 0.45, true);
    }
    // Keep relays out of the chamber, or the maze grows through the plaza.
    const chamberR = ringR * 0.72;
    keepOut = (x: number, z: number): boolean => (x - cx) ** 2 + (z - cz) ** 2 < chamberR * chamberR;
  }

  const place = scatterPlacer(w, h, rng, nodes, { margin, minSep, keepOut });
  for (let i = 0; i < opts.relays; i++) place(false);
  return nodes;
}

/**
 * The initial mesh: connect each node to its K nearest neighbours.
 *
 * K is the loop budget. K=2 is essentially a ring or a tree and the solver has
 * nothing to choose between; K=4+ is dense enough that decay has real work to
 * do and the SURVIVING topology is genuinely emergent rather than preordained.
 * Duplicate edges are collapsed (the relation is symmetric).
 */
export function meshNeighbours(nodes: TrackNode[], k = 4, maxLen = Infinity): TrackEdge[] {
  const seen = new Set<string>();
  const edges: TrackEdge[] = [];
  for (const n of nodes) {
    const near = nodes
      .filter((m) => m.id !== n.id)
      .filter((m) => Math.hypot(m.x - n.x, m.z - n.z) <= maxLen)
      .sort((p, q) => (p.x - n.x) ** 2 + (p.z - n.z) ** 2 - ((q.x - n.x) ** 2 + (q.z - n.z) ** 2))
      .slice(0, k);
    for (const m of near) {
      const a = Math.min(n.id, m.id);
      const b = Math.max(n.id, m.id);
      const key = `${a}:${b}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const len = Math.hypot(nodes[a].x - nodes[b].x, nodes[a].z - nodes[b].z);
      // Start every tube equal and let flow decide. Seeding `d` from length
      // would prejudge the outcome — short tubes would win before the
      // simulation ran, which is just "nearest-neighbour graph" with extra
      // steps.
      edges.push({ a, b, d: 1, len: Math.max(0.001, len) });
    }
  }
  return edges;
}

/**
 * Solve node pressures for a source/sink pair by Gauss–Seidel relaxation.
 *
 * Kirchhoff at every non-terminal node: Σ D_ij (p_i − p_j)/L_ij = 0, which
 * rearranges to the weighted-average update below. Gauss–Seidel rather than a
 * matrix solve because the network is tiny (tens of nodes), it needs no
 * allocation, and it degrades gracefully — a not-quite-converged pressure field
 * still yields a sane flow direction, which is all the conductivity update
 * actually consumes.
 */
function solvePressures(g: TrackGraph, source: number, sink: number, flow: number, iters = 60): Float64Array {
  const n = g.nodes.length;
  const p = new Float64Array(n);
  p[source] = flow;
  p[sink] = 0;
  // Adjacency with conductance per edge (D/L).
  const adj: Array<Array<{ to: number; c: number }>> = Array.from({ length: n }, () => []);
  for (const e of g.edges) {
    const c = e.d / e.len;
    adj[e.a].push({ to: e.b, c });
    adj[e.b].push({ to: e.a, c });
  }
  for (let it = 0; it < iters; it++) {
    for (let i = 0; i < n; i++) {
      if (i === source || i === sink) continue;
      let num = 0;
      let den = 0;
      for (const { to, c } of adj[i]) {
        num += c * p[to];
        den += c;
      }
      if (den > 1e-12) p[i] = num / den;
    }
  }
  return p;
}

/**
 * Run the growth. Every step picks a food pair, pushes flow between them, and
 * updates conductivities.
 *
 * Cycling the source/sink pair across ALL food nodes (rather than fixing one
 * pair) is what produces loops: each pair reinforces its own best route, and
 * where two routes overlap they compound, while a tube useful to only one pair
 * still survives if its flow beats decay. A single fixed pair would reinforce
 * exactly one path and decay everything else — a tree again.
 */
export function growNetwork(g: TrackGraph, rng: () => number, opts: GrowOpts = DEFAULT_GROW): TrackGraph {
  const foods = g.nodes.filter((n) => n.food).map((n) => n.id);
  if (foods.length < 2 || g.edges.length === 0) return g;

  for (let step = 0; step < opts.steps; step++) {
    // Deterministic pair selection from the seeded rng.
    const s = foods[Math.floor(rng() * foods.length)];
    let t = foods[Math.floor(rng() * foods.length)];
    if (t === s) t = foods[(foods.indexOf(s) + 1) % foods.length];

    const p = solvePressures(g, s, t, opts.flow);

    // NORMALISE the flow field before reinforcing.
    //
    // The raw magnitudes are the trap here. |Q| = D·Δp/L with Δp ≤ 1 spread
    // over ~4 hops and L ~ 15 tiles gives |Q| ~ 0.02, so Q^1.35 ~ 5e-3 against
    // a decay term of μD ~ 0.1 — reinforcement runs ~20× weaker than decay and
    // EVERY tube starves to the 1e-4 floor, whatever its flow. The first draft
    // did exactly that and produced a uniformly dead graph, which the pruner
    // then read as "all edges equal" (measured: 42/42 edges at 0.000).
    //
    // Scaling by the step's own strongest flow makes the update scale-free: the
    // busiest tube always gains ~1 unit, the rest gain in proportion, and the
    // gain exponent still decides how sharply they separate. That is what the
    // model actually needs — the ABSOLUTE flow is an artifact of floor size and
    // node count, only the RELATIVE flow carries information.
    let qMax = 0;
    const qs = new Float64Array(g.edges.length);
    for (let i = 0; i < g.edges.length; i++) {
      const e = g.edges[i];
      const q = Math.abs((e.d * (p[e.a] - p[e.b])) / e.len);
      qs[i] = q;
      if (q > qMax) qMax = q;
    }
    if (qMax < 1e-12) continue; // no flow this step (degenerate pair) — skip

    for (let i = 0; i < g.edges.length; i++) {
      const e = g.edges[i];
      // f(|Q|) − μD. The exponent sharpens: with gain > 1 a tube carrying twice
      // the flow gains more than twice the conductivity, so the mesh separates
      // into highways and capillaries instead of drifting to a uniform value.
      e.d += Math.pow(qs[i] / qMax, opts.gain) - opts.decay * e.d;
      if (e.d < 1e-4) e.d = 1e-4; // never negative; a dead tube can revive
    }
  }
  return g;
}

/**
 * Prune atrophied tubes, then guarantee the result is still one connected
 * component with at least `minLoops` independent cycles.
 *
 * The cycle count is `E − V + 1` per component (the circuit rank). That number
 * IS the design requirement — "figure-eight or better" means rank ≥ 2 — so it
 * is measured directly rather than inferred from some proxy like edge count.
 *
 * Pruning walks weakest-first and REFUSES any cut that would disconnect the
 * graph or drop the rank below the floor. That ordering matters: pruning by a
 * fixed threshold is what produced disconnected islands in the first draft,
 * because conductivity distributions vary wildly between seeds and no single
 * threshold is right for all of them.
 */
export function pruneToCircuit(g: TrackGraph, minLoops = 2, opts: { survive?: number } = {}): TrackGraph {
  const keep = new Set(g.edges.map((_, i) => i));
  const order = g.edges.map((e, i) => ({ i, d: e.d })).sort((a, b) => a.d - b.d);

  // A tube that ended the simulation genuinely THRIVING is kept regardless of
  // how many loops we already have. Without this the loop count pins to exactly
  // `minLoops` on every seed — the pruner shaves until the floor stops it, so
  // the "organic, different every level" topology collapses into "always a
  // figure-eight". The threshold is relative to the network's own strongest
  // tube, because absolute conductivity varies by an order of magnitude
  // between seeds and no fixed cutoff is right for all of them.
  const maxD = g.edges.reduce((m, e) => Math.max(m, e.d), 0);
  const surviveAt = maxD * (opts.survive ?? 0.12);

  const connectedAndRank = (): { ok: boolean; rank: number; seen: Set<number> } => {
    const adj = new Map<number, number[]>();
    let edgeCount = 0;
    for (const i of keep) {
      const e = g.edges[i];
      edgeCount++;
      if (!adj.has(e.a)) adj.set(e.a, []);
      if (!adj.has(e.b)) adj.set(e.b, []);
      adj.get(e.a)!.push(e.b);
      adj.get(e.b)!.push(e.a);
    }
    const start = adj.keys().next().value;
    const seen = new Set<number>();
    if (start === undefined) return { ok: false, rank: 0, seen };
    const stack = [start];
    seen.add(start);
    while (stack.length) {
      const v = stack.pop()!;
      for (const u of adj.get(v) ?? []) if (!seen.has(u)) (seen.add(u), stack.push(u));
    }
    const ok = seen.size === adj.size;
    return { ok, rank: edgeCount - seen.size + 1, seen };
  };

  for (const { i, d } of order) {
    if (d >= surviveAt) continue; // thriving — the flow earned it, keep it
    keep.delete(i);
    const { ok, rank } = connectedAndRank();
    if (!ok || rank < minLoops) keep.add(i); // undo — this tube is load-bearing
  }

  const kept = [...keep].map((i) => g.edges[i]);
  const used = new Set<number>();
  for (const e of kept) (used.add(e.a), used.add(e.b));
  return { nodes: g.nodes.filter((n) => used.has(n.id)), edges: kept };
}

/**
 * PRUNE LEAVES — drop degree-1 nodes, cascading.
 *
 * This is where "roads that dead-end in mid-air" actually come from, and it is
 * worth being precise because two earlier fixes aimed at the symptom and missed.
 *
 * `pruneToCircuit` guarantees the graph stays CONNECTED and keeps its LOOPS,
 * but neither property forbids a dangling spur: a node of degree 1 is attached
 * to the network and destroys no cycle, so the pruner happily keeps it.
 * Carved, that spur is a lane that runs out into solid rock. Measured on the
 * graph: 2-4 leaf nodes per floor, which matched the 1.3 road terminations per
 * floor seen downstream almost exactly.
 *
 * Repairing it at TILE level (extend the stub until it rejoins something) does
 * not work — it was tried, and it "joined" 8-24 times per floor while the
 * termination count never moved, because every extension creates a new tile
 * that is itself the new end of the road. The defect is topological, so the fix
 * has to be topological: remove the leaf, not the tile.
 *
 * Cascading, because removing a leaf can expose another one behind it.
 */
export function pruneLeaves(g: TrackGraph): TrackGraph {
  const edges = g.edges.slice();
  for (let guard = 0; guard < 200; guard++) {
    const deg = new Map<number, number>();
    for (const e of edges) {
      deg.set(e.a, (deg.get(e.a) ?? 0) + 1);
      deg.set(e.b, (deg.get(e.b) ?? 0) + 1);
    }
    const leaf = new Set([...deg.entries()].filter(([, d]) => d <= 1).map(([n]) => n));
    if (!leaf.size) break;
    for (let i = edges.length - 1; i >= 0; i--) {
      if (leaf.has(edges[i].a) || leaf.has(edges[i].b)) edges.splice(i, 1);
    }
  }
  const used = new Set<number>();
  for (const e of edges) (used.add(e.a), used.add(e.b));
  return { nodes: g.nodes.filter((n) => used.has(n.id)), edges };
}

/** Circuit rank (independent cycles) of a graph assumed connected. */
export function circuitRank(g: TrackGraph): number {
  const used = new Set<number>();
  for (const e of g.edges) (used.add(e.a), used.add(e.b));
  return used.size === 0 ? 0 : g.edges.length - used.size + 1;
}

/**
 * The whole growth stage: seed → mesh → grow → prune.
 *
 * Returns a connected, loopy graph in tile space. It is NOT yet a track — the
 * edges are straight chords between nodes. `track-path.ts` turns it into
 * rideable geometry; this module only decides the TOPOLOGY.
 */
export function growTrack(
  w: number,
  h: number,
  rng: () => number,
  opts: {
    foods?: number;
    relays?: number;
    minLoops?: number;
    grow?: GrowOpts;
    layout?: NodeLayout;
    maxLenFrac?: number;
    survive?: number;
  } = {},
): TrackGraph {
  // Scale the seed count with floor area so a big floor gets a bigger network
  // rather than the same little circuit adrift in it.
  // FOOD COUNT IS THE COMPLEXITY DIAL, and it was worth measuring rather than
  // guessing. Physarum genuinely optimises toward a MINIMAL efficient network,
  // so with few food sources it converges on the same small answer every seed:
  // at 5 foods the output was 8 nodes / 9 edges / rank 2 on 30/30 seeds — a
  // textbook figure-eight, but identical every floor, which is the one thing
  // this design was supposed to avoid.
  //
  // Measured over 30 seeds per setting (rank min/avg/max):
  //     5 foods → 2/2.00/2      10 foods → 2/2.37/4
  //     8 foods → 2/2.13/3      12 foods → 2/2.87/6
  //    14 foods → 2/3.97/7   ← genuine per-floor variety
  //
  // More food means more competing routes, so more tubes survive on their own
  // flow and the surviving topology actually differs between seeds.
  //
  // ── THE CAP THAT WASN'T ───────────────────────────────────────────────────
  //
  // The clamps below used to be `min(15, …)` and `min(22, …)`, and a census
  // showed both BINDING FROM FLOOR 1: every depth from 1 to 10 wanted 15 food
  // and 22 relays and got exactly that, while the grid grew 3975 → 11125 tiles.
  // So "scale the seed count with floor area" is precisely what did not happen,
  // and the consequence was visible in the output — the circuit's share of the
  // walkable floor decayed 0.30 → 0.12 with depth. The same little network,
  // adrift in a bigger and bigger floor, which is the exact failure the comment
  // above claims to prevent. Raised so the clamp is a runaway guard on the
  // deepest floors rather than the operative value on every floor.
  const area = w * h;
  const foods = opts.foods ?? Math.max(6, Math.min(44, Math.round(area / 260) + 4));
  const relays = opts.relays ?? Math.max(8, Math.min(64, Math.round(area / 190) + 6));
  const nodes = layoutNodes(w, h, rng, { layout: opts.layout ?? "scatter", foods, relays, minSep: 5 });
  // CAP THE CHORD LENGTH. A nearest-neighbour mesh on a sparse region can still
  // pair two nodes across the whole floor, and a long chord swept with a
  // 2.5-tile brush paves everything it crosses: measured 8/40 floors ending up
  // >70% track, one at 97% — a floor with no maze left in it at all. Keeping
  // tubes local also keeps the network planar-ish, so legs cross each other far
  // less and the circuit reads as roads rather than a cat's cradle.
  const maxLen = Math.min(w, h) * (opts.maxLenFrac ?? 0.42);
  const edges = meshNeighbours(nodes, 4, maxLen);
  const grown = growNetwork({ nodes, edges }, rng, opts.grow ?? DEFAULT_GROW);
  // Prune to a loopy connected core, THEN drop dangling spurs. Both are
  // needed: pruneToCircuit protects cycles but happily keeps a degree-1 tail,
  // and that tail is exactly what carves into a road ending in solid rock.
  //
  // `survive` is the second dial on how much circuit a floor gets, and it is
  // NOT interchangeable with the node count: the node count decides how many
  // routes compete, `survive` decides how many of them the pruner lets live.
  // Measured over 8 seeds × 3 depths × 5 layouts, raising it 0.045 → 0.20
  // roughly halves both lane share and circuit rank on every one, which makes
  // it the archetype's coarse "how much track" knob. Left at the shipped
  // default here; the profiles set their own (see archetypes.ts).
  return pruneLeaves(pruneToCircuit(grown, opts.minLoops ?? 2, { survive: opts.survive }));
}
