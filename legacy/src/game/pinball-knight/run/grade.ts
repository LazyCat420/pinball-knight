/**
 * The floor's score: FLOW and the end-of-floor GRADE.
 *
 * Extracted verbatim from core.ts. Pure reads off `state` plus the tuning
 * table — no scene, no THREE, no lifecycle — which is what makes it the one
 * piece of the descent path that is straightforwardly testable.
 */
import { state } from "../state";
import {
  GRADE_FLOW_FULL,
  GRADE_FLOW_OK,
  GRADE_KILLS_FULL,
  GRADE_KILLS_OK,
  GRADE_COMBO_FULL,
  GRADE_COMBO_OK,
  GRADE_GOLD,
} from "../constants";

export function floorFlow(): number {
  if (state.levelFlowT <= 0) return 0;
  return state.levelFlowSum / state.levelFlowT;
}

/**
 * Grade the floor being left: FLOW (how much speed you actually carried),
 * carnage (share of the horde killed) and style (best bounce combo), two marks
 * each → S/A/B/C/D and a gold bonus. The "play it again, but cooler" hook.
 *
 * Both the pace and style axes were rebuilt in the de-clone wave. Pace was raw
 * wall-clock, so walking a floor briskly scored the same as riding it, and
 * style capped at combo 8 — the exact point where the combo curve starts being
 * interesting. Both now measure the thing the game is actually about.
 */
export function gradeFloor(): { grade: string; gold: number } {
  const kills = state.kills - state.levelStartKills;
  const share = kills / Math.max(1, state.levelHordeSize);
  const flow = floorFlow();
  let pts = 0;
  pts += flow >= GRADE_FLOW_FULL ? 2 : flow >= GRADE_FLOW_OK ? 1 : 0;
  pts += share >= GRADE_KILLS_FULL ? 2 : share >= GRADE_KILLS_OK ? 1 : 0;
  pts += state.levelBestCombo >= GRADE_COMBO_FULL ? 2 : state.levelBestCombo >= GRADE_COMBO_OK ? 1 : 0;
  const grade = pts >= 6 ? "S" : pts >= 5 ? "A" : pts >= 3 ? "B" : pts >= 2 ? "C" : "D";
  return { grade, gold: GRADE_GOLD[grade] ?? 0 };
}
