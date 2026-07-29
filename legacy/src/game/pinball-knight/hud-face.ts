/**
 * 🛡️ THE KNIGHT'S FACE — the Doom-status-bar mugshot, painted procedurally.
 *
 * One offscreen canvas, blitted into the HUD by `gui/screens/hud.ts`: a
 * helmeted old knight who scans left and right while he fights, glances toward
 * whatever just hit him, and comes apart as his health does — the helm chips,
 * cracks, shatters and finally falls away, leaving a bloodied grey-bearded head.
 *
 * ── WHY THE NUMBERS ARE WHAT THEY ARE ──
 *
 * **36×36 cells at SCALE 2 = a 72px backing store, and the HUD blits it 1:1.**
 * The previous face authored 24×24 at SCALE 5 (a 120px store) into a 72px slot.
 * `imageSmoothingEnabled` is off everywhere in this UI, so that was a 0.6×
 * NEAREST-NEIGHBOUR downscale: two of every five source rows and columns were
 * dropped outright, unevenly. Every one-pixel feature in the art — the eye
 * catch-light, the nostrils, the helmet cracks — had a 40% chance of simply not
 * existing on screen, and the ones that survived sat on an irregular grid. That
 * is the single largest thing that was wrong with it, and no amount of extra
 * detail in the source could have survived it. `FACE_PX` is exported and
 * `hud-face.test.ts` pins the HUD's face box to a whole multiple of it so the
 * resample cannot come back.
 *
 * **Every colour is a palette entry, by index.** The UI layer composites INSIDE
 * the pixel pass (see `gui/layer.ts` and `engine/render/pixel-pass.ts`), which
 * means this canvas gets dithered and snapped to the 32-colour Cold Crypt
 * palette by a LUMA-WEIGHTED nearest match. Free-hex art does not survive that.
 * Measured on the old face: `blood` and `bloodHi` both landed on entry 12, so
 * the gore had no shading at all; the eye catch-light and the sclera both landed
 * on 22, so the highlight that "kills the dead doll look" was invisible; the
 * grey hair and the steel helm both landed on 20, so beard and armour were one
 * flat mass; and the brightest skin tone landed on 17, torch ORANGE. Authoring
 * from `paletteCss(i)` means what is written here is what reaches the screen,
 * and colours sitting exactly on an entry can't shimmer between two of them
 * under the pass's Bayer dither. See `render/palette.ts` and
 * `scripts/marble-census.mjs`.
 *
 * **The skin ramp borrows the leather entries.** There are only three skin
 * entries (23-25), which is not enough tones to sculpt a face. 26-28 are the
 * same hue family one step darker, and the quantizer routes deep skin there
 * anyway, so they are used deliberately as the shadow end rather than by
 * accident. The hair takes the STONE ramp and the helm the STEEL ramp — matte
 * grey against specular grey — because putting both on steel is what merged
 * them before.
 *
 * **The outline is derived, not authored.** The head is painted onto a scratch
 * canvas, and any empty cell touching a painted one is inked with entry 1. That
 * is the same 1px ink the actor sprites wear (a quarter of every actor's pixels
 * are outline), and deriving it means the silhouette stays correct through all
 * six helmet damage stages, the head turn and the pain recoil without a second
 * set of coordinates to keep in sync.
 */
import { paletteCss } from "./render/palette";

const GRID = 36;
const SCALE = 2;
/** Backing-store size. The HUD must blit at a whole multiple of this. */
export const FACE_PX = GRID * SCALE; // 72
const PX = FACE_PX;

type Expr = "fresh" | "steady" | "hurt" | "bloodied" | "dying" | "dead";
type Mood = Expr | "grin" | "smile" | "wince";

let canvas: HTMLCanvasElement | null = null;
let ctx: CanvasRenderingContext2D | null = null;
let scratch: HTMLCanvasElement | null = null;
let sctx: CanvasRenderingContext2D | null = null;

// ── Live face state ──
let hp = 6;
let maxHp = 6;
let painT = 0; // >0 = wincing from a recent hit
let healT = 0; // >0 = brief smile
let specialT = 0; // >0 = wide grin (item/power pickup)
let lookX = 0; // -1..1 gaze, toward a damage source or wherever the idle scan went
let lookY = 0; // -1..1 gaze, up/down
let turn = 0; // -1 | 0 | 1 — which way the HEAD is turned, not just the eyes
let turnT = 0.8; // countdown to the next idle glance
let blinkT = 2.4; // countdown to the next blink
let blinkFor = 0; // >0 = eyes shut this frame
let lastSig = ""; // repaint guard

/**
 * The face's own noise, so the idle scan never touches `Math.random`.
 *
 * This is cosmetic, but the sim next door is replay-and-coop deterministic and
 * a shared global RNG is exactly how a cosmetic reaches in and desynchronises
 * one. A private LCG costs three lines and removes the question.
 */
let rngState = 0x9e3779b9;
function rnd(): number {
  rngState = (rngState * 1664525 + 1013904223) >>> 0;
  return rngState / 0x100000000;
}

/** Create (once) the shared face canvas and return it. */
export function createFace(): HTMLCanvasElement {
  if (canvas) return canvas;
  // No `id` and no `style`. Both were meaningful when this canvas was a DOM
  // child that the two old HUDs re-parented between them; since the UI moved
  // inside the pixel pass it is a backing store that is never appended to
  // anything, so `image-rendering: pixelated` had nothing to apply to and the
  // id addressed nothing. Setting them also made the module un-renderable under
  // the node-canvas shim the tests use, for no benefit at all.
  const c = document.createElement("canvas");
  c.width = PX;
  c.height = PX;
  const context = c.getContext("2d");
  if (context) context.imageSmoothingEnabled = false;
  canvas = c;
  ctx = context;

  // `willReadFrequently`: the outline pass reads this one back on every repaint.
  const s = document.createElement("canvas");
  s.width = PX;
  s.height = PX;
  scratch = s;
  sctx = s.getContext("2d", { willReadFrequently: true });
  if (sctx) sctx.imageSmoothingEnabled = false;

  lastSig = "";
  return c;
}

export function disposeFace(): void {
  canvas = null;
  ctx = null;
  scratch = null;
  sctx = null;
  painT = healT = specialT = 0;
  lookX = lookY = 0;
  turn = 0;
  turnT = 0.8;
  blinkT = 2.4;
  blinkFor = 0;
  lastSig = "";
}

/** Latch the current health so the tier + blood level track it. */
export function setFaceHealth(currentHp: number, currentMax: number): void {
  hp = Math.max(0, currentHp);
  maxHp = Math.max(1, currentMax);
}

/** A hit landed — wince, and (if we know where it came from) glance that way. */
export function faceOnDamage(sourceAngle?: number): void {
  painT = 0.32;
  if (sourceAngle !== undefined) {
    lookX = Math.cos(sourceAngle);
    lookY = Math.sin(sourceAngle) * 0.6;
    // Snap the HEAD round too, not just the pupils. A mugshot that only moves
    // its eyes reads as a painting; Doom's turned the whole skull, and at this
    // size a one-cell skull shift under a two-cell feature shift is what sells
    // it as a turn rather than a slide.
    turn = lookX > 0.35 ? 1 : lookX < -0.35 ? -1 : 0;
    turnT = 0.55; // hold the glance a beat before the idle scan takes over again
  }
}

/** A heal — a quick relieved grin. */
export function faceOnHeal(): void {
  healT = 0.42;
}

/** A special / power pickup — a wide toothy grin. */
export function faceOnSpecial(): void {
  specialT = 0.7;
}

function tierOf(): Expr {
  if (hp <= 0) return "dead";
  const f = hp / maxHp;
  if (f <= 0.18) return "dying";
  if (f <= 0.36) return "bloodied";
  if (f <= 0.55) return "hurt";
  if (f <= 0.78) return "steady";
  return "fresh";
}

/**
 * Advance the face's own animation timers and repaint if anything visible
 * changed. Call once per rendered frame with the frame's dt.
 */
export function renderFace(dt: number): void {
  if (!ctx || !canvas) return;

  painT = Math.max(0, painT - dt);
  healT = Math.max(0, healT - dt);
  specialT = Math.max(0, specialT - dt);

  // ── The idle scan. The face is never still: it looks left, forward and right
  // on its own, and faster as the fight goes badly — a wounded man checks his
  // flanks. Weighted toward centre so it reads as scanning, not a metronome.
  turnT -= dt;
  if (turnT <= 0 && painT === 0) {
    const r = rnd();
    turn = r < 0.42 ? 0 : r < 0.71 ? -1 : 1;
    lookX = turn;
    lookY = rnd() < 0.22 ? (rnd() < 0.5 ? -1 : 1) : 0;
    const hurry = 1 - 0.45 * (1 - hp / maxHp);
    turnT = (0.45 + rnd() * 0.85) * hurry;
  }
  if (painT === 0 && turn === 0) {
    lookX *= Math.max(0, 1 - dt * 6);
    lookY *= Math.max(0, 1 - dt * 6);
  }

  blinkFor = Math.max(0, blinkFor - dt);
  blinkT -= dt;
  if (blinkT <= 0) {
    blinkFor = 0.11;
    const tier = tierOf();
    blinkT = tier === "dying" ? 0.9 + rnd() * 0.4 : 2.2 + (hp / maxHp) * 2;
  }

  const sig = [
    tierOf(),
    exprNow(),
    blinkFor > 0 ? 1 : 0,
    turn,
    Math.round(lookX * 2),
    Math.round(lookY * 2),
    painT > 0 ? Math.ceil(painT * 20) : 0,
    healT > 0 ? 1 : 0,
    specialT > 0 ? 1 : 0,
  ].join(":");
  if (sig === lastSig) return;
  lastSig = sig;
  paint();
}

function exprNow(): Mood {
  const tier = tierOf();
  if (tier === "dead") return "dead";
  if (specialT > 0) return "grin";
  if (painT > 0) return "wince";
  if (healT > 0) return "smile";
  return tier;
}

// ── Palette. Every entry is an INDEX into the Cold Crypt palette, because this
// canvas is snapped to it downstream — see the header. The index is spelled out
// in the comment so a palette edit can be traced through to here.
const P = paletteCss;
const C = {
  bg: P(0), //           0  void black
  bgHi: P(1), //         1  outline — the recessed plate the portrait sits in
  ink: P(1), //          1  outline — the silhouette ink every actor wears
  // ── helm: the STEEL ramp (specular, cold, bright) ──
  steelDk: P(19), //    19  steel dark
  steel: P(20), //      20  steel mid
  steelHi: P(21), //    21  steel light
  steelBright: P(22), //22  steel highlight
  // ── crest: the torch ramp, the only warm thing down here ──
  gold: P(14), //       14  ember
  goldMid: P(15), //    15  flame dark
  goldHi: P(16), //     16  flame
  goldBright: P(17), // 17  flame light
  // ── skin: six tones. 26-28 are the leather ramp, used deliberately as the
  //    shadow end — three skin entries cannot sculpt a face. ──
  skinLo: P(26), //     26  leather shadow — the deepest crease
  skinDeep: P(27), //   27  leather dark
  skinDk: P(23), //     23  skin shadow
  skin: P(24), //       24  skin mid
  skinHi: P(25), //     25  skin light
  skinBright: P(17), // 17  flame light — the warm catch on brow and nose only
  // ── eyes ──
  white: P(22), //      22  steel highlight — the sclera
  iris: P(29), //       29  arcane dark
  irisHi: P(30), //     30  arcane mid
  pupil: P(1), //        1  outline
  glint: P(18), //      18  flame core — a WARM white, so it separates from the
  //                        sclera's cold white instead of vanishing into it
  // ── mouth ──
  mouthDk: P(10), //    10  blood shadow — a mouth interior, not brown wood
  gum: P(11), //        11  blood dark
  teeth: P(21), //      21  steel light
  // ── blood: all four, so the gore has form ──
  bloodSh: P(10), //    10  blood shadow
  blood: P(11), //      11  blood dark
  bloodMid: P(12), //   12  blood mid
  bloodHi: P(13), //    13  blood light
  sweat: P(5), //        5  stone highlight — a pale bead. Entry 31 (arcane
  //                        light) was tried first and a saturated cyan pixel on
  //                        a skin field does not read as sweat, it reads as a
  //                        gemstone stuck to his face.
  // ── hair: the STONE ramp (matte, cool), never the steel the helm wears ──
  hairDk: P(2), //       2  stone dark
  hair: P(3), //         3  stone mid
  hairHi: P(4), //       4  stone light
  hairWhite: P(5), //    5  stone highlight
  hairSilver: P(21), // 21  steel light — a handful of strands, no more
  scalp: P(24), //      24  skin mid — the bald pate
  scalpHi: P(25), //    25  skin light
};

// ── Draw plumbing ──
// `g` is whichever surface is being painted (the scratch for the head, the
// visible canvas for the backdrop and the composite). `offX/offY` shift
// everything drawn through `cell` — that is how the head turn and the pain
// recoil move a whole layer without every coordinate below knowing about them.
let g: CanvasRenderingContext2D | null = null;
let offX = 0;
let offY = 0;

function cell(gx: number, gy: number, gw: number, gh: number, color: string): void {
  if (!g) return;
  g.fillStyle = color;
  g.fillRect((gx + offX) * SCALE, (gy + offY) * SCALE, gw * SCALE, gh * SCALE);
}
function px(gx: number, gy: number, color: string): void {
  cell(gx, gy, 1, 1, color);
}
/** Where a span mirrors to. The head's axis of symmetry runs between 17 and 18. */
function mir(gx: number, gw: number): number {
  return GRID - gx - gw;
}
/** Draw a span and its mirror: symmetry by construction, broken only on purpose. */
function sym(gx: number, gy: number, gw: number, gh: number, color: string): void {
  cell(gx, gy, gw, gh, color);
  cell(mir(gx, gw), gy, gw, gh, color);
}
function symPx(gx: number, gy: number, color: string): void {
  sym(gx, gy, 1, 1, color);
}

function paint(): void {
  if (!ctx || !sctx || !scratch) return;
  const mood = exprNow();
  const tier = tierOf();
  const stage = helmetStageOf();

  // A fresh hit knocks the head down a cell. One row of recoil at this size is
  // a real flinch; two would look like the panel came loose.
  const recoil = painT > 0.18 ? 1 : 0;

  // ── 1. The head, onto the scratch, over transparent ──
  sctx.clearRect(0, 0, PX, PX);
  g = sctx;
  offX = turn;
  offY = recoil;

  paintScalp(stage);
  paintHelmet(stage);
  paintSkin();
  paintBeard(tier);

  // Features sit one cell further round than the skull. That difference IS the
  // turn: the skull slides, the features slide twice as far across it, and the
  // far cheek guard narrows — three cheap cues that together read as rotation.
  offX = turn * 2;
  paintBrow(mood, tier);
  paintEyes(mood, tier);
  paintNose();
  paintMoustache(tier);
  paintMouth(mood);
  offX = turn;
  paintDamage(tier);
  offX = 0;
  offY = 0;

  // ── 2. Reaction wash, ON THE HEAD ONLY.
  //
  // `source-atop` clips it to what has already been painted, which matters more
  // than it sounds: a full-frame tint washed the backdrop too, and at three
  // moods out of seven the whole 72px cell went flat red / green / gold with
  // the portrait barely visible inside it. Tinting the head alone keeps the
  // silhouette and the frame reading while the reaction still lands.
  const wash =
    painT > 0
      ? `rgba(168,50,68,${0.3 * (painT / 0.32)})`
      : healT > 0
        ? `rgba(95,138,79,${0.22 * (healT / 0.42)})`
        : specialT > 0
          ? "rgba(240,166,60,0.18)"
          : null;
  if (wash) {
    sctx.globalCompositeOperation = "source-atop";
    sctx.fillStyle = wash;
    sctx.fillRect(0, 0, PX, PX);
    sctx.globalCompositeOperation = "source-over";
  }

  // ── 3. The visible canvas: backdrop, derived ink, then the head ──
  g = ctx;
  ctx.clearRect(0, 0, PX, PX);
  cell(0, 0, GRID, GRID, C.bg);
  cell(6, 3, 24, 32, C.bgHi); // the recess the portrait sits in

  paintOutline();

  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(scratch, 0, 0);
  g = null;
}

/**
 * Ink the silhouette, read back off the scratch rather than authored.
 *
 * Any empty cell orthogonally touching a painted one becomes entry 1. Six
 * helmet damage stages, a turning head and a recoil offset all change the
 * outline; none of them need to say so.
 */
function paintOutline(): void {
  if (!sctx || !ctx) return;
  const data = sctx.getImageData(0, 0, PX, PX).data;
  // One sample per CELL, at the cell's top-left texel. Everything on the
  // scratch is drawn cell-aligned, so that sample stands for the whole cell.
  const solid = (gx: number, gy: number): boolean => {
    if (gx < 0 || gy < 0 || gx >= GRID || gy >= GRID) return false;
    return data[(gy * SCALE * PX + gx * SCALE) * 4 + 3] > 8;
  };
  ctx.fillStyle = C.ink;
  for (let gy = 0; gy < GRID; gy++) {
    for (let gx = 0; gx < GRID; gx++) {
      if (solid(gx, gy)) continue;
      if (solid(gx - 1, gy) || solid(gx + 1, gy) || solid(gx, gy - 1) || solid(gx, gy + 1)) {
        ctx.fillRect(gx * SCALE, gy * SCALE, SCALE, SCALE);
      }
    }
  }
}

/**
 * Helmet damage stage 0-5 from the health tier: the plates chip, crack, shatter
 * and finally fall away entirely, Doom-status-face style, so LOW HP literally
 * reads as "the armour is gone and it's just his bloody face".
 */
function helmetStageOf(): number {
  switch (tierOf()) {
    case "fresh":
      return 0;
    case "steady":
      return 1;
    case "hurt":
      return 2;
    case "bloodied":
      return 3;
    case "dying":
      return 4;
    default:
      return 5; // dead
  }
}

/**
 * The old knight's HEAD under the helm — a balding grey-haired pate. Hidden
 * while the dome is intact; shows through the holes as it shatters, then fully
 * bared, wild and blood-matted, once the helmet is gone.
 */
function paintScalp(stage: number): void {
  // The bald crown. Domed with the same upper-left key as the face, because a
  // flat fill here is a slab of wood sitting on the head — which is exactly how
  // the first pass read once the helm came off and you could see all of it.
  cell(12, 4, 12, 7, C.skinDk);
  cell(12, 4, 9, 5, C.scalp);
  cell(13, 4, 6, 3, C.scalpHi);
  cell(14, 4, 3, 1, C.skinBright); // the shine off the top of the pate
  cell(22, 5, 2, 6, C.skinDeep); // the far side turning away
  cell(12, 10, 12, 1, C.skinDk);
  // liver spots and a scar — age, at one pixel each
  px(15, 7, C.skinDeep);
  px(20, 6, C.skinDeep);

  // grey fringe down both sides of the pate
  sym(9, 5, 3, 8, C.hair);
  sym(9, 5, 1, 8, C.hairDk);
  sym(10, 6, 2, 4, C.hairHi);
  symPx(11, 8, C.hairWhite);
  px(19, 4, C.hairSilver);

  if (stage < 4) return;
  // Helm gone. What is left of his hair standing up off a blood-matted pate.
  cell(10, 2, 16, 2, C.hair);
  cell(10, 2, 7, 1, C.hairHi);
  cell(21, 2, 5, 2, C.hairDk);
  for (const x of [11, 14, 17, 20, 23]) px(x, 1, x % 2 ? C.hairWhite : C.hairHi);
  sym(8, 3, 2, 7, C.hairDk);
  sym(9, 4, 1, 5, C.hair);
  // matted blood, following the fringe down rather than sitting in the middle
  cell(11, 5, 3, 1, C.blood);
  px(11, 6, C.bloodSh);
  cell(21, 6, 3, 1, C.bloodSh);
  px(23, 7, C.blood);
  if (stage < 5) return;
  cell(14, 3, 5, 1, C.bloodMid);
  px(16, 4, C.bloodHi);
  cell(12, 8, 2, 1, C.blood);
}

function paintHelmet(stage: number): void {
  if (stage >= 5) {
    // DEAD — helmet entirely gone; only a battered blood-streaked gorget left.
    cell(10, 33, 16, 3, C.steelDk);
    cell(10, 33, 16, 1, C.steel);
    cell(12, 34, 3, 1, C.bloodSh);
    cell(21, 35, 4, 1, C.blood);
    return;
  }

  // ── Gorget (neck plate) — holds on until death.
  // Dark and low: the beard hangs over it, and a BRIGHT plate here competed
  // with the helm for the eye and read as a shelf the head was sitting on.
  cell(10, 33, 16, 3, C.steelDk);
  cell(10, 33, 16, 1, C.steel);
  sym(10, 33, 2, 1, C.steelHi); // the two lit shoulder edges
  sym(11, 34, 1, 1, C.steel);

  if (stage >= 4) {
    // DYING — helm smashed off. A bent remnant brow-plate clings on the near
    // side and one cheek strap swings free; everything else is bare scalp.
    cell(9, 6, 7, 3, C.steelDk);
    cell(9, 6, 7, 1, C.steel);
    cell(9, 6, 3, 1, C.steelHi);
    cell(7, 9, 2, 9, C.steelDk); // the dangling strap
    px(8, 17, C.steel);
    px(10, 5, C.steelDk);
    cell(11, 8, 2, 1, C.bloodSh);
    return;
  }

  // ── Dome (stepped, rounded) ──
  cell(14, 0, 8, 1, C.steel);
  cell(12, 1, 12, 1, C.steel);
  cell(10, 2, 16, 1, C.steel);
  cell(9, 3, 18, 1, C.steel);
  cell(8, 4, 20, 4, C.steel);
  // brim, flared a cell wider than the dome
  cell(7, 8, 22, 1, C.steel);
  cell(7, 9, 22, 1, C.steelDk); // the shadow it throws on the forehead

  // Light from the upper left: a rake down the near side…
  if (stage === 0) {
    cell(14, 0, 4, 1, C.steelBright);
    cell(12, 1, 4, 1, C.steelBright);
    cell(10, 2, 4, 1, C.steelHi);
    cell(9, 3, 3, 1, C.steelHi);
    cell(8, 4, 2, 4, C.steelHi);
    cell(7, 8, 4, 1, C.steelHi);
    sym(10, 7, 1, 1, C.steelBright); // brim rivets
  } else {
    cell(12, 1, 3, 1, C.steelHi);
    cell(10, 2, 3, 1, C.steelHi);
    cell(8, 4, 2, 3, C.steelHi);
  }
  // …and the far side falls into shadow.
  cell(20, 0, 2, 1, C.steelDk);
  cell(21, 1, 3, 1, C.steelDk);
  cell(23, 2, 3, 1, C.steelDk);
  cell(24, 3, 3, 1, C.steelDk);
  cell(25, 4, 3, 4, C.steelDk);
  cell(25, 8, 4, 1, C.steelDk);

  // ── Gold crest / nasal spine — knocked clean off at stage ≥ 2 ──
  if (stage < 2) {
    cell(17, 0, 3, 9, C.goldMid);
    cell(17, 0, 1, 9, C.goldHi);
    cell(19, 2, 1, 7, C.gold);
    px(17, 1, C.goldBright);
    px(17, 5, C.goldBright);
  } else {
    cell(17, 7, 2, 2, C.gold); // the torn stub
    px(18, 6, C.steelDk);
    px(17, 6, C.bloodSh);
  }

  // ── Cracks and punched-out holes, growing with the stage ──
  if (stage >= 1) {
    cell(24, 3, 1, 4, C.steelDk); // the first ding
    cell(13, 4, 2, 1, C.steelDk);
    px(12, 5, C.steelDk);
  }
  if (stage >= 2) {
    // a crack forks across the dome
    px(15, 2, C.steelDk);
    cell(15, 3, 1, 2, C.steelDk);
    px(16, 5, C.steelDk);
    px(14, 5, C.steelDk);
    cell(22, 4, 3, 1, C.steelDk);
    px(21, 5, C.steelDk);
  }
  if (stage >= 3) {
    // SHATTERED — chunks punched out, the grey head showing through the gaps
    cell(11, 3, 3, 2, C.hair);
    px(10, 5, C.hairDk);
    cell(21, 5, 3, 2, C.hair);
    px(23, 4, C.hairHi);
    cell(16, 8, 4, 1, C.hair); // a jagged bite out of the brim
    px(20, 2, C.hair);
    cell(14, 6, 2, 1, C.bloodSh);
    px(22, 7, C.bloodMid);
  }

  // ── Cheek guards. The head turn narrows the FAR one and widens the near one,
  // which is most of what sells the rotation. The right guard also takes the
  // worse of the beating, so the damage is never mirror-symmetric.
  // They stop at the cheekbone, not at the chin: run down to the jaw they put a
  // grey bar on either side of the mouth and the lower face read as more armour.
  const leftBot = stage >= 3 ? 16 : stage >= 2 ? 21 : 25;
  const leftW = turn < 0 ? 2 : 3;
  cell(7, 9, leftW, leftBot - 9, C.steel);
  cell(7, 9, 1, leftBot - 9, C.steelHi);
  if (stage < 3) px(8, 13, C.steelBright);
  if (stage >= 2) cell(7, leftBot - 1, leftW, 1, C.steelDk); // jagged break edge

  const rightBot = stage >= 3 ? 14 : stage >= 2 ? 19 : 25;
  const rightW = turn > 0 ? 2 : 3;
  cell(29 - rightW, 9, rightW, rightBot - 9, C.steel);
  cell(28, 9, 1, rightBot - 9, C.steelDk);
  if (stage < 2) {
    px(27, 13, C.steelHi);
    px(27, 20, C.steelHi);
  } else {
    cell(29 - rightW, rightBot - 1, rightW, 1, C.steelDk);
  }
}

/**
 * The face itself: the skin mass, then the form on top of it — the brow shelf,
 * the temples, the cheekbones, the shadow the far third of the head falls into,
 * and the hollows an old man has under his eyes.
 */
function paintSkin(): void {
  // The skull: full width through the cheeks, then a REAL taper to the chin.
  // The first pass ended the skin in a rectangle and let the beard cover the
  // join, which is why the portrait had no jaw at all.
  cell(10, 9, 16, 17, C.skin); // brow → cheek
  cell(11, 26, 14, 2, C.skin);
  cell(12, 28, 12, 1, C.skin);
  cell(13, 29, 10, 1, C.skin);
  cell(14, 30, 8, 1, C.skin);
  cell(15, 31, 6, 1, C.skin); // chin
  cell(15, 32, 6, 2, C.skin); // neck — wide enough to MEET the gorget. A four-
  //                             cell neck left a gap and the head read as
  //                             balanced on a post.
  symPx(10, 9, C.skinDk); // knock the top corners round under the brim

  // ── The light. Upper-left key, so the near temple and cheek catch it and the
  // far third of the face sits a full ramp step down. ──
  cell(11, 10, 9, 2, C.skinHi); // the forehead plane
  cell(11, 10, 5, 1, C.skinBright);
  cell(22, 10, 4, 4, C.skinDk); // the far temple
  cell(24, 12, 2, 14, C.skinDeep); // the far side falling away
  cell(10, 12, 1, 14, C.skinDk); // the near edge turning
  cell(23, 14, 1, 12, C.skinDk);

  // cheekbones
  cell(11, 18, 3, 3, C.skinHi);
  px(11, 18, C.skinBright);
  cell(21, 18, 3, 3, C.skin);
  cell(11, 21, 4, 1, C.skinDk); // the hollow under them
  cell(21, 21, 3, 1, C.skinDeep);

  // Eye sockets. SHALLOW: a five-row band of shadow across both eyes read as a
  // mask, not as bone. Two rows of shelf plus the bags below is enough.
  sym(11, 13, 6, 2, C.skinDk);
  sym(11, 13, 6, 1, C.skinDeep);
  sym(11, 18, 5, 1, C.skinHi); // an old man's bags
  symPx(10, 15, C.skinLo); // crow's feet
  symPx(10, 17, C.skinLo);
  // the frown lines he has worn in between the brows
  cell(17, 11, 1, 3, C.skinDeep);
  cell(19, 11, 1, 3, C.skinDeep);

  // jaw and chin, with the shadow the chin throws down onto the neck
  cell(12, 28, 12, 1, C.skinDk);
  cell(13, 29, 10, 1, C.skinDk);
  cell(14, 30, 8, 1, C.skinDeep);
  cell(15, 31, 6, 1, C.skinLo);
  cell(15, 32, 6, 2, C.skinDeep);
  cell(16, 30, 4, 1, C.skinHi); // …but the point of the chin catches the light
}

function paintBrow(mood: Mood, tier: Expr): void {
  // Angrier — lower, and tilted in at the inner ends — as the fight wears on.
  const angry = mood === "wince" || tier === "dying" || tier === "bloodied";
  const y = angry ? 13 : 12;
  sym(11, y, 6, 1, C.hairDk);
  sym(11, y - 1, 5, 1, C.skinLo);
  // the shaggy grey brows themselves
  sym(11, y, 3, 1, C.hair);
  symPx(12, y, C.hairHi);
  if (angry) {
    // the inner ends drop, which is the whole vocabulary of a scowl
    sym(15, y + 1, 2, 1, C.hairDk);
    cell(17, 14, 2, 1, C.skinLo);
  }
}

function paintEyes(mood: Mood, tier: Expr): void {
  if (mood === "dead") {
    drawX(11, 14);
    drawX(20, 14);
    return;
  }
  if (blinkFor > 0) {
    // A shut lid is a lid, not a line: skin over the socket, with a lash line
    // and the crease above it.
    sym(11, 14, 5, 3, C.skinDk);
    sym(11, 14, 5, 1, C.skinDeep);
    sym(11, 16, 5, 1, C.skinLo);
    return;
  }

  const squint = mood === "wince" || tier === "dying";
  const dy = Math.max(-1, Math.min(1, Math.round(lookY)));
  const ox = Math.max(-1, Math.min(1, turn));

  // sclera
  const eh = squint ? 2 : 4;
  const ey = squint ? 15 : 14;
  sym(11, ey, 5, eh, C.white);
  // The lid's shadow across the top of the white. An eye with no lid shadow
  // reads as a bulging cartoon eye.
  sym(11, ey, 5, 1, C.skinDk);

  // iris + pupil, riding the gaze
  const ix = 12 + ox;
  const iy = squint ? 15 : 15 + dy;
  sym(ix, iy, 2, 2, C.iris);
  sym(ix, iy + 1, 2, 1, C.irisHi);
  symPx(ix + (ox > 0 ? 1 : 0), iy, C.pupil);
  // The catch-light, entry 18 — warm white, against the cold white of the
  // sclera. On the old face both were entry 22 and this pixel did nothing.
  if (!squint) symPx(ix + (ox > 0 ? 0 : 1), iy, C.glint);

  // lower lid
  sym(11, ey + eh, 5, 1, C.skinHi);

  if (squint) {
    // the heavy upper lid pressing down
    sym(11, 13, 5, 2, C.skinDk);
    sym(11, 14, 5, 1, C.skinLo);
  }
  if (tier === "dying" && !squint) {
    // white showing all the way round — the look of a man who knows
    sym(11, 13, 5, 1, C.white);
  }
}

function paintNose(): void {
  // the bridge, catching the key light down its near edge
  cell(16, 13, 4, 6, C.skin);
  cell(16, 13, 2, 6, C.skinHi);
  cell(16, 14, 1, 4, C.skinBright);
  cell(19, 14, 1, 5, C.skinDk);
  // the ball of it
  cell(16, 18, 4, 2, C.skinHi);
  cell(16, 18, 2, 1, C.skinBright);
  cell(19, 18, 1, 2, C.skinDk);
  // nostril wings, and the shadow underneath
  px(15, 19, C.skinDeep);
  px(20, 19, C.skinLo);
  px(16, 20, C.skinLo);
  px(19, 20, C.skinLo);
  cell(17, 20, 2, 1, C.skinDk);
}

/**
 * The moustache. Split under the nose and swept out past the corners of the
 * mouth, which is the shape that makes the LIP legible — a bar straight across
 * merges with the beard and the mouth disappears into one dark mass.
 */
function paintMoustache(tier: Expr): void {
  const grey = tier === "fresh" || tier === "steady" ? C.hairHi : C.hairWhite;
  sym(12, 21, 6, 2, C.hairDk);
  sym(12, 21, 4, 1, C.hair);
  symPx(12, 22, C.hair); // the ends droop past the corners of the mouth
  symPx(13, 21, grey);
  cell(17, 21, 2, 1, C.skinDeep); // the philtrum split
}

/**
 * The beard — cropped grey STUBBLE hugging the jaw, and no more than that.
 *
 * It took two passes to get here and both failures are worth recording, because
 * the second one is not obvious.
 *
 * A full beard painted in `hairDk` read as a second piece of armour and the
 * mouth vanished into it. The fix for THAT — lighten it, put it on the stone
 * ramp's bright end — produced a white beard that read as CHAINMAIL, because
 * this palette's only two grey ramps (stone 2-5, steel 19-22) are barely a hue
 * apart. A large grey mass next to a steel helm is a grey mass next to a grey
 * mass, whichever end of whichever ramp it sits on.
 *
 * So the beard is small, and it is DARK. Both matter. Small, because grey reads
 * as hair when there is a little of it against a lot of skin — and the third of
 * the portrait it used to occupy goes back to being FACE, which is the whole
 * point of a mugshot that shows damage; you cannot paint a split lip on a beard.
 * Dark, because in a palette this tight the separation has to come from VALUE
 * rather than hue: the helm's steel sits at the bright end of its ramp, so the
 * beard takes the dark end of its own and the two can never be confused, which
 * is precisely what a light grey beard could not manage no matter which of the
 * two grey ramps it was drawn from. The greys survive as strands on top.
 */
function paintBeard(tier: Expr): void {
  const worn = tier !== "fresh" && tier !== "steady";
  const body = worn ? C.hair : C.hairDk;

  // sideburns — a narrow strip in front of the ear, under the cheek guard
  sym(10, 16, 2, 6, body);

  // The jaw line, following the taper: a clean two-cell band, and nothing
  // inboard of it. An earlier pass filled the chin and then broke it up with
  // scattered pixels, which did not read as stubble — it read as noise, and
  // noise at 36px destroys every shape it touches.
  sym(11, 22, 2, 3, body);
  sym(12, 25, 2, 2, body);
  sym(13, 27, 2, 2, body);

  // the chin tuft, a narrow point rather than a full chin
  cell(16, 28, 4, 3, body);
  cell(16, 27, 4, 1, C.hairDk); // where it meets the lower lip

  // Grey strands ON the dark mass. This is where the age reads, and it works
  // only because the mass underneath is dark enough to show them.
  px(10, 18, C.hairHi);
  px(25, 20, C.hairHi);
  px(11, 23, C.hairHi);
  px(24, 23, C.hairHi);
  px(17, 29, C.hairHi);
  px(11, 20, C.hairWhite);
  px(18, 30, C.hairWhite);

  if (!worn) return;
  // Greyer, and creeping further up the cheek, once he has been at it a while.
  px(12, 21, C.hairSilver);
  px(23, 22, C.hairSilver);
  px(13, 26, C.hairHi);
  px(19, 30, C.hairWhite);
}

/**
 * The mouth, in the clear band the moustache and the beard leave at y23-25.
 *
 * Every variant is built the same way: a dark cavity, a bright row of teeth
 * against it, and a lit lower lip below. That three-value stack is what makes
 * a mouth legible at 10 cells wide — a single dark bar reads as a slot.
 */
function paintMouth(mood: Mood): void {
  switch (mood) {
    case "grin": // wide, toothy, delighted
      cell(13, 23, 10, 3, C.mouthDk);
      cell(13, 23, 10, 1, C.teeth);
      cell(14, 25, 8, 1, C.teeth);
      for (let x = 14; x < 23; x += 2) px(x, 23, C.skinLo);
      symPx(12, 23, C.skinHi); // the corners pull back
      symPx(12, 24, C.skinDk);
      break;
    case "smile":
      cell(14, 23, 8, 2, C.mouthDk);
      cell(15, 23, 6, 1, C.teeth);
      cell(14, 25, 8, 1, C.skinHi);
      symPx(13, 23, C.skinHi);
      symPx(13, 22, C.skinDk); // the corners lift
      break;
    case "wince": // gritted, bared teeth, corners hauled down
      cell(13, 23, 10, 3, C.mouthDk);
      cell(13, 23, 10, 1, C.teeth);
      cell(13, 25, 10, 1, C.teeth);
      for (let x = 14; x < 23; x += 2) px(x, 24, C.gum);
      symPx(12, 25, C.skinLo);
      break;
    case "dead": // slack, tongue lolling
      cell(14, 23, 8, 3, C.mouthDk);
      cell(15, 23, 6, 1, C.bloodSh);
      cell(16, 25, 4, 2, C.bloodMid);
      px(17, 26, C.bloodHi);
      break;
    case "dying": // open, gasping
      cell(14, 23, 8, 3, C.mouthDk);
      cell(15, 23, 6, 1, C.gum);
      cell(15, 24, 3, 1, C.teeth);
      px(16, 25, C.blood);
      break;
    case "bloodied":
    case "hurt": // tight and downturned
      cell(14, 24, 8, 1, C.mouthDk);
      cell(14, 23, 8, 1, C.skinDeep);
      cell(15, 25, 6, 1, C.skinHi);
      symPx(13, 23, C.skinDk);
      symPx(13, 25, C.skinLo);
      break;
    default: // steady / fresh — a set jaw, closed hard
      cell(14, 24, 8, 1, C.skinLo);
      cell(15, 23, 6, 1, C.skinDk);
      cell(16, 25, 4, 1, C.skinHi); // just the centre of the lower lip catches
  }
}

/**
 * Battle damage, layered. Each tier ADDS to the one before it, so the face
 * accumulates a history rather than swapping between six pictures — and every
 * wound is built out of the full four-step blood ramp, so it has depth instead
 * of being a flat red decal. (On the old face two of those four steps snapped
 * to the same palette entry, which is exactly why the gore read as a sticker.)
 */
function paintDamage(tier: Expr): void {
  if (tier === "fresh") return;

  // steady — a first cheek scratch.
  cell(11, 20, 4, 1, C.blood);
  px(11, 20, C.bloodSh);
  px(14, 20, C.bloodMid);
  if (tier === "steady") return;

  // hurt — a gash across the far temple that has run down past the eye, and a
  // bruise coming up under it. The gash stays OUTBOARD of the socket: run over
  // the eye it stops reading as a cut and reads as a missing eye, three tiers
  // before he is supposed to look that far gone.
  cell(24, 10, 2, 4, C.blood);
  cell(24, 10, 1, 4, C.bloodSh);
  px(25, 12, C.bloodMid);
  cell(24, 14, 1, 3, C.bloodSh);
  cell(21, 18, 3, 1, C.bloodSh);
  px(22, 18, C.bloodMid);
  if (tier === "hurt") return;

  // bloodied — split lip, a smear down the far cheek, the first sweat.
  cell(14, 26, 3, 1, C.bloodHi);
  cell(13, 27, 2, 1, C.blood);
  cell(21, 19, 3, 2, C.blood);
  cell(22, 20, 2, 1, C.bloodMid);
  px(18, 11, C.sweat);
  px(12, 16, C.bloodSh);
  if (tier === "bloodied") return;

  // dying — over half the face, running, one eye swollen dark.
  cell(11, 10, 5, 1, C.blood);
  cell(12, 11, 2, 4, C.bloodSh);
  px(13, 15, C.bloodMid);
  cell(20, 23, 4, 2, C.bloodHi);
  cell(21, 25, 2, 3, C.blood);
  cell(11, 13, 5, 1, C.bloodSh);
  px(22, 12, C.sweat);
  px(12, 18, C.sweat);
  px(16, 9, C.sweat);
}

/**
 * DEV — every tier and every expression in one image: `__gui.face()`.
 *
 * The mugshot has 6 health tiers × 4 moods × blink × three head turns, and the
 * only way to reach most of those in a live run is to take real damage at a
 * real health value. That is not a way to judge art, and it is the reason the
 * previous face's broken catch-light and flat gore went unnoticed for so long —
 * nobody could see them side by side. Columns are the moods, rows the tiers.
 *
 * This drives the live singleton (the face has exactly one set of state), so it
 * snapshots and restores everything it touches; the HUD keeps its expression
 * across a call.
 */
export function faceContactSheet(): HTMLCanvasElement {
  const c = createFace();
  const saved = { hp, maxHp, painT, healT, specialT, turn, lookX, lookY, blinkFor, lastSig };

  const tiers: Array<[string, number]> = [
    ["fresh", 1],
    ["steady", 0.7],
    ["hurt", 0.5],
    ["bloodied", 0.3],
    ["dying", 0.12],
    ["dead", 0],
  ];
  const moods: Array<[string, () => void]> = [
    ["idle", () => {}],
    ["look ◀", () => (turn = -1)],
    ["look ▶", () => (turn = 1)],
    ["wince", () => (painT = 0.3)],
    ["smile", () => (healT = 0.4)],
    ["grin", () => (specialT = 0.6)],
    ["blink", () => (blinkFor = 0.1)],
  ];

  const PAD = 16;
  const sheet = document.createElement("canvas");
  sheet.width = PAD + moods.length * (PX + PAD);
  sheet.height = PAD * 2 + tiers.length * (PX + PAD);
  const out = sheet.getContext("2d");
  if (!out) return sheet;
  out.imageSmoothingEnabled = false;
  out.fillStyle = C.bg;
  out.fillRect(0, 0, sheet.width, sheet.height);

  out.font = "10px monospace";
  out.fillStyle = C.steelHi;
  moods.forEach(([label], col) => out.fillText(label, PAD + col * (PX + PAD), 12));

  tiers.forEach(([, frac], row) => {
    moods.forEach(([, set], col) => {
      maxHp = 100;
      hp = Math.round(frac * 100);
      painT = healT = specialT = 0;
      turn = 0;
      lookX = lookY = 0;
      blinkFor = 0;
      set();
      paint(); // straight to the painter — renderFace's repaint guard would eat these
      out.drawImage(c, PAD + col * (PX + PAD), PAD * 2 + row * (PX + PAD));
    });
  });

  hp = saved.hp;
  maxHp = saved.maxHp;
  painT = saved.painT;
  healT = saved.healT;
  specialT = saved.specialT;
  turn = saved.turn;
  lookX = saved.lookX;
  lookY = saved.lookY;
  blinkFor = saved.blinkFor;
  lastSig = ""; // force the HUD's next frame to repaint over the sheet's last cell
  paint();
  lastSig = saved.lastSig;
  return sheet;
}

function drawX(gx: number, gy: number): void {
  for (let i = 0; i < 5; i++) {
    px(gx + i, gy + i, C.pupil);
    px(gx + 4 - i, gy + i, C.pupil);
  }
}
