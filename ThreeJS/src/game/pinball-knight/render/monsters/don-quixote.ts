/**
 * DON QUIXOTE — the procedural fallback, and the bestiary portrait.
 *
 * The shipped art is an imported sheet (`public/sprites/don_quixote-S.*`), so
 * in the dungeon this painter draws only what the sheet omits. It is NOT dead
 * code even so: `monster-portrait.ts` paints every roster card from the painter
 * table regardless of whether the kind also has an atlas, so this is the figure
 * on his bestiary entry.
 *
 * Which is why he is ON FOOT here. The first version of this file drew him
 * mounted on a donkey — faithful to the novel, and nothing like the sheet,
 * where he is a paunchy knight in dented plate with a barber's basin helmet, a
 * feather in it, a crimson sash-skirt, and a tournament lance he carries
 * couched. A portrait that disagrees with the sprite teaches the player the
 * wrong silhouette to look for.
 */
import {
  type Ramp,
  CX,
  GROUND,
  ellShaded,
  rrectShaded,
  groundShadow,
} from "../../engine/render/figure";
import type { ActorPaints, Dir, FramePaint } from "../../engine/render/paint-types";

// Ramps, read off the published sheet's own palette.
const R_STEEL: Ramp = [9, 10, 11]; // dented blue-grey plate
const R_BRASS: Ramp = [13, 14, 15]; // the basin helmet and the gilded breastplate
const R_SASH: Ramp = [6, 7, 8]; // crimson skirt of tassets
const R_SKIN: Ramp = [12, 14, 15]; // face, and that nose
const R_HAIR: Ramp = [16, 18, 20]; // moustache, beard, boot leather
const R_WOOD: Ramp = [20, 22, 24]; // the lance shaft
const R_FEATHER: Ramp = [28, 29, 30]; // the pale plume
const R_STARS: Ramp = [27, 28, 29]; // seeing stars, after the wall

interface PoseOpts {
  /** 0 = lance shouldered, 1 = lance couched and level. */
  couch?: number;
  /** Vertical bob, in atlas pixels. */
  bob?: number;
  /** Stride swing for the boots. */
  stride?: number;
  /** Reeling from a crash: stars overhead, lance dropped. */
  dazed?: number;
  dead?: boolean;
}

function donQuixoteFrame(dir: Dir, phase: number, opts: PoseOpts = {}): FramePaint {
  return (ctx) => {
    const { couch = 0, bob = 0, stride = 0, dazed = 0, dead = false } = opts;
    const face = dir === "N" ? -1 : 1; // facing away: no face, and the plume leads

    groundShadow(ctx, CX, GROUND, 17);

    if (dead) {
      // A heap of plate and a lance across it.
      ellShaded(ctx, CX - 2, GROUND - 6, 15, 7, R_STEEL);
      ellShaded(ctx, CX + 9, GROUND - 8, 6, 5, R_BRASS);
      rrectShaded(ctx, CX - 18, GROUND - 4, 34, 3, 1, R_WOOD);
      return;
    }

    const y = GROUND + bob;

    // ── Boots ──
    rrectShaded(ctx, CX - 9 + stride, y - 12, 7, 12, 2, R_HAIR);
    rrectShaded(ctx, CX + 2 - stride, y - 12, 7, 12, 2, R_HAIR);

    // ── Greaves ──
    rrectShaded(ctx, CX - 7 + stride * 0.6, y - 24, 5, 13, 2, R_STEEL);
    rrectShaded(ctx, CX + 2 - stride * 0.6, y - 24, 5, 13, 2, R_STEEL);

    // ── Crimson tassets ──
    rrectShaded(ctx, CX - 12, y - 34, 24, 11, 3, R_SASH);

    // ── Gilded, and frankly generous, breastplate ──
    ellShaded(ctx, CX, y - 45, 13, 12, R_BRASS);
    // Pauldrons.
    ellShaded(ctx, CX - 13, y - 53, 7, 6, R_STEEL);
    ellShaded(ctx, CX + 13, y - 53, 7, 6, R_STEEL);

    // ── Head ──
    const headY = y - 63;
    ellShaded(ctx, CX, headY, 8, 7, R_SKIN);
    if (face > 0 && dir !== "N") {
      // The nose first: it is the read at atlas size.
      ellShaded(ctx, CX + 4, headY + 1, 4, 3, R_SKIN);
      ellShaded(ctx, CX + 1, headY - 2, 2, 2, R_HAIR); // eye
      // Moustache, out past the cheek on both sides.
      rrectShaded(ctx, CX - 6, headY + 3, 14, 3, 1, R_HAIR);
    }
    // Barber's basin helmet: a shallow bowl with a wide brim.
    ellShaded(ctx, CX, headY - 6, 9, 6, R_BRASS);
    rrectShaded(ctx, CX - 11, headY - 4, 22, 3, 1, R_BRASS);
    // The plume.
    rrectShaded(ctx, CX - 2 - face * 3, headY - 16, 3, 11, 1, R_FEATHER);

    // ── Lance, or stars ──
    if (dazed > 0) {
      const a = phase * Math.PI * 4;
      ellShaded(ctx, CX + Math.cos(a) * 11, headY - 14 + Math.sin(a) * 4, 3, 3, R_STARS);
      ellShaded(ctx, CX + Math.cos(a + Math.PI) * 11, headY - 14 + Math.sin(a + Math.PI) * 4, 3, 3, R_STARS);
      rrectShaded(ctx, CX - 16, GROUND - 5, 32, 3, 1, R_WOOD); // dropped
      return;
    }

    if (couch > 0) {
      // Couched: level, forward, and long enough to arrive before he does.
      const lanceY = y - 44;
      const len = 26 + couch * 12;
      ctx.save();
      ctx.translate(CX, lanceY);
      ctx.rotate(face * (1 - couch) * -0.5);
      rrectShaded(ctx, 0, -2, len * face, 4, 1, R_WOOD);
      rrectShaded(ctx, len * face - (face < 0 ? 6 : 0), -3, 6, 6, 1, R_STEEL);
      ctx.restore();
    } else {
      // Shouldered, angled back across the body.
      ctx.save();
      ctx.translate(CX + face * 4, y - 46);
      ctx.rotate(face * -0.9);
      rrectShaded(ctx, -6, -2, 40, 4, 1, R_WOOD);
      rrectShaded(ctx, 34, -3, 6, 6, 1, R_STEEL);
      ctx.restore();
    }
  };
}

export function makeDonQuixotePaints(): ActorPaints {
  const clips = (dir: Dir) => ({
    idle: [
      donQuixoteFrame(dir, 0, { bob: 0 }),
      donQuixoteFrame(dir, 0.25, { bob: -1 }),
      donQuixoteFrame(dir, 0.5, { bob: -2 }),
      donQuixoteFrame(dir, 0.75, { bob: -1 }),
    ],
    walk: [
      donQuixoteFrame(dir, 0, { stride: 4, bob: -1 }),
      donQuixoteFrame(dir, 0.25, { stride: 0, bob: -3 }),
      donQuixoteFrame(dir, 0.5, { stride: -4, bob: -1 }),
      donQuixoteFrame(dir, 0.75, { stride: 0, bob: -3 }),
    ],
    /**
     * LEAPER CROUCH — the held wind-up his movement policy demands, and the
     * one frame the whole fight is read off. He plants, drops his weight, and
     * brings the lance down level: that is the cue to get out of the line.
     * Without it the policy falls through CLIP_FALLBACK to `idle` and the
     * charge arrives with no tell at all.
     */
    crouch: [
      donQuixoteFrame(dir, 0, { couch: 0.55, bob: 1, stride: -2 }),
      donQuixoteFrame(dir, 0.5, { couch: 0.8, bob: 2, stride: -3 }),
    ],
    // The wind-up, then the couched lance: the tell IS the lance coming level.
    attack: [
      donQuixoteFrame(dir, 0, { couch: 0.2, bob: -1 }),
      donQuixoteFrame(dir, 0.33, { couch: 0.7, bob: -2 }),
      donQuixoteFrame(dir, 0.66, { couch: 1, bob: -3, stride: 5 }),
      donQuixoteFrame(dir, 1, { couch: 1, bob: -1, stride: -3 }),
    ],
    /** The wall-crash stun (entities/don-quixote.ts) plays this. */
    stumble: [
      donQuixoteFrame(dir, 0, { dazed: 1 }),
      donQuixoteFrame(dir, 0.5, { dazed: 1 }),
      donQuixoteFrame(dir, 1, { dazed: 1 }),
    ],
    death: [
      donQuixoteFrame(dir, 0, { dazed: 1 }),
      donQuixoteFrame(dir, 0.4, { dazed: 1, bob: 3 }),
      donQuixoteFrame(dir, 0.7, { dead: true }),
      donQuixoteFrame(dir, 1, { dead: true }),
    ],
  });

  return { S: clips("S"), N: clips("N"), E: clips("E") };
}
