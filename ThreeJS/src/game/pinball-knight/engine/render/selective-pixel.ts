import type { Material, Object3D } from "three";
import { abs, dot, float, floor, max, mix, smoothstep, step, texture, vec2, vec3 } from "three/tsl";
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

/** Octahedral encoding fits geometric normals in the mask's spare G/B channels.
 * Use geometry normals rather than normal maps so texture grain never becomes
 * an ink edge. No extra attachment or scene draw is needed. */
export function encodeGeometryNormal(normal: Node): Node {
  const n = normal.div(abs(normal.x).add(abs(normal.y)).add(abs(normal.z)));
  const signs = vec2(n.x.greaterThanEqual(0).select(1, -1), n.y.greaterThanEqual(0).select(1, -1));
  const folded = vec2(1).sub(abs(n.yx)).mul(signs);
  return n.z.greaterThanEqual(0).select(n.xy, folded).mul(0.5).add(0.5);
}

function decodeGeometryNormal(encoded: Node): Node {
  const p = encoded.mul(2).sub(1);
  const z = float(1).sub(abs(p.x)).sub(abs(p.y));
  const t = max(z.negate(), float(0));
  return vec3(
    p.x.add(p.x.greaterThanEqual(0).select(t.negate(), t)),
    p.y.add(p.y.greaterThanEqual(0).select(t.negate(), t)),
    z,
  ).normalize();
}

/** Sample scenery on the selected block grid, but draw contours at the original
 * resolution. Destination AND block source must be scenery: neither an actor's
 * silhouette nor the UI may be moved by the filter. */
export function selectivePixelSample(mask: Texture, depth: Texture, uv: Node, res: Node, block: Node): { uv: Node; ink: Node } {
  const centre = floor(uv.mul(res).div(block)).mul(block).add(floor(block.div(2))).add(0.5).div(res);
  const here = texture(mask, uv);
  const protectedPixel = max(here.r, texture(mask, centre).r);
  const enabled = step(float(1.5), block).mul(step(float(0.001), protectedPixel).oneMinus());
  const at = mix(uv, centre, enabled);
  const z = texture(depth, uv).r;
  const normal = decodeGeometryNormal(here.gb);
  const lightDirection = vec3(0.35, 0.8, 0.45);
  let edge: Node = float(0);
  for (const [x, y] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    // One original scene pixel, independent of the colour block size.
    const delta = vec2(x, y).div(res);
    const neighbour = uv.add(delta);
    const adjacent = texture(mask, neighbour);
    const neighbourDepth = texture(depth, neighbour).r;
    const oppositeDepth = texture(depth, uv.sub(delta)).r;
    const scenery = step(float(0.001), adjacent.r).oneMinus();
    const adjacentNormal = decodeGeometryNormal(adjacent.gb);
    // Ink only the less light-facing side of a crease, avoiding a doubled line.
    const normalEdge = smoothstep(0.12, 0.35, float(1).sub(dot(normal, adjacentNormal)))
      .mul(step(float(0.01), dot(adjacentNormal, lightDirection).sub(dot(normal, lightDirection))))
      .mul(scenery);
    // A planar depth slope has zero second difference: do not darken an entire
    // slanted floor or wall just because adjacent depth values differ.
    const depthEdge = step(float(0.0006), neighbourDepth.sub(z))
      .mul(step(float(0.0003), neighbourDepth.add(oppositeDepth).sub(z.mul(2))))
      .mul(max(scenery, step(float(0.9999), neighbourDepth)));
    edge = max(edge, max(normalEdge, depthEdge));
  }
  return { uv: at, ink: float(1).sub(edge.mul(enabled).mul(0.4)) };
}
