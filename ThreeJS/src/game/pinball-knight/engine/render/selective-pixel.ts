import type { Material, Object3D } from "three";
import { float, floor, max, mix, step, texture, vec2 } from "three/tsl";
import type { Texture } from "three";

export const PIXEL_FILTERS = ["off", "subtle", "chunky"] as const;
export type PixelFilter = (typeof PIXEL_FILTERS)[number];
export function isPixelFilter(value: unknown): value is PixelFilter {
  return PIXEL_FILTERS.some((mode) => mode === value);
}
export function pixelBlockSize(mode: PixelFilter): number {
  return mode === "chunky" ? 4 : mode === "subtle" ? 2 : 1;
}

/** Only explicitly opted-in scenery is filtered. Actors remain protected even
 * when they share its material. Cutouts and translucent effects always retain
 * their original samples. A child can opt out of an environment ancestor. */
export function pixelProtection(object: Object3D, material: Material): number {
  if (material.transparent || material.alphaTest > 0 || material.type === "MeshBasicMaterial") return 1;
  for (let node: Object3D | null = object; node; node = node.parent) {
    if (typeof node.userData.pixelEnvironment === "boolean") return node.userData.pixelEnvironment ? 0 : 1;
  }
  return 1;
}

// Node graphs have varying element types throughout this expression.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Node = any;

/** Choose the block's centre only when BOTH destination and source are scenery.
 * The mask is rendered with the scene's depth/alpha tests and material blending:
 * an actor cannot grow into neighbouring blocks or lose a thin silhouette.
 * Keeping one full-resolution scene also preserves wall occlusion exactly. */
export function selectivePixelSample(mask: Texture, depth: Texture, uv: Node, res: Node, block: Node): { uv: Node; ink: Node } {
  const centre = floor(uv.mul(res).div(block)).mul(block).add(floor(block.div(2))).add(0.5).div(res);
  const protectedPixel = max(texture(mask, uv).r, texture(mask, centre).r);
  const enabled = step(float(1.5), block).mul(step(float(0.001), protectedPixel).oneMinus());
  const at = mix(uv, centre, enabled);
  const z = texture(depth, at).r;
  let edge: Node = float(0);
  for (const [x, y] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const neighbour = at.add(vec2(x, y).mul(block).div(res));
    // Do not draw scenery ink from a protected sprite's depth boundary.
    const scenery = step(float(0.001), texture(mask, neighbour).r).oneMinus();
    edge = max(edge, step(float(0.001), texture(depth, neighbour).r.sub(z)).mul(scenery));
  }
  return { uv: at, ink: float(1).sub(edge.mul(enabled).mul(0.18)) };
}
