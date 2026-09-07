/**
 * CRAWLING HAND ("Thing" from Addams Family) — a severed pale gothic hand
 * that skitters on its fingertips like a spider, lunging to grab and pin the
 * knight while other monsters close in and attack.
 *
 * Procedural fallback cel-painter parameterised by (dir, phase, opts).
 */
import {
  type Ramp,
  CX,
  GROUND,
  ellShaded,
  limbShaded,
  detail as figDetail,
  groundShadow,
} from "../../engine/render/figure";
import type { ActorPaints, Dir, FramePaint } from "../../engine/render/paint-types";

// Palette ramps:
// Pale gothic skin tone:
const R_SKIN: Ramp = [2, 3, 4];
const R_SKIN_DK: Ramp = [1, 2, 3];
// Severed wrist stump / flesh:
const R_STUMP: Ramp = [10, 11, 12];
// Veins / stitch marks:
const R_VEIN = 19;

interface PoseOpts {
  bob?: number;
  crawlStep?: number;
  grabbing?: boolean;
  lungeT?: number;  // 0..1
  deathT?: number;  // 0..1
  dead?: boolean;
}

function crawlingHandFrame(dir: Dir, phase: number, opts: PoseOpts = {}): FramePaint {
  return (ctx) => {
    const { bob = 0, crawlStep = 0, grabbing = false, lungeT = 0, deathT = 0, dead = false } = opts;

    if (dead || deathT > 0) {
      // Flipped onto back, fingers curled into dying spasm, going limp
      const t = Math.min(1, Math.max(0, deathT));
      const collapseY = GROUND - 4 + t * 2;
      const palmW = 26 * (1 + t * 0.1);
      const palmH = 14 * Math.max(0.3, 1 - t * 0.5);

      groundShadow(ctx, CX, GROUND + 2, 22 * (1 - t * 0.2));

      // Inverted collapsed palm
      ellShaded(ctx, CX, collapseY, palmW * 0.5, palmH * 0.5, R_SKIN);
      // Severed wrist cross-section
      ellShaded(ctx, CX - 10, collapseY - 1, 4, 3.5, R_STUMP);

      // Curled death fingers
      const curlOffset = Math.sin(t * Math.PI) * 4;
      limbShaded(ctx, [CX + 4, collapseY], [CX + 12 - curlOffset, collapseY - 6], 3, R_SKIN);
      limbShaded(ctx, [CX + 2, collapseY], [CX + 10 - curlOffset, collapseY - 8], 3, R_SKIN);
      limbShaded(ctx, [CX, collapseY], [CX + 6 - curlOffset, collapseY - 9], 3, R_SKIN);
      limbShaded(ctx, [CX - 4, collapseY], [CX - 2 - curlOffset, collapseY - 8], 2.5, R_SKIN);

      // Blood / rot specks
      figDetail(ctx, [[CX + 6, collapseY + 2], [CX - 4, collapseY + 3]], 2, R_STUMP[0]);
      return;
    }

    const baseY = GROUND - 10 + bob;
    groundShadow(ctx, CX, GROUND + 2, 20 + Math.abs(crawlStep) * 4);

    if (grabbing) {
      // Reared back and lunging forward with wide-open grasping fingers
      const lungeX = CX + (dir === "E" ? 8 : dir === "W" ? -8 : 0);
      const lungeY = baseY - 6 - lungeT * 4;

      // Arched wrist & palm
      ellShaded(ctx, lungeX - 6, lungeY, 9, 7, R_SKIN);
      // Severed wrist stump
      ellShaded(ctx, lungeX - 12, lungeY + 2, 4, 4.5, R_STUMP);

      // 4 wide grasping fingers + thumb clutching forward
      const spread = 8 + lungeT * 6;
      limbShaded(ctx, [lungeX, lungeY - 4], [lungeX + spread + 6, lungeY - 8], 3.5, R_SKIN);
      limbShaded(ctx, [lungeX + 2, lungeY - 2], [lungeX + spread + 8, lungeY - 2], 3.5, R_SKIN);
      limbShaded(ctx, [lungeX + 1, lungeY + 1], [lungeX + spread + 7, lungeY + 5], 3.5, R_SKIN);
      limbShaded(ctx, [lungeX - 2, lungeY + 4], [lungeX + spread + 3, lungeY + 9], 3, R_SKIN);
      // Thumb
      limbShaded(ctx, [lungeX - 4, lungeY - 5], [lungeX + spread * 0.5, lungeY - 10], 3, R_SKIN_DK);

      // Vein details
      figDetail(ctx, [[lungeX - 4, lungeY - 1], [lungeX - 1, lungeY - 2]], 1.5, R_VEIN);
      return;
    }

    // Normal Idle & Finger-walking Crawl
    const palmX = CX;
    const palmY = baseY;

    // Arched palm
    ellShaded(ctx, palmX, palmY, 10, 6.5, R_SKIN);
    // Severed wrist stump at the rear
    ellShaded(ctx, palmX - 9, palmY + 1, 3.5, 4, R_STUMP);

    // 5 walking fingers planted on the ground
    // Crawl step shifts front/back finger positions like spider legs
    const s1 = Math.sin(crawlStep * Math.PI * 2) * 4;
    const s2 = Math.cos(crawlStep * Math.PI * 2) * 4;

    // Pinky
    limbShaded(ctx, [palmX - 4, palmY + 2], [palmX - 6 + s1, GROUND], 2.5, R_SKIN_DK);
    // Ring finger
    limbShaded(ctx, [palmX - 1, palmY + 3], [palmX - 1 - s2, GROUND], 3, R_SKIN);
    // Middle finger (longest)
    limbShaded(ctx, [palmX + 3, palmY + 3], [palmX + 4 + s2, GROUND], 3.5, R_SKIN);
    // Index finger
    limbShaded(ctx, [palmX + 7, palmY + 2], [palmX + 9 - s1, GROUND], 3, R_SKIN);
    // Thumb arching out
    limbShaded(ctx, [palmX + 8, palmY - 2], [palmX + 12 + s1 * 0.5, GROUND - 2], 2.8, R_SKIN);

    // Purple veins on back of hand
    figDetail(ctx, [[palmX - 3, palmY - 2], [palmX + 1, palmY - 3], [palmX + 4, palmY - 1]], 1.5, R_VEIN);
  };
}

export function makeCrawlingHandPaints(): ActorPaints {
  const facings = (dir: Dir) => ({
    idle: [
      crawlingHandFrame(dir, 0, { bob: 0, crawlStep: 0 }),
      crawlingHandFrame(dir, 1, { bob: -1, crawlStep: 0.1 }),
      crawlingHandFrame(dir, 2, { bob: -2, crawlStep: 0.2 }),
      crawlingHandFrame(dir, 3, { bob: -1, crawlStep: 0.1 }),
    ],
    walk: [
      crawlingHandFrame(dir, 0, { bob: 0, crawlStep: 0 }),
      crawlingHandFrame(dir, 1, { bob: -1, crawlStep: 0.25 }),
      crawlingHandFrame(dir, 2, { bob: 0, crawlStep: 0.5 }),
      crawlingHandFrame(dir, 3, { bob: -1, crawlStep: 0.75 }),
    ],
    attack: [
      crawlingHandFrame(dir, 0, { bob: 2, grabbing: false }),
      crawlingHandFrame(dir, 1, { bob: -1, grabbing: true, lungeT: 0.35 }),
      crawlingHandFrame(dir, 2, { bob: -2, grabbing: true, lungeT: 0.75 }),
      crawlingHandFrame(dir, 3, { bob: 0, grabbing: true, lungeT: 1.0 }),
    ],
    death: [
      crawlingHandFrame(dir, 0, { deathT: 0.25 }),
      crawlingHandFrame(dir, 1, { deathT: 0.50 }),
      crawlingHandFrame(dir, 2, { deathT: 0.75 }),
      crawlingHandFrame(dir, 3, { deathT: 1.00, dead: true }),
    ],
  });

  return {
    N: facings("N"),
    S: facings("S"),
    E: facings("E"),
    W: facings("W"),
  };
}
