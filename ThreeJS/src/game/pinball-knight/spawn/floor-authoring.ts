/**
 * AUTHORING a floor — everything that decides what the floor IS, before any of
 * it is committed to the world.
 *
 * ## The split, and why it is here
 *
 * `buildLevel` was 717 lines running ~20 placement phases off ONE RNG stream.
 * The cut is at the line where the floor stops being local values and becomes
 * `state.grid` — before it, every phase works on locals and nothing outside can
 * observe the half-built floor; after it, phases read the world back out. That
 * boundary is not a stylistic preference: it is the only place in the function
 * where the set of things that have to be threaded is small (ten values) rather
 * than the whole of `state`.
 *
 * ## ⚠️ THE ORDER OF THE DRAWS IS THE CONTRACT
 *
 * Every phase here draws from the same `rng`. Reorder any two draws and every
 * draw after them changes — a completely different floor that renders perfectly,
 * throws nothing, and passes every unit test in the suite. The load-bearing
 * sequence is:
 *
 *     rollModifier → windinessFor → buildTrackFloor → stampSecretBands
 *     → decorateMaze → authorLampPuzzle
 *
 * `paintSurfaces` and `paintBands` deliberately do NOT draw from it (they use
 * `surfaceSeed`), and `themeFor` is a pure hash. If you change anything in here,
 * prove it with `scripts/floor-census.mjs` — that is what it is for.
 */
import { state } from "../state";
import { floorRng, floorSeed } from "../maze/floor-seed";
import { biomeFor as biomeForSeed, type Biome } from "../boot/biomes";
import type { Grid, TilePos } from "../maze/generator";
import { saveBestDepth } from "../best-depth";
import { tintLights } from "../boot/lighting";
import { HAZARDS_BASE, HAZARDS_MAX, HAZARDS_PER_LEVEL, PARTS_BASE, PARTS_MAX, PARTS_PER_LEVEL, ROOM_MAX_CELLS, ROOM_MIN_CELLS, SURFACE_BANDS, TARGETS_PER_FLOOR, TRACK_FIRST, TRAPDOORS_PER_FLOOR, VAULT_RAMPS_PER_FLOOR, floorBudgets, levelConfig } from "../constants";
import { coopSeed, setCoopFloor } from "../coop";
import { resetItemNid } from "../economy/ground-items";
import { resetPickupSweep } from "../economy/pickups";
import { archetypeFor, windinessFor } from "../maze/archetypes";
import { setMazeBiome } from "../maze/build";
import { type PrefabAnchor, decorateMaze, pickEndpoints, widenMainArtery } from "../maze/decorate";
import { walkableCount } from "../maze/floor-metrics";
import { carveRooms, crackSecretWalls, generateMaze, thickenWalls, tileCenter } from "../maze/generator";
import { authorLampPuzzle, lampCountFor } from "../maze/lamp-puzzle";
import { rollModifier } from "../maze/modifiers";
import { pickFocusCells, stampLandmark, stampPrefabs, themeFor, themeIndexFor } from "../maze/prefabs";
import { paintBands, paintSurfaces } from "../maze/surface-paint";
import { buildTrackFloor } from "../maze/track-floor";
import { nearSealed } from "../maze/track-socket";
import { pruneSealedBands, stampSecretBands } from "../secrets";
import { resetZombieNid } from "../spawn/factory";

/**
 * What authoring produced. Exactly the values the population half still needs —
 * measured, not guessed: everything else (`windiness`, `theme`, `endpoints`,
 * `anchors`, `budget`, `surfaceSeed`, …) is consumed before the boundary and
 * deliberately does not appear here.
 */
export interface AuthoredFloor {
  level: number;
  cfg: ReturnType<typeof import("../constants").levelConfig>;
  biome: Biome;
  rng: () => number;
  arch: ReturnType<typeof import("../maze/archetypes").archetypeFor>;
  modifier: ReturnType<typeof import("../maze/modifiers").rollModifier>;
  bonusRoom: boolean;
  track: ReturnType<typeof import("../maze/track-floor").buildTrackFloor>;
  grid: Grid;
  plan: ReturnType<typeof import("../maze/decorate").decorateMaze>;
  lampPuzzlePlan: ReturnType<typeof import("../maze/lamp-puzzle").authorLampPuzzle>;
}

/** Decide the floor. Mutates only `state.runSeed`/`runDeepestFloor`/`bonusRoomNext`. */
export function authorFloor(level: number): AuthoredFloor {
  // ── Co-op: adopt the SHARED POOL SEED so every player generates the identical
  // floor/enemy/boss layout. Set before the maze RNG below. No-op solo/offline. ──
  const cs = coopSeed();
  if (cs !== null) state.runSeed = cs >>> 0;
  setCoopFloor(level); // pool presence now filters to this floor
  resetZombieNid(); // per-floor network ids — deterministic across the pool
  resetItemNid();
  resetPickupSweep(); // the knight is about to be teleported to the new spawn
  // Run-scoped, so it must be updated here rather than in the per-floor reset
  // below. `saveBestDepth` no-ops unless this genuinely beats the record.
  if (level > state.runDeepestFloor) state.runDeepestFloor = level;
  saveBestDepth(level);
  const cfg = levelConfig(level);

  // Depth grading: each biome down shifts the fill palette a family over.
  const biome = biomeForSeed(level, state.runSeed);
  tintLights(biome);
  // ...and the STONE changes family with it, not just the light on it. A grade
  // cannot move a quantized palette entry onto a different one, so the masonry
  // painters remap their own three stone tones per biome (maze/build.ts
  // BIOME_STONE). Must run before buildMaze — the textures bake it in.
  setMazeBiome(themeIndexFor(level, state.runSeed));

  // One deterministic stream per (run, level): a refresh mid-run rerolls the
  // run, but a single level is internally consistent and replayable.
  // The mix lives in maze/floor-seed.ts because every peer and a dozen tests
  // must derive it identically — see that file's header.
  const rng = floorRng(state.runSeed, level);
  // FLOOR ARCHETYPE: the macro layout — Warrens / Spine / Great Hall / Cavern /
  // Ring Keep. On the shipping branch it is `arch.track` (a TrackProfile) that
  // does the work; `arch.seeds` shapes the LEGACY grid and nothing else.
  // Cycles every 5 while the biome cycles every 4, so the pair takes 20 floors
  // to repeat.
  const arch = archetypeFor(level);
  // MODIFIER: rolled from this floor's own seed (not a cycle), so two runs at
  // the same depth differ. Scales budgets only — see maze/modifiers.ts.
  const modifier = rollModifier(level, rng);
  // WINDINESS is the archetype's texture knob now, rolled inside its own range
  // rather than read off a flat depth cycle — two Caverns twenty floors apart
  // used to share a corridor character exactly. cfg.windiness stays as the
  // level-1 anchor and the fallback for callers that don't know the archetype.
  const windiness = windinessFor(level, arch, rng);
  // A grade-S/A descent unlocked a BONUS room on this floor (Wave F glue).
  const bonusRoom = state.bonusRoomNext;
  state.bonusRoomNext = false;
  // The floor's THEME. Not a prefab-only concept, whatever its module name
  // suggests: `theme.deal` orders the part kinds decorateMaze reaches for and
  // `theme.enemies` biases the horde (spawn/factory.ts), and both of those ship
  // on every floor. Only the prefab POOLS — `theme.pool` / `theme.landmarks` —
  // are legacy-branch-only. Consumes no rng: it is a hash of (level, runSeed).
  const theme = themeFor(level, state.runSeed);
  // ── TRACK-FIRST base grid ────────────────────────────────────────────────
  //
  // The floor's main artery used to be DERIVED from the random maze: carve a
  // maze, trace a path through it, widen that path. So the "track" inherited
  // every wiggle and dead-end the maze happened to produce — curves landed
  // where a gap existed rather than where the ball goes (the ramp fragments
  // pointing nowhere), and there was nowhere to put a real curve at all
  // (artery-banks censused 22,713 open tiles: 81.8% have an open radius of
  // ZERO; radius-4 fillets fitted 4 times across 40 floors).
  //
  // Now the circuit is GROWN FIRST — slime-mould flow reinforcement, so it is
  // naturally loopy and different every level — and the maze grows into what's
  // left, tying in at on-ramps. Corner radius becomes an input we allocate
  // rather than an output we scavenge. See maze/track-floor.ts.
  //
  // It generates at FINAL tile resolution, so it replaces `thickenWalls` too;
  // the fallback path below still thickens, which is why `grid` is assigned
  // from one branch or the other rather than being a single expression.
  //
  // THE ARCHETYPE REACHES THE LIVE FLOOR HERE, and until this line it did not.
  // `arch.seeds` shapes the legacy grid, and on a track floor that grid is
  // never built — so the five archetypes were shaping a floor nobody saw while
  // the descent card below announced them by name (a blind census over 6 seeds
  // × 10 depths could not tell them apart on any statistic). `arch.track` is
  // the profile that makes the name true: node layout, loop floor, lane width,
  // plaza, and how much maze surrounds the circuit. Windiness rides along as
  // the surrounding maze's growing-tree bias — the same knob it always was, now
  // on the branch that ships. Clamped: at 1.0 the surround is a pure
  // backtracker with no junctions at all, and at 0 it is all junctions and no
  // corridor.
  const track = TRACK_FIRST
    ? buildTrackFloor(cfg.cellsW, cfg.cellsH, rng, {
        profile: arch.track,
        density: Math.max(0.35, Math.min(0.85, windiness)),
      })
    : null;
  let grid: Grid;
  let endpoints: { start: TilePos; stairs: TilePos } | null;
  // Prefab anchors are authored in HALF-SCALE cell coords and scaled ×2 onto
  // the thickened grid — a shape only the legacy branch has. A track floor is
  // generated at final resolution from its own geometry and ships none, so
  // they default EMPTY and the track branch cannot point decoration at
  // furniture that was never carved.
  //
  // ROOMS USED TO DEFAULT EMPTY FOR THE SAME REASON, AND THAT WAS THE BUG
  // (Plaza A-1). The reasoning was sound about `carveRooms`' half-scale rects
  // and wrong about the conclusion: a track floor DOES carve rooms — the Great
  // Hall plaza, via the same `carveChamber` brush — at final resolution, in
  // the coords this function already speaks. Discarding them meant
  // `furnishRooms` ran on `[]` on 100% of shipped floors, so the four room
  // archetypes, their guards and prizes, and the map overlay's per-archetype
  // wash were all unreachable. `buildTrackFloor` now reports them as
  // `TrackFloor.chambers` and they are handed over below.
  let rooms: Array<{ i0: number; j0: number; w: number; h: number }> = [];
  let anchors: PrefabAnchor[] = [];
  if (track) {
    grid = track.grid;
    // Exposed to the running game via `__dungeonDoorways()` — see state.doorways.
    state.doorways = track.doorways;
    // Both endpoints sit ON the circuit and a lap apart, so the route between
    // them RIDES the track instead of treating it as scenery between errands.
    endpoints = { start: track.start, stairs: track.stairs };
    // Chamber rects, already in final tile coords — no ×2 scaling, which is the
    // legacy branch's half-scale correction and would be wrong here. Non-empty
    // on `greathall` only for now (plazaFrac > 0 on exactly that archetype);
    // the King's Hall follows under its own flag.
    rooms = track.chambers;
  } else {
    // ── THE LEGACY FALLBACK, BUILT ONLY WHEN IT IS ACTUALLY USED ───────────
    //
    // All of this — the growing-tree maze, its rooms, the landmark set piece,
    // the focus zones, the prefab stamps and the half-scale secret cracks —
    // used to run UNCONDITIONALLY, above the `buildTrackFloor` call, and then
    // be thrown away by `track ? [] : …` a few lines further down. Measured
    // over 400 floors across 5 archetypes × 10 depths: `buildTrackFloor`
    // returned null 0 times, so the entire block was discarded on 100% of
    // floors while five test files exercised it and read as coverage.
    //
    // It is NOT deleted, because it is a genuine fallback: `buildTrackFloor`
    // returns null when the flow network degenerates to no edges or no legs,
    // and a floor that fails to generate is worse than a plain maze. It is
    // moved HERE so the code says which of the two it is. The measured cost of
    // running it eagerly was small (1.8 ms against 109 ms of track growth, 1.6%
    // of generation) — the reason to move it is that a pass computed on every
    // floor and used on none is indistinguishable from a pass that ships.
    //
    // Corridors, then ROOMS carved over them (bumper chamber / speedway /
    // arena / vault), then a few CRACKED secret walls — all on the raw grid,
    // all before thickening, so the wall-band structure survives. Thick walls
    // are what make the Diablo low-rim/tall-back trick work — see
    // thickenWalls. Decoration runs on the thickened grid, with room rects
    // scaled to match.
    const raw = generateMaze(cfg.cellsW, cfg.cellsH, rng, cfg.braid * arch.braidMult, windiness, {
      seeds: arch.seeds(cfg.cellsW, cfg.cellsH, rng) ?? undefined,
      solidSeeds: arch.solid,
      braidGradient: arch.braidGradient,
    });
    const rawRooms = carveRooms(raw, rng, cfg.rooms + (bonusRoom ? 1 : 0), ROOM_MIN_CELLS, ROOM_MAX_CELLS);
    // PREFAB STAMPS (Wave C): themed room/hallway shapes drawn from a seeded
    // shuffle bag — Slalom, Gauntlet, Oilworks, the Magician's Parlor… Carved
    // before the secret cracks so the cracks see the final wall set.
    //
    // The floor's ONE set piece goes down FIRST, with priority and a wide
    // mortar: the Tilt Table, the Pachinko Drop, the Observatory… Regular
    // stamps then fill in around it, clustered on this floor's hot zones so the
    // level has loud rooms and quiet halls instead of an even sprinkle.
    const landmark = stampLandmark(raw, rng, theme);
    const focus = pickFocusCells(raw, rng);
    // More open-chamber prefabs per floor (Slice 2, open playfield) — the theme
    // pools are mostly open tables/halls, so this adds bounce-able area.
    const prefabCount = Math.min(3 + Math.floor((level - 1) / 2), 6);
    const stamped = stampPrefabs(raw, rng, prefabCount, theme, landmark.claimed, focus);
    crackSecretWalls(raw, rng, cfg.secrets);
    grid = thickenWalls(raw);
    // Widen the main start→stairs artery into a 3-wide "launch highway" so the
    // floor plays as a machine and not a uniform 2-wide box maze. Reachability-
    // preserving (only carves wall→floor); runs BEFORE decorate so every stage —
    // topology/parts/arc-corners/render — sees the widened grid.
    // START + STAIRS are chosen ONCE here and shared by both the artery widener
    // and decorateMaze. Both used to derive them independently with the same
    // "top-left tile → farthest tile" rule, which put the exit in the
    // bottom-right corner of every floor; see pickEndpoints.
    state.doorways = []; // the legacy maze has no section plan
    endpoints = pickEndpoints(grid, rng);
    if (endpoints) widenMainArtery(grid, endpoints);
    rooms = rawRooms.map((r) => ({ i0: r.i0 * 2, j0: r.j0 * 2, w: r.w * 2, h: r.h * 2 }));
    // Prefab anchors ride the same ×2 into the thickened grid — the landmark's
    // first, so its set-piece furniture wins any tile the regular stamps also want.
    anchors = [...landmark.anchors, ...stamped.anchors].map((a) => ({ i: a.i * 2, j: a.j * 2, kind: a.kind }));
  }
  // ── SECRET BANDS, on the grid the player will actually stand on ──────────
  //
  // `crackSecretWalls` above ran on `raw` — the HALF-SCALE grid, on the
  // understanding that `thickenWalls` doubles each mark into the 2×2 band the
  // rest of the game assumes. A track floor does neither: it generates at final
  // resolution and DISCARDS `raw`. So on the shipping path every one of those
  // 4-10 bands was thrown away, and the only cracks a player ever met were the
  // incidental ones `openLaunchTargets` leaves while repairing launcher runways
  // — measured, 3 bands across 25 consecutive floors.
  //
  // The smash-through payoff, its loot, the speed witch and the revolving door
  // were all unreachable on roughly nine floors in ten because of it.
  //
  // Stamped HERE, between geometry and decoration, deliberately: the walls are
  // final (so a band is never cracked into a curve that a later pass reshapes)
  // and `decorateMaze` has not yet run its secrets scan, so the bands are picked
  // up by the existing plumbing with nothing else to change.
  if (track) {
    stampSecretBands(grid, rng, cfg.secrets, {
      // The plunger lane commits you by design; a secret door in its side wall
      // is the same defect as any other hole in it (track-launch.test.ts).
      avoid: (i, j) => nearSealed(grid, track.mask, i, j),
    });
  }
  // Pinball-machine density grows with depth AND rides the floor's actual area
  // — the 4× floors change scaled zombies/torches/rooms but left this an
  // absolute cap, spreading 26 parts over ~26k late-game tiles (the "sparse"
  // read). The area term keeps parts-per-tile roughly constant as floors grow;
  // decorateMaze's sparse-region fill then guarantees no quadrant ships empty.
  // ── THE GRID IS FINAL HERE, SO THE BUDGETS RIDE THE REAL AREA ───────────
  //
  // Every wall-moving pass has run (buildTrackFloor owns them all on the track
  // branch, widenMainArtery on the legacy one) and decorateMaze writes only the
  // stairs tile, so this count is the floor's actual walkable area. Until now
  // the budgets rode `cfg.floorTiles`, an estimate measured at **3.2x too big**
  // over 64 live floors — which is why the zombie and torch caps bound on every
  // floor from level 1 and their depth ramps were dead code.
  //
  // Deterministic and rng-free: the grid is a pure function of (runSeed, level),
  // so two co-op peers count the same number without exchanging anything.
  const walkable = walkableCount(grid);
  const budget = floorBudgets(level, walkable);
  const partBudget = Math.min(PARTS_BASE + (level - 1) * PARTS_PER_LEVEL, PARTS_MAX) + budget.partsArea;
  // The floor modifier scales the budgets (and only the budgets — it can't
  // reach connectivity). Every product is floored at a sane minimum so a harsh
  // roll can't produce a pitch-dark or furniture-free floor.
  const plan = decorateMaze(
    grid,
    rng,
    Math.max(1, Math.round(budget.zombies * modifier.hordeMult)),
    Math.max(4, Math.round(budget.torches * modifier.torchMult)),
    Math.max(4, Math.round(partBudget * modifier.partMult)),
    rooms,
    {
      anchors,
      // A modifier biases WHICH furniture the corridor pass reaches for first.
      deal: modifier.dealBias.length ? ([...modifier.dealBias, ...theme.deal] as typeof theme.deal) : theme.deal,
      targets: TARGETS_PER_FLOOR,
      trapdoors: Math.round(TRAPDOORS_PER_FLOOR * modifier.trapdoorMult),
      vaultRamps: VAULT_RAMPS_PER_FLOOR, // ramps aimed ACROSS a band, so the hop jumps the maze
      hazards: Math.round(Math.min(HAZARDS_BASE + (level - 1) * HAZARDS_PER_LEVEL, HAZARDS_MAX) * modifier.hazardMult),
      forceVault: bonusRoom, // a grade-unlocked bonus floor guarantees a vault
      launchBreaks: cfg.launchBreaks, // A1 — smashable walls at launch-runway ends, scaled by depth
      bonusItems: modifier.bonusItems,
      endpoints: endpoints ?? undefined,
      // The authored-machine layer draws from its OWN stream, never `rng` —
      // a draw from the shared one would reroll every existing floor. It needs
      // the real per-(run, level) seed to be reproducible across co-op peers;
      // without this it falls back to a geometry hash, which is deterministic
      // but not shared. See maze/assembly-place.ts PlaceOpts.rng.
      assemblySeed: floorSeed(state.runSeed, level),
      // On a TRACK floor the geometry is generated, not authored, so a vault or
      // spine part facing a wall carries no intent worth preserving — re-aim it
      // or demote it to a bumper. The legacy generator keeps the exemption (its
      // set-pieces really are authored, and its spine boosters carry a
      // down-flow contract the re-aim would break).
      strictLaunchers: !!track,
      // The plunger lane, when the track layer managed to fit one. decorate
      // keeps every other kind of content out of it and lays its boosters.
      chute: track?.chute ?? null,
      // The island is geometry the maze layer built; decorate only flanks it.
      orbit: track?.orbit ?? null,
      // WALL GEOMETRY IS FINISHED. On a track floor every curved-wall family —
      // the circuit's fillets, the arc sweeps, the orbit island and the artery
      // banks — is authored by `buildTrackFloor` before decorate is called, so
      // decorate places content into finished geometry instead of building more
      // of it. The legacy branch passes nothing and keeps its own bank pass.
      wallsAuthored: !!track,
      floor: level, // ITEM RARITY is depth-biased — see rollItemRarity
    },
  );

  // A band whose corridor decorate then walled off is a smash that opens a
  // pocket — reverted to plain stone rather than shipped as a lie. Both tile
  // types are solid, so nothing about reachability moves. See pruneSealedBands.
  pruneSealedBands(grid, plan.secrets);

  // ── LIGHT PUZZLE: scatter braziers + seal a loot vault (maze/lamp-puzzle).
  // Author it here (before parts are built) so the lamp spots ride the SAME
  // createPinballParts pass. `occupied` = everything already placed, so a
  // brazier/vault never lands on a spawn, item, part, torch or the endpoints. ──
  const puzzleOccupied = new Set<string>();
  const markOcc = (t: { i: number; j: number } | null | undefined): void => {
    if (t) puzzleOccupied.add(`${t.i},${t.j}`);
  };
  markOcc(plan.start);
  markOcc(plan.stairs);
  plan.parts.forEach(markOcc);
  plan.spawns.forEach(markOcc);
  plan.items.forEach(markOcc);
  plan.props.forEach(markOcc);
  plan.torches.forEach(markOcc);
  const lampPuzzlePlan = authorLampPuzzle(grid, plan.start, (i, j) => puzzleOccupied.has(`${i},${j}`), rng, lampCountFor(level));
  if (lampPuzzlePlan) plan.parts.push(...lampPuzzlePlan.lamps);

  // ── SURFACES ── what the floor is MADE of (engine/surfaces.ts). Runs on the
  // FINAL grid — after topology, shapes, cracks, prefabs and the lamp puzzle —
  // because it only rewrites materials and must see the walls that survived.
  //
  // Seeded off (runSeed, level) but through its OWN derived stream inside
  // paintSurfaces, NOT off `rng`: taking draws from the shared stream here
  // would shift every later call and reroll the layout of every existing
  // floor. This is the standing rule for new generation behaviour
  // (ROUTE_MATH_PLAN Part 8) and it is why floors are bit-identical today.
  const surfaceSeed = (state.runSeed ^ (level * 0x85ebca6b)) >>> 0;
  // The arrival tile and the exit stay baseline: mud underfoot on spawn reads
  // as broken controls, and terrain that steals the stairs is just a tax.
  const surfaceSafe = [tileCenter(grid, plan.start.i, plan.start.j), tileCenter(grid, plan.stairs.i, plan.stairs.j)];
  paintSurfaces(grid, surfaceSeed, {
    mix: modifier.surfaceMix,
    coverage: modifier.surfaceCoverage,
    safeSpots: surfaceSafe,
  });
  // ── THE SECOND AUTHOR ── the modifier above is WEATHER: it rolls on 45% of
  // floors from level 3 and paints uniformly at random, which left the surface
  // matrix — the one mechanic this game has that nothing else does — unable to
  // hear anything a floor's SHAPE had to say. `paintBands` lets the archetype
  // state what its launch district, machine core and drain lane are made of,
  // zoned on the same distance-from-spawn bands `decorateMaze` has picked room
  // archetypes from since Slice 9, so the material and the furniture describe
  // one floor instead of two.
  //
  // SECOND, deliberately: the modifier is the announced once-in-a-while event
  // and the zoning is the floor's permanent character, so the zoning is what
  // shows through on top. Its own derived stream again, and it writes only
  // `Grid.surfaces` — flipping SURFACE_BANDS leaves every floor's GEOMETRY
  // byte-for-byte identical, which floor-pipeline.test.ts asserts both ways.
  if (SURFACE_BANDS && arch.track.bands) {
    paintBands(grid, surfaceSeed, plan.start, arch.track.bands, surfaceSafe);
  }

  return { level, cfg, biome, rng, arch, modifier, bonusRoom, track, grid, plan, lampPuzzlePlan };
}
