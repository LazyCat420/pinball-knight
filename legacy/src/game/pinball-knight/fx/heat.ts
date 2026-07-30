/**
 * Which things are HOT, where they are on screen, and which eight matter most.
 *
 * The pixel pass warps the scene around up to eight points (see `heatWarp` in
 * `engine/render/pixel-pass.ts`). This is the game-side half that decides what
 * those points are — and it lives here rather than in the engine because the
 * engine is not allowed to know what a fire puddle is.
 *
 * ── WHY CPU PROJECTION, AND NOT THE TWO OBVIOUS ALTERNATIVES ─────────────────
 *
 * **Rejected: a heat-mask render target.** The frame is submission- and
 * pipeline-bound, not fill-bound. An extra render target plus a pass plus a
 * material is the most expensive available way to answer "where is the fire",
 * and the answer is eight numbers.
 *
 * **Rejected: reusing the bloom target's warmth** (`bloom.r - bloom.b`). Free and
 * clever, and wrong: it makes ANYTHING hot-and-bright shimmer. The loot glints
 * are warm gold, the rollover lamps are warm, the flame-core sparks are warm.
 * Every one of those would wobble the floor around it.
 *
 * So: walk the few things that are actually on fire, project them, keep the
 * strongest eight.
 */
import * as THREE from "three";
import { state } from "../state";
import { activeMaterial } from "../entities/marble";
import { VENT_WARN, VENT_ACTIVE } from "../constants";

/** Must match `HEAT_SPOTS` in the pass. Asserted in `heat.test.ts`. */
export const HEAT_SPOTS = 8;

const xs = new Float32Array(HEAT_SPOTS);
const ys = new Float32Array(HEAT_SPOTS);
const rs = new Float32Array(HEAT_SPOTS);

interface Source {
  x: number;
  z: number;
  y: number;
  /** World radius. */
  r: number;
  /** Ranking weight — bigger and hotter wins a slot. */
  score: number;
}

const sources: Source[] = [];
const v = new THREE.Vector3();

/** How many sources were dropped by the eight-slot cap on the last call. */
let dropped = 0;
export function droppedHeatSources(): number {
  return dropped;
}

/**
 * Project a world point to RT UV.
 *
 * ⚠️ THE V FLIP. The pass samples its render targets through `rtUv()`, which
 * flips v — so a spot projected without the `1 -` lands mirrored vertically. That
 * failure is nearly invisible: heat haze is subtle and a dungeon frame is roughly
 * symmetric, so the shimmer simply appears in the wrong place and looks fine.
 * This exact flip has been got wrong twice in this repo on other render-target
 * hops. `heat.test.ts` places a probe OFF-CENTRE precisely so it cannot pass
 * under a mirror.
 */
function toRtUv(camera: THREE.Camera, x: number, y: number, z: number): { u: number; vv: number } {
  v.set(x, y, z).project(camera);
  return { u: v.x * 0.5 + 0.5, vv: 1 - (v.y * 0.5 + 0.5) };
}

/**
 * Collect, rank and push this frame's heat sources.
 *
 * `uvPerWorld` converts a world radius into a UV radius. Taken from the pass's
 * own `sizing()` rather than recomputed: `computeRenderSizing` is explicitly
 * documented as drifting for a frame after a resize if called twice.
 */
export function pushHeatField(
  camera: THREE.Camera,
  pass: { setHeat: (xs: Float32Array, ys: Float32Array, rs: Float32Array, n: number, t: number) => void; sizing: () => { renderW: number } },
  t: number,
  ppu: number,
): void {
  sources.length = 0;

  // 1. Fire pools — the main event. Scored by size AND remaining life, so a pool
  //    guttering out stops bending the air before it stops being drawn.
  for (const fx of state.floorFx) {
    if (fx.kind !== "fire") continue;
    const lifeFrac = fx.maxLife > 0 ? fx.life / fx.maxLife : 0;
    sources.push({ x: fx.x, z: fx.z, y: 0.15, r: fx.radius * 1.5, score: fx.radius * (0.35 + lifeFrac) });
  }

  // 2. Roaring fire vents. Only while the jet is actually out — the sputter tell
  //    is a warning, not a heat source.
  for (const part of state.pinballParts) {
    if (part.kind !== "firevent") continue;
    const roaring = part.hitT >= VENT_WARN && part.hitT <= VENT_WARN + VENT_ACTIVE;
    if (!roaring) continue;
    sources.push({ x: part.x + part.dirX * 0.6, z: part.z + part.dirZ * 0.6, y: 0.3, r: 0.9, score: 1.4 });
  }

  // 3. The knight while the lava marble is up. The player is always worth a slot
  //    if they are the thing on fire.
  const p = state.player;
  if (p && activeMaterial() === "lava") {
    sources.push({ x: p.x, z: p.z, y: 0.35, r: 0.8, score: 2.0 });
  }

  // 4. Torches, weakest and last — they are small, but a corridor of them with no
  //    shimmer at all reads as if the effect is broken.
  const anchors = state.maze?.torchAnchors;
  if (anchors && p) {
    for (const a of anchors) {
      const d2 = (a.x - p.x) ** 2 + (a.z - p.z) ** 2;
      if (d2 > 64) continue; // 8 units — beyond that it cannot be seen anyway
      sources.push({ x: a.x, z: a.z, y: 1.1, r: 0.35, score: 0.25 });
    }
  }

  sources.sort((a, b) => b.score - a.score);

  const sizing = pass.sizing();
  // World radius → UV: `ppu` render pixels per world unit, over the render width.
  // ×2 because the shimmer should reach a bit beyond the flame itself — hot air
  // rises past its source.
  const uvPerWorld = (ppu / sizing.renderW) * 2;

  let n = 0;
  for (const s of sources) {
    if (n >= HEAT_SPOTS) break;
    const { u, vv } = toRtUv(camera, s.x, s.y, s.z);
    // Off-screen (with a margin) contributes nothing but still costs a slot, so
    // skip rather than zero — the next source down deserves the slot.
    if (u < -0.2 || u > 1.2 || vv < -0.2 || vv > 1.2) continue;
    xs[n] = u;
    ys[n] = vv;
    rs[n] = Math.max(0.01, s.r * uvPerWorld);
    n++;
  }
  // Zero the tail. The contract is "the first `n` are valid", and the pass honours
  // that — but these are module-level arrays that persist between frames, so
  // leaving last frame's values past `n` hands over a buffer whose garbage looks
  // like data. A future reader who loops the whole array instead of `n` would
  // resurrect fires that went out, and it would look like a shader bug.
  for (let i = n; i < HEAT_SPOTS; i++) {
    xs[i] = 0;
    ys[i] = 0;
    rs[i] = 0;
  }
  dropped = Math.max(0, sources.length - n);
  pass.setHeat(xs, ys, rs, n, t);
}

/** For tests: the ranked source list from the last `pushHeatField`. */
export function lastHeatSources(): readonly Source[] {
  return sources;
}
