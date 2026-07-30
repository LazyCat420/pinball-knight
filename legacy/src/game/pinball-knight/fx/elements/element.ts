/**
 * The shape every elemental shader hands back, and the flags they all share.
 *
 * ── WHY A FRESH MATERIAL PER INSTANCE, NOT `.clone()` ────────────────────────
 * A `NodeMaterial.clone()` copies node REFERENCES, so the clone shares the
 * original's uniform nodes. That is fatal here: each floor decal fades on its
 * own schedule and each fire needs its own phase offset, so they need their own
 * `uOpacity` and `uSeed`. Sharing them would make every fire in a room flicker
 * and die in lockstep — the exact artefact the torch flip-book already avoids
 * with a per-torch `phase`.
 *
 * So a caller asks the factory again. That is cheap: building a node graph is
 * plain object allocation, next to nothing beside the `THREE.Mesh` the same
 * spawn already creates. And it does NOT multiply pipelines — three keys the
 * compiled pipeline on material CONTENT, so N structurally-identical graphs
 * share one. (This is the same fact `fx/system.ts` relies on to warm every pool
 * slot by revealing one.)
 *
 * ── WHY `MeshBasicNodeMaterial` ──────────────────────────────────────────────
 * It is the node-graph equivalent of the `MeshBasicMaterial` these effects used
 * before: UNLIT, so the effect owns its own brightness and nothing in the scene
 * lighting can dim a flame. A raw `THREE.ShaderMaterial` is rejected outright by
 * `WebGPURenderer` ("not compatible") and renders a COMPLETELY BLACK screen
 * while the game keeps ticking, so it is not an option; plain `NodeMaterial` is
 * the fullscreen-quad tool and carries lighting setup this does not want.
 */
import * as THREE from "three";
import { MeshBasicNodeMaterial } from "three/webgpu";
import type { TSLUniform } from "./noise";

/** The elemental looks that are shader-backed. */
export type ElementKind = "fire" | "slick" | "frost" | "oil" | "tar" | "rod";

export interface ElementMaterial {
  material: MeshBasicNodeMaterial;
  /** Seconds. Advanced from the REAL-time clock, not the fixed sim step — a
   *  flame must keep moving through a hit-freeze, exactly like the particles. */
  uTime: TSLUniform<number>;
  /** Master fade, 0..1. Replaces the old `material.opacity` pokes: a node
   *  material's alpha comes from the graph, so `.opacity` would do nothing. */
  uOpacity: TSLUniform<number>;
  /** How hot / how agitated, 0..1+. Lets one material serve a guttering trail
   *  tile and a roaring ignited pool. */
  uIntensity: TSLUniform<number>;
  /** Per-instance phase offset. Without it every instance is the same clock. */
  uSeed: TSLUniform<number>;
  dispose(): void;
}

/**
 * Common flags for a ground decal or an additive billboard.
 *
 * `depthWrite: false` and `transparent: true` are carried over from the
 * materials these replace — a flat disc at y=0.03 that wrote depth would z-fight
 * the floor and clip the sprites standing in it.
 */
export function elementMaterial(additive: boolean): MeshBasicNodeMaterial {
  const m = new MeshBasicNodeMaterial();
  m.transparent = true;
  m.depthWrite = false;
  // Fire, frost and the rod ADD light so the bloom feeds on their hot cores;
  // oil, tar and water sit ON the scene. Same split as the textures before them.
  m.blending = additive ? THREE.AdditiveBlending : THREE.NormalBlending;
  return m;
}
