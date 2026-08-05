/**
 * DRIFT — did this generated cell stay the character we asked for?
 *
 * `intake-qa.ts` asks whether ONE frame obeys the geometry contract. It has no
 * opinion about identity, because at intake there is nothing to compare
 * against. Once a build has an approved master, every later cell has an
 * absolute reference, and "is this still the same creature" becomes a
 * measurement instead of a judgement call.
 *
 * That is the whole point of this file. A build makes 72 cells (6 moves × 3
 * facings × 4 keys); nobody looks at 72 cells honestly. They look at the first
 * six, get bored, and publish. The gate's job is to hand back a SHORT list —
 * the cells that actually moved away from the master — so the attention goes
 * where it earns something.
 *
 * ── WHAT THIS DELIBERATELY DOES NOT DO ──────────────────────────────────────
 * It does not score whether the art is GOOD. A cell can pass every check here
 * and still be an ugly pose, and a beautiful cell can fail `area` because the
 * character legitimately crouched. These are DRIFT metrics: they answer "did
 * the model quietly swap the subject, the scale, or the palette", which is the
 * failure that survives a bored reviewer. Art direction stays human.
 *
 * ── THE COMPARISON IS PER-FACING ────────────────────────────────────────────
 * A cell is only ever scored against the master OF ITS OWN FACING. Comparing an
 * N-facing walk key against the E master measures the rotation, not the drift,
 * and would condemn every back view ever generated.
 *
 * Pure: no node imports, no canvas. Enforced by testkit/testkit-boundary.test.ts.
 */

import { blobs, subjectOf, unionBox, OPAQUE_AT } from "./blobs";
import { oklab, oklabDist } from "./colour";
import { FEET, ANCHOR_TOL_PX } from "./intake";
import type { QaCheck, QaLevel, QaVerdict } from "./intake-qa";
import type { RawImage } from "./resample";

/**
 * THE THRESHOLDS.
 *
 * Every number here is a guess until `drift-calibrate.test.ts` has run it over
 * the published sheets that already work (frog, jester, beaver, zombie). A
 * metric tuned on nothing condemns working art — that failure has happened in
 * this repo before, with a differently-shaped probe that declared healthy code
 * broken. So the calibration test is not optional polish; it is the thing that
 * makes these numbers mean anything.
 *
 * They are exported so the test can assert against them by name rather than
 * re-typing literals that then drift apart from these.
 */
export const DRIFT = {
  /**
   * Opaque-texel count, as a ratio of the master's.
   *
   * CALIBRATED 2026-08-05 against frog/jester/beaver as published. Every
   * standing cell of that art sits inside the hard band. The only cells that
   * fall out are final death frames (0.61–0.63×), which is the creature
   * genuinely lying down and foreshortened — hence the off-floor exemption
   * below rather than a wider band that would stop catching a dropped weapon.
   */
  AREA_LO: 0.7,
  AREA_HI: 1.4,
  /** Same, but the range that is merely worth mentioning. */
  AREA_SOFT_LO: 0.82,
  AREA_SOFT_HI: 1.22,
  /**
   * |Δ(w/h)| / master's aspect — ADVISORY ONLY. See the check for why.
   *
   * Calibration measured legitimate published art at 28% (beaver attack), 50%
   * (frog walk) and 251% (jester's final death frame) off its own idle. The
   * threshold is set where it still says something useful about an unusual
   * pose without ever blocking one.
   */
  ASPECT_SOFT_TOL: 0.35,
  /** Mean OKLab distance between the two frames' colour histograms. */
  PALETTE_TOL: 0.16,
  PALETTE_SOFT_TOL: 0.09,
  /** Feet may sit this far off the contract line before it is a real problem. */
  FEET_TOL_PX: ANCHOR_TOL_PX * 3,
  /** Two keys of one clip that overlap this much are the same pose twice. */
  DUPE_IOU: 0.94,
  /** Colour bins coarser than generation noise (±8 per channel). */
  BIN: 32,
} as const;

export interface DriftOptions {
  /**
   * A clip whose poses legitimately leave the floor. `death` ends lying down;
   * `roll` and `ball` are off the baseline by definition. Scoring their feet
   * against 0.9H reports a failure for doing exactly what was asked.
   */
  clip?: string;
  /** Label used in the report, e.g. "walk E key 3". */
  label?: string;
}

/** Clips that are exempt from the baseline check, and why. */
const OFF_FLOOR = new Set(["death", "roll", "ball", "stumble"]);

const pct = (n: number) => `${(n * 100).toFixed(1)}%`;
const ratio = (n: number) => `${n.toFixed(2)}×`;

/** Opaque-texel count and the subject's bounding box, in one pass. */
function measure(img: RawImage): { area: number; box: [number, number, number, number] | null } {
  const all = blobs(img.data, img.width, img.height);
  const { subject, extras } = subjectOf(all);
  if (!subject) return { area: 0, box: null };
  // Extras that survived `subjectOf`'s 1% floor are real art — a dropped
  // shield, a thrown spear — so they count toward the silhouette. Specks do
  // not; that is what the floor is for.
  const box = unionBox([subject, ...extras]);
  let area = 0;
  for (let i = 3; i < img.data.length; i += 4) if (img.data[i] >= OPAQUE_AT) area++;
  return { area, box };
}

/**
 * A coarse OKLab colour histogram over the OPAQUE texels only.
 *
 * Alpha-weighted rather than binary because a 1px selout edge is where a
 * palette swap shows up first, and thresholding it away is how you fail to
 * notice the model re-tinted the outline.
 */
function histogram(img: RawImage): Map<number, { lab: ReturnType<typeof oklab>; n: number }> {
  const bins = new Map<number, { lab: ReturnType<typeof oklab>; n: number }>();
  const { data } = img;
  const q = 256 / DRIFT.BIN;
  for (let i = 0; i < data.length; i += 4) {
    const a = data[i + 3];
    if (a < OPAQUE_AT) continue;
    const r = data[i], g = data[i + 1], b = data[i + 2];
    const key = (Math.floor(r / q) << 10) | (Math.floor(g / q) << 5) | Math.floor(b / q);
    const hit = bins.get(key);
    if (hit) hit.n++;
    else bins.set(key, { lab: oklab(r, g, b), n: 1 });
  }
  return bins;
}

/**
 * How far `a`'s colours sit from the nearest colour `b` actually uses,
 * weighted by how much of `a` wears them.
 *
 * Deliberately ASYMMETRIC. The question is "did this cell introduce colours the
 * master does not have" — a cell that merely fails to use some of the master's
 * palette (a back view with no face) is not drift, it is a back view. A
 * symmetric distance would flag every N facing.
 */
function paletteDistance(a: RawImage, b: RawImage): number {
  const ha = histogram(a);
  const hb = [...histogram(b).values()];
  if (!ha.size || !hb.length) return 0;
  let sum = 0, total = 0;
  for (const { lab, n } of ha.values()) {
    let best = Infinity;
    for (const q of hb) {
      const d = oklabDist(lab, q.lab);
      if (d < best) best = d;
    }
    sum += best * n;
    total += n;
  }
  return total ? sum / total : 0;
}

/**
 * Score one generated cell against its facing's master.
 *
 * Returns the same `QaVerdict` shape `qaFrame` does, so the panel renders both
 * with one component and a build's per-cell verdict reads identically to the
 * intake verdict the user already learned to read.
 */
export function driftFrame(cell: RawImage, master: RawImage, opts: DriftOptions = {}): QaVerdict {
  const checks: QaCheck[] = [];
  const add = (c: QaCheck) => checks.push(c);
  const m = measure(master);
  const c = measure(cell);

  // ── 0. is there a subject at all ────────────────────────────────────────
  // Every check below divides by the master's measurements or reads the cell's
  // box. An empty cell must fail HERE, loudly, rather than producing five
  // NaN-shaped passes further down.
  if (!c.box || c.area === 0) {
    add({
      id: "subject", label: "a subject exists", value: "empty", want: "one figure", pass: false,
      why: "the cell has no opaque pixels — the generation failed or the matte ate everything",
      fix: "re-roll this key; if it repeats, the master's matte is the suspect, not the pose",
    });
    return finish(checks, opts);
  }
  if (!m.box || m.area === 0) {
    add({
      id: "master", label: "the master is usable", value: "empty", want: "one figure", pass: false,
      why: "the MASTER has no opaque pixels, so nothing downstream can be scored against it",
      fix: "re-approve the identity frame — this is a build-level fault, not a cell-level one",
    });
    return finish(checks, opts);
  }

  // ── 1. body mass ─────────────────────────────────────────────────────────
  // The single most useful number. A model that lost the weapon, dropped the
  // cape, or quietly rendered a chibi version of the character moves this
  // first, and it moves before anything a human notices at thumbnail size.
  //
  // Off-floor clips are exempt from the HARD band, measured: a frog's and a
  // jester's final death frames come in at 0.61–0.63× their own idle, because
  // a creature lying down really does present less of itself to the camera.
  // Widening the band for everyone would have bought that exemption at the
  // cost of no longer catching a dropped weapon on a standing clip.
  const offFloor = OFF_FLOOR.has(opts.clip ?? "");
  const area = c.area / m.area;
  const areaHard = !offFloor && (area < DRIFT.AREA_LO || area > DRIFT.AREA_HI);
  const areaSoft = area < DRIFT.AREA_SOFT_LO || area > DRIFT.AREA_SOFT_HI;
  add({
    id: "area", label: "body mass vs the master", value: ratio(area),
    want: offFloor ? `${DRIFT.AREA_SOFT_LO}–${DRIFT.AREA_SOFT_HI}× (advisory: off-floor clip)` : `${DRIFT.AREA_SOFT_LO}–${DRIFT.AREA_SOFT_HI}×`,
    pass: !areaHard && !areaSoft, soft: !areaHard,
    ...(areaHard || areaSoft ? {
      why: area < 1
        ? "the figure lost mass — a dropped weapon, a shed cloak, or a smaller character"
        : "the figure gained mass — added armour, a second limb, or a bigger character",
      fix: "compare against the master ghost overlay; if the silhouette is right, re-frame (free). If it is wrong, re-roll the key.",
    } : {}),
  });

  // ── 2. proportions — ADVISORY, ALWAYS ────────────────────────────────────
  //
  // This check was written as a hard gate and the calibration run refuted it,
  // which is the entire reason that run exists. Scored against their own idle
  // frame, sheets the game is drawing TODAY come back at 28% (beaver attack),
  // 38% (beaver walk), 50% (frog walk) and 251% (jester's last death frame).
  //
  // The reason is not that the art drifted. A tight bounding box around a
  // stride is genuinely wider than one around a stand, and a creature lying
  // down is genuinely a different rectangle. Bbox aspect measures POSE. As a
  // block it would have rejected four of four known-good sheets; as an
  // advisory it still earns its place, because a standing clip that suddenly
  // reports 60% is worth a glance.
  //
  // Kept, demoted, and documented — rather than deleted — so the next person
  // to think "we should check proportions" finds the measurement instead of
  // re-deriving it.
  const ma = (m.box[2] - m.box[0] + 1) / (m.box[3] - m.box[1] + 1);
  const ca = (c.box[2] - c.box[0] + 1) / (c.box[3] - c.box[1] + 1);
  const aspect = Math.abs(ca - ma) / ma;
  add({
    id: "aspect", label: "proportions (advisory)", value: `${pct(aspect)} off (${ca.toFixed(2)} vs ${ma.toFixed(2)})`,
    want: `within ${pct(DRIFT.ASPECT_SOFT_TOL)}`,
    pass: aspect <= DRIFT.ASPECT_SOFT_TOL, soft: true,
    ...(aspect > DRIFT.ASPECT_SOFT_TOL ? {
      why: "the figure's bounding box changed shape a lot — usually the pose, occasionally a stretched character",
      fix: "check the master ghost overlay; this never blocks a publish on its own",
    } : {}),
  });

  // ── 3. palette ───────────────────────────────────────────────────────────
  // The drift that survives every other check. A knight whose armour warmed
  // half a step per frame passes area, aspect and feet, and reads as a
  // shimmer once the clip plays.
  const pal = paletteDistance(cell, master);
  add({
    id: "palette", label: "colours vs the master", value: pal.toFixed(3),
    want: `≤ ${DRIFT.PALETTE_SOFT_TOL}`,
    pass: pal <= DRIFT.PALETTE_SOFT_TOL, soft: pal <= DRIFT.PALETTE_TOL,
    ...(pal > DRIFT.PALETTE_SOFT_TOL ? {
      why: "this cell wears colours the master does not — a re-tint, a new light, or a material swap",
      fix: "the crush snaps to one palette and hides mild drift; heavy drift survives it. Re-roll if the overlay shows a different creature.",
    } : {}),
  });

  // ── 4. the baseline ──────────────────────────────────────────────────────
  // `register.ts` puts the lowest ink on the floor. A cell whose feet wander
  // is a cell the importer will silently LIFT to compensate, which reads in
  // game as the creature bobbing while it walks.
  const clip = opts.clip ?? "";
  if (!OFF_FLOOR.has(clip)) {
    const wantY = Math.round(FEET * cell.height);
    const feetY = c.box[3];
    const off = Math.abs(feetY - wantY);
    add({
      id: "feet", label: "feet on the baseline", value: `y=${feetY} (want ${wantY})`,
      want: `± ${DRIFT.FEET_TOL_PX}px`, pass: off <= DRIFT.FEET_TOL_PX, soft: true,
      ...(off > DRIFT.FEET_TOL_PX ? {
        why: "the importer registers on the lowest ink, so an off-baseline cell makes the creature bob",
        fix: "re-frame — free, no GPU, and it is the correct fix for this specific failure",
      } : {}),
    });
  }

  return finish(checks, opts);
}

/**
 * Cross-frame checks: the ones a single cell cannot answer.
 *
 * Called with a clip's keys IN ORDER. Returns clip-level checks only; the
 * per-cell verdicts come from `driftFrame`.
 */
export function driftClip(cells: readonly RawImage[], opts: DriftOptions = {}): QaVerdict {
  const checks: QaCheck[] = [];
  if (cells.length < 2) {
    return finish([{
      id: "keys", label: "the clip has keys", value: `${cells.length}`, want: "≥ 2",
      pass: cells.length > 0, soft: true,
      ...(cells.length < 2 ? { why: "a one-frame clip cannot be checked for motion", fix: "generate the remaining keys" } : {}),
    }], opts);
  }

  // ── duplicate keys ───────────────────────────────────────────────────────
  // THE failure this catches: asked for four distinct extremes, the model
  // returns the same pose two or three times with a pixel of jitter. It looks
  // like a full clip in the contact sheet and animates as a freeze. IoU over
  // the alpha mask is the cheapest honest test — it needs no registration,
  // because the cells already share a canvas and a baseline.
  const masks = cells.map((c) => alphaMask(c));
  let worst = 0, worstPair = "";
  for (let i = 0; i < masks.length; i++) {
    for (let j = i + 1; j < masks.length; j++) {
      const v = iou(masks[i], masks[j], cells[i], cells[j]);
      if (v > worst) { worst = v; worstPair = `${i + 1}↔${j + 1}`; }
    }
  }
  checks.push({
    id: "distinct", label: "keys are distinct poses", value: `worst overlap ${pct(worst)} (${worstPair})`,
    want: `< ${pct(DRIFT.DUPE_IOU)}`, pass: worst < DRIFT.DUPE_IOU,
    ...(worst >= DRIFT.DUPE_IOU ? {
      why: `keys ${worstPair} are the same pose — this clip will animate as a freeze, not a motion`,
      fix: "re-roll one of the pair with a new seed; if it repeats, the two pose scripts are too close to distinguish",
    } : {}),
  });

  return finish(checks, opts);
}

function alphaMask(img: RawImage): Uint8Array {
  const m = new Uint8Array(img.width * img.height);
  for (let i = 0, p = 0; i < img.data.length; i += 4, p++) m[p] = img.data[i + 3] >= OPAQUE_AT ? 1 : 0;
  return m;
}

/**
 * Intersection over union of two alpha masks.
 *
 * Cells of one clip share a canvas by construction (`cutSheetToCells` places
 * every cell on one canvas sized to the widest and tallest, feet on a shared
 * baseline), so a raw overlap is meaningful. Differing sizes mean the caller
 * skipped that step — return 0 rather than silently comparing misaligned art.
 */
function iou(a: Uint8Array, b: Uint8Array, ia: RawImage, ib: RawImage): number {
  if (ia.width !== ib.width || ia.height !== ib.height) return 0;
  let inter = 0, union = 0;
  for (let i = 0; i < a.length; i++) {
    if (a[i] | b[i]) union++;
    if (a[i] & b[i]) inter++;
  }
  return union ? inter / union : 0;
}

/**
 * Three-valued, matching `intake-qa`: a hard failure blocks, a soft failure is
 * publishable with a deliberate click, everything green is ready.
 *
 * `soft: true` on a FAILING check is what makes it advisory. A check that
 * passes carries no weight either way.
 */
function finish(checks: QaCheck[], opts: DriftOptions): QaVerdict {
  const failed = checks.filter((c) => !c.pass);
  const hard = failed.some((c) => !c.soft);
  const level: QaLevel = hard ? "reject" : failed.length ? "usable" : "ready";
  const head = opts.label ? `${opts.label} — ${level.toUpperCase()}` : level.toUpperCase();
  const lines = checks.map((c) => {
    const mark = c.pass ? "  ok " : c.soft ? "  !  " : "  ✗  ";
    const tail = c.pass ? "" : `\n         ${c.why}\n         fix: ${c.fix}`;
    return `${mark}${c.label.padEnd(26)} ${c.value}  (want ${c.want})${tail}`;
  });
  return { level, checks, report: [head, ...lines].join("\n") };
}
