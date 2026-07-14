/**
 * 🗡️ Crypt of the Braindead — lifecycle + loop.
 *
 * PHASE 0: a style sandbox. Static room, two actors, full pixel pipeline, live
 * toggles for every style knob. No input-driven movement, no maze, no AI, no
 * combat — those are Phases 1-3. The point of this build is to look at it and
 * decide whether the 8-bit style is right BEFORE any gameplay gets built on it.
 *
 * Follows the same lifecycle contract as every other game here (see
 * mouse-game/core.ts): fullscreen overlay, its own renderer, setInputOwner on
 * the way in, clearInputOwner + full dispose on the way out.
 */
import * as THREE from "three";
import { setInputOwner, clearInputOwner } from "../../utils/input-manager";
import { state, resetState, type Actor } from "./state";
import { createPixelPass } from "./render/pixel-pass";
import { buildSpriteSheet, createActorSprite } from "./render/sprite";
import { Animator, type Facing } from "./render/animator";
import { PLAYER_FRAMES, ZOMBIE_FRAMES } from "./render/sprite-data";
import { createDungeonCamera, aimCamera } from "./camera";
import { buildSandbox, type Sandbox } from "./sandbox";
import { createHUD, updateHUD } from "./ui";
import { PALETTE_HEX } from "./render/palette";
import { disposeAll } from "./dispose";

let sandbox: Sandbox | null = null;

export function isDungeonGameActive(): boolean {
  return state.active;
}

export function launchDungeonGame(onExit?: () => void): void {
  if (state.active) return;
  state.active = true;
  state.onExitCallback = onExit ?? null;
  setInputOwner("dungeon-game");

  // ── Overlay ──
  state.container = document.createElement("div");
  state.container.id = "dungeon-game-overlay";
  state.container.style.cssText = `
    position: fixed; inset: 0; z-index: 10000;
    background: #0b0d12;
    overflow: hidden;
  `;
  // The room below has a window-level click handler — don't let clicks reach it.
  state.container.addEventListener("click", (e) => e.stopPropagation());
  document.body.appendChild(state.container);

  // ── Renderer ──
  // No antialiasing: it would smear the pixel edges we're working so hard to
  // keep hard. Everything else about colour/tonemapping is set by createPixelPass.
  state.renderer = new THREE.WebGLRenderer({ antialias: false, alpha: false });
  state.renderer.shadowMap.enabled = true;
  state.renderer.shadowMap.type = THREE.BasicShadowMap; // hard-edged — soft shadows fight the look
  state.renderer.setClearColor(PALETTE_HEX[0]);
  state.container.appendChild(state.renderer.domElement);

  state.pixelPass = createPixelPass(state.renderer, {
    quantize: state.quantize,
    dither: state.dither,
    scanline: state.scanline,
  });

  // ── Scene ──
  state.scene = new THREE.Scene();
  state.scene.background = new THREE.Color(PALETTE_HEX[0]);

  // Cold slate fill. This is the colour the dungeon IS — torches are only
  // accents on top of it.
  //
  // The intensity looks absurdly high, and it has to be: Lambert multiplies the
  // light by the albedo, and the stone albedo is ALREADY dark (#454f5e). Two
  // dark values multiplied bottom out, and the quantizer then snaps the result
  // to black. Tune this by looking at the screen, not at the number.
  const ambient = new THREE.AmbientLight(0x6b7d99, 4.0);
  state.scene.add(ambient);

  // A little vertical shape, so wall tops separate from wall faces instead of
  // flattening into one silhouette.
  const hemi = new THREE.HemisphereLight(0x8fa3bd, 0x1e2430, 1.2);
  state.scene.add(hemi);

  // ── Camera ──
  state.camera = createDungeonCamera();
  aimCamera(state.camera, 0, 0.5, 0);

  // ── Room ──
  sandbox = buildSandbox(state.scene);
  state.torchLights = sandbox.torchLights;

  // ── Actors ──
  buildActors();

  // ── HUD ──
  state.hudEl = createHUD(state.container);
  updateHUD(state.hudEl);

  // ── Listeners ──
  state.onKeyDown = handleKey;
  window.addEventListener("keydown", state.onKeyDown);

  state.onResize = () => state.pixelPass?.resize();
  window.addEventListener("resize", state.onResize);

  console.log("🗡️ Crypt: style sandbox running (phase 0)");

  state.lastTime = performance.now();
  state.animFrameId = requestAnimationFrame(loop);
}

/**
 * (Re)build the two actors. Called on launch, and again whenever the "lit
 * sprites" toggle flips — the lit/unlit choice is baked into the material, so
 * switching means new sprites.
 */
function buildActors(): void {
  if (!state.scene) return;

  // Tear down any existing actors first.
  if (state.player) {
    state.scene.remove(state.player.sprite.mesh);
    state.player.sprite.dispose();
  }
  state.zombies.forEach((z) => {
    state.scene!.remove(z.sprite.mesh);
    z.sprite.dispose();
  });
  state.zombies = [];

  const playerSheet = buildSpriteSheet(PLAYER_FRAMES);
  const zombieSheet = buildSpriteSheet(ZOMBIE_FRAMES);

  const makeActor = (
    sheet: ReturnType<typeof buildSpriteSheet>,
    x: number,
    z: number,
    facing: Facing,
  ): Actor => {
    const sprite = createActorSprite(sheet, state.spritesLit);
    sprite.mesh.position.set(x, 0, z);
    state.scene!.add(sprite.mesh);
    const anim = new Animator(sprite);
    anim.setFacing(facing);
    anim.play("idle");
    return { sprite, anim, x, z };
  };

  state.player = makeActor(playerSheet, 0, 1, "S");

  // Three zombies at different facings, so one screenshot shows all the
  // authored directions at once — including the mirrored W.
  state.zombies.push(makeActor(zombieSheet, -2.5, -1.5, "S"));
  state.zombies.push(makeActor(zombieSheet, 2.5, -1.5, "E"));
  state.zombies.push(makeActor(zombieSheet, 0, -3.5, "W"));
}

function eachActor(fn: (a: Actor) => void): void {
  if (state.player) fn(state.player);
  state.zombies.forEach(fn);
}

function handleKey(e: KeyboardEvent): void {
  if (!state.active) return;

  switch (e.key.toLowerCase()) {
    case "escape":
      exitDungeonGame();
      return;

    // ── Clip switching. Zombies play `death` where the player plays `attack`,
    // since neither actor has both. Forced replay so you can retrigger a
    // non-looping clip by hitting the key again.
    case "1":
      eachActor((a) => a.anim.play("idle", { force: true }));
      break;
    case "2":
      eachActor((a) => a.anim.play("walk", { force: true }));
      break;
    case "3":
      state.player?.anim.play("attack", { force: true });
      state.zombies.forEach((z) => z.anim.play("death", { force: true }));
      break;

    // ── Facing ──
    case "w":
      eachActor((a) => a.anim.setFacing("N"));
      break;
    case "s":
      eachActor((a) => a.anim.setFacing("S"));
      break;
    case "a":
      eachActor((a) => a.anim.setFacing("W"));
      break;
    case "d":
      eachActor((a) => a.anim.setFacing("E"));
      break;

    // ── Style toggles ──
    case "q":
      state.quantize = !state.quantize;
      state.pixelPass?.setQuantize(state.quantize);
      break;
    case "f":
      state.dither = !state.dither;
      state.pixelPass?.setDither(state.dither);
      break;
    case "l":
      state.spritesLit = !state.spritesLit;
      buildActors();
      break;
    case "k":
      state.scanline = !state.scanline;
      state.pixelPass?.setScanline(state.scanline);
      break;

    default:
      return;
  }

  if (state.hudEl) updateHUD(state.hudEl);
}

function loop(now: number): void {
  if (!state.active) return;
  state.animFrameId = requestAnimationFrame(loop);

  const dt = Math.min((now - state.lastTime) / 1000, 0.1); // clamp — a tab-out shouldn't skip 40 frames
  state.lastTime = now;
  state.elapsed += dt;

  eachActor((a) => a.anim.update(dt));

  // Torch flicker. Two out-of-phase sines rather than random noise: random
  // flicker reads as a broken lightbulb, layered sines read as a flame.
  state.torchLights.forEach((light, i) => {
    const t = state.elapsed * 6 + i * 2.1;
    light.intensity = 18 + Math.sin(t) * 1.6 + Math.sin(t * 2.7) * 0.9;
  });

  if (state.scene && state.camera && state.pixelPass) {
    state.pixelPass.render(state.scene, state.camera);
  }
}

export function exitDungeonGame(): void {
  if (!state.active) return;

  const onExit = state.onExitCallback;

  if (state.animFrameId !== null) cancelAnimationFrame(state.animFrameId);
  if (state.onKeyDown) window.removeEventListener("keydown", state.onKeyDown);
  if (state.onResize) window.removeEventListener("resize", state.onResize);

  disposeAll(sandbox);
  sandbox = null;

  clearInputOwner();
  resetState();

  console.log("🗡️ Crypt: exited");
  onExit?.();
}
