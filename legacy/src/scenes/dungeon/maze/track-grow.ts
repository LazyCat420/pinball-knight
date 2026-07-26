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
  const margin = opts.margin ?? Math.max(3, Math.min(w, h) * 0.12);
  const minSep = opts.minSep ?? Math.max(4, Math.min(w, h) * 0.16);
  const nodes: TrackNode[] = [];
  const far = (x: number, z: number): boolean => {
    for (const n of nodes) if ((n.x - x) ** 2 + (n.z - z) ** 2 < minSep * minSep) return false;
    return true;
  };
  const place = (food: boolean, tries: number): void => {
    for (let t = 0; t < tries; t++) {
      const x = margin + rng() * (w - 2 * margin);
      const z = margin + rng() * (h - 2 * margin);
      if (!far(x, z)) continue;
      nodes.push({ id: nodes.length, x, z, food });
      return;
    }
  };
  // Food first so they claim the good spread; relays fill between them.
  for (let i = 0; i < opts.foods; i++) place(true, 40);
  for (let i = 0; i < opts.relays; i++) place(false, 40);
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
  opts: { foods?: number; relays?: number; minLoops?: number; grow?: GrowOpts } = {},
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
  const area = w * h;
  const foods = opts.foods ?? Math.max(6, Math.min(15, Math.round(area / 260) + 4));
  const relays = opts.relays ?? Math.max(8, Math.min(22, Math.round(area / 190) + 6));
  const nodes = seedNodes(w, h, rng, { foods, relays, minSep: 5 });
  // CAP THE CHORD LENGTH. A nearest-neighbour mesh on a sparse region can still
  // pair two nodes across the whole floor, and a long chord swept with a
  // 2.5-tile brush paves everything it crosses: measured 8/40 floors ending up
  // >70% track, one at 97% — a floor with no maze left in it at all. Keeping
  // tubes local also keeps the network planar-ish, so legs cross each other far
  // less and the circuit reads as roads rather than a cat's cradle.
  const maxLen = Math.min(w, h) * 0.42;
  const edges = meshNeighbours(nodes, 4, maxLen);
  const grown = growNetwork({ nodes, edges }, rng, opts.grow ?? DEFAULT_GROW);
  return pruneToCircuit(grown, opts.minLoops ?? 2);
}
