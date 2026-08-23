/**
 * SPORELING — a fungal shambler: a heavy spotted cap over a squat fibrous body,
 * a mossy skirt, two stubby feet, and a pair of ember eyes under the cap brim.
 *
 * Built from a reference sheet as a SHAPE SPEC, not as pixels. The reference was
 * a 12-frame single-facing sheet in a warm palette on a baked-in checkerboard;
 * importing it directly would have given us one direction, a foreign palette and
 * a foreign lighting model. So the creature is re-authored the way every other
 * monster here is authored — as a painter parameterised by (dir, phase) — which
 * buys N/S/E, phase-driven animation and the Cold Crypt palette for free.
 *
 * ── THE PALETTE PROBLEM THIS FILE SOLVES ────────────────────────────────────
 * The reference is red-cap/cream-spot/olive-skirt. Cold Crypt has no red-cream
 * pair: mapping cap→blood(10-13) and spots→torch-light(17-18) is the closest
 * honest read, and it keeps the creature's ONE memorable feature — a spotted
 * dome — legible at the 72px grid.
 *
 * The body is the hazard. A pale fibrous stalk is near-value with stone floor
 * (4-5), which is exactly the "readable cluster vs mush" failure figure.ts was
 * built to prevent. So the stalk uses R_BONE (20-22) and leans on its ramp's
 * bounce, and the skirt below it is rot-green — a hard value AND hue break
 * across the middle of the silhouette, so the figure never merges into the
 * floor even when standing still on flowstone.
 */
import {
  type Pt,
  type Ramp,
  CX,
  GROUND,
  R_BONE,
  R_BLOOD,
  limbShaded,
  ellShaded,
  plateShaded,
  detail as figDetail,
  glow as figGlow,
  groundShadow,
} from "../../engine/render/figure";
import type { ActorPaints, Dir, FramePaint } from "../../engine/render/paint-types";

/** Cap: blood ramp — the palette's only red family. */
const R_CAP: Ramp = [10, 11, 12];
/** Stalk: bone, so the body reads light without going stone-grey. */
const R_STALK: Ramp = R_BONE;
/** Skirt/moss: rot green, the mid-silhouette value break. */
const R_MOSS: Ramp = [6, 7, 8];

/** Cap spot colour — torch light, so the dome stays legible after the snap. */
const SPOT = 17;
/** Ember eye core / halo. */
const EYE_CORE = 18;
const EYE_HOT = 16;

/**
 * One sporeling frame.
 *
 * @param dir   facing — N hides the face, E is drawn narrow and offset
 * @param phase -1..1 gait phase; drives cap sway, body bob and leg swing
 * @param dead  splatted death pose
 */
function sporelingFrame(dir: Dir, phase: number, dead = false): FramePaint {
  return (ctx) => {
    if (dead) {
      groundShadow(ctx, CX, GROUND + 2, 22);
      // Cap collapsed flat, stalk burst under it.
      ellShaded(ctx, CX, GROUND - 5, 24, 7, R_CAP);
      ellShaded(ctx, CX - 2, GROUND - 3, 10, 4, R_STALK);
      for (const s of [-1, 1]) {
        figDetail(ctx, [[CX + s * 8, GROUND - 8], [CX + s * 17, GROUND - 3]], 2, SPOT);
      }
      // spore puff
      figDetail(ctx, [[CX - 12, GROUND - 12], [CX - 16, GROUND - 18]], 1.4, 8);
      figDetail(ctx, [[CX + 11, GROUND - 13], [CX + 16, GROUND - 19]], 1.4, 8);
      return;
    }

    const bob = Math.sin(phase * Math.PI) * 2.5;
    const sway = phase * 3;
    const narrow = dir === "E" ? 0.86 : 1; // side view is thinner
    // Body sits LOW and heavy; the cap owns the top ~45% of the figure, which is
    // the proportion that makes the reference read as a mushroom rather than as
    // a person wearing a hat.
    const cy = GROUND - 27 + bob; // stalk centre
    const capY = cy - 21 + bob * 0.4;

    groundShadow(ctx, CX, GROUND + 2, 22 * narrow);

    // ── legs: stubby, swinging in antiphase ──
    for (const s of [-1, 1]) {
      const swing = phase * 4 * s;
      const hip: Pt = [CX + s * 6 * narrow, GROUND - 11];
      const foot: Pt = [CX + s * 7 * narrow + swing, GROUND - 1];
      limbShaded(ctx, hip, foot, 5.5, [26, 27, 28] as Ramp);
      // hoof-ish foot pad, leather-dark so it anchors on the floor
      ellShaded(ctx, foot[0], GROUND - 2, 5, 3.5, [26, 27, 28] as Ramp);
    }

    // ── stalk: squat and barrel-shaped, wider at the base ──
    ellShaded(ctx, CX, cy, 14 * narrow, 18, R_STALK);
    // A FEW soft fibres. The first pass drew five hard striations and the body
    // read as a pleated paper bag; the reference's fibres are a hint, not a rib
    // cage. Two off-centre strokes in the adjacent ramp tone is enough texture
    // to survive the crush without becoming the shape.
    for (const i of dir === "E" ? [0.4] : [-0.5, 0.5]) {
      figDetail(
        ctx,
        [[CX + i * 7 * narrow, cy - 8], [CX + i * 7 * narrow + sway * 0.15, cy + 8]],
        1.1,
        20,
      );
    }

    // ── mossy skirt: a deep ragged hem, the mid-figure value break ──
    const hemY = cy + 8;
    plateShaded(
      ctx,
      [
        [CX - 16 * narrow, hemY - 1],
        [CX + 16 * narrow, hemY - 1],
        [CX + 13 * narrow, hemY + 13],
        [CX + 7 * narrow, hemY + 7],
        [CX + 1 * narrow, hemY + 14],
        [CX - 6 * narrow, hemY + 8],
        [CX - 12 * narrow, hemY + 13],
      ],
      R_MOSS,
    );

    // ── arms: short, hanging, swinging opposite the legs ──
    for (const s of [-1, 1]) {
      if (dir === "E" && s === -1) continue; // far arm occluded in profile
      const sh: Pt = [CX + s * 13 * narrow, cy - 4];
      const hand: Pt = [CX + s * 17 * narrow - phase * 3 * s, cy + 8];
      limbShaded(ctx, sh, hand, 4.5, R_STALK);
      // three clawed fingers
      for (let f = -1; f <= 1; f++) {
        figDetail(ctx, [[hand[0], hand[1]], [hand[0] + f * 2.5 + s * 1.5, hand[1] + 4]], 1.2, 20);
      }
    }

    // ── cap: the silhouette. A tall BELL, not a plate. ──
    // Height 22 against half-width 29 is the whole difference between "mushroom"
    // and "dinner plate on a stick" — the first pass used 13 and the creature
    // lost its most recognisable feature.
    const capW = 26 * narrow;
    const capX = CX + sway * 0.5;
    ellShaded(ctx, capX, capY, capW, 19, R_CAP);
    // Flatten the dome's underside by overpainting the bottom third, so the cap
    // is a bell with a real brim rather than a full ellipse.
    ellShaded(ctx, capX, capY + 13, capW * 0.99, 6, R_CAP);
    // brim underside — dark gill band, separates cap from stalk
    ellShaded(ctx, capX, capY + 16.5, capW * 0.9, 4, [10, 10, 11] as Ramp);
    // gill striations under the brim
    for (let i = -3; i <= 3; i++) {
      if (dir === "E" && i < -1) continue;
      figDetail(
        ctx,
        [[capX + i * 6 * narrow, capY + 15], [capX + i * 6 * narrow, capY + 18.5]],
        1.1,
        10,
      );
    }
    // spots — staggered across the dome so it reads curved, not as a flat disc
    const spots: Array<[number, number, number]> = [
      [-0.6, -0.3, 4.0],
      [-0.18, -0.62, 3.6],
      [0.24, -0.55, 3.8],
      [0.62, -0.22, 3.9],
      [-0.42, 0.18, 3.2],
      [0.4, 0.22, 3.3],
    ];
    for (const [sx, sy, r] of spots) {
      if (dir === "E" && sx < -0.45) continue;
      ellShaded(ctx, capX + sx * capW * 0.84, capY + sy * 13, r, r * 0.85, [SPOT, SPOT, 18] as Ramp);
    }

    // ── eyes: two embers in the shadow under the brim ──
    // Drawn LAST and unshaded (layer 3 of the cel convention). These are the
    // creature's focal point — the first pass buried them under the brim shadow
    // and the face vanished, so they now sit just below the gill band with a
    // dark socket behind them for contrast.
    if (dir !== "N") {
      const ex = dir === "E" ? capX + 6 : capX;
      const eyeY = capY + 22;
      const gap = dir === "E" ? 6 : 9;
      for (const s of dir === "E" ? [1] : [-1, 1]) {
        // Socket: a dark pocket so the ember never sits on mid-value stalk.
        // WIDE and SHALLOW — a round socket read as a goggle and made the
        // creature look startled rather than dangerous.
        ellShaded(ctx, ex + s * gap, eyeY, 6, 3.2, [0, 0, 1] as Ramp);
        // The ember itself is a narrow slit, angled inward into a scowl.
        ctx.save();
        ctx.translate(ex + s * gap, eyeY);
        ctx.rotate(s * 0.22);
        ellShaded(ctx, 0, 0, 4.4, 1.9, [EYE_HOT, EYE_CORE, 18] as Ramp);
        ctx.restore();
        figGlow(ctx, ex + s * gap, eyeY, 2.6, EYE_CORE, EYE_HOT);
      }
    }
  };
}

/** Attack: a lunging swipe — cap tips forward, one arm thrown wide. */
function sporelingAttack(dir: Dir, t: number): FramePaint {
  return (ctx) => {
    sporelingFrame(dir, 0.5 + t * 0.4)(ctx);
    if (dir === "N") return;
    const s = dir === "E" ? 1 : 1;
    const y = GROUND - 30;
    // motion arc, drawn unshaded on top (layer 3 of the cel convention)
    ctx.beginPath();
    ctx.arc(CX + s * 10, y + 6, 20 + t * 6, -0.7, 0.8);
    ctx.lineWidth = 2;
    ctx.strokeStyle = `rgba(143,196,107,${0.75 - t * 0.35})`;
    ctx.stroke();
    // flung spores
    for (let i = 0; i < 3; i++) {
      const a = -0.5 + i * 0.5;
      figDetail(
        ctx,
        [
          [CX + s * (22 + t * 8) + Math.cos(a) * 4, y + Math.sin(a) * 10],
          [CX + s * (28 + t * 10) + Math.cos(a) * 6, y + Math.sin(a) * 13],
        ],
        1.6,
        9,
      );
    }
  };
}

export function makeSporelingPaints(): ActorPaints {
  const dc = (dir: Dir) => ({
    idle: [sporelingFrame(dir, -0.12), sporelingFrame(dir, 0.18)],
    walk: [
      sporelingFrame(dir, -0.85),
      sporelingFrame(dir, 0.1),
      sporelingFrame(dir, 0.85),
      sporelingFrame(dir, 0.1),
    ],
    attack: [sporelingAttack(dir, 0), sporelingAttack(dir, 0.5), sporelingAttack(dir, 1)],
    death: [
      sporelingFrame(dir, 0.9),
      sporelingFrame(dir, 0, true),
      sporelingFrame(dir, 0, true),
      sporelingFrame(dir, 0, true),
    ],
  });
  return { S: dc("S"), N: dc("N"), E: dc("E") };
}
