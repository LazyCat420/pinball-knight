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
 * Runs in launchDungeonGame BEFORE startLevel(1): the renderer/scene/camera
 * exist, the game loop does not. The intro drives its own RAF (registered on
 * state.animFrameId so exitDungeonGame cancels it), builds its letter maze
 * straight through the REAL buildMaze() and parks it on state.maze — the
 * normal startLevel → disposeLevel path tears it down, no special casing.
 * Skips: any key/click, the SKIP button, `?no-intro=1`, `__skipDungeonIntro`,
 * or prefers-reduced-motion.
 */
import * as THREE from "three";
import { state } from "../state";
import { buildMaze } from "../maze/build";
import { tileCenter } from "../maze/generator";
import type { LevelPlan } from "../maze/decorate";
import { buildTitleGrid, stepIntroBall, INTRO_BALL_SPEED, type IntroBall } from "./title-grid";
import { getKnightSheet } from "../render/knight-sheets";
import { lookFromGear } from "../render/knight-look";
import { createActorSprite, type ActorSprite } from "../engine/render/sprite";
import { SPRITE_PIXEL_GRID, CAMERA_DIST, DIR_HEIGHT, SHADOW_AREA, FOG_NEAR, FOG_FAR, WALL_H } from "../constants";
import { ensurePixelFonts, PIXEL_FONT_LABEL } from "../pixel-fonts";
import { sfxRoll, sfxBreak, sfxBumper, sfxCoin, sfxLevelStart } from "../audio";

// ── Choreography (seconds) ──
const RUN_DUR = 2.3; // sprint, jump at the end…
const JUMP_T = 1.88; // …launching here, apex = bonk = phase end
const BONK_DUR = 0.3; // hitstop freeze
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

function shouldSkipIntro(): boolean {
  try {
    if (new URLSearchParams(window.location.search).get("no-intro") === "1") return true;
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
  ensurePixelFonts();

  const overlay = document.getElementById("dungeon-game-overlay") ?? document.body;

  // The gameplay chrome (HUDs, hint bar, minimap, debug chip) is already
  // mounted; a title sequence with a health bar under it reads as a glitch.
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
    stairs: { i: 0, j: 0 }, // buried inside the border wall — never seen
    spawns: [],
    torches: [],
    items: [],
    props: [],
    parts: [],
    rooms: [],
    secrets: [],
    frog: null,
    plazas: [],
  };
  state.maze = buildMaze(scene, grid, plan, []); // disposeLevel reclaims it
  // buildMaze always erects the stairs kit (pit, pylons, arcane beam) at
  // plan.stairs; ours is buried in the border wall but the beam still pokes
  // above it. Hide everything parked on that tile.
  {
    const sc = tileCenter(grid, plan.stairs.i, plan.stairs.j);
    for (const m of state.maze.group.children) {
      if (Math.hypot(m.position.x - sc.x, m.position.z - sc.z) < 1.3) m.visible = false;
    }
  }
  // The gameplay light rig is a dim ambience plus a lamp that follows the
  // player — neither is running here, and the title card deserves stage
  // lighting. Intro-only; removed on teardown.
  const introLights = new THREE.Group();
  introLights.add(new THREE.AmbientLight(0xa8b8d8, 1.7));
  const fill = new THREE.DirectionalLight(0xdfe8ff, 1.8);
  fill.position.set(8, 18, 24); // from the camera side, so wall faces read
  introLights.add(fill);
  scene.add(introLights);
  void renderer.compileAsync?.(scene, camera).catch(() => {});

  // Fog is tuned for the gameplay frame; the pull-out would fade the far
  // letters. Push it out for the intro, restore on teardown.
  const fog = scene.fog as THREE.Fog | null;
  const fogSaved = fog ? { near: fog.near, far: fog.far } : null;
  if (fog) {
    fog.near = 150;
    fog.far = 400;
  }

  // Aim the sun at the title block and widen its shadow frustum to cover it.
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
  ballSprite.mesh.visible = false; // hidden until the 2D world shatters
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

  // The full knight atlas is wider than some GPU texture limits (swiftshader
  // caps at 8192px; the atlas is ~8600) — drawImage from it can silently paint
  // NOTHING. Extract just the frames the 2D bit needs into a small strip via
  // getImageData, which is a CPU path no texture cap can break.
  const sheetCanvas = sheet.texture.image as HTMLCanvasElement;
  const neededFrames = [...runFrames, ...rollFrames];
  const strip = document.createElement("canvas");
  strip.width = neededFrames.length * SPRITE_PIXEL_GRID;
  strip.height = SPRITE_PIXEL_GRID;
  {
    const sctx = strip.getContext("2d")!;
    const atlasCtx = sheetCanvas.getContext("2d");
    neededFrames.forEach((f, i) => {
      if (atlasCtx) sctx.putImageData(atlasCtx.getImageData(f * SPRITE_PIXEL_GRID, 0, SPRITE_PIXEL_GRID, SPRITE_PIXEL_GRID), i * SPRITE_PIXEL_GRID, 0);
    });
  }
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

  // The knight rides his OWN display-resolution canvas so his sprite scales by
  // a WHOLE number and stays crisp. The background canvas is 480px wide and
  // CSS-upscaled ~3.3× (fractional) — fine for the chunky solid shapes, but it
  // smeared the sprite's pixel grid (fat pixel next to thin). Here `S` maps the
  // 480-virtual space to real screen px, and the knight is drawn at the nearest
  // INTEGER multiple of the sprite grid, so one art pixel = KS whole pixels.
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

  // DOM bits: skip button always; title banner appears at the title phase.
  const styleEl = document.createElement("style");
  styleEl.textContent = "@keyframes pk-blink{0%,55%{opacity:1}56%,100%{opacity:0}}";
  document.head.appendChild(styleEl);
  const skipBtn = document.createElement("button");
  skipBtn.textContent = "SKIP ▸";
  skipBtn.style.cssText = `position:absolute;right:18px;bottom:14px;z-index:9600;background:rgba(0,0,0,.45);color:#cfd6c8;border:1px solid rgba(207,214,200,.4);padding:8px 14px;cursor:pointer;font:10px ${PIXEL_FONT_LABEL};letter-spacing:1px;`;
  overlay.appendChild(skipBtn);
  const banner = document.createElement("div");
  banner.style.cssText = `position:absolute;left:0;right:0;bottom:7%;z-index:9500;text-align:center;color:#e8c869;display:none;font:16px ${PIXEL_FONT_LABEL};text-shadow:0 3px 0 #000,0 0 18px rgba(232,200,105,.35);pointer-events:none;`;
  banner.innerHTML = `PINBALL KNIGHT<div style="margin-top:14px;font-size:9px;color:#cfd6c8;animation:pk-blink 1.1s step-end infinite">PRESS ANY KEY</div>`;
  overlay.appendChild(banner);
  const fadeEl = document.createElement("div");
  fadeEl.style.cssText =
    "position:absolute;inset:0;z-index:9700;background:#000;opacity:0;transition:opacity .38s ease;pointer-events:none;";
  overlay.appendChild(fadeEl);

  // ── Lifecycle ──
  let phase: Phase = "run";
  let pt = 0; // time within the current phase
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
    kc.remove(); // no-op if beginShatter already retired it
    skipBtn.remove();
    banner.remove();
    styleEl.remove();
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
    // state.maze (the letter grid) is left for startLevel's disposeLevel.
  }

  function finish(): void {
    if (finishing) return;
    finishing = true;
    fadeEl.style.opacity = "1";
    window.setTimeout(() => {
      if (state.animFrameId !== null) cancelAnimationFrame(state.animFrameId);
      (window as unknown as { __dungeonIntroPhase?: string | null }).__dungeonIntroPhase = null;
      cleanupVisuals();
      if (state.active) {
        sfxLevelStart();
        onDone();
        fadeEl.style.opacity = "0";
        window.setTimeout(() => fadeEl.remove(), 450);
      } else {
        fadeEl.remove();
      }
    }, 400);
  }

  function onSkipKey(e: KeyboardEvent): void {
    if (["Shift", "Control", "Alt", "Meta", "F5", "F11", "F12"].includes(e.key)) return;
    e.stopImmediatePropagation();
    finish();
  }
  function onSkipPointer(e: PointerEvent): void {
    if (e.target === skipBtn) return; // the button's own click handles it
    finish();
  }
  window.addEventListener("keydown", onSkipKey, true);
  window.addEventListener("pointerdown", onSkipPointer, true);
  skipBtn.onclick = finish;

  // ── 2D painters ──
  function paintOverworld(t: number, frozen: boolean, bonkT: number): void {
    const scroll = SCROLL_SPEED * Math.min(t, RUN_DUR);
    ctx.save();
    if (frozen && shake > 0) ctx.translate((Math.random() - 0.5) * 6 * shake, (Math.random() - 0.5) * 4 * shake);

    // Sky
    const sky = ctx.createLinearGradient(0, 0, 0, BH);
    sky.addColorStop(0, "#6fb7f0");
    sky.addColorStop(1, "#cfe9ff");
    ctx.fillStyle = sky;
    ctx.fillRect(-8, -8, BW + 16, BH + 16);

    // Clouds — two parallax layers of chunky pill blobs.
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

    // Ground — grass lip over dungeon-stone brick courses (the tell).
    ctx.fillStyle = "#57b74e";
    ctx.fillRect(0, GROUND_Y, BW, 6);
    for (let y = GROUND_Y + 6, row = 0; y < BH; y += 16, row++) {
      for (let x = -((scroll + (row % 2) * 16) % 32); x < BW; x += 32) {
        ctx.fillStyle = row % 2 ? "#8d8577" : "#7d7568";
        ctx.fillRect(Math.round(x), y, 30, 14);
      }
    }

    // The floating brick.
    const bx = Math.round(blockWorldX - scroll - BLOCK / 2);
    const bump = frozen ? Math.round(8 * Math.sin(Math.min(1, bonkT / 0.22) * Math.PI)) : 0;
    const by = GROUND_Y - BLOCK_CLEAR - BLOCK - bump;
    ctx.fillStyle = "#6b6357";
    ctx.fillRect(bx, by, BLOCK, BLOCK);
    ctx.fillStyle = "#8d8577";
    ctx.fillRect(bx + 3, by + 3, BLOCK - 6, BLOCK - 6);
    ctx.strokeStyle = "#4a443c";
    ctx.strokeRect(bx + 0.5, by + 0.5, BLOCK - 1, BLOCK - 1);
    ctx.fillStyle = "#e8c869";
    ctx.font = `20px ${PIXEL_FONT_LABEL}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("?", bx + BLOCK / 2, by + BLOCK / 2 + 2);

    // The knight — run cycle on the ground, mid-somersault in the air.
    let yOff = 0;
    let frame = runFrames[Math.floor(t * 12) % runFrames.length];
    if (t >= JUMP_T) {
      const u = Math.min(0.5, (t - JUMP_T) / ((RUN_DUR - JUMP_T) * 2)); // 0→0.5 = rise to apex
      yOff = JUMP_H * 4 * u * (1 - u);
      frame = rollFrames[Math.min(rollFrames.length - 1, Math.floor(u * 2 * rollFrames.length))];
    }
    // The knight + his contact shadow render on the crisp display-res canvas,
    // at integer scale and integer position (no sub-pixel smear). Coordinates
    // are the same 480-virtual ones the background uses, mapped up by S.
    kctx.clearRect(0, 0, kc.width, kc.height);
    kctx.fillStyle = "rgba(0,0,0,.25)";
    kctx.beginPath();
    kctx.ellipse(KX * S, (GROUND_Y + 4) * S, (26 - yOff * 0.12) * S, 6 * S, 0, 0, Math.PI * 2);
    kctx.fill();
    const baseY = (GROUND_Y - yOff + 6) * S; // where the feet land, real px
    kctx.drawImage(
      strip,
      (stripIndex.get(frame) ?? 0) * SPRITE_PIXEL_GRID,
      0,
      SPRITE_PIXEL_GRID,
      SPRITE_PIXEL_GRID,
      Math.round(KX * S - KREAL / 2),
      Math.round(baseY - KREAL),
      KREAL,
      KREAL,
    );

    // Bonk flash + sparks
    if (frozen) {
      const a = Math.max(0, 1 - bonkT / BONK_DUR);
      ctx.fillStyle = `rgba(255,244,190,${0.55 * a})`;
      ctx.beginPath();
      ctx.arc(bx + BLOCK / 2, by + BLOCK + 4, 30 + 60 * (1 - a), 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = `rgba(255,220,120,${a})`;
      for (let k = 0; k < 6; k++) {
        const ang = (k / 6) * Math.PI * 2 + 0.4;
        const d = 18 + 46 * (1 - a);
        ctx.fillRect(bx + BLOCK / 2 + Math.cos(ang) * d, by + BLOCK / 2 + Math.sin(ang) * d, 4, 4);
      }
    }

    // HUD gag
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
    ctx.restore();
  }

  function beginShatter(): void {
    // The knight is now the 3D ball — his 2D canvas retires as the world breaks.
    kc.remove();
    snap = document.createElement("canvas");
    snap.width = BW;
    snap.height = BH;
    snap.getContext("2d")!.drawImage(c2d, 0, 0);
    const CELL = 40;
    const cx = blockWorldX - SCROLL_SPEED * RUN_DUR; // block screen x at bonk (≈ KX)
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
    ctx.clearRect(0, 0, BW, BH); // transparent — the 3D maze shows through
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

  /** Zoom that fits the whole title block at the END orientation. */
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
    // Log-space zoom — a linear zoom-out spends its whole life in the boring
    // middle; exponential reads as one continuous accelerating pull.
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
    // Dev/QA probe — headless harnesses poll this instead of guessing timings.
    (window as unknown as { __dungeonIntroPhase?: string | null }).__dungeonIntroPhase = phase;
    state.animFrameId = requestAnimationFrame(tick);
    const dt = Math.min(0.05, (now - lastNow) / 1000);
    lastNow = now;
    pt += dt;
    const nowS = now / 1000;

    switch (phase) {
      case "run":
        paintOverworld(pt, false, 0);
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
        paintOverworld(RUN_DUR, true, pt);
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
          banner.style.display = "block";
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
