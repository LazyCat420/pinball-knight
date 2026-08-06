/**
 * Bundle entry for `scripts/mega-map.mjs` — one import surface, nothing else.
 *
 * esbuild bundles this file; the script imports the result. Kept separate from
 * the three modules it re-exports so none of them has to know it is being
 * bundled, and so adding a fourth is a one-line change here.
 */
export { buildMegaFloor, type MegaFloor, type MegaFloorOptions } from "./mega-floor";
export { renderFloorSvg, type SvgOptions } from "./floor-svg";
export { censusPatterns, formatCensus, type PatternCensus } from "./pattern-census";
