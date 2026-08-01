/**
 * OPEN-SPACE CENSUS — how much of a shipping floor is open AND empty.
 *
 * The instrument for the live QA complaint "make these open spaces be filled
 * out … so there's not just blank spaces for too long". `maze/open-space.ts`
 * defines the numbers; this runs them over real floors and rolls them up by
 * archetype, which is the axis the defect lives on (only `greathall` carries a
 * non-zero `plazaFrac`).
 *
 * REAL: the floors come from `buildHeadlessPlan`, which mirrors
 * `spawn/floor-authoring.ts` draw for draw — see that function's header for why
 * it does not reuse `buildHeadlessFloor` or `floor-density.test.ts`'s
 * `liveFloor()`, neither of which builds the floor that ships.
 *
 * MODELLED: nothing. Every number here is a count over a generated grid.
 */
import { buildHeadlessPlan } from "./headless-floor";
import { measureOpenSpace, R_DEAD, type OpenSpaceMetrics, type SectionDensity } from "../maze/open-space";
import { ARCHETYPES } from "../maze/archetypes";

export interface FloorRow {
  level: number;
  seed: number;
  archetype: string;
  modifier: string;
  walkable: number;
  parts: number;
  partsPer1k: number;
  worstBarren: number;
  deadShare: number;
  openDeadShare: number;
  openShare: number;
  sections: number;
  biggestSectionRatio: number;
  /** The emptiest section on this floor — where to point a screenshot. */
  worstSection: SectionDensity | null;
}

export interface Roll {
  floors: number;
  worstBarrenMean: number;
  worstBarrenP95: number;
  worstBarrenMax: number;
  openDeadShareMean: number;
  openDeadShareP95: number;
  deadShareMean: number;
  biggestSectionRatioMean: number;
  biggestSectionRatioMin: number;
  partsPer1kMean: number;
}

export interface CensusReport {
  rDead: number;
  floors: number;
  overall: Roll;
  byArchetype: Record<string, Roll>;
  /** The single worst floor by openDeadShare — the reproduction case. */
  worstFloor: FloorRow | null;
  perFloor: FloorRow[];
}

const mean = (xs: number[]): number => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

/** Nearest-rank percentile — no interpolation, so the value is one we saw. */
function pct(xs: number[], p: number): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.ceil((p / 100) * s.length) - 1))];
}

function roll(rows: FloorRow[]): Roll {
  const wb = rows.map((r) => r.worstBarren);
  const ods = rows.map((r) => r.openDeadShare);
  const bsr = rows.map((r) => r.biggestSectionRatio);
  return {
    floors: rows.length,
    worstBarrenMean: mean(wb),
    worstBarrenP95: pct(wb, 95),
    worstBarrenMax: wb.length ? Math.max(...wb) : 0,
    openDeadShareMean: mean(ods),
    openDeadShareP95: pct(ods, 95),
    deadShareMean: mean(rows.map((r) => r.deadShare)),
    biggestSectionRatioMean: mean(bsr),
    biggestSectionRatioMin: bsr.length ? Math.min(...bsr) : 0,
    partsPer1kMean: mean(rows.map((r) => r.partsPer1k)),
  };
}

function rowFor(level: number, seed: number, archIndex?: number): FloorRow | null {
  const f = buildHeadlessPlan(level, seed);
  if (!f) return null;
  // `archIndex` is accepted for symmetry with floor-density.test.ts's sweep but
  // deliberately unused: `archetypeFor(level)` is what the game calls, and
  // forcing an archetype would measure a floor the player never gets.
  void archIndex;
  const m: OpenSpaceMetrics = measureOpenSpace(f.grid, f.plan.parts);
  const worstSection = m.sections.reduce<SectionDensity | null>(
    (w, s) => (!w || s.maxBarren > w.maxBarren ? s : w),
    null,
  );
  return {
    level,
    seed,
    archetype: f.archetype,
    modifier: f.modifier,
    walkable: m.walkable,
    parts: m.parts,
    partsPer1k: m.walkable > 0 ? (m.parts * 1000) / m.walkable : 0,
    worstBarren: m.worstBarren,
    deadShare: m.deadShare,
    openDeadShare: m.openDeadShare,
    openShare: m.walkable > 0 ? m.openTiles / m.walkable : 0,
    sections: m.sections.length,
    biggestSectionRatio: m.biggestSectionRatio,
    worstSection,
  };
}

export function runOpenSpaceCensus(levels: number[], seeds: number[]): CensusReport {
  const perFloor: FloorRow[] = [];
  for (const level of levels) {
    for (const seed of seeds) {
      const r = rowFor(level, seed);
      if (r) perFloor.push(r);
    }
  }
  const byArchetype: Record<string, Roll> = {};
  for (const a of ARCHETYPES) {
    const rows = perFloor.filter((r) => r.archetype === a.id);
    if (rows.length) byArchetype[a.id] = roll(rows);
  }
  const worstFloor = perFloor.reduce<FloorRow | null>(
    (w, r) => (!w || r.openDeadShare > w.openDeadShare ? r : w),
    null,
  );
  return {
    rDead: R_DEAD,
    floors: perFloor.length,
    overall: roll(perFloor),
    byArchetype,
    worstFloor,
    perFloor,
  };
}
