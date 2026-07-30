/**
 * TESTKIT — node-canvas harness for driving the REAL sprite pipeline offline.
 *
 * ⚠️ NOT SHIPPED. This module imports `canvas` (a devDependency) and must never
 * be reachable from client code; `testkit-boundary.test.ts` enforces that by
 * scanning the subtree, because there is no compiler rule that would.
 *
 * The point of this file is that it does NOT re-implement anything. It calls
 * `paintInArtSpace` and `crushToGrid` — the exact functions `paintFrame` calls —
 * so a census here measures the atlas the GPU samples. Two suites once hand-
 * rolled "paint a frame the way paintFrame does", and when the buffer stopped
 * being the art's coordinate space both silently began comparing against a path
 * production no longer takes.
 */

import { createCanvas } from "canvas";
import { paintInArtSpace, crushToGrid } from "../engine/render/sprite";
import { installPalette, PALETTE_SIZE } from "../render/palette";
import { censusCell, declaredSet, mergeStats, type CellStats } from "../render/atlas-census";
import type { ActorPaints, Dir, FramePaint } from "../engine/render/paint-types";
import {
  ZOMBIE_VARIANTS, withRecoil,
  makeBatPaints, makeBossPaints, makeBrutePaints, makeChomperPaints, makeGhostPaints,
  makeGoblinPaints, makeGolemPaints, makeMagnetPaints, makePinPaints, makeSlimePaints,
  makeSpiderPaints, makeSpitterPaints, makeWebspinnerPaints, makeZombiePaints,
} from "../render/cel-painter";
import { makeSporelingPaints } from "../render/monsters/sporeling";
import { makeJesterPaints } from "../render/monsters/jester";
import { makeCroakerPaints } from "../render/monsters/croaker";
import { makeRotortailPaints } from "../render/monsters/rotortail";
import { makeStiltneckPaints } from "../render/monsters/stiltneck";
import { makeHoundPaints } from "../render/monsters/hound";
import { CAMERA_ZOOMS } from "../constants/render";
import type { SheetKey } from "../boot/sheets";

/**
 * The five shipped camera rungs as GRID sizes, derived — never typed out.
 *
 * `SPRITE_PIXEL_GRID = PPU * 9/8`. Asserting on the ambient value instead turns
 * a census OFF for anyone who picked a different camera, which is the trap
 * `atlas-size.test.ts` documents.
 */
export const RUNGS: number[] = [...new Set(Object.values(CAMERA_ZOOMS).map((ppu) => (ppu * 9) / 8))].sort((a, b) => a - b);

/** The rung the game actually ships at (`CAMERA_ZOOM_DEFAULT` is "wider", PPU 56). */
export const SHIPPED_GRID = (56 * 9) / 8;

/**
 * `SPRITE_PX` for a given grid. The identity `SPRITE_PX / GRID === 2` holds at
 * every rung, which is what makes the downscale an exact 2x2 box.
 */
export const bufferFor = (grid: number): number => grid * 2;

/**
 * Install the node-canvas `document` shim and the real palette. Returns the undo.
 *
 * Both halves are load-bearing. `sprite.ts` allocates its scratch via
 * `document.createElement("canvas")`, and without `installPalette()` figure.ts
 * is still on its 16-step GREYSCALE fallback — every hue assertion then measures
 * nothing while passing. (`hound.test.ts` is missing that call today.)
 */
export function installSpriteTestDom(): () => void {
  const realDoc = (globalThis as { document?: unknown }).document;
  (globalThis as { document?: unknown }).document = {
    createElement: (t: string) => (t === "canvas" ? createCanvas(1, 1) : {}),
  };
  installPalette();
  return () => {
    (globalThis as { document?: unknown }).document = realDoc;
  };
}

/** The pre-crush buffer for one frame — what the painter actually asked for. */
export function paintBuffer(f: FramePaint, grid: number = SHIPPED_GRID): ImageData {
  const px = bufferFor(grid);
  const buf = createCanvas(px, px);
  const ctx = buf.getContext("2d") as unknown as CanvasRenderingContext2D;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, px, px);
  paintInArtSpace(ctx, f, px);
  return ctx.getImageData(0, 0, px, px) as unknown as ImageData;
}

/** ONE frame through the production path, at a chosen rung. */
export function paintAtlas(f: FramePaint, grid: number = SHIPPED_GRID): ImageData {
  const px = bufferFor(grid);
  const buf = createCanvas(px, px);
  const ctx = buf.getContext("2d") as unknown as CanvasRenderingContext2D;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, px, px);
  paintInArtSpace(ctx, f, px);
  const cell = crushToGrid(buf as unknown as HTMLCanvasElement, grid);
  const cctx = cell.getContext("2d") as unknown as CanvasRenderingContext2D;
  return cctx.getImageData(0, 0, grid, grid) as unknown as ImageData;
}

/**
 * The roster, keyed by `SheetKey` so tsc enforces completeness.
 *
 * A `SheetKey[]` would be checkable only by registry-drift's text scan; a
 * `Record` is a compile error the moment a 20th monster lands. `zombie` has no
 * SheetKey — it is a variant family built from `state.zombieVariantSheets` — so
 * it is appended separately by `rosterSubjects()` rather than smuggled in here.
 */
export const ROSTER: Record<SheetKey, () => ActorPaints> = {
  spider: makeSpiderPaints,
  brute: makeBrutePaints,
  spitter: makeSpitterPaints,
  ghost: makeGhostPaints,
  bat: makeBatPaints,
  slime: makeSlimePaints,
  boss: makeBossPaints,
  goblin: makeGoblinPaints,
  pin: makePinPaints,
  golem: makeGolemPaints,
  chomper: makeChomperPaints,
  magnet: makeMagnetPaints,
  webspinner: makeWebspinnerPaints,
  sporeling: makeSporelingPaints,
  hound: makeHoundPaints,
  jester: makeJesterPaints,
  croaker: makeCroakerPaints,
  rotortail: makeRotortailPaints,
  stiltneck: makeStiltneckPaints,
};

export interface Subject {
  key: string;
  paints: ActorPaints;
}

/**
 * Every censusable actor, wrapped in `withRecoil` — because that is what
 * `boot/sheets.ts` ships, and the recoil frames are real atlas cells.
 */
export function rosterSubjects(): Subject[] {
  const out: Subject[] = Object.entries(ROSTER).map(([key, make]) => ({ key, paints: withRecoil(make()) }));
  out.push({ key: "zombie", paints: withRecoil(makeZombiePaints(ZOMBIE_VARIANTS[0])) });
  return out;
}

/**
 * The frames a noise census looks at: the E profile, idle and both stride
 * extremes.
 *
 * E is the busiest silhouette and the only facing that cannot hide a limb
 * crossing behind the body. This is a NOISE census, not a silhouette census — it
 * needs a sample that moves when a painter gets busier, not exhaustive coverage.
 * All frames would be ~20 subjects x ~14 frames x 3 rungs ≈ 840 paints, several
 * seconds, for a number that does not change conclusions.
 */
export function censusFrames(p: ActorPaints, dir: Dir = "E"): FramePaint[] {
  const idle = p[dir].idle ?? [];
  const walk = p[dir].walk ?? [];
  const out: FramePaint[] = [];
  if (idle[0]) out.push(idle[0]);
  if (walk[0]) out.push(walk[0]);
  if (walk.length > 1) out.push(walk[Math.floor(walk.length / 2)]);
  return out;
}

export interface SubjectStats extends CellStats {
  key: string;
  /** Palette indices in the atlas that the painter never asked for. */
  inventedIdx: number[];
}

/** Census one subject at one rung: paint every census frame, merge, diff vs declared. */
export function censusSubject(s: Subject, grid: number = SHIPPED_GRID): SubjectStats {
  const frames = censusFrames(s.paints);
  const cells: CellStats[] = [];
  const declared = new Set<number>();
  for (const f of frames) {
    // The declared set is measured off the PRE-CRUSH buffer, so it is what the
    // painter asked for rather than a hand-count of source literals.
    for (const i of declaredSet(paintBuffer(f, grid).data)) declared.add(i);
    cells.push(censusCell(paintAtlas(f, grid).data, grid));
  }
  const merged = mergeStats(cells, PALETTE_SIZE);
  const inventedIdx: number[] = [];
  for (let i = 0; i < merged.counts.length; i++) {
    if (merged.counts[i] > 0 && !declared.has(i)) inventedIdx.push(i);
  }
  return { ...merged, key: s.key, inventedIdx };
}
