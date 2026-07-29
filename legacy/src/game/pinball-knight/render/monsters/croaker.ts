/**
 * CROAKER — a squat spotted frog that hops off walls and fires twin eye-beams.
 *
 * Authored from a reference sheet as a SHAPE SPEC, the method sporeling.ts and
 * jester.ts document: the reference is a four-row sheet (idle / wall-bounce hop /
 * twin laser / hurt-death) in a bright tropical palette, and filtering those
 * pixels would buy one facing, a foreign palette and a foreign lighting model.
 * A painter parameterised by (dir, phase, pose) buys N/S/E, animation and Cold
 * Crypt by construction.
 *
 * ── THE SILHOUETTE IS THE MECHANIC ──────────────────────────────────────────
 * Three things have to be legible, because all three are rules:
 *
 *   1. It is WIDE AND LOW — a dome on folded haunches. Nothing else on the
 *      roster has a horizontal-oval silhouette, and the reason it matters is
 *      the third rule below: this is the shape that goes OVER a knee-high wall,
 *      so it should look like a thing that is mostly legs, coiled.
 *   2. The EYES ARE THE WEAPON. They are oversized, they sit on top of the
 *      dome, and they are the only saturated red on the body — so the charge
 *      (`aim`) reads as the eyes brightening, and the beams leave from exactly
 *      where the player was already looking.
 *   3. The HOP is a stretch. Crouch compresses the dome and folds the legs
 *      under; the airborne pose stretches it along the travel axis with the
 *      legs trailing. Same creature, two extensions — that is what makes a
 *      wall-bounce read as one continuous arc rather than as teleporting.
 *
 * ── PALETTE ─────────────────────────────────────────────────────────────────
 * The reference is emerald + gold spots + cobalt legs + cream belly. Cold Crypt
 * has a rot-green family (6-9) and nothing else green, so the body is rot —
 * which is a hazard, because rot-green is the ZOMBIE colour and the floor paint
 * uses it too (figure.ts's whole bounce-tone argument). Three defences:
 *
 *   · GOLD SPOTS (torch 15-17) tile the dome, the same hue-break trick the
 *     jester's motley uses. A spotted green dome is not a zombie.
 *   · The legs are ARCANE (29-31), the palette's cold accent. Cobalt against
 *     green is the reference's own contrast and it is nearly unused elsewhere,
 *     so the folded haunches read as a separate limb mass instead of merging.
 *   · The belly is BONE (20-22), a hard value break along the bottom edge —
 *     which is also the edge that has to separate from the floor.
 */
import {
  type Pt,
  type Ramp,
  CX,
  GROUND,
  limbShaded,
  ellShaded,
  detail as figDetail,
  glow as figGlow,
  groundShadow,
} from "../../engine/render/figure";
import { paletteCss } from "../palette";
import type { ActorPaints, Dir, FramePaint } from "../../engine/render/paint-types";

// ── MATERIALS ───────────────────────────────────────────────────────────────
/** Body: rot green — the palette's only green family. */
const R_SKIN: Ramp = [7, 8, 9];
/** Spots: torch gold. The hue break that stops it reading as a zombie. */
const R_SPOT: Ramp = [15, 16, 17];
/** Haunches and forelegs: arcane. The reference's cobalt, and a family the
 *  census found almost unspent. */
const R_LEG: Ramp = [29, 30, 31];
/**
 * Belly: the DIM end of bone.
 *
 * At [20,21,22] it was the brightest thing in the frame and covered the whole
 * lower dome, so the creature read as a green hood over a white bib rather than
 * as a frog. It is a chin and a throat, not an apron — small, low, and only a
 * step or two above the skin it sits on.
 */
const R_BELLY: Ramp = [19, 20, 21];
/** Toes. Gold, so the feet pick up the spots rather than inventing a colour. */
const R_TOE: Ramp = [14, 15, 16];

/** Eye iris — blood, the only saturated red on the body. */
const EYE = 12;
/** Eye core when charging / firing, and the beam itself. */
const EYE_HOT = 13;
const BEAM = 13;
const BEAM_CORE = 17;

// ── GEOMETRY (cel units; GROUND = 118, CX = 64) ─────────────────────────────
/** Half-width of the body dome at rest. WIDE — this is the read. */
const BODY_W = 30;
/** Dome half-height at rest. Roughly half the width: a frog is a squashed ball. */
const BODY_H = 20;
/** Dome centre height above GROUND at rest. */
const BODY_Y = GROUND - 20;
/** Eye centre, as a fraction of the dome's half-extent from its centre. */
const EYE_UX = 0.46;
const EYE_UY = -0.62;

/**
 * The gold spot field.
 *
 * Fixed positions in DOME-NORMALISED space (-1..1 on each axis), not random and
 * not regenerated per frame: a spot pattern that moves between frames is the
 * "confetti crawl" artifact, and it is far more obvious on an animated sprite
 * than banding ever was. Normalised so they ride the dome through every squash
 * and stretch without being re-authored per pose.
 */
const SPOTS: Array<[number, number, number]> = [
  [-0.70, -0.20, 4.6],
  [-0.34, -0.52, 4.2],
  [0.02, -0.20, 4.8],
  [0.38, -0.54, 4.0],
  [0.70, -0.16, 4.4],
  [-0.54, 0.22, 4.0],
  [0.52, 0.26, 4.2],
  [0.12, 0.34, 3.4],
];

/** How the body is shaped this frame. One creature, several extensions. */
interface Pose {
  /** -1..1 breathing/gait phase. */
  phase: number;
  /** 1 = resting proportions; <1 crouched (wider, flatter); >1 stretched. */
  stretch?: number;
  /** Lift off the ground, cel px — the airborne poses. */
  air?: number;
  /** 0..1 how far the legs are thrown back behind the body (a leap). */
  trail?: number;
  /** 0..1 eye charge — brightens the iris and adds a halo. */
  charge?: number;
  /** Beam length in cel px, 0 = not firing. */
  beam?: number;
  /** Squashed flat against a wall (the bounce frame). */
  splat?: number;
  dead?: boolean;
  /** Belly-up, X eyes. */
  belly?: boolean;
}

function croakerFrame(dir: Dir, pose: Pose): FramePaint {
  return (ctx) => {
    const narrow = dir === "E" ? 0.92 : 1; // barely — a frog is wide from ANY angle

    if (pose.dead && !pose.belly) {
      // The melted puddle: the last death frame. A low mound of green with the
      // gold spots still in it, so it reads as THIS creature's remains.
      groundShadow(ctx, CX, GROUND + 1, 30);
      ellShaded(ctx, CX, GROUND - 3, 30, 7, R_SKIN);
      for (const [sx, , r] of SPOTS) {
        ellShaded(ctx, CX + sx * 24, GROUND - 5 + Math.abs(sx) * 2, r * 0.8, r * 0.5, R_SPOT, 0, { rim: false });
      }
      for (const s of [-1, 1]) {
        figDetail(ctx, [[CX + s * 26, GROUND - 2], [CX + s * 34, GROUND]], 2.2, 8);
      }
      return;
    }

    const breath = Math.sin(pose.phase * Math.PI) * 1.6;
    const st = pose.stretch ?? 1;
    const air = pose.air ?? 0;
    const trail = pose.trail ?? 0;
    const splat = pose.splat ?? 0;

    // Squash and stretch, conserving area-ish: a stretched frog is longer and
    // thinner, a crouched one is wider and flatter. `splat` overrides for the
    // wall-bounce frame, which compresses along the TRAVEL axis instead.
    const bw = BODY_W * (st >= 1 ? st : 1 / (st * 0.72 + 0.28)) * narrow * (1 - splat * 0.42);
    const bh = (BODY_H + breath) * (st >= 1 ? 1 / st : 1 + (1 - st) * 0.55) * (1 + splat * 0.3);
    const cy = BODY_Y - air + (1 - st) * 6;

    groundShadow(ctx, CX, GROUND + 2, Math.max(9, (bw - air * 0.35) * 0.82));

    // ── back legs: big folded haunches. Drawn BEHIND the body. ──
    for (const s of [-1, 1]) {
      if (dir === "E" && s === -1) continue; // far haunch occluded in profile
      // OUTBOARD. The first cut hung them at 0.58 of the half-width and the
      // shins crossed the belly, so the frog looked like it was clutching
      // something. A frog's haunches are the widest part of it — they belong
      // outside the dome's silhouette, which is also what sells "coiled".
      const hipX = CX + s * bw * 0.82;
      const hipY = cy + bh * 0.34;
      // Folded at rest (knee up beside the body), thrown back when leaping.
      const kneeX = hipX + s * (5 - trail * 4);
      const kneeY = hipY - 11 + trail * 10;
      const footX = hipX + s * (2 - trail * 18);
      const footY = hipY + 14 + trail * 6 + (air > 0 ? 2 : 0);
      limbShaded(ctx, [hipX, hipY], [kneeX, kneeY], 11, R_LEG);
      limbShaded(ctx, [kneeX, kneeY], [footX, footY], 8, R_LEG);
      // three splayed toes
      for (let t = -1; t <= 1; t++) {
        figDetail(
          ctx,
          [[footX, footY], [footX + s * 7 + t * 3, footY + 3 + Math.abs(t) * 1.5]],
          3,
          R_TOE[1],
        );
      }
    }

    // ── the dome ──
    ellShaded(ctx, CX, cy, bw, bh, R_SKIN);
    // Belly: a bone crescent along the lower front. Drawn as an ellipse clipped
    // to the dome's lower half so it never breaks the silhouette.
    ctx.save();
    ctx.beginPath();
    ctx.ellipse(CX, cy, bw, bh, 0, 0, Math.PI * 2);
    ctx.clip();
    ellShaded(ctx, CX, cy + bh * 0.70, bw * 0.46, bh * 0.40, R_BELLY, 0, { bounce: false });
    ctx.restore();
    // Spots, riding the dome in normalised space.
    for (const [ux, uy, r] of SPOTS) {
      if (dir === "E" && ux < -0.5) continue;
      ellShaded(ctx, CX + ux * bw * 0.82, cy + uy * bh * 0.78, r, r * 0.86, R_SPOT, 0, { rim: false });
    }

    // ── front legs: short, propping the chest ──
    for (const s of [-1, 1]) {
      if (dir === "E" && s === -1) continue;
      const shX = CX + s * bw * 0.30;
      const shY = cy + bh * 0.62;
      const paw: Pt = [shX + s * (3 - trail * 12), GROUND - 2 - air + trail * 4];
      limbShaded(ctx, [shX, shY], paw, 6.5, R_LEG);
      for (let t = -1; t <= 1; t++) {
        figDetail(ctx, [[paw[0], paw[1]], [paw[0] + t * 3.5 + s * 2, paw[1] + 3]], 2.4, R_TOE[1]);
      }
    }

    // ── the eyes: oversized, on TOP of the dome, and the weapon ──
    const ch = pose.charge ?? 0;
    const eyes: Array<[number, number]> =
      dir === "E"
        ? [[CX + bw * (EYE_UX + 0.12), cy + bh * EYE_UY]]
        : [
            [CX - bw * EYE_UX, cy + bh * EYE_UY],
            [CX + bw * EYE_UX, cy + bh * EYE_UY],
          ];
    for (const [ex, ey] of eyes) {
      const er = 8.5 + ch * 1.2;
      // The socket bulges ABOVE the dome line — that overhang is what makes a
      // frog read as a frog rather than as a spotted rock.
      ellShaded(ctx, ex, ey, er, er * 0.95, R_SKIN);
      if (pose.belly) {
        // X eyes
        for (const d of [-1, 1]) {
          figDetail(ctx, [[ex - 4, ey - 4 * d], [ex + 4, ey + 4 * d]], 2, 1);
        }
        continue;
      }
      ellShaded(ctx, ex, ey, er * 0.72, er * 0.72, [10, EYE, EYE_HOT] as Ramp, 0, { rim: false });
      // Charging brightens the iris and blooms a halo; at rest it is a plain
      // red eye with the classic single specular dot.
      if (ch > 0) figGlow(ctx, ex, ey, er * (0.34 + ch * 0.3), EYE_HOT, BEAM_CORE);
      ellShaded(ctx, ex - er * 0.28, ey - er * 0.3, er * 0.2, er * 0.2, [22, 22, 22] as Ramp, 0, { rim: false });
    }

    // ── the beams ──
    // Drawn last and unshaded (layer 3 of the cel convention). Twin, from the
    // eyes, CONVERGING slightly — the reference's beams cross down and forward,
    // which is what puts the impact in front of the creature where the player
    // can read it, rather than off the edge of the cel.
    const beam = pose.beam ?? 0;
    if (beam > 0) {
      // ONE convergence point, on the floor IN FRONT of the creature — not a
      // direction per eye. The first cut aimed each beam inward-and-down by a
      // fraction of the eye offset and both beams terminated ON the frog's own
      // belly: it read as shooting itself. Naming the target explicitly also
      // puts the impact where the player is already looking, which is the whole
      // reason the beams converge in the reference.
      ctx.lineCap = "round";
      for (const [ex, ey] of eyes) {
        // Target per eye, not one shared point.
        //
        // Converging on a single spot is right in PROFILE and wrong head-on:
        // from the front, the place two eye-beams would meet is behind the
        // creature's own chin, so both strokes crossed the belly in an X and
        // the frog read as shooting itself. Head-on they SPLAY instead — down
        // and outward, landing either side of the feet — which is the same
        // pair of beams seen from the other axis, and it keeps the body clear.
        const tgt: Pt = dir === "E"
          ? [CX + bw * 0.6 + beam, GROUND - 2]
          : [ex + (ex - CX) * 0.55, GROUND + 2];
        // Reach scales with `beam` so the shot GROWS out of the eye across the
        // clip instead of appearing at full length.
        const k = Math.min(1, beam / 44);
        const ax = ex + (tgt[0] - ex) * k;
        const ay = ey + (tgt[1] - ey) * k;
        ctx.beginPath();
        ctx.moveTo(ex, ey);
        ctx.lineTo(ax, ay);
        ctx.lineWidth = 5;
        ctx.strokeStyle = paletteCss(BEAM);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(ex, ey);
        ctx.lineTo(ax, ay);
        ctx.lineWidth = 2;
        ctx.strokeStyle = paletteCss(BEAM_CORE);
        ctx.stroke();
        for (let i = 0; i < 3; i++) {
          const a = -0.7 + i * 0.7;
          figDetail(
            ctx,
            [[ax, ay], [ax + Math.cos(a) * 9, ay + Math.sin(a) * 7]],
            1.8,
            i === 1 ? BEAM_CORE : BEAM,
          );
        }
      }
    }

    // ── wall-bounce impact starburst ──
    if (splat > 0) {
      const s = dir === "E" ? 1 : 1;
      for (let i = 0; i < 7; i++) {
        const a = (i / 7) * Math.PI - Math.PI / 2;
        const bx = CX + s * bw;
        figDetail(
          ctx,
          [[bx, cy], [bx + s * (10 + Math.cos(a) * 6), cy + Math.sin(a) * 14]],
          2.2,
          i % 2 ? BEAM_CORE : R_SPOT[2],
        );
      }
    }

    // ── dazed stars (hurt) ──
    if (pose.belly) {
      for (let i = 0; i < 3; i++) {
        const a = -0.9 + i * 0.9;
        figGlow(ctx, CX + Math.cos(a) * 26, cy - bh - 8 + Math.sin(a) * 5, 3, BEAM_CORE, 17);
      }
    }
  };
}

/**
 * THE LASER: charge, fire, sustain, cut.
 *
 * Four beats, and the first one is the whole point — the eyes brighten for a
 * beat BEFORE anything leaves them. A hitscan-feeling weapon with no wind-up is
 * indistinguishable from being damaged at random, so the charge frame is the
 * mechanic and the beam is the consequence.
 */
function croakerLaser(dir: Dir, beat: 0 | 1 | 2 | 3): FramePaint {
  const charge: Array<Pose> = [
    { phase: -0.2, charge: 0.45, stretch: 0.94 },
    { phase: 0, charge: 1, beam: 30, stretch: 0.97 },
    { phase: 0.1, charge: 1, beam: 46 },
    { phase: 0.2, charge: 0.5, beam: 0 },
  ];
  return croakerFrame(dir, charge[beat]);
}

export function makeCroakerPaints(): ActorPaints {
  const dc = (dir: Dir) => ({
    idle: [
      croakerFrame(dir, { phase: -0.2 }),
      croakerFrame(dir, { phase: 0.25 }),
      croakerFrame(dir, { phase: 0.05 }),
    ],
    // The "walk" is a HOP CYCLE — a frog has no walk, and giving it one would
    // be the single fastest way to make the leap mechanic look like a bug.
    walk: [
      croakerFrame(dir, { phase: 0.6, stretch: 0.78 }),
      croakerFrame(dir, { phase: -0.4, stretch: 1.22, air: 9, trail: 0.7 }),
      croakerFrame(dir, { phase: -0.2, stretch: 1.1, air: 5, trail: 0.35 }),
      croakerFrame(dir, { phase: 0.3, stretch: 0.86, air: 0 }),
    ],
    attack: [croakerLaser(dir, 0), croakerLaser(dir, 1), croakerLaser(dir, 2), croakerLaser(dir, 3)],
    // CROUCH is the leaper tell (render/tell-clips.ts vocabulary): gathered,
    // flattened, held. It must not look like the hop's own crouch frame, so it
    // goes lower and does not move.
    crouch: [
      croakerFrame(dir, { phase: 0.1, stretch: 0.7 }),
      croakerFrame(dir, { phase: -0.1, stretch: 0.66 }),
    ],
    // The airborne pose, for the locked leap.
    run: [
      croakerFrame(dir, { phase: -0.3, stretch: 1.3, air: 14, trail: 1 }),
      croakerFrame(dir, { phase: -0.1, stretch: 1.24, air: 11, trail: 0.85 }),
    ],
    // The WALL BOUNCE — squashed against the masonry with an impact burst. Its
    // own clip so the ricochet is a visible event and not a silent direction
    // change; `stumble` is the slot the recoil system already plays on impact.
    stumble: [
      croakerFrame(dir, { phase: 0, stretch: 1.15, air: 10, trail: 0.6, splat: 1 }),
      croakerFrame(dir, { phase: 0.2, stretch: 1.05, air: 7, trail: 0.3, splat: 0.4 }),
    ],
    death: [
      croakerFrame(dir, { phase: 0.4, stretch: 0.8, belly: true }),
      croakerFrame(dir, { phase: 0, stretch: 0.72, belly: true }),
      croakerFrame(dir, { phase: 0, dead: true }),
      croakerFrame(dir, { phase: 0, dead: true }),
    ],
  });
  return { S: dc("S"), N: dc("N"), E: dc("E") };
}
