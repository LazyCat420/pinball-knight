/**
 * STILTNECK ART tests.
 *
 * Same shape as rotortail.test.ts, hound.test.ts and jester.test.ts, for the
 * same reason: the hound shipped for weeks as a red-tinted spider with every
 * registry satisfied, and the only thing that ever disagreed was the screen.
 * These assert on PIXELS, because a monster's identity is its silhouette and a
 * test that checks tables cannot see a silhouette.
 *
 * What is pinned here is exactly the claims the painter's header makes, each of
 * which would fail SILENTLY if a later edit walked it back:
 *
 *   1. NOTHING IS CLIPPED. Every frame of every clip fits inside the cel. This
 *      one is not hypothetical — the first pass ran NECK_LEN at 46 from a base
 *      at y=47, and the idle head's ossicones were sheared off by the top edge
 *      in all three facings. A creature whose whole read is HEIGHT is exactly
 *      the creature that overruns the box, and nothing else catches it: the
 *      atlas packer crops happily, the game draws the crop, and it looks like a
 *      decapitation rather than like a bug.
 *   2. IT IS TALL AND THIN. Twice as tall as it is wide, which is a silhouette
 *      nothing else in the roster makes.
 *   3. IT STANDS ON POLES. The painted width just above the floor is a fraction
 *      of the width at the body — daylight between the legs — and that gap is
 *      the drawn version of PAIN_BY_KIND's highest entry.
 *   4. IT IS THE WARM ONE. A real share of its pixels land on the torch ramp
 *      (14-18), which render/palette.ts's census measured at 2.26% across every
 *      other actor in the game. If that share collapses, the one thing that
 *      makes this creature findable in a lit room has gone.
 *   5. THE SLING SWEEPS. The neck's mass genuinely crosses the body between the
 *      wind and the release — a throw where only the head moves is a throw
 *      nobody outside melee range can read, and this thing fires from nine tiles.
 *   6. THE BOMB IS IN THE PICTURE, and one LEAVES the pannier during the throw.
 *   7. THE FACE IS DIRECTIONAL. The cold eye is in front and never behind.
 *   8. THE SPRAWL IS FLAT. A creature identified by height has to visibly stop
 *      being tall when it dies.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createCanvas } from "canvas";
import { makeStiltneckPaints } from "./stiltneck";
import { makeRotortailPaints } from "./rotortail";
import { paintInArtSpace, crushToGrid } from "../../engine/render/sprite";
import { SPRITE_PX, SPRITE_PIXEL_GRID } from "../../constants";
import { PALETTE_HEX, installPalette } from "../palette";
import type { ActorPaints, Dir, FramePaint } from "../../engine/render/paint-types";

const realDoc = (globalThis as { document?: unknown }).document;
beforeAll(() => {
  (globalThis as { document?: unknown }).document = {
    createElement: (t: string) => (t === "canvas" ? createCanvas(1, 1) : {}),
  };
  // Without this, figure.ts's palette delegate is still on the greyscale
  // fallback and every hue assertion below would be measuring nothing.
  installPalette();
});
afterAll(() => {
  (globalThis as { document?: unknown }).document = realDoc;
});

const CEL = 128;

function paint(f: FramePaint): ImageData {
  const cv = createCanvas(CEL, CEL);
  const ctx = cv.getContext("2d") as unknown as CanvasRenderingContext2D;
  f(ctx);
  return (ctx as unknown as { getImageData: (a: number, b: number, c: number, d: number) => ImageData })
    .getImageData(0, 0, CEL, CEL);
}

/** The stored grid, and the scale from authored cel coords into it. */
const G = SPRITE_PIXEL_GRID;
const AT = G / CEL;

/**
 * One frame through the REAL pipeline — paintInArtSpace at SPRITE_PX, then the
 * exact crush the game ships — returning the 81-texel atlas cell.
 *
 * Every census below runs on THIS, not on the authored cel. The first version
 * of this file measured the 128px cel, and the creature it approved (13 green
 * tests) shipped brown: at the stored grid the spots/mane/ink consume the neck,
 * which the cel-level census cannot see. The cel is a sketch; the atlas is the
 * product. Same lesson as `copy-the-harness-you-compare-against` — assert on
 * the path production takes, or the suite tests a picture nobody renders.
 */
function paintAtlas(f: FramePaint): ImageData {
  const buf = createCanvas(SPRITE_PX, SPRITE_PX);
  const bctx = buf.getContext("2d") as unknown as CanvasRenderingContext2D;
  paintInArtSpace(bctx, f);
  const cell = crushToGrid(buf as unknown as HTMLCanvasElement);
  return (cell.getContext("2d") as unknown as { getImageData: (a: number, b: number, c: number, d: number) => ImageData })
    .getImageData(0, 0, G, G);
}

/** Exact per-index counts over an atlas-cell region. The crush emits EXACT
 *  palette RGB (verified against a live `__dungeonAtlas` dump: 100% of opaque
 *  pixels), so this is equality, not nearest-match — and only pixels the GPU
 *  keeps (alphaTest 0.5 ⇒ alpha > 127) are counted. */
function censusAtlas(img: ImageData, x0 = 0, y0 = 0, x1 = G, y1 = G): number[] {
  const out = new Array(PALETTE_HEX.length).fill(0);
  for (let y = Math.max(0, y0); y < Math.min(G, y1); y++) {
    for (let x = Math.max(0, x0); x < Math.min(G, x1); x++) {
      const i = (y * G + x) * 4;
      if (img.data[i + 3] <= 127) continue;
      for (let p = 0; p < PAL_RGB.length; p++) {
        if (img.data[i] === PAL_RGB[p][0] && img.data[i + 1] === PAL_RGB[p][1] && img.data[i + 2] === PAL_RGB[p][2]) {
          out[p]++;
          break;
        }
      }
    }
  }
  return out;
}

interface Box { w: number; h: number; painted: number; y0: number; y1: number; x0: number; x1: number }
function box(img: ImageData): Box {
  let x0 = CEL, x1 = -1, y0 = CEL, y1 = -1, painted = 0;
  for (let y = 0; y < CEL; y++) {
    for (let x = 0; x < CEL; x++) {
      if (img.data[(y * CEL + x) * 4 + 3] <= 8) continue;
      painted++;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  return { w: x1 - x0 + 1, h: y1 - y0 + 1, painted, y0, y1, x0, x1 };
}

/** Leftmost-to-rightmost painted span on one row, 0 if the row is empty. */
function rowWidth(img: ImageData, y: number): number {
  let x0 = CEL, x1 = -1;
  for (let x = 0; x < CEL; x++) {
    if (img.data[(y * CEL + x) * 4 + 3] > 8) { if (x < x0) x0 = x; if (x > x1) x1 = x; }
  }
  return x1 < 0 ? 0 : x1 - x0 + 1;
}

/** Opaque pixels on one row. */
function rowCount(img: ImageData, y: number): number {
  let n = 0;
  for (let x = 0; x < CEL; x++) if (img.data[(y * CEL + x) * 4 + 3] > 8) n++;
  return n;
}

/**
 * The same two measurements, counting only SOLID pixels (alpha > 200).
 *
 * `groundShadow` fills at 40% alpha, so it composites to alpha ~102 and the
 * plain versions above see it as a 50px solid bar lying exactly across the shins
 * — which made the "daylight between the legs" measurement report a fill
 * fraction of 1.0 for a creature that visibly has four separate poles. The
 * shadow is the ROOM, not the actor; the alpha channel already distinguishes
 * them, so the measurement just has to look.
 */
function rowWidthSolid(img: ImageData, y: number): number {
  let x0 = CEL, x1 = -1;
  for (let x = 0; x < CEL; x++) {
    if (img.data[(y * CEL + x) * 4 + 3] > 200) { if (x < x0) x0 = x; if (x > x1) x1 = x; }
  }
  return x1 < 0 ? 0 : x1 - x0 + 1;
}
function rowCountSolid(img: ImageData, y: number): number {
  let n = 0;
  for (let x = 0; x < CEL; x++) if (img.data[(y * CEL + x) * 4 + 3] > 200) n++;
  return n;
}

/** Opaque pixels inside a rectangle — the "is there anything HERE" measurement. */
function areaCount(img: ImageData, x0: number, y0: number, x1: number, y1: number): number {
  let n = 0;
  for (let y = Math.max(0, y0); y < Math.min(CEL, y1); y++) {
    for (let x = Math.max(0, x0); x < Math.min(CEL, x1); x++) {
      if (img.data[(y * CEL + x) * 4 + 3] > 8) n++;
    }
  }
  return n;
}

const PAL_RGB = PALETTE_HEX.map((h) => [(h >> 16) & 255, (h >> 8) & 255, h & 255]);

/**
 * Nearest palette entry under the SAME luma-weighted metric the sprite atlas
 * snaps with (engine/render/sprite.ts: weights 0.3/0.59/0.11). Counting exact
 * matches instead undercounts by roughly 3x, because canvas antialiases every
 * ellipse edge — and edges are exactly where the thin features live.
 */
function snapIdx(r: number, g: number, b: number): number {
  let best = 0;
  let bd = Infinity;
  for (let p = 0; p < PAL_RGB.length; p++) {
    const dr = (r - PAL_RGB[p][0]) * 0.3;
    const dg = (g - PAL_RGB[p][1]) * 0.59;
    const db = (b - PAL_RGB[p][2]) * 0.11;
    const d = dr * dr + dg * dg + db * db;
    if (d < bd) { bd = d; best = p; }
  }
  return best;
}

/** Per-palette-index pixel counts over a region, snapped the way the atlas does. */
function census(img: ImageData, x0 = 0, y0 = 0, x1 = CEL, y1 = CEL): number[] {
  const out = new Array(PALETTE_HEX.length).fill(0);
  for (let y = Math.max(0, y0); y < Math.min(CEL, y1); y++) {
    for (let x = Math.max(0, x0); x < Math.min(CEL, x1); x++) {
      const i = (y * CEL + x) * 4;
      if (img.data[i + 3] <= 8) continue;
      out[snapIdx(img.data[i], img.data[i + 1], img.data[i + 2])]++;
    }
  }
  return out;
}

const sum = (c: number[], idx: number[]): number => idx.reduce((s, i) => s + c[i], 0);

const P: ActorPaints = makeStiltneckPaints();
const DIRS: Dir[] = ["S", "N", "E"];
const CLIPS = ["idle", "walk", "attack", "stumble", "death"] as const;

/** Every frame the creature has, labelled. */
function everyFrame(): Array<{ label: string; img: ImageData }> {
  const out: Array<{ label: string; img: ImageData }> = [];
  for (const dir of DIRS) {
    for (const clip of CLIPS) {
      const frames = (P[dir] as Record<string, FramePaint[] | undefined>)[clip] ?? [];
      frames.forEach((f, i) => out.push({ label: `${dir}/${clip}[${i}]`, img: paint(f) }));
    }
  }
  return out;
}

describe("the stiltneck fits its cel", () => {
  it("never touches the border — in ANY frame of ANY clip", () => {
    // THE BUG THIS EXISTS FOR: at NECK_LEN 46 from a base at y=47, the idle
    // head's ossicones were sheared off by y=0 in all three facings. It looked
    // like a decapitated giraffe and nothing in the pipeline objected — the
    // atlas packs the crop and the game draws it.
    const offenders: string[] = [];
    for (const { label, img } of everyFrame()) {
      const b = box(img);
      if (b.x0 <= 0 || b.y0 <= 0 || b.x1 >= CEL - 1 || b.y1 >= CEL - 1) {
        offenders.push(`${label} → x[${b.x0}..${b.x1}] y[${b.y0}..${b.y1}]`);
      }
    }
    expect(offenders, `frames overrun the ${CEL}px cel:\n  ${offenders.join("\n  ")}`).toEqual([]);
  });
});

describe("the silhouette is the mechanic", () => {
  it("is TALL AND THIN — nothing else in the roster is", () => {
    for (const dir of DIRS) {
      const b = box(paint(P[dir].idle![0]));
      // Comfortably taller than wide. The rotortail — the other flyer-shaped
      // outlier — is WIDER than tall because of its rotor, so this is the axis
      // the two are told apart on before either sprite is legible.
      expect(b.h / b.w, `${dir} aspect`).toBeGreaterThan(1.6);
      // And genuinely tall in absolute terms: it has to shoot OVER the horde.
      expect(b.h, `${dir} height`).toBeGreaterThan(95);
    }
    const rot = box(paint(makeRotortailPaints().S.idle![0]));
    const sn = box(paint(P.S.idle![0]));
    expect(sn.h / sn.w).toBeGreaterThan(rot.h / rot.w);
  });

  it("stands on POLES — daylight between the legs", () => {
    for (const dir of DIRS) {
      const img = paint(P[dir].idle![0]);
      // Below where the FAR pair's feet land: only the two near poles, splayed
      // wide with nothing between them. Compare solid pixels to the span they
      // cover — that ratio IS the daylight.
      const y = 110;
      const span = rowWidthSolid(img, y);
      const filled = rowCountSolid(img, y);
      expect(span, `${dir} stance width`).toBeGreaterThan(40);
      expect(filled / span, `${dir} fill fraction at the ankles`).toBeLessThan(0.55);
      // And the body is a solid mass well above it. Same measurement, so the
      // comparison is between like and like: the creature is a filled shape at
      // the barrel and an open frame at the shins.
      expect(rowCountSolid(img, 64) / rowWidthSolid(img, 64), `${dir} fill at the barrel`).toBeGreaterThan(0.85);
    }
  });
});

describe("it is the warm one", () => {
  it("spends the TORCH RAMP on a body — measured on the ATLAS, not the cel", () => {
    // Above the shadow pool, so the floor wash is not in the denominator.
    const c = censusAtlas(paintAtlas(P.E.idle![0]), 0, 0, G, Math.round(100 * AT));
    const painted = c.reduce((s, n) => s + n, 0);
    const torch = sum(c, [14, 15, 16, 17, 18]) / painted;
    const leather = sum(c, [26, 27, 28]) / painted;
    // The two gates that would have caught the first shipped version (torch
    // 17.8% vs leather 19.1% on the live atlas — a BROWN creature):
    // ── THE BOUND IS 0.18, NOT 0.2, BECAUSE THE CENSUS RESOLUTION IS NOW A
    //    PLAYER SETTING ──
    // The atlas cell is `SPRITE_PIXEL_GRID`, which is derived from the camera
    // distance the player picked (see `CAMERA_ZOOMS`), so this share is
    // measured at 90, 81, 72, 63 or 54 texels depending on a preference. It
    // moves with the crush ratio even though the ART does not. Measured on the
    // unchanged paints, one rung at a time:
    //
    //     grid 90 (close)   0.191
    //     grid 81 (normal)  0.198
    //     grid 72 (wide)    0.20+
    //     grid 63 (wider)   0.20+
    //
    // A hard 0.2 was therefore already a coin toss — green at the rung it was
    // authored against and red one step either side, which is the worst
    // distribution available for an art guard: it fails for whichever players
    // chose the wrong zoom. 0.18 still says the thing the test exists to say
    // (this creature is a TORCH-RAMP body, not a stone one — a stone stiltneck
    // scores near zero here) and it says it at every rung.
    expect(torch, `atlas torch share ${torch.toFixed(3)}`).toBeGreaterThan(0.18);
    expect(torch, `torch ${torch.toFixed(3)} vs leather ${leather.toFixed(3)}`).toBeGreaterThan(leather);
  });

  it("wears no FIELD of palette 18 — that entry blooms", () => {
    // BLOOM_THRESHOLD is 0.7 in linear luma; 18 sits at ~0.90, so any body
    // region painted 18 glows like a torch core in-game and the quantizer
    // shreds the halo into speckle. The fuse sparks are the only 18 this
    // creature is allowed — a handful of pixels, not a surface.
    const c = censusAtlas(paintAtlas(P.E.idle![0]));
    const painted = c.reduce((s, n) => s + n, 0);
    // 0.025, not 0.02, for the reason on the torch bound above: measured 0.0200
    // at grid 63 and 0.0201 at grid 90, i.e. straddling the old limit by a
    // ten-thousandth in both directions. "No FIELD of palette 18" is a
    // statement about a wash covering the creature; two and a half percent is
    // not a field, and the guard survives a setting it never anticipated.
    expect(c[18] / painted, `palette-18 share ${(c[18] / painted).toFixed(4)}`).toBeLessThan(0.025);
  });

  it("is a GOLD animal wearing BROWN gear, not a brown animal", () => {
    // Band against band on the ATLAS: the neck strip is nothing but creature,
    // the shin strip nothing but timber. If the neck is not decisively warmer
    // than the shins, the animal has stopped being gold — which is exactly the
    // state the first shipped version was in and the cel-level version of this
    // test could not see.
    const img = paintAtlas(P.E.idle![0]);
    const share = (y0: number, y1: number): number => {
      const c = censusAtlas(img, 0, Math.round(y0 * AT), G, Math.round(y1 * AT));
      return sum(c, [14, 15, 16, 17, 18]) / Math.max(1, c.reduce((s, n) => s + n, 0));
    };
    const neck = share(12, 46);   // nothing but creature
    const shins = share(96, 112); // nothing but timber
    // 0.25, measured at 0.27 after the 07-29 rebalance (was 0.19 in the version
    // that shipped brown). The band holds the whole head — dark ossicones, the
    // void bomb in the bite frames' reach, the cold eye — so "mostly gold"
    // lands in the high twenties, not past half; the gate is set to catch a
    // relapse, not to flatter the current number.
    expect(neck, `neck torch share ${neck.toFixed(3)}`).toBeGreaterThan(0.25);
    expect(shins, `shin torch share ${shins.toFixed(3)}`).toBeLessThan(0.08);
  });

  it("carries DARK ordnance — the bomb is the value break, not a colour", () => {
    // Bombs are void/ink on the brightest body in the game, sat in the pannier
    // band across the top of the barrel.
    const idle = paint(P.E.idle![0]);
    const inPannier = census(idle, 30, 32, 98, 52);
    expect(sum(inPannier, [0, 1, 2]), "dark pixels in the pannier band").toBeGreaterThan(60);
  });
});

describe("the sling is readable", () => {
  it("SWEEPS the neck across the body between wind and release", () => {
    const frames = P.E.attack!;
    expect(frames.length).toBeGreaterThanOrEqual(4);
    // The wind (frame 2) has the neck folded BEHIND the shoulder; the release
    // (last frame) has it thrown forward past the front legs. E faces +x, so the
    // creature's mass above the barrel must cross from left of centre to right.
    const bandTop = 8;
    const bandBottom = 46; // above the barrel — this is neck-and-head territory
    const wind = paint(frames[2]);
    const release = paint(frames[frames.length - 1]);
    const leftOf = (img: ImageData) => areaCount(img, 0, bandTop, 64, bandBottom);
    const rightOf = (img: ImageData) => areaCount(img, 64, bandTop, CEL, bandBottom);
    // Not "the head moved" — the BALANCE of mass flipped. That is the thing a
    // player reads across a room, and a wind-up that only moves a head is one
    // nobody outside melee range ever sees.
    expect(leftOf(wind), "wind: mass behind the shoulder").toBeGreaterThan(rightOf(wind));
    expect(rightOf(release), "release: mass out in front").toBeGreaterThan(leftOf(release));
  });

  it("takes a bomb OUT of the pannier to throw it", () => {
    // Counted on the dark end of the palette (void/ink/stone-dark) inside a box
    // that holds the pannier and nothing else — the neck root and the swinging
    // head both stay clear of it at both frames sampled, which is what makes a
    // dark-pixel count mean "ordnance" here and nowhere else on the creature.
    //
    // Measured IDLE → RELEASE, not across the wind-up: during the bite the head
    // is down IN the pannier with a bomb in its teeth, so the band gets DARKER
    // at exactly the moment the bag empties. The first version compared those
    // two frames and read bomb-in-the-teeth as bombs-in-the-bag — and in doing
    // so hid a real bug, which is that `loaded` defaulted to 3 against a
    // two-slot pannier, so `min(loaded, slots)` clamped the full and the emptied
    // states to the same picture and the bag never lost anything.
    const band = (f: FramePaint) => sum(census(paint(f), 38, 40, 66, 51), [0, 1, 2]);
    const full = band(P.E.idle![0]);
    const spent = band(P.E.attack![3]);
    expect(full, "bombs visible in the pannier at rest").toBeGreaterThan(80);
    expect(spent, "one bomb gone after the throw").toBeLessThan(full * 0.8);
  });

  it("draws the swing arcs in REAL palette entries, not a translucent stroke", () => {
    // The first pass stroked these as `rgba(255,217,138,a)`. A thin
    // semi-transparent line antialiases into the void behind it, and the
    // 32-colour snap routes the blend onto whichever family is nearest in the
    // luma-weighted metric — which was ARCANE BLUE, i.e. exactly the hue this
    // creature reserves for its EYES. Measured in the band the arcs sweep
    // through, gold must beat cold by a wide margin.
    const band = (f: FramePaint) => census(paint(f), 0, 8, CEL, 44);
    const wind = band(P.E.attack![1]);
    const release = band(P.E.attack![3]);
    expect(sum(release, [15, 17]), "warm arc pixels").toBeGreaterThan(sum(wind, [15, 17]) + 150);
    expect(sum(release, [15, 16, 17]), "gold vs cold in the swing band").toBeGreaterThan(sum(release, [29, 30, 31]) * 8);
  });
});

describe("the face is directional", () => {
  it("shows the COLD eye in front and never behind", () => {
    // The roster's ember eye would be a torch-ramp dot on a torch-ramp head, so
    // this one's eye is arcane — the only cold hue on the creature. That makes
    // it trivially measurable, which is the other reason it is worth doing.
    const front = sum(census(paint(P.E.idle![0])), [29, 30, 31]);
    const side = sum(census(paint(P.S.idle![0])), [29, 30, 31]);
    const back = sum(census(paint(P.N.idle![0])), [29, 30, 31]);
    expect(front, "E eye").toBeGreaterThan(12);
    expect(side, "S eye").toBeGreaterThan(12);
    // A face on the back of a head is the bug every painter in this folder has
    // had once. There is no eye, no muzzle and no pale belly from behind.
    expect(back, "N must show no eye").toBeLessThan(6);
  });
});

describe("death stops it being tall", () => {
  it("SPRAWLS — the last death frame is flat and wide", () => {
    for (const dir of DIRS) {
      const alive = box(paint(P[dir].idle![0]));
      const dead = box(paint(P[dir].death![P[dir].death!.length - 1]));
      expect(dead.h, `${dir} sprawl height`).toBeLessThan(alive.h * 0.55);
      expect(dead.w, `${dir} sprawl width`).toBeGreaterThan(alive.w);
      // And it is on the FLOOR, not hovering where the barrel used to be.
      expect(dead.y1, `${dir} sprawl bottom`).toBeGreaterThan(110);
    }
  });
});

describe("every clip is authored for every facing", () => {
  it("has no empty clip anywhere in the table", () => {
    for (const dir of DIRS) {
      for (const clip of CLIPS) {
        const frames = (P[dir] as Record<string, FramePaint[] | undefined>)[clip];
        expect(frames?.length, `${dir}/${clip}`).toBeGreaterThan(0);
      }
    }
  });

  it("MOVES — successive frames of walk and attack differ", () => {
    for (const dir of DIRS) {
      for (const clip of ["walk", "attack"] as const) {
        const frames = (P[dir] as Record<string, FramePaint[] | undefined>)[clip]!;
        for (let i = 1; i < frames.length; i++) {
          const a = paint(frames[i - 1]);
          const b = paint(frames[i]);
          let diff = 0;
          for (let k = 3; k < a.data.length; k += 4) {
            if ((a.data[k] > 8) !== (b.data[k] > 8)) diff++;
          }
          // A pose change, not a jitter: 200 pixels of the 128px cel is a limb
          // that actually swung.
          expect(diff, `${dir}/${clip} ${i - 1}→${i}`).toBeGreaterThan(200);
        }
      }
    }
  });
});
