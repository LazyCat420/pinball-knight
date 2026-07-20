/**
 * FLOATING DAMAGE NUMBERS — the readout that tells you a hit actually landed
 * and how hard.
 *
 * Like everything in vfx.ts these are WORLD-SPACE objects drawn into the scene,
 * not DOM overlays: they get pixelated, palette-quantized and bloomed with the
 * rest of the frame, and they sit at the point of impact in the isometric
 * projection rather than floating in a flat HUD layer. (The combo `×N` flash in
 * ui.ts is the other thing — that one IS a centred DOM element, and is
 * deliberately unrelated.)
 *
 * BILLBOARDING: the dungeon camera is FIXED (constants.CAMERA_YAW / CAMERA_TILT),
 * so — exactly like SlashPool — a quad faces it by taking the inverse of those
 * two angles under a YXZ rotation order. No per-frame lookAt needed.
 *
 * POOLING: a busy floor throws a lot of hits (every projectile pellet, every
 * burn tick, every pin in a strike), so nothing is allocated per damage event.
 * The pool builds POOL_SIZE meshes, canvases, textures and materials ONCE at
 * construction and cycles them with a ring cursor. A spent slot just goes
 * invisible. Spawning redraws one small 128x64 canvas and flags the texture —
 * bounded work, no GC churn, no mesh/material creation in the hot path.
 *
 * PIXEL FONT GOTCHA: `@font-face` alone does NOT make a webfont available to
 * canvas — `ctx.fillText` silently falls back to a smooth system font until the
 * face is actually loaded. So the pool awaits `awaitPixelFonts()` and, because
 * the very first hits can land before that resolves, remembers which live slots
 * were drawn with the fallback and REDRAWS them once the real face arrives.
 * Only digits are ever drawn: Press Start 2P has 0-9 and A-Z but no glyphs for
 * symbols like ●◆★, which would silently fall back and break the aesthetic.
 */
import * as THREE from "three";
import { CAMERA_YAW, CAMERA_TILT, PPU } from "../constants";
import { awaitPixelFonts, labelFont } from "../pixel-fonts";

/**
 * Who took the hit. Convention: damage the player DEALS reads light (white →
 * gold as it gets bigger), damage the player TAKES reads red.
 */
export type DamageTextKind = "out" | "crit" | "in";

/** Ring-buffer size. Enough for a flamethrower cone into a pin crew. */
export const POOL_SIZE = 32;

/**
 * Texture cell. 128x64 at PPU=64 means the quad below is exactly 2x1 world
 * units, i.e. ONE canvas texel per render-target pixel at scale 1 — which is
 * what keeps the glyphs crisp instead of resampled through the pixel pass.
 */
const TEX_W = 128;
const TEX_H = 64;
const QUAD_W = TEX_W / PPU;
const QUAD_H = TEX_H / PPU;

/** Glyph cell size for the label face (Press Start 2P wants multiples of 8). */
const FONT_PX = 24;

export interface DamageTextStyle {
  /** sRGB tint multiplied over the white glyphs (the outline stays black). */
  color: number;
  /** Quad scale multiplier — bigger hits read bigger. */
  scale: number;
  /** Seconds the number lives. */
  life: number;
}

/**
 * Format a damage amount for display. Damage is fractional internally (card
 * percent multipliers, rage, pinball synergy) but a floating "3.7" reads as
 * noise, so it rounds — and a connected hit never shows "0", because a hit that
 * shows nothing reads as a miss.
 *
 * Digits only, by design: see the Press Start 2P note in the file header.
 */
export function formatDamage(amount: number): string {
  if (!Number.isFinite(amount) || amount <= 0) return "";
  return String(Math.max(1, Math.round(amount)));
}

/**
 * Colour / size / lifetime for a hit. Size ramps with magnitude so a chip and a
 * haymaker are distinguishable at a glance without reading the digits, and a
 * crit is a clear step above anything a normal hit can reach.
 */
export function damageTextStyle(amount: number, kind: DamageTextKind): DamageTextStyle {
  // 0 at 1 damage, saturating at 1 around 24 — a curve, so the interesting
  // spread sits in the low numbers where most hits actually land.
  const mag = Math.min(1, Math.max(0, Math.log2(Math.max(1, amount)) / 4.6));
  if (kind === "in") {
    // Damage TAKEN. Always legible, always red — you must never miss this one.
    return { color: 0xff5563, scale: 1.15 + mag * 0.55, life: 0.95 };
  }
  if (kind === "crit") {
    // Amplified hit (rage / pinball synergy): bigger, hotter, hangs longer.
    return { color: 0xffd24a, scale: 1.5 + mag * 0.7, life: 1.05 };
  }
  // Ordinary outgoing damage: near-white for chip, warming toward gold as it
  // climbs, so a big number also reads as a HOT number.
  return { color: mag > 0.55 ? 0xfff3c8 : 0xffffff, scale: 0.85 + mag * 0.55, life: 0.8 };
}

/**
 * Per-frame presentation of a number, as a pure function of its age. Split out
 * from the pool so the motion curve is testable without a WebGL context.
 *
 * - POP: a fast scale overshoot in the first beat, so the number punches in
 *   rather than materialising.
 * - RISE: decelerating upward drift (an ease-out, not linear) — it lifts off
 *   the impact then settles, which reads better than constant velocity.
 * - FADE: full opacity for the first half, then out. Numbers that start fading
 *   immediately are unreadable at speed.
 */
export function damageTextFrame(age: number, life: number): { alpha: number; scale: number; rise: number } {
  const t = life > 0 ? Math.min(1, Math.max(0, age / life)) : 1;
  const pop = t < 0.16 ? 1 + 0.45 * (1 - t / 0.16) : 1;
  const rise = 0.95 * (1 - (1 - t) * (1 - t)); // ease-out: fast then settling
  const alpha = t < 0.5 ? 1 : 1 - (t - 0.5) / 0.5;
  return { alpha, scale: pop, rise };
}

interface Slot {
  mesh: THREE.Mesh;
  mat: THREE.MeshBasicMaterial;
  canvas: HTMLCanvasElement;
  tex: THREE.CanvasTexture;
  age: number;
  life: number;
  scale: number;
  /** World position the number rises FROM. */
  x: number;
  y: number;
  z: number;
  /** Text currently painted, kept so a slot can be repainted when fonts land. */
  text: string;
  /** True if `text` was painted with the system fallback face, not the pixel one. */
  staleFont: boolean;
}

/**
 * Draw one number into its cell: white glyphs with a hard black outline (so it
 * stays legible over any floor) centred in the canvas. Glyphs are WHITE because
 * the tint lives on the material — that way a colour change costs no redraw,
 * and multiplying by the tint leaves the black outline black.
 */
function paintNumber(canvas: HTMLCanvasElement, text: string): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.clearRect(0, 0, TEX_W, TEX_H);
  if (!text) return;
  ctx.font = labelFont(FONT_PX);
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.lineJoin = "round";
  ctx.miterLimit = 2;
  // Round the anchor to whole pixels — a half-pixel origin fringes the glyph
  // edges, which is exactly what the pixel pass then amplifies.
  const cx = Math.round(TEX_W / 2);
  const cy = Math.round(TEX_H / 2);
  ctx.lineWidth = 6;
  ctx.strokeStyle = "#000000";
  ctx.strokeText(text, cx, cy);
  ctx.fillStyle = "#ffffff";
  ctx.fillText(text, cx, cy);
}

/**
 * The pooled world-space damage-number system. Owned by the VFX system (see
 * vfx.ts `createVfx`), which adds the group to the scene, ticks it and disposes
 * it — so call sites only ever touch `state.vfx?.damage(...)`.
 */
export class DamageTextPool {
  readonly group: THREE.Group;
  private slots: Slot[] = [];
  private geo: THREE.PlaneGeometry;
  private cursor = 0;
  private fontsReady = false;

  constructor() {
    this.group = new THREE.Group();
    this.geo = new THREE.PlaneGeometry(QUAD_W, QUAD_H);

    for (let i = 0; i < POOL_SIZE; i++) {
      const canvas = document.createElement("canvas");
      canvas.width = TEX_W;
      canvas.height = TEX_H;
      const tex = new THREE.CanvasTexture(canvas);
      // NEAREST both ways: this is pixel art, it must never be smoothed.
      tex.magFilter = THREE.NearestFilter;
      tex.minFilter = THREE.NearestFilter;
      tex.generateMipmaps = false;
      tex.colorSpace = THREE.SRGBColorSpace; // scene buffer is linear — see vfx.ts
      const mat = new THREE.MeshBasicMaterial({
        map: tex,
        transparent: true,
        depthWrite: false,
        depthTest: false, // numbers must never be swallowed by a wall or a body
        side: THREE.DoubleSide,
      });
      const mesh = new THREE.Mesh(this.geo, mat);
      mesh.rotation.order = "YXZ";
      mesh.rotation.y = CAMERA_YAW;
      mesh.rotation.x = -CAMERA_TILT;
      mesh.visible = false;
      mesh.renderOrder = 20; // above the slash arcs (12) and the ghosts (9)
      this.group.add(mesh);
      this.slots.push({
        mesh, mat, canvas, tex,
        age: 0, life: 0, scale: 1,
        x: 0, y: 0, z: 0,
        text: "", staleFont: false,
      });
    }

    // Prime the pixel face. Anything drawn before this resolves used the system
    // fallback, so those live slots get repainted the moment the real one lands.
    void awaitPixelFonts().then(() => {
      this.fontsReady = true;
      for (const s of this.slots) {
        if (s.life > 0 && s.staleFont) {
          paintNumber(s.canvas, s.text);
          s.tex.needsUpdate = true;
          s.staleFont = false;
        }
      }
    });
  }

  /**
   * Throw a number at a world point. `amount` is the damage actually dealt;
   * sub-1 and non-positive amounts are dropped rather than shown as "0".
   */
  spawn(x: number, y: number, z: number, amount: number, kind: DamageTextKind): void {
    const text = formatDamage(amount);
    if (!text) return;
    const style = damageTextStyle(amount, kind);

    const s = this.slots[this.cursor];
    this.cursor = (this.cursor + 1) % POOL_SIZE;

    if (s.text !== text || s.staleFont) {
      paintNumber(s.canvas, text);
      s.tex.needsUpdate = true;
      s.text = text;
    }
    s.staleFont = !this.fontsReady;

    // Scatter horizontally so a burst of hits on one body doesn't stack into an
    // illegible pile. Screen-x under the iso yaw is the world (x-z) diagonal.
    const jitter = (Math.random() - 0.5) * 0.5;
    s.x = x + jitter;
    s.y = y;
    s.z = z - jitter;
    s.age = 0;
    s.life = style.life;
    s.scale = style.scale;
    s.mat.color.setHex(style.color);
    s.mat.opacity = 1;
    s.mesh.position.set(s.x, s.y, s.z);
    s.mesh.scale.setScalar(style.scale);
    s.mesh.visible = true;
  }

  update(dt: number): void {
    for (const s of this.slots) {
      if (s.life <= 0) continue;
      s.age += dt;
      if (s.age >= s.life) {
        s.life = 0;
        s.mesh.visible = false;
        continue;
      }
      const f = damageTextFrame(s.age, s.life);
      s.mesh.position.y = s.y + f.rise;
      s.mesh.scale.setScalar(s.scale * f.scale);
      s.mat.opacity = f.alpha;
    }
  }

  dispose(): void {
    this.geo.dispose();
    for (const s of this.slots) {
      s.tex.dispose();
      s.mat.dispose();
    }
    this.slots.length = 0;
  }
}
