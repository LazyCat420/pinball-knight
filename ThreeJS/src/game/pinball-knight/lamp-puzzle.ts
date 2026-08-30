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
 *
 * TWO ways in, and the second one is the guaranteed one:
 *   · light every brazier          → `lightLamp` → opens it EARLY, mid-floor
 *   · kill the floor's overlord    → `openVaultOnBossDefeat` (run/descend.ts
 *                                    dropBossReward, + the co-op replica path)
 */
import * as THREE from "three";
import { state } from "./state";
import type { PinballPart } from "./state";
import type { LampPuzzlePlan } from "./maze/lamp-puzzle";
import { type Grid, tileCenter } from "./maze/generator";
import { createStaticSprite } from "./engine/render/sprite";
import { PALETTE_HEX } from "./render/palette";
import { ITEM_PAINTS } from "./render/cel-painter";
import { showToast, showPickupNote } from "./ui";
import { sfxTarget, sfxBossReveal, sfxCoin } from "./sfx";

const CHEST_UNLIT = 0x6b1f2a; // dim blood-iron while sealed
const CHEST_LIT = 0xf0c040; // gold as braziers light
const CHEST_OPEN = 0xa050e0; // arcane portal-violet on open

// The carcass reads as an OBJECT, so it comes out of the dungeon palette rather
// than being invented here — the pixel pass quantizes to these 32 entries and an
// off-palette brown would land on whichever neighbour won the luma match.
const C_WOOD = PALETTE_HEX[28]; // leather mid — the planks
const C_WOOD_DK = PALETTE_HEX[26]; // leather shadow — feet, keyhole
const C_IRON = PALETTE_HEX[19]; // steel dark — every band, and what carries the glow
const C_BRASS = PALETTE_HEX[16]; // flame — the lockplate and its hasp

/** Chest dimensions, in world units (a tile is 1). */
const W = 0.82; // width, across the hinge — a chest is WIDER than it is tall
const D = 0.46; // depth
const FOOT = 0.05; // stubby feet, so it sits ON the floor instead of in it
const BODY_H = 0.26;
const TOP = FOOT + BODY_H; // the rim the lid is hinged at
const R = D / 2; // the lid dome's radius — half the depth, so it domes flush

/**
 * How far the lid swings, radians. Past vertical (109°) on purpose: under a 45°
 * iso camera a lid that stops AT vertical is a thin edge-on sliver and the chest
 * just looks lidless. Leaning it back shows its face and clears the mouth.
 */
const LID_OPEN = 1.9;

/**
 * Build the sealed vault chest at (x,z).
 *
 * A plank carcass on four feet, strapped in iron, brass-locked, under a barrel
 * lid on a real HINGE — the lid is a pivot group at the back rim, so opening is
 * a swing rather than a box drifting upward off the base (which is what the
 * first pass did, and what made it read as scenery rather than a container).
 *
 * The glow the puzzle drives lives on the IRONWORK only. A chest that pulses
 * all over is a lamp; a chest whose bands pulse is sealed. `userData` stashes
 * the handles `updateLampPuzzle` animates: the iron material, the sigil and its
 * material, the hinge, and the mouth that lights up on open.
 *
 * GRID-ALIGNED, deliberately: the iso camera is yawed 45°, so an axis-aligned
 * chest is already the three-quarter view — front, side and the curve of the
 * lid all on screen at once. Yawing it flat-on to the camera was tried and
 * killed the dome; it rendered as a rectangle with straps on it.
 */
function buildVaultChest(x: number, z: number): THREE.Group {
  const gp = new THREE.Group();

  const ironMat = new THREE.MeshStandardMaterial({ color: C_IRON, emissive: CHEST_UNLIT, emissiveIntensity: 0.5, roughness: 0.55, metalness: 0.6 });
  const woodMat = new THREE.MeshStandardMaterial({ color: C_WOOD, roughness: 0.9, metalness: 0.05 });
  const woodDkMat = new THREE.MeshStandardMaterial({ color: C_WOOD_DK, roughness: 0.95, metalness: 0 });
  const brassMat = new THREE.MeshStandardMaterial({ color: C_BRASS, emissive: 0x2a1a06, emissiveIntensity: 0.4, roughness: 0.35, metalness: 0.8 });
  // The mouth of the box: black until the vault opens onto it.
  const innerMat = new THREE.MeshStandardMaterial({ color: 0x120c18, emissive: CHEST_OPEN, emissiveIntensity: 0, roughness: 1 });

  // ── Carcass ──
  const body = new THREE.Mesh(new THREE.BoxGeometry(W, BODY_H, D), woodMat);
  body.position.y = FOOT + BODY_H / 2;
  body.castShadow = true;
  gp.add(body);

  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const foot = new THREE.Mesh(new THREE.BoxGeometry(0.11, FOOT + 0.02, 0.11), woodDkMat);
      foot.position.set(sx * (W / 2 - 0.07), (FOOT + 0.02) / 2, sz * (D / 2 - 0.07));
      gp.add(foot);
    }
  }

  // Vertical straps, proud of the planks on all four sides. Same two x offsets
  // as the lid bands, so strap and band line up when the chest is shut.
  for (const sx of [-0.22, 0.22]) {
    const strap = new THREE.Mesh(new THREE.BoxGeometry(0.075, BODY_H + 0.02, D + 0.03), ironMat);
    strap.position.set(sx, FOOT + BODY_H / 2, 0);
    gp.add(strap);
  }
  // The rim is a FRAME, not a slab. A slab is the whole top face of the chest,
  // and with the lid off it is the biggest surface on screen — so the open chest
  // read as a violet TABLE. Four bars leave the middle to the mouth.
  for (const sz of [-1, 1]) {
    const bar = new THREE.Mesh(new THREE.BoxGeometry(W + 0.03, 0.05, 0.055), ironMat);
    bar.position.set(0, TOP - 0.02, (sz * (D + 0.03)) / 2);
    gp.add(bar);
  }
  for (const sx of [-1, 1]) {
    const bar = new THREE.Mesh(new THREE.BoxGeometry(0.055, 0.05, D + 0.03), ironMat);
    bar.position.set((sx * (W + 0.03)) / 2, TOP - 0.02, 0);
    gp.add(bar);
  }

  // The mouth: what you look INTO once the lid is off. It sits a hair ABOVE the
  // carcass's top face — inside the box it is simply invisible, which is how the
  // first pass ended up with an interior nothing could ever see.
  const mouth = new THREE.Mesh(new THREE.BoxGeometry(W - 0.13, 0.02, D - 0.13), innerMat);
  mouth.position.y = TOP + 0.005;
  gp.add(mouth);

  const lock = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.15, 0.05), brassMat);
  lock.position.set(0, TOP - 0.13, D / 2 + 0.01);
  gp.add(lock);
  const keyhole = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.05, 0.03), woodDkMat);
  keyhole.position.set(0, TOP - 0.17, D / 2 + 0.04);
  gp.add(keyhole);

  // ── Lid, on its hinge at the BACK rim ──
  const lidPivot = new THREE.Group();
  lidPivot.position.set(0, TOP, -R);
  // A half-cylinder: axis rotated onto X so the barrel runs across the chest,
  // theta 0..PI so the surviving half is the DOME (rotation.z = +PI/2 carries it
  // to +y; -PI/2 would bury it under the floor).
  const dome = new THREE.Mesh(new THREE.CylinderGeometry(R, R, W, 16, 1, false, 0, Math.PI), woodMat);
  dome.rotation.z = Math.PI / 2;
  dome.position.z = R;
  dome.castShadow = true;
  lidPivot.add(dome);
  lidPivot.userData.dome = dome; // the half that must end up ABOVE the hinge (vault-chest.test.ts)
  // The half-cylinder has no flat face — this closes it. WOOD, not glow: an
  // emissive underside turns the whole open chest into one violet slab, and the
  // read you want is a wooden lid thrown back off a lit interior.
  const under = new THREE.Mesh(new THREE.BoxGeometry(W, 0.03, D), woodDkMat);
  under.position.set(0, -0.015, R);
  lidPivot.add(under);
  for (const sx of [-0.22, 0.22]) {
    const band = new THREE.Mesh(new THREE.CylinderGeometry(R + 0.02, R + 0.02, 0.075, 16, 1, false, 0, Math.PI), ironMat);
    band.rotation.z = Math.PI / 2;
    band.position.set(sx, 0, R);
    lidPivot.add(band);
  }
  // The hasp: an L of a tab off the lid's front lip and a tongue hanging down
  // OVER the lockplate. It has to stand proud of both — flush with the dome the
  // lock occludes its lower half, and all you see is a stud floating above the
  // lock with a gap under it.
  const tab = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.05, 0.1), brassMat);
  tab.position.set(0, -0.01, D - 0.01);
  lidPivot.add(tab);
  const tongue = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.13, 0.045), brassMat);
  tongue.position.set(0, -0.08, D + 0.03);
  lidPivot.add(tongue);
  gp.add(lidPivot);

  // The hovering arcane sigil — the "sealed" tell, spun each frame.
  const sigil = new THREE.Mesh(new THREE.TorusGeometry(0.26, 0.03, 6, 18), new THREE.MeshStandardMaterial({ color: 0x1a1622, emissive: CHEST_UNLIT, emissiveIntensity: 1.2, roughness: 0.4 }));
  sigil.rotation.x = Math.PI / 2;
  sigil.position.y = 1;
  gp.add(sigil);

  gp.position.set(x, 0, z);
  gp.userData.glow = ironMat;
  gp.userData.sigilMat = sigil.material as THREE.MeshStandardMaterial;
  gp.userData.inner = innerMat;
  gp.userData.lid = lidPivot;
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
  if (pz.lit >= pz.total) openVault("braziers");
  else showPickupNote(`🔥 BRAZIER ${pz.lit}/${pz.total} — light them all`);
}

/**
 * The OVERLORD carried the key.
 *
 * Every floor's exit is boss-gated (spawn/floor-populate.ts), so this is the one
 * unlock a player cannot miss — and it was the whole complaint: the chest stands
 * in the boss chamber (the vault takes the deepest OPEN tile, which is where the
 * stairs and the arena get carved), you kill the boss, and the chest sat there
 * inert with nothing on screen ever mentioning braziers.
 *
 * The brazier route still works and still opens it EARLY, before the fight —
 * this is a floor, not a replacement.
 */
export function openVaultOnBossDefeat(): void {
  openVault("boss");
}

/** Open the sealed vault: spawn the loot, blow the FX, flag it done. */
function openVault(by: "braziers" | "boss"): void {
  const pz = state.lampPuzzle;
  if (!pz || pz.unlocked || !state.scene) return;
  pz.unlocked = true;
  pz.openT = 0;
  // Set INSIDE the guard, not by the caller: a boss kill on a floor whose scene
  // is gone would otherwise leave a sealed vault reporting itself solved.
  if (by === "boss") pz.lit = pz.total; // the HUD/`__lampPuzzle` probe must not say 0/3 over an open chest
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
  // The banner is a SINGLE slot (gui/screens/toasts.ts pushBanner overwrites),
  // and on the boss path "OVERLORD SLAIN" is already in it — so that route gets
  // the queued corner note instead of eating the kill banner.
  if (by === "boss") showPickupNote("🗝️ THE OVERLORD'S KEY — the vault opens");
  else showToast("🗝️ VAULT UNSEALED", "every brazier lit — the reliquary opens");
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
  const lid = pz.chest.userData.lid as THREE.Object3D | undefined; // the hinge group
  const inner = pz.chest.userData.inner as THREE.MeshStandardMaterial | undefined;
  sigil?.rotateZ(dt * (pz.unlocked ? 3.5 : 1.2));
  const frac = pz.total > 0 ? pz.lit / pz.total : 0;
  if (pz.unlocked) {
    pz.openT += dt;
    const t = Math.min(1, pz.openT / 0.6);
    const e = 1 - (1 - t) * (1 - t) * (1 - t); // ease-out: the lid FLIES back, then settles
    if (lid) lid.rotation.x = -LID_OPEN * e; // −x swings the front edge UP and back over the hinge
    if (inner) inner.emissiveIntensity = e * (1.5 + 0.4 * Math.sin(animT * 6));
    if (glow) {
      glow.emissive.setHex(CHEST_OPEN);
      glow.emissiveIntensity = 1.6 + 0.5 * Math.sin(animT * 5);
    }
    if (sigilMat) {
      sigilMat.emissive.setHex(CHEST_OPEN);
      sigilMat.emissiveIntensity = Math.max(0, 2 - pz.openT * 2); // sigil fades as the seal breaks
      // …and then LEAVES. Its own colour is near-black, so a faded sigil is a
      // dark ring hanging over an opened chest forever.
      if (sigil) sigil.visible = pz.openT < 1;
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
