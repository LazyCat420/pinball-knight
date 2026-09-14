/**
 * Projectile VFX Types & Interfaces.
 *
 * Defines the contracts for reusable projectile archetypes, multi-layer
 * mesh bundles, in-flight dynamics, launch tells, and impact visual effects.
 */
import * as THREE from "three";
import type { ProjectileKind } from "../../items";

export type ProjectileArchetype =
  | "bullet"
  | "flame"
  | "glob"
  | "beam"
  | "blade"
  | "bomb"
  | "condiment";

export interface ProjectileMeshBundle {
  root: THREE.Object3D;
  coreMesh: THREE.Mesh;
  glowMesh?: THREE.Mesh;
  accentMesh?: THREE.Mesh;
}

export interface ProjectileVfxConfig {
  kind: ProjectileKind;
  archetype: ProjectileArchetype;

  /** Core shape dimensions & visual tuning */
  dimensions: {
    radius: number;
    length?: number;
    glowScale?: number;
  };

  /** Color palette */
  colors: {
    core: number;       // Bright incandescent / front color
    glow?: number;      // Outer translucent halo color
    accent?: number;    // Secondary accent (casing, fuse, seeds, tip)
  };

  /** Flight dynamics */
  flight: {
    orientToHeading?: boolean; // Points tip along velocity vector
    spinAxis?: "x" | "y" | "z" | "roll" | "pitch" | "yaw";
    spinSpeed?: number;
    pulseGlow?: boolean;
    pulseSpeed?: number;
    trailType?: "sparks" | "smoke" | "embers" | "caustic" | "stream" | "laser" | "dust";
    trailColor?: number;
    trailInterval?: number;
    trailCount?: number;
  };

  /** Launch / Muzzle VFX */
  launch?: {
    muzzleFlash?: boolean;
    flashColor?: number;
    sparkCount?: number;
    smokePuff?: boolean;
  };

  /** Impact VFX */
  impact: {
    wallType: "sparks" | "burst" | "splash" | "detonate";
    color: number;
    count?: number;
    screenShake?: number;
    floorDecal?: string;
  };
}
