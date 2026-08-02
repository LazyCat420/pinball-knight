/**
 * PINBALL KNIGHT — title intro.
 *
 * The gag, in order:
 *   1. A flat side-scroller: the knight sprints through a suspiciously cheerful
 *      overworld (blue sky, hills, "WORLD 1-1") like it's 1985.
 *   2. He jumps and headbutts a floating brick — hitstop, flash, DING.
 *   3. The whole 2D world shatters into falling shards, revealing that the
 *      knight has been inside the DUNGEON all along — a 3D isometric maze
 *      whose walls spell "PINBALL / KNIGHT".
 *   4. He's now a pinball, ricocheting around the letterforms at full tilt
 *      while the camera tilts up from side-on and pulls out until the title
 *      reads. PRESS ANY KEY.
 *
 * ⚠️ NOTHING CALLS THIS. `core.ts` imports `runPinballIntro` and never invokes
 * it — the walkable tavern lobby is the entry now (see the note over
 * `beginRun`), and both routes into a floor, the plunger's `onDescend` and
 * `__dungeonStartRun`, go straight to `armFloorLoading`. VERIFIED BOTH WAYS on
 * 2026-07-30: grep finds one import and zero call sites repo-wide, and a live
 * run started on braindeadbot.com left `__dungeonIntroPhase` null for its whole
 * 30-second sample (the probe emulated `prefers-reduced-motion: no-preference`
 * first, because headless Chrome reports `reduce` and `shouldSkipIntro()`
 * honours it — without that the probe would have proven nothing).
 *
 * The line above used to read "Runs in launchDungeonGame BEFORE startLevel(1)",
 * and a sweep of the UI-input path reasonably read a real defect out of it: the
 * loop below drives `pixelPass.render()` in `shatter`, `sweep` and `title` but
 * NOT in `run` or `bonk`, and `drawUiFrame` is wrapped around that call — so
 * `intro-chrome`, which owns the SKIP button, is neither painted nor given input
 * for the first 2.6 seconds. That asymmetry is real and it is the same shape as
 * the two freezes fixed the same day, but it is UNREACHABLE, and it is not the
 * one-line fix it looks like: during `run`/`bonk` the two 2D canvases above
 * (z-index 9000/9001, `inset:0`, opaque sky gradient) cover the renderer's
 * canvas completely, so presenting a UI frame would paint SKIP *underneath* the
 * gag. Reviving this sequence means painting the skip affordance into `c2d`, or
 * accepting that the first 2.6s has none. The ACTION is not what is missing —
 * `onSkipKey`/`onSkipPointer` are window listeners and fire from frame one.
 *
 * If it is revived: it expects to run in launchDungeonGame BEFORE startLevel(1),
 * where the renderer/scene/camera exist and the game loop does not. It drives
 * its own RAF (registered on state.animFrameId so exitDungeonGame cancels it),
 * builds its letter maze straight through the REAL buildMaze() and parks it on
 * state.maze — the normal startLevel → disposeLevel path tears it down, no
 * special casing. Skips: any key/click, the SKIP button, `?no-intro=1`,
 * `__skipDungeonIntro`, or prefers-reduced-motion.
 */
import { introChromeScreen, setIntroFade, setIntroTitle } from "../gui/screens/intro-chrome";
import { close as closeUiScreen, push as pushUiScreen } from "../gui/stack";
import * as THREE from "three";
import { state } from "../state";
import { buildMaze } from "../maze/build";
import { disposeLevel } from "../dispose";
import { tileCenter } from "../maze/generator";
import type { LevelPlan } from "../maze/decorate";
import { buildTitleGrid, stepIntroBall, INTRO_BALL_SPEED, type IntroBall } from "./title-grid";
import { getKnightSheet } from "../render/knight-sheets";
import { lookFromGear } from "../render/knight-look";
import { createActorSprite, cutFrameStrip, type ActorSprite } from "../engine/render/sprite";
import { SPRITE_PIXEL_GRID, CAMERA_DIST, DIR_HEIGHT, SHADOW_AREA, FOG_NEAR, FOG_FAR, WALL_H } from "../constants";
import { ensurePixelFonts, PIXEL_FONT_LABEL } from "../pixel-fonts";
import { sfxRoll, sfxBreak, sfxBumper, sfxCoin, sfxLevelStart } from "../sfx";

// ── Choreography (seconds) ──
const RUN_DUR = 2.3; // sprint, jump at the end…
const JUMP_T = 1.55; // …launching here, smooth parabolic arc into question block
const BONK_DUR = 0.35; // hitstop freeze
const SHATTER_DUR = 0.95; // the 2D world falls apart
const SWEEP_DUR = 5.2; // camera tilts up + pulls out
const TITLE_DUR = 2.6; // hold on the full title
// Camera path: side-on and tight (reads as the 2D plane) → isometric-ish and
// wide. Final yaw is a taste call: 0 keeps the words dead-horizontal, 18°
// restores the diamond feel while the text stays perfectly legible.
const TILT_FROM = (7 * Math.PI) / 180;
const TILT_TO = (38 * Math.PI) / 180;
const YAW_FROM = 0;
const YAW_TO = (18 * Math.PI) / 180;
const ZOOM_FROM = 2.3;

type Phase = "run" | "bonk" | "shatter" | "sweep" | "title";

function offsetFor(tilt: number, yaw: number): THREE.Vector3 {
  const horiz = Math.cos(tilt) * CAMERA_DIST;
  return new THREE.Vector3(Math.sin(yaw) * horiz, Math.sin(tilt) * CAMERA_DIST, Math.cos(yaw) * horiz);
}

const smooth = (u: number): number => {
  const t = Math.min(1, Math.max(0, u));
  return t * t * (3 - 2 * t);
};

/**
 * ONCE PER PAGE LOAD.
 *
 * `launchDungeonGame` runs again every time the player re-enters the dungeon
 * from the site, and a title sequence on the second entry of one visit is a
 * sequence you sit through rather than watch. A fresh load is a fresh visit; a
 * reload replays it, which is also how you look at it while working on it.
 * Deliberately NOT persisted — a `localStorage` flag would mean nobody ever sees
 * this again, including whoever has to change it.
 */
let played = false;

function shouldSkipIntro(): boolean {
  if (played) return true;
  try {
    const q = new URLSearchParams(window.location.search);
    if (q.get("no-intro") === "1") return true;
    if (q.get("autostart") === "1") return true;
    if ((window as unknown as { __skipDungeonIntro?: boolean }).__skipDungeonIntro) return true;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return true;
  } catch {
    /* headless quirks — play the intro */
  }
  return false;
}

export function runPinballIntro(onDone: () => void): void {
  const { renderer, scene, camera, pixelPass } = state;
  if (!renderer || !scene || !camera || !pixelPass || shouldSkipIntro()) {
    onDone();
    return;
  }
  played = true;
  ensurePixelFonts();

  const overlay = document.getElementById("dungeon-game-overlay") ?? document.body;

  // Hide every overlay child except the renderer's canvas, restore on teardown.
  const hiddenChrome: Array<{ el: HTMLElement; vis: string }> = [];
  for (const child of Array.from(overlay.children)) {
    if (child === renderer.domElement) continue;
    const el = child as HTMLElement;
    hiddenChrome.push({ el, vis: el.style.visibility });
    el.style.visibility = "hidden";
  }

  // ── The 3D title maze, built now so shaders can prewarm during the 2D bit ──
  const layout = buildTitleGrid();
  const grid = layout.grid;
  const plan: LevelPlan = {
    start: { i: 1, j: 1 },
    stairs: { i: 0, j: 0 },
    spawns: [],
    torches: [],
    items: [],
    props: [],
    parts: [],
    rooms: [],
    secrets: [],
    frog: null,
    circuits: [],
    plazas: [],
  };
  state.maze = buildMaze(scene, grid, plan, []);
  const introMaze = state.maze;
  {
    const sc = tileCenter(grid, plan.stairs.i, plan.stairs.j);
    for (const m of state.maze.group.children) {
      if (Math.hypot(m.position.x - sc.x, m.position.z - sc.z) < 1.3) m.visible = false;
    }
  }
  const introLights = new THREE.Group();
  introLights.add(new THREE.AmbientLight(0xa8b8d8, 1.7));
  const fill = new THREE.DirectionalLight(0xdfe8ff, 1.8);
  fill.position.set(8, 18, 24);
  introLights.add(fill);
  scene.add(introLights);
  void renderer.compileAsync?.(scene, camera).catch(() => {});

  const fog = scene.fog as THREE.Fog | null;
  const fogSaved = fog ? { near: fog.near, far: fog.far } : null;
  if (fog) {
    fog.near = 150;
    fog.far = 400;
  }

  let sun: THREE.DirectionalLight | null = null;
  scene.traverse((o) => {
    if (!sun && (o as THREE.DirectionalLight).isDirectionalLight) sun = o as THREE.DirectionalLight;
  });
  const shadowSaved = sun ? { area: SHADOW_AREA } : null;
  if (sun) {
    const s: THREE.DirectionalLight = sun;
    s.position.set(-DIR_HEIGHT * 0.55, DIR_HEIGHT, -DIR_HEIGHT * 0.55);
    s.target.position.set(0, 0, 0);
    const area = grid.w / 2 + 4;
    s.shadow.camera.left = -area;
    s.shadow.camera.right = area;
    s.shadow.camera.top = area;
    s.shadow.camera.bottom = -area;
    s.shadow.camera.updateProjectionMatrix();
  }

  // ── The pinball knight + echo trail ──
  const sheet = getKnightSheet("sword", lookFromGear(state.gear ?? {}), "dungeon");
  const runFrames = sheet.clips.get("E:run") ?? [0];
  const rollFrames = sheet.clips.get("E:roll") ?? runFrames;
  const ballFrames = sheet.clips.get("E:ball") ?? runFrames;

  const ball: IntroBall = { x: layout.spawn.x, z: layout.spawn.z, vx: 0.84, vz: 0.55 };
  {
    const n = Math.hypot(ball.vx, ball.vz);
    ball.vx = (ball.vx / n) * INTRO_BALL_SPEED;
    ball.vz = (ball.vz / n) * INTRO_BALL_SPEED;
  }
  const ballSprite = createActorSprite(sheet, false);
  ballSprite.mesh.visible = false;
  scene.add(ballSprite.mesh);

  const ECHO_OPACITY = [0.3, 0.2, 0.12, 0.06];
  const echoes: ActorSprite[] = ECHO_OPACITY.map((op) => {
    const e = createActorSprite(sheet, false);
    e.setBlobVisible(false);
    e.mesh.visible = false;
    const mat = e.mesh.material as THREE.MeshBasicMaterial;
    mat.opacity = op;
    mat.depthWrite = false;
    scene.add(e.mesh);
    return e;
  });
  const trail: Array<{ x: number; z: number }> = [];
  let trailClock = 0;

  // ── 2D overworld canvas ──
  const BW = 480;
  const BH = Math.min(360, Math.max(216, Math.round((BW * window.innerHeight) / Math.max(1, window.innerWidth))));
  const c2d = document.createElement("canvas");
  c2d.width = BW;
  c2d.height = BH;
  c2d.style.cssText =
    "position:absolute;inset:0;width:100%;height:100%;z-index:9000;image-rendering:pixelated;pointer-events:none;";
  overlay.appendChild(c2d);
  const ctx = c2d.getContext("2d")!;
  ctx.imageSmoothingEnabled = false;

  const neededFrames = [...runFrames, ...rollFrames];
  const strip = cutFrameStrip(sheet.texture.image as HTMLCanvasElement, neededFrames);
  const stripIndex = new Map<number, number>(neededFrames.map((f, i) => [f, i]));

  const GROUND_Y = BH - 52;
  const KX = Math.round(BW * 0.3); // knight screen x
  const SCALE = 1.4;
  const KH = Math.round(SPRITE_PIXEL_GRID * SCALE); // ~101 px tall
  const JUMP_H = 64;
  const SCROLL_SPEED = 150;
  const BLOCK = 40; // brick side
  const BLOCK_CLEAR = KH + JUMP_H - 8; // bottom of brick: headbutt at apex
  const blockWorldX = KX + SCROLL_SPEED * RUN_DUR; // arrives overhead at bonk

  const S = window.innerWidth / BW;
  const kc = document.createElement("canvas");
  kc.width = Math.round(window.innerWidth);
  kc.height = Math.round(BH * S);
  kc.style.cssText =
    "position:absolute;inset:0;width:100%;height:100%;z-index:9001;image-rendering:pixelated;pointer-events:none;";
  overlay.appendChild(kc);
  const kctx = kc.getContext("2d")!;
  kctx.imageSmoothingEnabled = false;
  const KS = Math.max(2, Math.round((KH * S) / SPRITE_PIXEL_GRID)); // integer sprite scale
  const KREAL = SPRITE_PIXEL_GRID * KS; // knight height, real px

  setIntroTitle(false);
  setIntroFade(0);
  pushUiScreen(introChromeScreen(() => finish()));

  // ── Overworld Particles & Coin Pop State ──
  interface Particle2D {
    x: number;
    y: number;
    vx: number;
    vy: number;
    size: number;
    color: string;
    life: number;
    maxLife: number;
    gravity: number;
  }
  const overworldParticles: Particle2D[] = [];
  let dustTimer = 0;
  let hasLaunchedJump = false;
  let hasSpawnedBonkFx = false;

  interface CoinPop {
    x: number;
    y: number;
    vy: number;
    rot: number;
    life: number;
  }
  let coinPop: CoinPop | null = null;

  // ── Lifecycle ──
  let phase: Phase = "run";
  let pt = 0; // time within current phase
  let finishing = false;
  let cleaned = false;
  let lastNow = performance.now();
  let simAcc = 0;
  let lastBumperAt = -1;
  let shake = 0;
  let pieces: Array<{ sx: number; sy: number; x: number; y: number; vx: number; vy: number; rot: number; vr: number }> = [];
  let snap: HTMLCanvasElement | null = null;
  const camTarget = new THREE.Vector3(ball.x, 0, ball.z);

  function cleanupVisuals(): void {
    if (cleaned) return;
    cleaned = true;
    for (const { el, vis } of hiddenChrome) el.style.visibility = vis;
    scene!.remove(introLights);
    window.removeEventListener("keydown", onSkipKey, true);
    window.removeEventListener("pointerdown", onSkipPointer, true);
    c2d.remove();
    kc.remove();
    closeUiScreen("intro-chrome");
    ballSprite.mesh.removeFromParent();
    ballSprite.dispose();
    for (const e of echoes) {
      e.mesh.removeFromParent();
      e.dispose();
    }
    if (fog && fogSaved) {
      fog.near = fogSaved.near;
      fog.far = fogSaved.far;
    }
    if (sun && shadowSaved) {
      const s: THREE.DirectionalLight = sun;
      s.shadow.camera.left = -shadowSaved.area;
      s.shadow.camera.right = shadowSaved.area;
      s.shadow.camera.top = shadowSaved.area;
      s.shadow.camera.bottom = -shadowSaved.area;
      s.shadow.camera.updateProjectionMatrix();
    }
    camera!.zoom = 1;
    camera!.updateProjectionMatrix();
    if (state.maze === introMaze) disposeLevel();
  }

  function finish(): void {
    if (finishing) return;
    finishing = true;
    setIntroFade(1);
    window.setTimeout(() => {
      if (state.animFrameId !== null) cancelAnimationFrame(state.animFrameId);
      (window as unknown as { __dungeonIntroPhase?: string | null }).__dungeonIntroPhase = null;
      cleanupVisuals();
      if (state.active) {
        sfxLevelStart();
        onDone();
        setIntroFade(0);
      }
    }, 400);
  }

  function abortForRun(): void {
    if (finishing) return;
    finishing = true;
    setIntroFade(0);
    (window as unknown as { __dungeonIntroPhase?: string | null }).__dungeonIntroPhase = null;
    cleanupVisuals();
  }

  function onSkipKey(e: KeyboardEvent): void {
    if (["Shift", "Control", "Alt", "Meta", "F5", "F11", "F12"].includes(e.key)) return;
    e.stopImmediatePropagation();
    finish();
  }
  function onSkipPointer(): void {
    finish();
  }
  window.addEventListener("keydown", onSkipKey, true);
  window.addEventListener("pointerdown", onSkipPointer, true);

  // ── 2D painters ──
  function paintOverworld(t: number, frozen: boolean, bonkT: number, dt: number): void {
    const scroll = SCROLL_SPEED * Math.min(t, RUN_DUR);
    
    // Calculate global screen shake translate offset
    const sxOff = shake > 0 ? (Math.random() - 0.5) * 8 * shake : 0;
    const syOff = shake > 0 ? (Math.random() - 0.5) * 6 * shake : 0;

    ctx.save();
    if (sxOff !== 0 || syOff !== 0) ctx.translate(sxOff, syOff);

    // Sky gradient
    const sky = ctx.createLinearGradient(0, 0, 0, BH);
    sky.addColorStop(0, "#5ba9ec");
    sky.addColorStop(1, "#c4e4ff");
    ctx.fillStyle = sky;
    ctx.fillRect(-8, -8, BW + 16, BH + 16);

    // Clouds — two parallax layers
    ctx.fillStyle = "rgba(255,255,255,.92)";
    for (let l = 0; l < 2; l++) {
      const speed = l === 0 ? 0.18 : 0.34;
      const y0 = l === 0 ? 34 : 66;
      for (let k = 0; k < 4; k++) {
        const cx = (((k * 173 + l * 61 - scroll * speed) % (BW + 120)) + BW + 120) % (BW + 120) - 60;
        ctx.fillRect(Math.round(cx), y0 + (k % 2) * 10, 54, 12);
        ctx.fillRect(Math.round(cx) + 10, y0 - 8 + (k % 2) * 10, 34, 10);
      }
    }

    // Hills
    ctx.fillStyle = "#4f9e4f";
    for (let k = 0; k < 5; k++) {
      const hx = (((k * 220 - scroll * 0.5) % (BW + 260)) + BW + 260) % (BW + 260) - 130;
      ctx.beginPath();
      ctx.arc(hx, GROUND_Y + 10, 62 + (k % 2) * 26, Math.PI, 0);
      ctx.fill();
    }

    // Ground — grass lip over stone brick courses
    ctx.fillStyle = "#57b74e";
    ctx.fillRect(0, GROUND_Y, BW, 6);
    for (let y = GROUND_Y + 6, row = 0; y < BH; y += 16, row++) {
      for (let x = -((scroll + (row % 2) * 16) % 32); x < BW; x += 32) {
        ctx.fillStyle = row % 2 ? "#8d8577" : "#7d7568";
        ctx.fillRect(Math.round(x), y, 30, 14);
      }
    }

    // Spawn running dust particles
    if (!frozen && t < JUMP_T) {
      dustTimer += dt;
      if (dustTimer >= 0.12) {
        dustTimer = 0;
        overworldParticles.push({
          x: KX - 12 + Math.random() * 6,
          y: GROUND_Y - 2,
          vx: -40 - Math.random() * 30,
          vy: -10 - Math.random() * 15,
          size: 4 + Math.random() * 3,
          color: "rgba(220, 210, 190, 0.75)",
          life: 0.25,
          maxLife: 0.25,
          gravity: 20,
        });
      }
    }

    // Jump launch dust cloud burst
    if (!frozen && t >= JUMP_T && !hasLaunchedJump) {
      hasLaunchedJump = true;
      for (let i = 0; i < 8; i++) {
        overworldParticles.push({
          x: KX + (Math.random() - 0.5) * 16,
          y: GROUND_Y - 1,
          vx: (Math.random() - 0.5) * 100 - 30,
          vy: -30 - Math.random() * 40,
          size: 5 + Math.random() * 4,
          color: "rgba(240, 230, 210, 0.85)",
          life: 0.35,
          maxLife: 0.35,
          gravity: 40,
        });
      }
    }

    // Bonk impact particles & coin pop spawn
    if (frozen && !hasSpawnedBonkFx) {
      hasSpawnedBonkFx = true;
      const blockCenterX = Math.round(blockWorldX - scroll);
      const blockBottomY = GROUND_Y - BLOCK_CLEAR - 4;

      // Golden Coin Pop
      coinPop = {
        x: blockCenterX,
        y: blockBottomY - BLOCK - 6,
        vy: -220,
        rot: 0,
        life: 0.45,
      };

      // Sparkles and starburst
      for (let i = 0; i < 14; i++) {
        const angle = Math.random() * Math.PI * 2;
        const speed = 60 + Math.random() * 140;
        overworldParticles.push({
          x: blockCenterX + (Math.random() - 0.5) * 10,
          y: blockBottomY + (Math.random() - 0.5) * 6,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed,
          size: 3 + Math.random() * 4,
          color: i % 2 === 0 ? "#ffe866" : "#ffffff",
          life: 0.3 + Math.random() * 0.25,
          maxLife: 0.3 + Math.random() * 0.25,
          gravity: 200,
        });
      }
    }

    // Update and draw overworld particles
    for (let i = overworldParticles.length - 1; i >= 0; i--) {
      const p = overworldParticles[i];
      p.life -= dt;
      if (p.life <= 0) {
        overworldParticles.splice(i, 1);
        continue;
      }
      p.vy += p.gravity * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      const alpha = Math.max(0, p.life / p.maxLife);
      ctx.fillStyle = p.color;
      ctx.globalAlpha = alpha;
      ctx.fillRect(Math.round(p.x - p.size / 2), Math.round(p.y - p.size / 2), Math.round(p.size), Math.round(p.size));
      ctx.globalAlpha = 1;
    }

    // Render retro pixel-art Question Mark Block
    const bx = Math.round(blockWorldX - scroll - BLOCK / 2);
    const bump = frozen ? Math.round(10 * Math.sin(Math.min(1, bonkT / 0.2) * Math.PI)) : 0;
    const by = GROUND_Y - BLOCK_CLEAR - BLOCK - bump;

    // Block shadow
    ctx.fillStyle = "rgba(0,0,0,0.2)";
    ctx.fillRect(bx + 3, by + BLOCK + bump, BLOCK - 6, 4);

    // Block main body gradient / color
    if (frozen) {
      // Hit state: dark stone block feel
      ctx.fillStyle = "#4a423a";
      ctx.fillRect(bx, by, BLOCK, BLOCK);
      ctx.fillStyle = "#6b6156";
      ctx.fillRect(bx + 3, by + 3, BLOCK - 6, BLOCK - 6);
      ctx.fillStyle = "#2d2823";
      ctx.fillRect(bx + BLOCK - 3, by + 3, 3, BLOCK - 6);
      ctx.fillRect(bx + 3, by + BLOCK - 3, BLOCK - 6, 3);
    } else {
      // Active question block: rich retro golden orange with bevel highlights
      ctx.fillStyle = "#3a2a10"; // border
      ctx.fillRect(bx, by, BLOCK, BLOCK);

      const blockGrad = ctx.createLinearGradient(bx, by, bx, by + BLOCK);
      blockGrad.addColorStop(0, "#f7b731");
      blockGrad.addColorStop(1, "#d6790a");
      ctx.fillStyle = blockGrad;
      ctx.fillRect(bx + 2, by + 2, BLOCK - 4, BLOCK - 4);

      // Top/Left bevel highlight
      ctx.fillStyle = "#ffe875";
      ctx.fillRect(bx + 2, by + 2, BLOCK - 4, 3);
      ctx.fillRect(bx + 2, by + 2, 3, BLOCK - 4);

      // Bottom/Right bevel shadow
      ctx.fillStyle = "#a85400";
      ctx.fillRect(bx + 2, by + BLOCK - 5, BLOCK - 4, 3);
      ctx.fillRect(bx + BLOCK - 5, by + 2, 3, BLOCK - 4);

      // Corner rivets
      ctx.fillStyle = "#4a2c00";
      ctx.fillRect(bx + 4, by + 4, 3, 3);
      ctx.fillRect(bx + BLOCK - 7, by + 4, 3, 3);
      ctx.fillRect(bx + 4, by + BLOCK - 7, 3, 3);
      ctx.fillRect(bx + BLOCK - 7, by + BLOCK - 7, 3, 3);

      // Pulsing Question Mark "?"
      const pulse = Math.sin(t * 8) * 0.15 + 1;
      ctx.fillStyle = "#4d2300"; // shadow
      ctx.font = `bold 22px ${PIXEL_FONT_LABEL}`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("?", bx + BLOCK / 2 + 1, by + BLOCK / 2 + 3);

      ctx.fillStyle = "#ffffff"; // highlight text
      ctx.fillText("?", bx + BLOCK / 2, by + BLOCK / 2 + 1);
    }

    // Render Coin Pop Effect
    if (coinPop && coinPop.life > 0) {
      coinPop.life -= dt;
      coinPop.vy += 600 * dt;
      coinPop.y += coinPop.vy * dt;
      coinPop.rot += dt * 18;

      const coinScaleX = Math.cos(coinPop.rot);
      const coinWidth = Math.max(2, Math.abs(coinScaleX) * 16);
      const coinAlpha = Math.min(1, coinPop.life / 0.15);

      ctx.save();
      ctx.globalAlpha = coinAlpha;
      ctx.fillStyle = "#ffe433";
      ctx.fillRect(Math.round(coinPop.x - coinWidth / 2), Math.round(coinPop.y - 10), Math.round(coinWidth), 20);
      ctx.fillStyle = "#ffb700";
      ctx.fillRect(Math.round(coinPop.x - coinWidth / 4), Math.round(coinPop.y - 8), Math.round(coinWidth / 2), 16);
      ctx.restore();
    }

    // Calculate Knight Jump Arc
    let yOff = 0;
    // Cadence synced to scroll speed for zero foot-sliding
    let frame = runFrames[Math.floor(t * 14) % runFrames.length];
    if (t >= JUMP_T) {
      const u = Math.min(1, (t - JUMP_T) / (RUN_DUR - JUMP_T)); // 0→1 rise to apex at RUN_DUR
      yOff = JUMP_H * Math.sin(u * Math.PI * 0.5); // smooth launch curve reaching apex at block
      frame = rollFrames[Math.min(rollFrames.length - 1, Math.floor(u * rollFrames.length))];
    }
    if (frozen) {
      yOff = JUMP_H; // hold apex during bonk freeze
      frame = rollFrames[rollFrames.length - 1];
    }

    // Render Knight on display-resolution canvas `kc`
    kctx.clearRect(0, 0, kc.width, kc.height);
    kctx.save();
    if (sxOff !== 0 || syOff !== 0) {
      kctx.translate(sxOff * S, syOff * S);
    }

    // Contact shadow
    kctx.fillStyle = "rgba(0,0,0,.28)";
    kctx.beginPath();
    kctx.ellipse(KX * S, (GROUND_Y + 4) * S, Math.max(6 * S, (26 - yOff * 0.22) * S), 6 * S, 0, 0, Math.PI * 2);
    kctx.fill();

    const baseY = (GROUND_Y - yOff + 6) * S; // feet y in real px

    // Squash & Stretch on hitstop
    let scaleX = 1;
    let scaleY = 1;
    if (frozen) {
      const squash = Math.sin(Math.min(1, bonkT / BONK_DUR) * Math.PI);
      scaleX = 1 + squash * 0.18;
      scaleY = 1 - squash * 0.14;
    }

    kctx.save();
    kctx.translate(KX * S, baseY);
    kctx.scale(scaleX, scaleY);
    kctx.drawImage(
      strip,
      (stripIndex.get(frame) ?? 0) * SPRITE_PIXEL_GRID,
      0,
      SPRITE_PIXEL_GRID,
      SPRITE_PIXEL_GRID,
      Math.round(-KREAL / 2),
      Math.round(-KREAL),
      KREAL,
      KREAL,
    );
    kctx.restore();
    kctx.restore();

    // Bonk impact flash & starburst
    if (frozen) {
      const a = Math.max(0, 1 - bonkT / BONK_DUR);
      ctx.fillStyle = `rgba(255,248,200,${0.65 * a})`;
      ctx.beginPath();
      ctx.arc(bx + BLOCK / 2, by + BLOCK + 4, 34 + 64 * (1 - a), 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = `rgba(255,220,100,${a})`;
      for (let k = 0; k < 8; k++) {
        const ang = (k / 8) * Math.PI * 2 + 0.4;
        const d = 18 + 52 * (1 - a);
        ctx.fillRect(bx + BLOCK / 2 + Math.cos(ang) * d, by + BLOCK / 2 + Math.sin(ang) * d, 5, 5);
      }
    }

    // HUD
    ctx.fillStyle = "#fff";
    ctx.strokeStyle = "#1c2a38";
    ctx.lineWidth = 3;
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
    ctx.font = `10px ${PIXEL_FONT_LABEL}`;
    ctx.strokeText("WORLD 1-1", 16, 24);
    ctx.fillText("WORLD 1-1", 16, 24);
    const coins = frozen ? "01" : "00";
    ctx.strokeText(`COIN x${coins}`, BW - 110, 24);
    ctx.fillText(`COIN x${coins}`, BW - 110, 24);

    // Skip Affordance
    ctx.globalAlpha = 0.75;
    ctx.font = `8px ${PIXEL_FONT_LABEL}`;
    ctx.strokeText("ANY KEY — SKIP", 16, BH - 14);
    ctx.fillText("ANY KEY — SKIP", 16, BH - 14);
    ctx.globalAlpha = 1;

    ctx.restore();
  }

  function beginShatter(): void {
    kc.remove();
    snap = document.createElement("canvas");
    snap.width = BW;
    snap.height = BH;
    snap.getContext("2d")!.drawImage(c2d, 0, 0);
    const CELL = 40;
    const cx = blockWorldX - SCROLL_SPEED * RUN_DUR;
    const cy = GROUND_Y - BLOCK_CLEAR - BLOCK / 2;
    pieces = [];
    for (let y = 0; y < BH; y += CELL) {
      for (let x = 0; x < BW; x += CELL) {
        const dx = x + CELL / 2 - cx;
        const dy = y + CELL / 2 - cy;
        const d = Math.max(24, Math.hypot(dx, dy));
        const kick = 320 / Math.sqrt(d / 24);
        pieces.push({
          sx: x,
          sy: y,
          x,
          y,
          vx: (dx / d) * kick + (Math.random() - 0.5) * 60,
          vy: (dy / d) * kick - 140 - Math.random() * 90,
          rot: 0,
          vr: (Math.random() - 0.5) * 5,
        });
      }
    }
  }

  function paintShatter(dt: number, t: number): void {
    ctx.clearRect(0, 0, BW, BH);
    if (!snap) return;
    const CELL = 40;
    const alpha = Math.max(0, 1 - t / SHATTER_DUR);
    for (const p of pieces) {
      p.vy += 1500 * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.rot += p.vr * dt;
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.translate(p.x + CELL / 2, p.y + CELL / 2);
      ctx.rotate(p.rot);
      ctx.drawImage(snap, p.sx, p.sy, CELL, CELL, -CELL / 2, -CELL / 2, CELL, CELL);
      ctx.restore();
    }
  }

  // ── 3D side ──
  function simBall(dt: number, now: number): void {
    simAcc += dt;
    let bounced = false;
    while (simAcc >= 1 / 120) {
      simAcc -= 1 / 120;
      if (stepIntroBall(grid, ball, 1 / 120)) bounced = true;
    }
    if (bounced && now - lastBumperAt > 0.09) {
      lastBumperAt = now;
      sfxBumper();
    }
    trailClock += dt;
    if (trailClock >= 0.05) {
      trailClock = 0;
      trail.unshift({ x: ball.x, z: ball.z });
      if (trail.length > echoes.length + 1) trail.pop();
    }

    ballSprite.mesh.visible = true;
    ballSprite.mesh.position.set(ball.x, 0, ball.z);
    const bf = ballFrames[Math.floor(performance.now() / 60) % ballFrames.length];
    ballSprite.setFrame(bf);
    ballSprite.setFlipped(ball.vx < 0);
    echoes.forEach((e, i) => {
      const s = trail[i + 1];
      e.mesh.visible = !!s;
      if (s) {
        e.mesh.position.set(s.x, 0, s.z);
        e.setFrame(bf);
        e.setFlipped(ball.vx < 0);
      }
    });
  }

  function fitZoom(): number {
    const cam = camera!;
    const off = offsetFor(TILT_TO, YAW_TO);
    const dir = off.clone().negate().normalize();
    const right = new THREE.Vector3(Math.cos(YAW_TO), 0, -Math.sin(YAW_TO));
    const up = new THREE.Vector3().crossVectors(right, dir).normalize();
    let hw = 0;
    let hh = 0;
    for (const px of [-grid.w / 2, grid.w / 2]) {
      for (const pz of [-grid.h / 2, grid.h / 2]) {
        for (const py of [0, WALL_H]) {
          const v = new THREE.Vector3(px, py, pz);
          hw = Math.max(hw, Math.abs(v.dot(right)));
          hh = Math.max(hh, Math.abs(v.dot(up)));
        }
      }
    }
    const halfW = (cam.right - cam.left) / 2;
    const halfH = (cam.top - cam.bottom) / 2;
    return Math.min(halfW / (hw + 1.5), halfH / (hh + 2.2));
  }

  function aimIntroCamera(sweepU: number): void {
    const cam = camera!;
    const u = smooth(sweepU);
    const tilt = TILT_FROM + (TILT_TO - TILT_FROM) * u;
    const yaw = YAW_FROM + (YAW_TO - YAW_FROM) * u;
    const zf = fitZoom();
    const zoom = Math.exp(Math.log(ZOOM_FROM) + (Math.log(zf) - Math.log(ZOOM_FROM)) * u);
    camTarget.set(
      ball.x + (layout.center.x - ball.x) * u,
      0,
      ball.z + (layout.center.z - ball.z) * u,
    );
    cam.zoom = zoom;
    cam.position.copy(camTarget).add(offsetFor(tilt, yaw));
    cam.lookAt(camTarget);
    cam.updateProjectionMatrix();
  }

  // ── Main loop ──
  function tick(now: number): void {
    if (!state.active || cleaned) return;
    if (state.player) {
      abortForRun();
      return;
    }
    (window as unknown as { __dungeonIntroPhase?: string | null }).__dungeonIntroPhase = phase;
    state.animFrameId = requestAnimationFrame(tick);
    const dt = Math.min(0.05, (now - lastNow) / 1000);
    lastNow = now;
    pt += dt;
    const nowS = now / 1000;

    switch (phase) {
      case "run":
        paintOverworld(pt, false, 0, dt);
        if (pt >= JUMP_T && pt - dt < JUMP_T) sfxRoll();
        if (pt >= RUN_DUR) {
          phase = "bonk";
          pt = 0;
          shake = 1;
          sfxBreak();
          sfxCoin();
        }
        break;
      case "bonk":
        shake = Math.max(0, shake - dt * 3);
        paintOverworld(RUN_DUR, true, pt, dt);
        if (pt >= BONK_DUR) {
          phase = "shatter";
          pt = 0;
          beginShatter();
        }
        break;
      case "shatter":
        simBall(dt, nowS);
        aimIntroCamera(0);
        pixelPass!.render(scene!, camera!);
        paintShatter(dt, pt);
        if (pt >= SHATTER_DUR) {
          phase = "sweep";
          pt = 0;
          ctx.clearRect(0, 0, BW, BH);
        }
        break;
      case "sweep":
        simBall(dt, nowS);
        aimIntroCamera(pt / SWEEP_DUR);
        pixelPass!.render(scene!, camera!);
        if (pt >= SWEEP_DUR) {
          phase = "title";
          pt = 0;
          setIntroTitle(true);
        }
        break;
      case "title":
        simBall(dt, nowS);
        aimIntroCamera(1);
        pixelPass!.render(scene!, camera!);
        if (pt >= TITLE_DUR) finish();
        break;
    }
  }

  state.animFrameId = requestAnimationFrame(tick);
}
