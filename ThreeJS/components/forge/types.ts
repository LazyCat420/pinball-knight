import type { ClipName } from "@/game/pinball-knight/engine/render/paint-types";

export const CLIP_NAMES = [
  "idle", "walk", "run", "attack", "stumble", "death", "roll", "ball", "crouch", "wait", "wake",
] as const satisfies readonly ClipName[];

export type { ClipName };
