/**
 * HOUND — a lean four-legged charger: long low body, deep chest, a jutting
 * muzzle, pricked ears and a raised hackle ridge down the spine.
 *
 * ── WHY THIS FILE EXISTS ────────────────────────────────────────────────────
 * The hound shipped as a RED-TINTED SPIDER (`EXPANSION_SKIN.hound` →
 * `sheetFor("spider")`, tint 0xc23a2a). That is a legible placeholder for a
 * roster you are still designing and a bad lie for one you are playing: a
 * player told to watch for a charging hound was watching a spider change
 * colour, and the eight-legged silhouette says "skitters at you" while the
 * MECHANIC says "locks a line and dashes down it".
 *
 * ── THE SILHOUETTE IS THE MECHANIC ──────────────────────────────────────────
 * The hound's whole identity is HOUND_CHARGE_*: it stops, telegraphs for 0.45s,
 * then covers 5.5 tiles at 10 tiles/s in a straight line. So the body is drawn
 * along that line — a HORIZONTAL creature, longest on its charge axis, where
 * every other monster here is vertical. At the 128px cel that length is the
 * read: even crushed to the pixel grid you can tell which way a hound is
 * pointing, which is the one thing you need to know to dodge it.
 *
 * Two poses carry the mechanic:
 *   · CROUCH (`attack`) — haunches gathered, chest low, head dropped in line
 *     with the spine. This is the 0.45s tell, and it must not look like the
 *     walk. It shares the crouch vocabulary with MOVE_TELL.leap (see
 *     render/tell-clips.ts) deliberately.
 *   · EXTENSION (`run`) — legs thrown fore-and-aft, body stretched. The dash.
 *
 * ── PALETTE ─────────────────────────────────────────────────────────────────
 * Cold Crypt has no brown-dog family that would not read as the leather props
 * (26-28) or as a zombie's skin (23-25). So the hound is a STONE-DARK beast
 * (2-4) — a grey wolfhound — with a BLOOD hackle ridge and muzzle (10-13) and
 * torch-ember eyes (16-18). That keeps the red the tinted placeholder used as
 * the creature's accent rather than its whole body, so the roster still reads
 * "the red fast one" while stopping it from being a recoloured spider.
 *
 * Stone-on-stone is the hazard flagged in figure.ts: a grey animal on a grey
 * floor is the "readable cluster vs mush" failure. The defence is the ridge —
 * a hard hue AND value break running the length of the spine, exactly where
 * the eye looks to find the charge axis — plus a full-length ground shadow.
 */
import {
  type Pt,
  type Ramp,
  CX,
  GROUND,
  limbShaded,
  ellShaded,
  plateShaded,
  detail as figDetail,
  glow as figGlow,
  groundShadow,
} from "../../engine/render/figure";
import type { ActorPaints, Dir, FramePaint } from "../../engine/render/paint-types";

/** Pelt: stone, so the beast reads as a grey wolfhound rather than as leather. */
const R_PELT: Ramp = [2, 3, 4];
/** Belly / underside: one step darker, so the body has a lit top edge. */
const R_UNDER: Ramp = [1, 2, 3];
/** Hackle ridge + muzzle: blood — the accent that keeps "the red fast one". */
const R_HACKLE: Ramp = [10, 11, 12];
/** Paws: leather-dark, so the feet anchor on the floor like the sporeling's. */
const R_PAW: Ramp = [26, 27, 28];

/** Ember eye core / halo — the same pair the sporeling uses, so the roster's
 *  eyes are one vocabulary rather than a per-monster decision. */
const EYE_CORE = 18;
const EYE_HOT = 16;
/** Bared teeth. Bone would tie it to the skeletal families; steel highlight
 *  stays cold and reads as a wet fang at this size. */
const TOOTH = 22;

/** Body geometry, in cel units. Pulled out because the crouch and the dash are
 *  the SAME animal at different extensions — sharing the numbers is what stops
 *  the two poses drifting into two different creatures. */
const BODY_LEN = 30; // half-length of the trunk along the charge axis
const BODY_Y = GROUND - 30; // spine height at rest

/**
 * ONE JOINTED LEG.
 *
 * The first pass drew each leg as a single straight limb from hip to paw, and
 * at rest the four of them read as evenly-spaced posts — the animal looked like
 * a table. A dog's leg has a hard mid-joint and the two segments swing at
 * DIFFERENT rates, so the shape changes across the gait instead of just
 * translating sideways. That change is the walk.
 *
 * The hind leg's joint (hock) bends BACKWARD and the fore leg's (wrist) bends
 * forward; getting that opposition right is most of what separates "dog" from
 * "four sticks", so the caller passes `hind`.
 *
 * @param sw    -1/1 — which way this leg's swing runs, so pairs alternate
 * @param lift  the paw rises off the floor at the top of its swing
 */
function drawLeg(
  ctx: CanvasRenderingContext2D,
  hipX: number,
  hipY: number,
  phase: number,
  sw: number,
  hind: boolean,
  w: number,
  upper: Ramp,
  lower: Ramp,
  crouch: number,
  extend: number,
): void {
  const swing = phase * (hind ? 9 : 7.5) * sw * (1 + extend * 1.3);
  const gather = crouch * 6 * sw;
  // The paw leaves the ground on the forward half of its swing.
  const lift = Math.max(0, Math.sin(phase * Math.PI) * sw) * (4 + extend * 5);
  const hip: Pt = [hipX, hipY - crouch * 2];
  const paw: Pt = [hipX + swing - gather, GROUND - 2 - lift];
  // Joint sits about 55% down, kicked back (hock) or forward (wrist).
  const jx = hip[0] + (paw[0] - hip[0]) * 0.45 + (hind ? -5 : 4) - crouch * (hind ? 4 : -2);
  const jy = hip[1] + (paw[1] - hip[1]) * 0.55;
  limbShaded(ctx, hip, [jx, jy], w, upper);
  limbShaded(ctx, [jx, jy], paw, w * 0.72, lower);
  // Paw pad — leather-dark, so the foot lands on the floor rather than fading
  // into it. Squashes as it takes weight, so a planted paw reads as planted.
  ellShaded(ctx, paw[0], paw[1], 4.6, lift > 1 ? 2.2 : 3, R_PAW);
}

/**
 * One hound frame.
 *
 * @param dir    facing — E is the true profile (the charge read); S/N are the
 *               three-quarter views, drawn foreshortened
 * @param phase  -1..1 gait phase; drives leg swing, body bob and tail sway
 * @param opts   pose modifiers: `crouch` gathers for the dash, `extend`
 *               stretches into it, `dead` collapses the frame
 */
function houndFrame(
  dir: Dir,
  phase: number,
  opts: { crouch?: number; extend?: number; dead?: boolean } = {},
): FramePaint {
  return (ctx) => {
    const { crouch = 0, extend = 0, dead = false } = opts;

    if (dead) {
      groundShadow(ctx, CX, GROUND + 2, 26);
      // Collapsed on its side: the trunk flattened, legs folded up under it.
      ellShaded(ctx, CX, GROUND - 7, 27, 8, R_PELT);
      ellShaded(ctx, CX + 16, GROUND - 6, 11, 6, R_PELT); // head down
      figDetail(ctx, [[CX + 22, GROUND - 8], [CX + 30, GROUND - 5]], 2.4, 11); // muzzle
      for (const s of [-1, 1]) {
        // legs splayed, no longer bearing weight
        figDetail(ctx, [[CX + s * 8, GROUND - 5], [CX + s * 16, GROUND - 1]], 3.2, 3);
      }
      // The ridge survives as the last identifying mark.
      figDetail(ctx, [[CX - 18, GROUND - 12], [CX + 8, GROUND - 13]], 2.2, 11);
      return;
    }

    // FORESHORTENING: E is the full-length profile; S/N are three-quarter, so
    // the trunk compresses along the view axis while the chest stays wide. This
    // is what stops the head-on views reading as a different, stubbier animal.
    const long = dir === "E" ? 1 : 0.52;
    // The charge poses ride LOW — a gathered hound drops its chest to the floor.
    const drop = crouch * 7;
    const bob = Math.sin(phase * Math.PI) * (1.6 - crouch) + drop;
    const spineY = BODY_Y + bob;
    // Extension stretches the animal along its axis without moving the feet
    // apart, which is what makes the dash frame read as speed.
    const len = BODY_LEN * long * (1 + extend * 0.22);

    groundShadow(ctx, CX, GROUND + 2, (26 + extend * 6) * (dir === "E" ? 1 : 0.72));

    // ── FAR-SIDE LEGS ─────────────────────────────────────────────────────
    // Drawn first, one ramp darker, so the near legs read in front of them.
    // In profile a quadruped shows all four; head-on the far pair is hidden.
    // The far pair runs at the OPPOSITE gait phase — that is what makes a trot
    // read as a trot rather than as a pantomime horse.
    if (dir === "E") {
      for (const [hx, sw, hind] of [
        [-len * 0.55, -1, 1],
        [len * 0.5, 1, 0],
      ] as Array<[number, number, number]>) {
        drawLeg(ctx, CX + hx - 3, spineY + 6, -phase, sw, hind === 1, 3.4, R_UNDER, R_UNDER, crouch, extend);
      }
    }

    // ── TAIL ──────────────────────────────────────────────────────────────
    // Low and trailing; it sweeps opposite the gait, and a gathered hound tucks
    // it. Drawn before the trunk so it emerges from behind the haunch.
    {
      const tailBase: Pt = [CX - len * 0.92, spineY + 1];
      const sway = phase * 6 - crouch * 5;
      const tip: Pt = [CX - len * 1.5 - extend * 6, spineY + 6 + sway + crouch * 8];
      limbShaded(ctx, tailBase, tip, 3.4 - crouch, R_PELT);
      figDetail(ctx, [tailBase, tip], 1.3, 4);
    }

    // ── HAUNCH ────────────────────────────────────────────────────────────
    // The rear mass. A charger's power is behind it, so the haunch is the
    // widest part of the body and sits higher than the chest at rest.
    ellShaded(ctx, CX - len * 0.58, spineY - 1 - crouch * 2, 15 * long + 3, 13 - crouch, R_PELT);

    // ── TRUNK ─────────────────────────────────────────────────────────────
    // A long barrel with a deep chest at the front. Two overlapping ellipses
    // rather than one, so the back line dips behind the shoulder the way a
    // running dog's does.
    ellShaded(ctx, CX - len * 0.1, spineY + 1, len * 0.72, 11 - crouch, R_PELT);
    ellShaded(ctx, CX + len * 0.42, spineY + 2, 13 * long + 2, 12 - crouch * 0.5, R_PELT);
    // Belly shadow — the lit-top/dark-underside split that gives the body volume.
    ellShaded(ctx, CX - len * 0.05, spineY + 8, len * 0.66, 4.5, R_UNDER);

    // ── HACKLE RIDGE ──────────────────────────────────────────────────────
    // THE identifying mark, and the anti-mush defence: a blood-coloured saw
    // running the spine. It RAISES with the crouch — a hound about to charge
    // bristles, so the tell is visible even in silhouette.
    //
    // Drawn as SEPARATE SPIKES, not as one filled polygon. The first pass built
    // a single plate through alternating high/low points, and at the 72px cel
    // the notches closed up and it read as a flat red slab laid on the back —
    // the shape said "saddle", not "bristling". Individual tapered quills keep
    // gaps of background between them, and a gap is what the eye reads as a
    // spike. Fewer, bigger spikes survive the crush; five is enough.
    {
      const raise = 4 + crouch * 6;
      const n = dir === "E" ? 5 : 3;
      const x0 = CX - len * 0.8;
      const span = len * 1.4;
      for (let i = 0; i <= n; i++) {
        const t = i / n;
        const bx = x0 + t * span;
        // Tallest over the shoulders, tapering to the hips and the neck, so the
        // ridge has a profile instead of being a constant-height comb.
        const h = raise * (0.55 + Math.sin(t * Math.PI) * 0.75);
        const lean = 2 + crouch * 2; // quills rake backward
        plateShaded(
          ctx,
          [
            [bx - 3.2, spineY - 7],
            [bx - lean, spineY - 7 - h],
            [bx + 3.2, spineY - 7],
          ],
          R_HACKLE,
        );
      }
      // A thin dark seam along the spine base ties the quills into one ridge
      // rather than leaving them as loose triangles floating on the back.
      figDetail(ctx, [[x0 - 2, spineY - 7], [x0 + span + 2, spineY - 7]], 2.2, 10);
    }

    // ── NEAR-SIDE LEGS ────────────────────────────────────────────────────
    // Fore and hind, swinging in antiphase. `extend` throws them apart into the
    // classic stretched gallop; `crouch` folds them under the body instead.
    {
      const pairs: Array<[number, number, boolean]> = dir === "E"
        ? [[-len * 0.5, -1, true], [len * 0.46, 1, false]]
        : [[-9, -1, true], [9, 1, false]];
      for (const [hx, sw, hind] of pairs) {
        drawLeg(ctx, CX + hx, spineY + 5, phase, sw, hind, 4.2, R_PELT, R_PELT, crouch, extend);
      }
    }

    // ── NECK + HEAD ───────────────────────────────────────────────────────
    // The head leads the charge: it drops IN LINE with the spine as the hound
    // gathers, which is the pose that says "this is aimed at you".
    {
      const hx = CX + len * (dir === "E" ? 0.92 : 0.5);
      const hy = spineY - 6 + crouch * 7 + extend * 2;
      // neck
      limbShaded(ctx, [CX + len * 0.45, spineY - 2], [hx, hy + 2], 8 - crouch, R_PELT);
      // skull — a wedge, longer than it is tall
      ellShaded(ctx, hx, hy, 11 * (dir === "E" ? 1 : 0.8), 8, R_PELT);

      // ── EARS: pricked, and they PIN BACK on the charge ──
      // A relaxed hound's ears stand up; a committed one flattens them. Free
      // extra signal on the tell, at two triangles' cost.
      for (const s of dir === "E" ? [1] : [-1, 1]) {
        const pin = crouch * 0.9;
        const ex = hx - 4 + s * (dir === "E" ? 0 : 5);
        const back = pin * 7;
        plateShaded(
          ctx,
          [
            [ex - back, hy - 6],
            [ex - 3 - back * 1.4, hy - 15 + pin * 7],
            [ex + 3.5 - back, hy - 7],
          ],
          R_PELT,
        );
      }

      // ── MUZZLE: the long jutting snout, in blood so the face carries the
      //    accent colour and the head never merges with the stone body. ──
      const mz = dir === "E" ? 1 : 0.55;
      const snoutX = hx + 10 * mz;
      ellShaded(ctx, snoutX, hy + 3, 9 * mz, 4.5, R_HACKLE);
      // A gape that opens with the attack: the jaw drops as it commits.
      const gape = 2 + crouch * 3 + extend * 2;
      if (dir !== "N") {
        ellShaded(ctx, snoutX + 1 * mz, hy + 6 + gape * 0.5, 7.5 * mz, 2.6, [10, 10, 11] as Ramp);
        // ── TEETH ──
        for (let i = 0; i < (dir === "E" ? 3 : 2); i++) {
          const tx = snoutX + (2 - i * 4) * mz;
          figDetail(ctx, [[tx, hy + 4.5], [tx, hy + 4.5 + gape * 0.8]], 1.5, TOOTH);
        }
      }
      // Nose leather.
      figDetail(ctx, [[snoutX + 7 * mz, hy + 1.5], [snoutX + 8.5 * mz, hy + 2.5]], 2.2, 1);

      // ── EYES: embers, drawn LAST and unshaded (layer 3 of the cel
      //    convention), narrowed into a hunting scowl. ──
      if (dir !== "N") {
        const eyes: number[] = dir === "E" ? [0] : [-1, 1];
        for (const s of eyes) {
          const ex = hx + (dir === "E" ? 2 : s * 5);
          const ey = hy - 1;
          // Dark socket first, so the ember never sits on mid-value pelt.
          ellShaded(ctx, ex, ey, 4.6, 2.6, [0, 0, 1] as Ramp);
          ctx.save();
          ctx.translate(ex, ey);
          // Angled inward — the same scowl trick the sporeling uses.
          ctx.rotate((dir === "E" ? 1 : s) * 0.26);
          ellShaded(ctx, 0, 0, 3.4, 1.5, [EYE_HOT, EYE_CORE, 18] as Ramp);
          ctx.restore();
          figGlow(ctx, ex, ey, 2.2, EYE_CORE, EYE_HOT);
        }
      }
    }
  };
}

/**
 * ATTACK / CHARGE TELL — the gathered crouch.
 *
 * This is the 0.45s of HOUND_CHARGE_WINDUP made visible: haunches loaded, chest
 * dropped, head levelled down the charge line, ridge bristled, ears pinned. It
 * deliberately does NOT resemble `walk`, because a tell that reads as ordinary
 * movement is not a tell.
 */
function houndCrouch(dir: Dir, t: number): FramePaint {
  return (ctx) => {
    // Gather deepens across the windup, then the frame just before release
    // starts to unload — the coil, not a static pose.
    const c = t < 0.7 ? 0.45 + t * 0.78 : 1 - (t - 0.7) * 0.9;
    houndFrame(dir, -0.1 + t * 0.2, { crouch: c })(ctx);

    // Scuff kicked up by the loaded back feet — reads as traction being built.
    if (dir === "N") return;
    for (let i = 0; i < 3; i++) {
      const a = 0.4 + i * 0.5;
      const sx = CX - 26 - i * 5;
      figDetail(
        ctx,
        [[sx, GROUND - 2 - i], [sx - 5 - t * 5, GROUND - 5 - i * 2 - Math.sin(a) * 3]],
        1.5,
        4,
      );
    }
  };
}

/**
 * RUN / DASH — the extension. Legs thrown fore-and-aft, body stretched along
 * the charge axis, speed lines behind. This is HOUND_CHARGE_SPEED at 10 t/s.
 */
function houndDash(dir: Dir, t: number): FramePaint {
  return (ctx) => {
    // Full gallop cycle: extended → gathered → extended.
    const ph = Math.sin(t * Math.PI * 2);
    houndFrame(dir, ph, { extend: 0.55 + Math.abs(ph) * 0.45 })(ctx);
    if (dir === "N") return;
    // Speed lines, unshaded on top — the dash's motion arc, drawn as trailing
    // streaks rather than an arc because the charge is a STRAIGHT line and the
    // art should not imply a curve the mechanic cannot make.
    for (let i = 0; i < 3; i++) {
      const y = GROUND - 20 - i * 9;
      const x0 = CX - 34 - i * 3;
      ctx.beginPath();
      ctx.moveTo(x0, y);
      ctx.lineTo(x0 - 16 - t * 10, y);
      ctx.lineWidth = 1.6;
      ctx.strokeStyle = `rgba(217,87,99,${0.5 - i * 0.13})`;
      ctx.stroke();
    }
  };
}

export function makeHoundPaints(): ActorPaints {
  const dc = (dir: Dir) => {
    // ── THE GATHER IS AUTHORED ONCE AND WORN BY TWO CLIPS ────────────────────
    //
    // The tell was drawn for HOUND_CHARGE_WINDUP but the game asks for it under
    // a DIFFERENT NAME, and for weeks nothing played it. `enemy-rules` gives the
    // hound the `leaper` policy, whose telegraph is `MOVE_TELL.leap`, and
    // render/tell-clips.ts turns that into the clip `crouch` — a clip this
    // painter did not author, so `CLIP_FALLBACK` resolved it to `idle` and the
    // charge telegraph was a breathing hound with a tint on it. Probed live:
    // `crouch → idle 2f` in all three facings while `attack → 3f` sat unused
    // outside the 0.3s contact bite.
    //
    // Nothing detected it because hound.test.ts asserts the gather on `attack`,
    // which is exactly the clip the mechanic stopped asking for — the test and
    // the screen disagreed and only the test was read.
    //
    // So the same three frames are published under both names: `attack` for the
    // contact bite's windup (anim.attack 12fps → 0.25s) and `crouch` for the
    // leaper telegraph (anim.crouch 7fps → 0.43s, which is HOUND_CHARGE_WINDUP
    // 0.45s almost exactly). One authored pose, two rates, no second drawing to
    // keep in sync.
    const gather = [houndCrouch(dir, 0), houndCrouch(dir, 0.5), houndCrouch(dir, 1)];
    return {
      // Idle: breathing, weight settled. Small phase so it does not read as a walk.
      idle: [houndFrame(dir, -0.1), houndFrame(dir, 0.14)],
      // Walk: a four-beat trot.
      walk: [
        houndFrame(dir, -0.9),
        houndFrame(dir, 0.05),
        houndFrame(dir, 0.9),
        houndFrame(dir, 0.05),
      ],
      // The contact bite's windup — see houndCrouch.
      attack: gather,
      // The leaper telegraph, which is what the charge actually asks for.
      crouch: gather,
      // Run is the dash itself.
      run: [houndDash(dir, 0), houndDash(dir, 0.33), houndDash(dir, 0.66)],
      death: [
        houndFrame(dir, 0.5, { crouch: 0.8 }),
        houndFrame(dir, 0, { dead: true }),
        houndFrame(dir, 0, { dead: true }),
        houndFrame(dir, 0, { dead: true }),
      ],
    };
  };
  return { S: dc("S"), N: dc("N"), E: dc("E") };
}
