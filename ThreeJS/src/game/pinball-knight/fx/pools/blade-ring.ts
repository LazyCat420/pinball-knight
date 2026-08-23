/**
 * Orbiting blades — the Blade Storm ring made visible.
 *
 * Extracted from the 1700-line `vfx.ts` when it moved into `fx/`. Behaviour is
 * unchanged — only the file boundary is new, and the shared constants it used to
 * hold privately now live in `./shared.ts` so eight modules cannot drift apart.
 */
import * as THREE from "three";
import { CAMERA_YAW, CAMERA_TILT } from "../../constants";

/**
 * ORBITING BLADES — Blade Storm, made visible.
 *
 * Every other pool here fires an EVENT that then decays. A buff that lasts five
 * seconds is a STATE, so this pool is keep-alive instead: `refresh()` places the
 * blades for this frame and re-arms a short hold; `update()` hides them once the
 * caller stops refreshing (i.e. the buff lapsed) — no teardown call to forget,
 * and a dropped frame just leaves the ring up a beat longer.
 *
 * The blades are the SLASH crescent texture on billboards, rolled in screen
 * space so each one leans along its own tangent — the same trick the melee
 * slash uses to aim a flat quad in an iso view.
 */
const BLADE_MAX = 6;
const BLADE_HOLD = 0.12; // seconds a placed blade survives without a refresh

export class BladeRing {
  readonly group: THREE.Group;
  private meshes: THREE.Mesh[] = [];
  private geo: THREE.PlaneGeometry;
  private hold = 0;

  constructor(tex: THREE.CanvasTexture) {
    this.group = new THREE.Group();
    this.geo = new THREE.PlaneGeometry(0.85, 0.85);
    for (let i = 0; i < BLADE_MAX; i++) {
      const mat = new THREE.MeshBasicMaterial({
        map: tex,
        transparent: true,
        depthWrite: false,
        depthTest: true,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
        opacity: 0.85,
      });
      const m = new THREE.Mesh(this.geo, mat);
      m.rotation.order = "YXZ";
      m.visible = false;
      m.renderOrder = 12;
      this.meshes.push(m);
      this.group.add(m);
    }
  }

  refresh(x: number, y: number, z: number, angle: number, count: number, radius: number, color: number): void {
    this.hold = BLADE_HOLD;
    const n = Math.min(count, BLADE_MAX);
    for (let i = 0; i < BLADE_MAX; i++) {
      const m = this.meshes[i];
      if (i >= n) {
        m.visible = false;
        continue;
      }
      const a = angle + (i / n) * Math.PI * 2;
      m.position.set(x + Math.cos(a) * radius, y, z + Math.sin(a) * radius);
      // Lean the crescent along the orbit tangent (screen-space roll), then
      // billboard it to the fixed iso camera like every other flat FX quad.
      m.rotation.z = -a - Math.PI / 2;
      m.rotation.y = CAMERA_YAW;
      m.rotation.x = -CAMERA_TILT;
      const mat = m.material as THREE.MeshBasicMaterial;
      mat.color.setHex(color);
      // A touch of per-blade flicker so the ring shimmers instead of reading as
      // a rigid decal spinning at a constant brightness.
      mat.opacity = 0.7 + Math.random() * 0.3;
      m.scale.setScalar(0.9 + Math.random() * 0.2);
      m.visible = true;
    }
  }

  update(dt: number): void {
    if (this.hold <= 0) return;
    this.hold -= dt;
    if (this.hold > 0) return;
    for (const m of this.meshes) m.visible = false;
  }

  /** See `warmupReveal` — slot 0 stands in for the pool at prewarm time. */
  warmupTarget(): THREE.Object3D {
    return this.meshes[0];
  }

  dispose(): void {
    this.geo.dispose();
    for (const m of this.meshes) (m.material as THREE.Material).dispose();
  }
}
