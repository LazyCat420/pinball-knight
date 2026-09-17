/**
 * Projectile VFX Mesh Factory.
 *
 * Provides reusable, cached Three.js geometries and multi-layered mesh
 * bundles for all projectile archetypes (bullets, flames, globs, beams,
 * blades, bombs, and condiments).
 */
import * as THREE from "three";
import type { ProjectileMeshBundle, ProjectileVfxConfig } from "./types";
import { getProjectileVfxConfig } from "./registry";

// ── Cache for reusable geometries and materials ─────────────────────────────
const _geoCache = new Map<string, THREE.BufferGeometry>();
const _matCache = new Map<string, THREE.Material>();

function getCachedGeo<T extends THREE.BufferGeometry>(key: string, create: () => T): T {
  let geo = _geoCache.get(key);
  if (!geo) {
    geo = create();
    _geoCache.set(key, geo);
  }
  return geo as T;
}

function getCachedMat(
  color: number,
  opts: { additive?: boolean; opacity?: number; transparent?: boolean; wireframe?: boolean } = {},
): THREE.MeshBasicMaterial {
  const key = `${color.toString(16)}_${opts.additive ? "add" : "norm"}_${opts.opacity ?? 1}_${opts.wireframe ? "wf" : ""}`;
  let mat = _matCache.get(key) as THREE.MeshBasicMaterial | undefined;
  if (!mat) {
    mat = new THREE.MeshBasicMaterial({
      color,
      transparent: opts.transparent ?? (opts.additive || (opts.opacity !== undefined && opts.opacity < 1)),
      opacity: opts.opacity ?? 1,
      blending: opts.additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      depthWrite: !opts.additive,
      wireframe: opts.wireframe ?? false,
    });
    _matCache.set(key, mat);
  }
  return mat;
}

/**
 * Creates a dual-layer aerodynamic bullet mesh (incandescent core + outer tracer halo + casing accent).
 * Oriented with tip pointing along +Z for natural `rotation.y = Math.atan2(vx, vz)` heading alignment.
 */
export function createBulletBundle(config: ProjectileVfxConfig): ProjectileMeshBundle {
  const r = config.dimensions.radius;
  const len = config.dimensions.length ?? r * 2.8;
  const glowScale = config.dimensions.glowScale ?? 1.45;

  const coreGeoKey = `bullet_core_${r.toFixed(3)}_${len.toFixed(3)}`;
  const coreGeo = getCachedGeo(coreGeoKey, () => {
    const geo = new THREE.CapsuleGeometry(r, len, 6, 8);
    geo.rotateX(Math.PI / 2); // align capsule along Z
    return geo;
  });

  const glowGeoKey = `bullet_glow_${(r * glowScale).toFixed(3)}_${(len * 1.15).toFixed(3)}`;
  const glowGeo = getCachedGeo(glowGeoKey, () => {
    const geo = new THREE.CapsuleGeometry(r * glowScale, len * 1.15, 6, 8);
    geo.rotateX(Math.PI / 2);
    return geo;
  });

  const coreMat = getCachedMat(config.colors.core);
  const glowMat = getCachedMat(config.colors.glow ?? config.colors.core, {
    additive: true,
    opacity: 0.45,
    transparent: true,
  });

  const coreMesh = new THREE.Mesh(coreGeo, coreMat);
  const glowMesh = new THREE.Mesh(glowGeo, glowMat);

  const root = new THREE.Group();
  root.add(coreMesh);
  root.add(glowMesh);

  let accentMesh: THREE.Mesh | undefined;
  if (config.colors.accent !== undefined) {
    const accentGeoKey = `bullet_accent_${(r * 1.05).toFixed(3)}_${(len * 0.3).toFixed(3)}`;
    const accentGeo = getCachedGeo(accentGeoKey, () => {
      const geo = new THREE.CylinderGeometry(r * 1.05, r * 1.05, len * 0.3, 8);
      geo.rotateX(Math.PI / 2);
      geo.translate(0, 0, -len * 0.4);
      return geo;
    });
    const accentMat = getCachedMat(config.colors.accent);
    accentMesh = new THREE.Mesh(accentGeo, accentMat);
    root.add(accentMesh);
  }

  return { root, coreMesh, glowMesh, accentMesh };
}

/**
 * Creates a layered flame cluster (white-hot core + turbulent trailing orange-red teardrop shell).
 * Aligned with tip trailing -Z (or forward +Z).
 */
export function createFlameBundle(config: ProjectileVfxConfig): ProjectileMeshBundle {
  const r = config.dimensions.radius;
  const len = config.dimensions.length ?? r * 2.4;

  const coreGeoKey = `flame_core_${r.toFixed(3)}`;
  const coreGeo = getCachedGeo(coreGeoKey, () => new THREE.SphereGeometry(r, 8, 8));

  const mantleGeoKey = `flame_mantle_${(r * 1.5).toFixed(3)}_${len.toFixed(3)}`;
  const mantleGeo = getCachedGeo(mantleGeoKey, () => {
    const geo = new THREE.ConeGeometry(r * 1.5, len, 8);
    geo.rotateX(-Math.PI / 2); // point cone tail backward along -Z
    geo.translate(0, 0, -len * 0.35);
    return geo;
  });

  const coreMat = getCachedMat(config.colors.core);
  const glowMat = getCachedMat(config.colors.glow ?? 0xff6600, {
    additive: true,
    opacity: 0.65,
    transparent: true,
  });

  const coreMesh = new THREE.Mesh(coreGeo, coreMat);
  const glowMesh = new THREE.Mesh(mantleGeo, glowMat);

  const root = new THREE.Group();
  root.add(glowMesh);
  root.add(coreMesh);

  return { root, coreMesh, glowMesh };
}

/**
 * Creates a pulsating viscous glob with specular gloss highlights and orbital droplets.
 */
export function createGlobBundle(config: ProjectileVfxConfig): ProjectileMeshBundle {
  const r = config.dimensions.radius;

  const coreGeoKey = `glob_core_${r.toFixed(3)}`;
  const coreGeo = getCachedGeo(coreGeoKey, () => new THREE.SphereGeometry(r, 10, 8));

  const glowGeoKey = `glob_glow_${(r * 1.25).toFixed(3)}`;
  const glowGeo = getCachedGeo(glowGeoKey, () => new THREE.SphereGeometry(r * 1.25, 8, 6));

  const coreMat = getCachedMat(config.colors.core);
  const glowMat = getCachedMat(config.colors.glow ?? config.colors.core, {
    additive: true,
    opacity: 0.38,
    transparent: true,
  });

  const coreMesh = new THREE.Mesh(coreGeo, coreMat);
  const glowMesh = new THREE.Mesh(glowGeo, glowMat);

  const root = new THREE.Group();
  root.add(coreMesh);
  root.add(glowMesh);

  // Specular sheen dot
  const dotGeoKey = `glob_dot_${(r * 0.25).toFixed(3)}`;
  const dotGeo = getCachedGeo(dotGeoKey, () => new THREE.SphereGeometry(r * 0.25, 4, 4));
  const dotMat = getCachedMat(0xffffff, { additive: true, opacity: 0.85 });
  const accentMesh = new THREE.Mesh(dotGeo, dotMat);
  accentMesh.position.set(r * 0.45, r * 0.5, r * 0.45);
  root.add(accentMesh);

  return { root, coreMesh, glowMesh, accentMesh };
}

/**
 * Creates an energy plasma dart/beam with luminous inner core and diamond corona.
 */
export function createBeamBundle(config: ProjectileVfxConfig): ProjectileMeshBundle {
  const r = config.dimensions.radius;
  const len = config.dimensions.length ?? r * 4.5;

  const coreGeoKey = `beam_core_${r.toFixed(3)}_${len.toFixed(3)}`;
  const coreGeo = getCachedGeo(coreGeoKey, () => {
    const geo = new THREE.CylinderGeometry(r * 0.3, r, len, 6);
    geo.rotateX(Math.PI / 2);
    return geo;
  });

  const glowGeoKey = `beam_glow_${(r * 1.6).toFixed(3)}_${(len * 1.1).toFixed(3)}`;
  const glowGeo = getCachedGeo(glowGeoKey, () => {
    const geo = new THREE.CylinderGeometry(r * 0.5, r * 1.6, len * 1.1, 6);
    geo.rotateX(Math.PI / 2);
    return geo;
  });

  const coreMat = getCachedMat(config.colors.core);
  const glowMat = getCachedMat(config.colors.glow ?? config.colors.core, {
    additive: true,
    opacity: 0.55,
    transparent: true,
  });

  const coreMesh = new THREE.Mesh(coreGeo, coreMat);
  const glowMesh = new THREE.Mesh(glowGeo, glowMat);

  const root = new THREE.Group();
  root.add(coreMesh);
  root.add(glowMesh);

  return { root, coreMesh, glowMesh };
}

/**
 * Creates a thrown blade, ninja shuriken, or flat discus with sharp bevels.
 */
export function createBladeBundle(config: ProjectileVfxConfig): ProjectileMeshBundle {
  const r = config.dimensions.radius;

  if (config.kind === "shuriken") {
    // 4-pointed crossed ninja star
    const starGeoKey = `shuriken_${r.toFixed(3)}`;
    const starGeo = getCachedGeo(starGeoKey, () => {
      const g1 = new THREE.BoxGeometry(r * 2.2, 0.03, r * 0.4);
      const g2 = new THREE.BoxGeometry(r * 0.4, 0.03, r * 2.2);
      // Combine using plain group inside bundle
      return g1;
    });
    const coreMat = getCachedMat(config.colors.core);
    const coreMesh = new THREE.Mesh(starGeo, coreMat);

    const crossGeoKey = `shuriken_cross_${r.toFixed(3)}`;
    const crossGeo = getCachedGeo(crossGeoKey, () => new THREE.BoxGeometry(r * 0.4, 0.03, r * 2.2));
    const accentMesh = new THREE.Mesh(crossGeo, coreMat);

    const root = new THREE.Group();
    root.add(coreMesh);
    root.add(accentMesh);
    return { root, coreMesh, accentMesh };
  }

  // Flat discus / plate (e.g. Jester plate) or needle spine
  const discGeoKey = `blade_disc_${r.toFixed(3)}`;
  const discGeo = getCachedGeo(discGeoKey, () => new THREE.CylinderGeometry(r, r, 0.05, 12));
  const coreMat = getCachedMat(config.colors.core);
  const coreMesh = new THREE.Mesh(discGeo, coreMat);

  const glowGeoKey = `blade_rim_${(r * 1.1).toFixed(3)}`;
  const glowGeo = getCachedGeo(glowGeoKey, () => new THREE.CylinderGeometry(r * 1.1, r * 1.1, 0.02, 12));
  const glowMat = getCachedMat(config.colors.glow ?? 0xffffff, {
    additive: true,
    opacity: 0.4,
    transparent: true,
  });
  const glowMesh = new THREE.Mesh(glowGeo, glowMat);

  const root = new THREE.Group();
  root.add(coreMesh);
  root.add(glowMesh);

  return { root, coreMesh, glowMesh };
}

/**
 * Creates an iron bomb / ordnance model with top neck and sparking fuse.
 */
export function createBombBundle(config: ProjectileVfxConfig): ProjectileMeshBundle {
  const r = config.dimensions.radius;

  const coreGeoKey = `bomb_body_${r.toFixed(3)}`;
  const coreGeo = getCachedGeo(coreGeoKey, () => new THREE.SphereGeometry(r, 10, 8));
  const coreMat = getCachedMat(config.colors.core);
  const coreMesh = new THREE.Mesh(coreGeo, coreMat);

  // Top neck collar
  const neckGeoKey = `bomb_neck_${(r * 0.3).toFixed(3)}`;
  const neckGeo = getCachedGeo(neckGeoKey, () => {
    const geo = new THREE.CylinderGeometry(r * 0.25, r * 0.32, r * 0.35, 8);
    geo.translate(0, r * 0.95, 0);
    return geo;
  });
  const neckMat = getCachedMat(config.colors.accent ?? 0x475569);
  const accentMesh = new THREE.Mesh(neckGeo, neckMat);

  // Fuse spark tip
  const sparkGeoKey = `bomb_spark_${(r * 0.2).toFixed(3)}`;
  const sparkGeo = getCachedGeo(sparkGeoKey, () => {
    const geo = new THREE.SphereGeometry(r * 0.2, 6, 6);
    geo.translate(0, r * 1.25, 0);
    return geo;
  });
  const sparkMat = getCachedMat(config.colors.glow ?? 0xfacc15, {
    additive: true,
    opacity: 0.9,
    transparent: true,
  });
  const glowMesh = new THREE.Mesh(sparkGeo, sparkMat);

  const root = new THREE.Group();
  root.add(coreMesh);
  root.add(accentMesh);
  root.add(glowMesh);

  return { root, coreMesh, glowMesh, accentMesh };
}

/**
 * Creates a heavy iron dumbbell projectile (dual hexagonal weight plates + central chrome handle bar).
 */
export function createDumbbellBundle(config: ProjectileVfxConfig): ProjectileMeshBundle {
  const r = config.dimensions.radius;
  const len = config.dimensions.length ?? r * 2.8;

  const plateGeoKey = `dumbbell_plate_${r.toFixed(3)}`;
  const plateGeo = getCachedGeo(plateGeoKey, () => {
    const geo = new THREE.CylinderGeometry(r, r, len * 0.26, 6);
    geo.rotateZ(Math.PI / 2);
    return geo;
  });

  const barGeoKey = `dumbbell_bar_${(r * 0.28).toFixed(3)}_${(len * 0.85).toFixed(3)}`;
  const barGeo = getCachedGeo(barGeoKey, () => {
    const geo = new THREE.CylinderGeometry(r * 0.28, r * 0.28, len * 0.85, 8);
    geo.rotateZ(Math.PI / 2);
    return geo;
  });

  const coreMat = getCachedMat(config.colors.core);
  const accentMat = getCachedMat(config.colors.accent ?? 0x94a3b8);
  const glowMat = getCachedMat(config.colors.glow ?? config.colors.core, {
    additive: true,
    opacity: 0.35,
    transparent: true,
  });

  const leftPlate = new THREE.Mesh(plateGeo, coreMat);
  leftPlate.position.set(-len * 0.38, 0, 0);

  const rightPlate = new THREE.Mesh(plateGeo, coreMat);
  rightPlate.position.set(len * 0.38, 0, 0);

  const barMesh = new THREE.Mesh(barGeo, accentMat);

  const glowMesh = new THREE.Mesh(plateGeo, glowMat);
  glowMesh.scale.set(1.15, 1.15, 1.15);

  const root = new THREE.Group();
  root.add(barMesh);
  root.add(leftPlate);
  root.add(rightPlate);

  return { root, coreMesh: leftPlate, glowMesh, accentMesh: barMesh };
}

/**
 * Master dispatcher to assemble any configured projectile mesh bundle.
 */
export function buildProjectileBundle(config: ProjectileVfxConfig): ProjectileMeshBundle {
  switch (config.archetype) {
    case "bullet":
      return createBulletBundle(config);
    case "flame":
      return createFlameBundle(config);
    case "glob":
      return createGlobBundle(config);
    case "beam":
      return createBeamBundle(config);
    case "blade":
      return createBladeBundle(config);
    case "bomb":
      return createBombBundle(config);
    case "dumbbell":
      return createDumbbellBundle(config);
    case "condiment":
    default:
      return createGlobBundle(config);
  }
}

/**
 * Creates and returns the compound root Object3D (Mesh or Group) for a given projectile kind.
 */
export function createProjectileMesh(kind: string): THREE.Object3D {
  const config = getProjectileVfxConfig(kind);
  const bundle = buildProjectileBundle(config);
  return bundle.root;
}

/**
 * Clears GPU caches during game level teardown.
 */
export function disposeProjectileFactoryCache(): void {
  for (const geo of _geoCache.values()) geo.dispose();
  for (const mat of _matCache.values()) mat.dispose();
  _geoCache.clear();
  _matCache.clear();
}
