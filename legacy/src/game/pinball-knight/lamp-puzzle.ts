/**
 * LIGHT PUZZLE runtime — the sealed vault chest, its unlock, and the reward.
 *
 * Authoring (maze/lamp-puzzle.ts) picks the tiles; this owns the THREE mesh, the
 * lamp-lit progression, and the payout. Braziers themselves are `lamp`
 * pinball-parts (render/pinball-parts.ts buildLamp + animator, handler in
 * entities/pinball-collide.ts) — they call `lightLamp(part)` here on contact.
 *
 * The vault is a CHEST, not a carved sealed room, so the "every floor tile
 * reachable" pipeline invariant is never touched: before the puzzle is solved
 * the reward simply doesn't exist as ground items yet; opening spawns it.
 */
import * as THREE from "three";
import { state } from "./state";
import type { PinballPart } from "./state";
import type { LampPuzzlePlan } from "./maze/lamp-puzzle";
import { type Grid, tileCenter } from "./maze/generator";
import { createStaticSprite } from "./engine/render/sprite";
import { ITEM_PAINTS } from "./render/cel-painter";
import { showToast, showPickupNote } from "./ui";
import { sfxTarget, sfxBossReveal, sfxCoin } from "./sfx";

const CHEST_UNLIT = 0x6b1f2a; // dim blood-iron while sealed
const CHEST_LIT = 0xf0c040; // gold as braziers light
const CHEST_OPEN = 0xa050e0; // arcane portal-violet on open

/** Build the sealed vault chest at (x,z). Stashes its glow material for the
 * per-frame pulse; the reliquary "lid" lifts on open. */
function buildVaultChest(x: number, z: number): THREE.Group {
  const gp = new THREE.Group();
  const glowMat = new THREE.MeshStandardMaterial({ color: 0x2a2018, emissive: CHEST_UNLIT, emissiveIntensity: 0.5, roughness: 0.7, metalness: 0.3 });
  const trimMat = new THREE.MeshStandardMaterial({ color: 0x8a6a2e, emissive: 0x201810, emissiveIntensity: 0.3, roughness: 0.5, metalness: 0.6 });
  const base = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.42, 0.5), glowMat);
  base.position.y = 0.21;
  base.castShadow = true;
  const lid = new THREE.Mesh(new THREE.BoxGeometry(0.74, 0.22, 0.54), trimMat);
  lid.position.y = 0.52;
  // A hovering arcane sigil above the chest — the "sealed" tell, spun each frame.
  const sigil = new THREE.Mesh(new THREE.TorusGeometry(0.26, 0.03, 6, 18), new THREE.MeshStandardMaterial({ color: 0x1a1622, emissive: CHEST_UNLIT, emissiveIntensity: 1.2, roughness: 0.4 }));
  sigil.rotation.x = Math.PI / 2;
  sigil.position.y = 0.95;
  gp.add(base, lid, sigil);
  gp.position.set(x, 0, z);
  gp.userData.glow = glowMat;
  gp.userData.sigilMat = sigil.material as THREE.MeshStandardMaterial;
  gp.userData.lid = lid;
  gp.userData.sigil = sigil;
  return gp;
}

/** Install the floor's light puzzle: build the chest, seed state.lampPuzzle. */
export function installLampPuzzle(plan: LampPuzzlePlan, g: Grid, scene: THREE.Scene): void {
  const c = tileCenter(g, plan.vault.i, plan.vault.j);
  const chest = buildVaultChest(c.x, c.z);
  scene.add(chest);
  state.lampPuzzle = {
    total: plan.lamps.length,
    lit: 0,
    unlocked: false,
    vault: { i: plan.vault.i, j: plan.vault.j, x: c.x, z: c.z },
    loot: plan.loot,
    chest,
    openT: -1,
  };
  // Dev/QA hook (mirrors the __dungeon* probes): brazier + vault world coords so
  // a headless harness can warp the ball onto each lamp and watch the vault open.
  if (typeof window !== "undefined") {
    (window as unknown as { __lampPuzzle?: () => unknown }).__lampPuzzle = () => {
      const pz = state.lampPuzzle;
      if (!pz) return null;
      const lamps = state.pinballParts.filter((q) => q.kind === "lamp").map((q) => ({ x: q.x, z: q.z, lit: !!q.lit }));
      return { total: pz.total, lit: pz.lit, unlocked: pz.unlocked, vault: pz.vault, lamps };
    };
  }
}

/**
 * A brazier was rolled over — light it (idempotent). Updates progress and, on
 * the last one, opens the vault. Called from the `lamp` part handler.
 */
export function lightLamp(part: PinballPart): void {
  const pz = state.lampPuzzle;
  if (!pz || part.lit) return;
  part.lit = true;
  part.hitT = 0;
  pz.lit += 1;
  state.vfx?.burst(part.x, 0.7, part.z, CHEST_LIT, 16, 5);
  state.shakeT = Math.max(state.shakeT, 0.12);
  sfxTarget();
  state.hudDirty = true;
  if (pz.lit >= pz.total) openVault();
  else showPickupNote(`🔥 BRAZIER ${pz.lit}/${pz.total} — light them all`);
}

/** Open the sealed vault: spawn the loot, blow the FX, flag it done. */
function openVault(): void {
  const pz = state.lampPuzzle;
  if (!pz || pz.unlocked || !state.scene) return;
  pz.unlocked = true;
  pz.openT = 0;
  const { x, z } = pz.vault;
  // Reward = the rolled loot table, spread in a little ring around the chest.
  pz.loot.forEach((id, k) => {
    if (!state.scene || !ITEM_PAINTS[id]) return;
    const ang = (k / pz.loot.length) * Math.PI * 2;
    const lx = x + Math.cos(ang) * 0.9;
    const lz = z + Math.sin(ang) * 0.9;
    const sprite = createStaticSprite(ITEM_PAINTS[id]);
    sprite.mesh.position.set(lx, 0, lz);
    state.scene.add(sprite.mesh);
    state.groundItems.push({ kind: "potion", id, x: lx, z: lz, sprite, bobPhase: Math.random() * Math.PI * 2 });
  });
  state.vfx?.burst(x, 0.8, z, CHEST_OPEN, 34, 6);
  state.vfx?.sparks(x, 0.6, z, 0, 0, 20);
  state.shakeT = Math.max(state.shakeT, 0.4);
  state.hitstopT = Math.max(state.hitstopT, 0.06);
  sfxBossReveal();
  sfxCoin();
  showToast("🗝️ VAULT UNSEALED", "every brazier lit — the reliquary opens");
  state.hudDirty = true;
}

let animT = 0;

/** Per-frame: pulse the chest glow with progress, spin the sigil, lift the lid
 * on open. Cheap; called from the dungeon frame loop. */
export function updateLampPuzzle(dt: number): void {
  animT += dt;
  const pz = state.lampPuzzle;
  if (!pz || !pz.chest) return;
  const glow = pz.chest.userData.glow as THREE.MeshStandardMaterial | undefined;
  const sigilMat = pz.chest.userData.sigilMat as THREE.MeshStandardMaterial | undefined;
  const sigil = pz.chest.userData.sigil as THREE.Object3D | undefined;
  const lid = pz.chest.userData.lid as THREE.Object3D | undefined;
  sigil?.rotateZ(dt * (pz.unlocked ? 3.5 : 1.2));
  const frac = pz.total > 0 ? pz.lit / pz.total : 0;
  if (pz.unlocked) {
    pz.openT += dt;
    const t = Math.min(1, pz.openT / 0.6);
    if (lid) lid.position.y = 0.52 + t * 0.5; // lid lifts + drifts up
    if (glow) {
      glow.emissive.setHex(CHEST_OPEN);
      glow.emissiveIntensity = 1.6 + 0.5 * Math.sin(animT * 5);
    }
    if (sigilMat) {
      sigilMat.emissive.setHex(CHEST_OPEN);
      sigilMat.emissiveIntensity = Math.max(0, 2 - pz.openT * 2); // sigil fades as the seal breaks
    }
    return;
  }
  // Sealed: warms from blood-iron toward gold as braziers light.
  if (glow) {
    glow.emissive.setHex(frac > 0 ? CHEST_LIT : CHEST_UNLIT);
    glow.emissiveIntensity = 0.4 + frac * 1.1 + 0.2 * Math.sin(animT * 2.5);
  }
  if (sigilMat) sigilMat.emissiveIntensity = 0.8 + frac * 1.4 + 0.3 * Math.sin(animT * 3);
}

/** Tear down the floor's puzzle chest (per-floor + full teardown). */
export function disposeLampPuzzle(scene: THREE.Scene | null): void {
  const pz = state.lampPuzzle;
  if (pz?.chest) {
    scene?.remove(pz.chest);
    pz.chest.traverse((o) => {
      const m = o as THREE.Mesh;
      m.geometry?.dispose?.();
      const mat = m.material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
      else mat?.dispose?.();
    });
  }
  state.lampPuzzle = null;
}
