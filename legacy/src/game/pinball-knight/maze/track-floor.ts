/**
 * TRACK FLOOR — the track-first generator, packaged as a drop-in base grid.
 *
 * `core.ts startLevel` builds a floor in two halves:
 *
 *     A. base grid   generateMaze → carveRooms → stamps → thickenWalls
 *                    → pickEndpoints → widenMainArtery
 *     B. content     decorateMaze (parts, zombies, torches, arcs, rooms…)
 *
 * This module replaces **half A only**. Half B is large, well-tested and has
 * nothing to do with topology, so it keeps running exactly as it does today —
 * it just receives a grid whose main artery is a grown circuit rather than a
 * widened accident.
 *
 * ── Why this generates at FINAL resolution ────────────────────────────────
 *
 * The shipped path builds a half-scale cell maze and then `thickenWalls`
 * doubles it, which is what turns 1-wide slots into the 2-wide corridors the
 * renderer's low-rim/tall-back trick needs. The track has no use for that: it
 * already carves lanes 3-5 tiles wide with real radii, and doubling would turn
 * a radius-6 fillet into a radius-12 one and blow the floor budget. So we
 * generate at the FINAL tile scale and skip thickening entirely.
 *
 * The consequence to keep in mind: callers must NOT call `thickenWalls` on
 * this grid, and room rects/anchors from the shipped stamp passes (which are
 * authored in half-scale cell coords and scaled ×2 afterwards) do not apply.
 * `buildTrackFloor` therefore returns a grid that is already final.
 *
 * DOM- and three-free.
 */
import { type Grid, type TilePos, T_FLOOR, T_STAIRS, at, idx, isWalkable, setTile } from "./generator";
import { growTrack, circuitRank, type TrackGraph } from "./track-grow";
import { buildTrackPath, type TrackPath } from "./track-path";
import { carveTrack, carveChamber, growMazeAround, publishArcs, connectAll, sealedWalls, type TrackMask } from "./track-carve";
import { DEFAULT_TRACK_PROFILE, trackNodeCounts, type TrackProfile } from "./archetypes";
import { uncarveDeadEnds, removeWallStubs, healRoadTerminations } from "./track-socket";
import { carveLaunchChute, chuteTiles, resealChute, type LaunchChute } from "./track-launch";
import { DEFAULT_RULE_WEIGHTS, perimeterScore, PERIMETER_RULE_MIN } from "./floor-rules";
import { authorArcSweeps, stampOrbitIsland } from "./arc-sweeps";
import { compactArcs } from "./arc-contract";
import { authorArteryBanks, traceArtery } from "./artery-banks";
import { bfsDistances } from "../engine/flow-field";

/**
 * The `occupied` predicate the curve passes take, with nothing to avoid.
 *
 * They are run before any content exists now, so there is genuinely nothing
 * placed for a fillet to eat. Naming it rather than inlining `() => false` is
 * deliberate: the empty predicate is the *statement* that geometry precedes
 * content, and an inline arrow reads like an oversight.
 */
const NOTHING_OCCUPIED = (): boolean => false;

/**
 * Walls the connectivity repair should route around if it can: a sealed lane's
 * side walls, plus every wall tile that carries a published arc face.
 *
 * The arc half is the new one and it matters more than it looks. `connectAll`
 * carves the SHORTEST wall corridor into a stranded pocket, and a fillet's rim
 * is a thin band of wall — often the shortest thing between two open spaces. A
 * corridor punched through it leaves a curved wall with a doorway in the middle
 * of the sweep: the collider still reports the whole arc as solid (it derives
 * from `Grid.arcs`, not from the tiles), so the player sees a gap and hits a
 * wall. That is the see≠hit class of bug, and it is worth a longer corridor to
 * avoid. As always this is a preference and never a prohibition — connectAll
 * retries without the mask rather than leave anything stranded.
 */
function repairKeepOut(g: Grid, mask: TrackMask): Uint8Array {
  const out = sealedWalls(g, mask);
  if (g.arcIdx) {
    for (let k = 0; k < g.arcIdx.length; k++) if (g.arcIdx[k] >= 0) out[k] = 1;
  }
  return out;
}

export interface TrackFloor {
  grid: Grid;
  graph: TrackGraph;
  path: TrackPath;
  mask: TrackMask;
  /** Spawn and exit, chosen ON the circuit (see pickTrackEndpoints). */
  start: TilePos;
  stairs: TilePos;
  /**
   * The plunger lane (track-launch.ts), or null when no straight sealed run
   * fitted. When present, `start` IS `chute.base` — the floor opens parked at
   * the closed end, and firing runs the hallway before the maze begins.
   */
  chute: LaunchChute | null;
  /**
   * Rules the generator could not satisfy and DELIBERATELY stood down on, by
   * rule id (maze/floor-rules.ts).
   *
   * The point of recording rather than silently relaxing: constraints like
   * "open at the edge" and "give the chute a long straight sealed run" can be
   * jointly unsatisfiable on a floor whose circuit never reaches the border,
   * and a rule that quietly gives up is indistinguishable from a rule that
   * broke. With this the gate can hold the rule absolutely AND track how often
   * the generator has to fall back — which is the number that tells you the
   * thresholds have drifted out of reach.
   */
  relaxed: string[];
  /**
   * Centre of the floor's ORBIT ISLAND, when one fitted — the full-circle
   * curved wall you can ride a lap around. Geometry belongs to this layer;
   * `decorateMaze` reads the centre to flank it with bumpers, which is content.
   */
  orbit: { ci: number; cj: number } | null;
}

/**
 * Spawn and exit, both placed ON the track.
 *
 * Deliberately different from `pickEndpoints`, which picks the tile nearest a
 * random corner and then the farthest tile from it. That rule is right for a
 * maze — where the journey IS the floor — and wrong for a circuit, because it
 * would routinely drop the player in a maze cul-de-sac with the exit in
 * another one, and the track they are meant to ride would be scenery between
 * two errands.
 *
 * Here both endpoints sit on the circuit and are pushed as far apart as the
 * lane allows, so the natural route between them RUNS THE TRACK.
 */
export function pickTrackEndpoints(
  g: Grid,
  mask: TrackMask,
  chute?: { base: TilePos; mouth: TilePos } | null,
  opts: { perimeterBias?: number } = {},
): { start: TilePos; stairs: TilePos } | null {
  const lane: TilePos[] = [];
  for (let j = 0; j < g.h; j++) {
    for (let i = 0; i < g.w; i++) {
      if (mask.lane[idx(g, i, j)] && isWalkable(g, i, j)) lane.push({ i, j });
    }
  }
  if (lane.length < 2) return null;

  // Double sweep: farthest lane tile from an arbitrary one, then farthest from
  // that. The graph diameter along the actual walkable surface, so the two ends
  // are genuinely a lap apart rather than merely far in a straight line.
  //
  // ── Why the argmax is not enough ─────────────────────────────────────────
  //
  // Taking the single farthest tile treats "far" as the only thing that matters
  // about an exit, and it isn't: a big loop's farthest point is often the one
  // diametrically opposite, which is far to WALK and dead straight to LOOK at.
  // That is the `directness` metric's failure case (euclid ÷ pathLen near 1),
  // and it is not hypothetical — censused over 1200 floors, the shipped argmax
  // produced a floor above the 0.85 band about once in 1200. Rare enough that
  // the gate's fixed 48-seed sample misses it, which is precisely why it needs
  // fixing at the source rather than at the assertion.
  //
  // So: take every tile within `TIE` of the best distance — they are all "a lap
  // away" for any purpose the player can perceive — and among those pick the
  // one the route has to work HARDEST to reach. The exit becomes an allocation
  // instead of an argmax, which is the same inversion the whole track-first
  // rework is built on (docs/game-dev-rules §3).
  const TIE = 0.92;
  const far = (from: TilePos): { pos: TilePos; d: number } => {
    const dist = bfsDistances(g, from.i, from.j);
    let best = -1;
    for (const p of lane) {
      const d = dist[idx(g, p.i, p.j)];
      if (d > best && d < 0x3fffffff) best = d;
    }
    if (best <= 0) return { pos: from, d: best };
    let bestPos = from;
    let bestDirect = Infinity;
    for (const p of lane) {
      const d = dist[idx(g, p.i, p.j)];
      if (d < best * TIE || d >= 0x3fffffff) continue;
      const direct = Math.hypot(p.i - from.i, p.j - from.j) / d;
      if (direct < bestDirect) {
        bestDirect = direct;
        bestPos = p;
      }
    }
    return { pos: bestPos, d: dist[idx(g, bestPos.i, bestPos.j)] };
  };
  // With a launch chute the start is NOT ours to choose: the floor opens where
  // the plunger is, and the plunger is at the closed end of the chute.
  //
  // The exit is then swept from the chute's MOUTH, not from its base, and the
  // distinction is load-bearing. Sweeping from the base spends the floor's
  // diameter on the chute itself — the ~20 tiles of hallway count toward "how
  // far away is the farthest lane tile", so the exit lands correspondingly
  // nearer. Measured: warrens L1 came out with the stairs **36 steps** from the
  // mouth on a 3975-tile floor, i.e. the launch fired you out of the chute
  // almost on top of the exit. Sweeping from the mouth restores the intent —
  // a lap of the circuit from where the launch DELIVERS you.
  // ── WHERE THE FLOOR OPENS WITHOUT A CHUTE ────────────────────────────────
  //
  // The ~6% of floors (5 of 78 censused) where no straight sealed run fitted.
  // With a chute the spawn is the plunger's park tile and this is not ours to
  // choose; without one it was "the farthest lane tile from an arbitrary lane
  // tile", which is a pure function of the circuit's shape and lands wherever
  // that happens to be.
  //
  // Same treatment the chute gets, for the same reason — otherwise these floors
  // quietly ignore the archetype's `perimeterBias` and the rule check fails on
  // exactly the minority of floors nobody looks at. A BAND again, not an
  // argmax: every tile within TIE of the best distance is "as far as it gets"
  // for any purpose the player can perceive, so the perimeter term chooses
  // among equals rather than overriding the distance requirement.
  const bias = opts.perimeterBias ?? 0;
  const startBand = (from: TilePos): TilePos => {
    const dist = bfsDistances(g, from.i, from.j);
    let best = -1;
    for (const p of lane) {
      const d = dist[idx(g, p.i, p.j)];
      if (d > best && d < 0x3fffffff) best = d;
    }
    if (best <= 0) return from;
    let pick = from;
    let pickScore = -Infinity;
    for (const p of lane) {
      const d = dist[idx(g, p.i, p.j)];
      if (d < best * TIE || d >= 0x3fffffff) continue;
      // Perimeter decides; the tiny distance term only breaks exact ties, so
      // two equally-peripheral tiles resolve to the farther one deterministically.
      const sc = bias * perimeterScore(g, p.i, p.j) + (d / Math.max(1, best)) * 0.001;
      if (sc > pickScore) {
        pickScore = sc;
        pick = p;
      }
    }
    return pick;
  };
  const a = chute ? chute.base : startBand(lane[0]);
  const b = far(chute ? chute.mouth : a);
  if (b.d <= 0) return null;
  return { start: a, stairs: b.pos };
}

/**
 * Build a complete track-first base grid at FINAL tile resolution.
 *
 * `cellsW/cellsH` are the caller's half-scale numbers (what `generateMaze`
 * takes) and the grid comes out at `(2c+1)` per side.
 *
 * `profile` is the floor archetype's grip on the topology (archetypes.ts). It
 * is optional so every existing caller keeps the shipped behaviour, but the
 * game always passes one — without it the five archetypes are names on a card
 * over five identical floors.
 */
export function buildTrackFloor(
  cellsW: number,
  cellsH: number,
  rng: () => number,
  opts: { linkChance?: number; fill?: number; minLoops?: number; profile?: TrackProfile; density?: number } = {},
): TrackFloor | null {
  const w = cellsW * 2 + 1;
  const h = cellsH * 2 + 1;
  const grid: Grid = { w, h, t: new Uint8Array(w * h), shapes: new Uint8Array(w * h) };

  // Explicit `opts` still win over the profile, so the debug spawner and the
  // tuning scripts can override one knob without inventing a whole profile.
  const prof = opts.profile ?? DEFAULT_TRACK_PROFILE;
  const { foods, relays } = trackNodeCounts(prof, w, h);

  const graph = growTrack(w, h, rng, {
    minLoops: opts.minLoops ?? prof.minLoops,
    layout: prof.layout,
    foods,
    relays,
    maxLenFrac: prof.maxLenFrac,
    survive: prof.survive,
  });
  if (graph.edges.length === 0) return null;
  const path = buildTrackPath(graph, { laneScale: prof.laneScale });
  if (path.legs.length === 0) return null;

  const mask = carveTrack(grid, path);
  // THE PLAZA GOES DOWN BEFORE THE MAZE, never after. Carved afterwards it
  // would bulldoze finished corridors and leave severed stubs pointing into it;
  // carved here it is simply part of the circuit, and the maze's keep-out
  // margin respects it like any other lane. Sited on the surviving graph node
  // nearest the floor's centre — under the `hub` layout that IS the centre food
  // node — and `carveChamber` declines rather than clip a plaza on the border.
  if (prof.plazaFrac > 0 && graph.nodes.length) {
    const cx = w / 2;
    const cz = h / 2;
    let hub = graph.nodes[0];
    for (const n of graph.nodes) {
      if ((n.x - cx) ** 2 + (n.z - cz) ** 2 < (hub.x - cx) ** 2 + (hub.z - cz) ** 2) hub = n;
    }
    carveChamber(grid, mask, hub.x, hub.z, Math.min(w, h) * prof.plazaFrac);
  }
  // ── THE LAUNCH CHUTE (track-launch.ts) ──────────────────────────────────
  //
  // Carved HERE, between the circuit and the maze, for the same reason the
  // plaza is: it must be part of the track by the time anything else looks at
  // the grid. Carved after `growMazeAround` it would bulldoze finished
  // corridors; carved as decoration (which is effectively what the old free-air
  // plunger was) it would be a launch ritual with no lane behind it.
  // The archetype's spawn-placement weight reaches the chute here — this call
  // is what decides where the floor opens on 94% of floors (see the scoring
  // block in track-launch.ts).
  const profBias = prof.rules?.perimeterBias ?? DEFAULT_RULE_WEIGHTS.perimeterBias;
  const chute = carveLaunchChute(grid, mask, rng, { perimeterBias: profBias });
  growMazeAround(grid, mask, rng, {
    linkChance: opts.linkChance ?? prof.linkChance,
    fill: opts.fill ?? prof.fill,
    density: opts.density,
  });

  // ── PLUMBING REPAIR (track-socket.ts) ───────────────────────────────────
  //
  // The growth model makes an interesting layout but not a legible one. Before
  // these passes, 20 floors measured 105.8 dead ends and 116.4 wall stubs EACH
  // — corridors to nowhere and one-tile nubs jutting into rooms, which is what
  // made the floor read as "a bunch of walls that go nowhere".
  //
  // Order inside the block is load-bearing:
  //  1. UNCARVE first. It fills floor→wall and so can disconnect things, which
  //     is fine only because connectAll runs after it.
  //  2. connectAll next, to restore the one-component invariant uncarve may
  //     have broken. Carving wall→floor can only add connectivity, so nothing
  //     after this can strand the player.
  //  3. DE-STUB after both — widening leaves one-tile pillars when a corridor
  //     thickens, and connectAll's repair corridors carve fresh nubs of their
  //     own. Running it before either left 25.2 stubs + 5.2 isolated pillars
  //     per floor still standing.
  //  4. HEAL road terminations last: a lane that still ends in mid-air is
  //     DEMOTED to plain room floor, so no booster or bank is ever sited along
  //     a road to nowhere. Note what this does NOT do — it no longer tries to
  //     EXTEND the stub to rejoin the circuit. That chases its own tail, since
  //     each extension creates a new tile that is itself the new end of the
  //     road ("joined" fired 8-24x per floor while the count never moved). The
  //     real cause was topological (degree-1 graph leaves) and is fixed
  //     upstream by pruneLeaves; this is the belt-and-braces sweep.
  //
  // It is a FUNCTION because it runs TWICE — once after the maze grows, and
  // again after the curved walls are authored. That second call is not
  // defensive padding: a concave fillet fills a corner pocket floor→wall, which
  // is precisely the operation that manufactures a dead end. When the sweeps
  // lived in the content pass they ran after every repair had finished and
  // whatever they left simply shipped; measured on the live gate, moving them
  // here without re-running repair pushed six floors over the dead-end ceiling
  // (up to 5.31 per 1k tiles against a limit of 2.5).
  const endsEarly = pickTrackEndpoints(grid, mask, chute, { perimeterBias: profBias });
  const protect = endsEarly ? [endsEarly.start, endsEarly.stairs] : [];
  const repair = (keep: readonly TilePos[]): void => {
    uncarveDeadEnds(grid, mask, keep);
    // The keep-out steers the repair around any SEALED lane's walls — today the
    // launch chute's — and around published arc faces, because carving one is
    // how a swept curve becomes a curved wall with a hole in it. Neither can
    // refuse a connection; see connectAll.
    connectAll(grid, rng, repairKeepOut(grid, mask));
    removeWallStubs(grid, mask);
    if (endsEarly) healRoadTerminations(grid, mask, keep, { reach: 0 });
  };
  repair(protect);

  // ── CURVED WALLS, ALL OF THEM, HERE ─────────────────────────────────────
  //
  // A floor's curves used to be authored by TWO different layers. This one
  // published the circuit's own fillets; then `decorateMaze` — the CONTENT pass
  // that places bumpers, loot and zombies — ran `stampOrbitIsland` and
  // `authorArcSweeps` and built more. Censused over 30 floors, the content pass
  // owned the majority of them: 48.8 features per floor against this layer's
  // 35.5, and 179.3 tiles of arc length against 146.7. It also converted **44.9
  // tiles per floor from floor to wall** — the content pass was building walls.
  //
  // That is the defect the user named ("the walls that are curved are in the
  // pinball logic and not in the maze wall logic"), and it is a layering bug in
  // the sense of docs/game-dev-rules §3: layer 2 owns corner radii, layer 4
  // owns detail and "never contradicts" the macro intent. Curves authored after
  // content are curves fitted around furniture; curves authored here are curves
  // the furniture is then placed around. Same passes, opposite precedence.
  //
  // Three concrete things fall out of the move, none of them cosmetic:
  //
  //  · the repair passes now run BEFORE the curves exist and the de-stub pass
  //    runs again after, so a nub a fillet leaves behind is cleaned like any
  //    other. Previously the sweeps ran after every repair had finished and
  //    whatever they left stood.
  //  · `occupied` becomes trivially empty. That is the point, not a
  //    regression: a concave fillet no longer declines because a torch is in
  //    the way, it simply gets built and the torch is placed elsewhere.
  //  · `publishArcs` goes FIRST, so the circuit's own banked turns claim their
  //    tiles before the scavenging pass looks at corners. `authorArcSweeps`
  //    only considers tiles whose shape is still SHAPE_FULL, so this ordering
  //    is what makes "the track's curves win" true by construction.
  publishArcs(grid, path);
  const arcStart = endsEarly?.start ?? { i: 1, j: 1 };
  const orbit = stampOrbitIsland(grid, arcStart, NOTHING_OCCUPIED, rng);
  authorArcSweeps(grid, arcStart, NOTHING_OCCUPIED, rng);
  // The curves change geometry, so the geometry gets repaired — see `repair`.
  repair(protect);

  const ends = pickTrackEndpoints(grid, mask, chute, { perimeterBias: profBias });
  if (!ends) return null;

  // ── ARTERY BANKS — the last of the three curve families to come home ─────
  //
  // A bank is the OUTER shell of a turn on the start→stairs route: it converts
  // floor to wall to give a bend a rideable outside edge. It ran inside
  // `decorateMaze` — as the very first thing that pass did, before any content,
  // which is the tell that it never belonged there. Location was the only thing
  // making it "content"; measured, it was the last remaining source of the
  // content pass building walls (1.62 banks per floor, 82% of floors).
  //
  // It runs AFTER the sweeps and the repair, on the final endpoints, because a
  // bank is defined by the route and the route is defined by the finished
  // geometry. `authorArteryBanks` commits each bank behind its own strand
  // guard, so this cannot orphan anything; the repair below then cleans the
  // nubs the new wall shells leave, exactly as it does for the fillets.
  //
  // THE WHOLE CHUTE IS PROTECTED, mouth included. The route is traced from the
  // spawn, and the spawn is the chute's park tile, so the artery runs the full
  // length of the launch hallway and the mouth is its first real bend — exactly
  // the shape the bank pass reaches for. Unprotected it walls the mouth in:
  // measured on the live gate, 8 floors came back "no route from spawn to
  // stairs" while reachability still read 1.0000, which is the signature of the
  // route's second tile being solid rather than of anything being stranded.
  //
  // Protecting `mask.sealed` alone is NOT enough and that was the first fix
  // tried: the mouth cross-section is deliberately left unsealed so the merge
  // can open into the maze, which makes it the one part of the chute a bank may
  // still eat. `chuteTiles` is the lane in full.
  const arteryDist = bfsDistances(grid, ends.start.i, ends.start.j);
  const artery = traceArtery(grid, ends.start, ends.stairs, arteryDist);
  if (artery.length >= 8) {
    const guarded = new Set<number>();
    if (chute) for (const t of chuteTiles(grid, chute)) guarded.add(idx(grid, t.i, t.j));
    for (let k = 0; k < mask.sealed.length; k++) if (mask.sealed[k] === 1) guarded.add(k);
    const isGuarded = (i: number, j: number): boolean =>
      i >= 0 && j >= 0 && i < grid.w && j < grid.h && guarded.has(idx(grid, i, j));
    authorArteryBanks(grid, artery, ends.start, NOTHING_OCCUPIED, isGuarded);
    repair([ends.start, ends.stairs]);
  }

  // ── LAST: prune curves nothing meaningfully owns ────────────────────────
  //
  // `arcSweepGeometry` walks `Grid.arcs` and draws every feature's FULL span
  // without ever asking which tiles reference it, so a feature whittled down to
  // one tile by a later pass still renders a whole quarter-circle band hanging
  // off a single stone. Measured before this pass: 5.1% of features owned 1-2
  // tiles and 0.1% owned none, and all of them were being drawn.
  //
  // It has to run here, after every pass that can take tiles away. It only
  // rewrites shapes and remaps indices — no tile changes walkability — so it
  // cannot affect connectivity.
  // Close any side door `connectAll` had to punch into the plunger lane rather
  // than strand a pocket (about one floor in forty). Strand-guarded: a tile
  // that turns out to be load-bearing is put straight back.
  if (chute) {
    resealChute(grid, mask, chute, () => {
      const d = bfsDistances(grid, ends.start.i, ends.start.j);
      for (let j = 0; j < grid.h; j++) {
        for (let i = 0; i < grid.w; i++) {
          if (isWalkable(grid, i, j) && d[idx(grid, i, j)] < 0) return false;
        }
      }
      return true;
    });
  }

  compactArcs(grid);
  // Compaction turns a dropped feature's rim tiles back into plain stone, and a
  // former rim can be a three-sided nub — `removeWallStubs` skips arc tiles, so
  // it had no opinion on them while they were still rims. One more pass, after
  // the last thing that can create one. It only opens walls that carry no arc
  // face, so it cannot unback a surviving curve.
  removeWallStubs(grid, mask);

  setTile(grid, ends.stairs.i, ends.stairs.j, T_STAIRS);

  // A high-bias floor that opened centrally: was a peripheral option ever on
  // the table? `edgeBest` is the band's best, so "no" means impossible, not
  // ignored. Without a chute the same question is asked of the lane itself.
  const relaxed: string[] = [];
  if (profBias >= 0.5 && perimeterScore(grid, ends.start.i, ends.start.j) < PERIMETER_RULE_MIN) {
    const available = chute
      ? chute.edgeBest
      : (() => {
          let m = 0;
          for (let j = 0; j < grid.h; j++) {
            for (let i = 0; i < grid.w; i++) {
              if (mask.lane[idx(grid, i, j)] && isWalkable(grid, i, j)) m = Math.max(m, perimeterScore(grid, i, j));
            }
          }
          return m;
        })();
    if (available < PERIMETER_RULE_MIN) relaxed.push("spawn-respects-perimeter-bias");
  }

  return { grid, graph, path, mask, start: ends.start, stairs: ends.stairs, chute, orbit, relaxed };
}

/** Independent cycles in the circuit — exposed for HUD/debug and tests. */
export function floorCircuitRank(f: TrackFloor): number {
  return circuitRank(f.graph);
}
