/**
 * Tavern scene bootstrap + loop.
 *
 * Owns its own renderer/scene/camera rather than borrowing the dungeon's — the
 * dungeon's are torn down between floors, and two scenes sharing those fields
 * would fight over them. Everything else (the pixel post-pass, the iso camera
 * maths, the sprite pipeline, the palette) is shared, which is what keeps the
 * two scenes looking like one game.
 */
import * as THREE from "three";
import { createPixelPass, type PixelPass } from "../dungeon/render/pixel-pass";
import { createDungeonCamera, aimCamera } from "../dungeon/camera";
import { createInput, type InputHandle } from "../dungeon/input";
import { openVendorCounter, isVendorCounterOpen } from "../dungeon/tavern";
import {
  AMBIENT_INTENSITY,
  HEMI_INTENSITY,
  DIR_INTENSITY,
  DIR_HEIGHT,
  QUANTIZE_DEFAULT,
  DITHER_DEFAULT,
  SCANLINE_DEFAULT,
  OUTLINE_DEFAULT,
  BLOOM_DEFAULT,
  AO_DEFAULT,
} from "../dungeon/constants";
import { buildRoom, type BuiltRoom } from "./build";
import { buildProps, type BuiltProps } from "./props";
import { createStationFx, createStationPrompt, refreshFocus, type StationFx, type StationPrompt } from "./stations";
import { createTavernPlayer, updateTavernPlayer, disposeTavernPlayer } from "./player";
import { stationAt, ROOM, type Station } from "./layout";
import { tavern, resetTavernState, type TavernStats } from "./state";
import { showRunSummary, closeRunSummary, isRunSummaryOpen } from "./ui";

const ROOM_CENTER_X = (ROOM.minX + ROOM.maxX) / 2;
const ROOM_CENTER_Z = (ROOM.minZ + ROOM.maxZ) / 2;

/** How far the framing drifts from the room's centre toward the player (0 = locked). */
const CAM_LEAN = 0.5;
/** Camera smoothing, higher = snappier. */
const CAM_LERP = 3.4;

let raf = 0;
let last = 0;
let input: InputHandle | null = null;
let room: BuiltRoom | null = null;
let props: BuiltProps | null = null;
let fx: StationFx | null = null;
let prompt: StationPrompt | null = null;
let pixelPass: PixelPass | null = null;
let onKey: ((e: KeyboardEvent) => void) | null = null;
let onResize: (() => void) | null = null;

/**
 * Show/hide the dungeon's bottom HUD.
 *
 * None of it applies in the tavern (there is no health to watch, no ammo to
 * spend, no ability to fire), and leaving it up made the hub read as "the
 * dungeon, paused" rather than as somewhere you had arrived. Resolved by DOM id
 * because the HUD modules can be double-instantiated by the dev bundler.
 */
function hideDungeonHud(hidden: boolean): void {
  for (const id of ["dungeon-hud-diablo", "dungeon-hud"]) {
    const el = document.getElementById(id);
    if (el) el.style.display = hidden ? "none" : "";
  }
}

/** True while any overlay owns the screen — movement and interaction freeze. */
function panelOpen(): boolean {
  return isVendorCounterOpen() || isRunSummaryOpen();
}

/** Act on the focused station. */
function interact(): void {
  const s = tavern.focus;
  const host = tavern.container;
  if (!s || !host || panelOpen()) return;

  tavern.openStation = s;
  prompt?.hide();

  if (s.action.kind === "descend") {
    const go = tavern.onDescend;
    closeTavern();
    go?.();
    return;
  }
  if (s.action.kind === "summary") {
    showRunSummary(host, tavern.stats, () => {
      tavern.openStation = null;
    });
    return;
  }
  openVendorCounter(host, s.action.vendor, tavern.stats, () => {
    tavern.openStation = null;
  });
}

function frame(now: number): void {
  if (!tavern.active) return;
  raf = requestAnimationFrame(frame);

  const dt = Math.min(0.05, (now - last) / 1000 || 0);
  last = now;
  tavern.time += dt;

  const frozen = panelOpen();
  if (input) updateTavernPlayer(dt, input, frozen);

  const p = tavern.player;
  if (p) {
    // ── Station focus ──
    const next: Station | null = frozen ? null : stationAt(p.x, p.z);
    if (refreshFocus(next)) {
      fx?.setFocus(next);
      if (next) prompt?.show(next);
      else prompt?.hide();
    }

    // ── Camera ── wide hub view, leaning slightly toward the focused station so
    // the room subtly presents what you're about to use. Never rotates.
    // Anchor on the room's centre and lean a fraction toward the player (and
    // further toward a focused station). A full player-follow is wrong here:
    // this is a staged single-screen hub, and chasing the player pushed half
    // the stations out of frame.
    const leanX = tavern.focus ? (tavern.focus.x + p.x) / 2 : p.x;
    const leanZ = tavern.focus ? (tavern.focus.z + p.z) / 2 : p.z;
    const tx = ROOM_CENTER_X + (leanX - ROOM_CENTER_X) * CAM_LEAN;
    const tz = ROOM_CENTER_Z + (leanZ - ROOM_CENTER_Z) * CAM_LEAN;
    const k = Math.min(1, dt * CAM_LERP);
    tavern.camX += (tx - tavern.camX) * k;
    tavern.camZ += (tz - tavern.camZ) * k;
    if (tavern.camera) aimCamera(tavern.camera, tavern.camX, 0, tavern.camZ);
  }

  fx?.update(dt, tavern.time, props?.accents ?? new Map());

  // ── Hearth + forge flicker ── two summed sines so it never reads as a loop.
  if (room) {
    const flick = 1 + Math.sin(tavern.time * 9.3) * 0.09 + Math.sin(tavern.time * 3.1) * 0.05;
    room.fireLight.intensity = 9 * flick;
    for (let i = 0; i < room.flames.length; i++) {
      const f = room.flames[i];
      const s = 0.85 + Math.sin(tavern.time * (7 + i * 1.7) + i) * 0.16;
      f.scale.set(1, s, 1);
      (f.material as THREE.MeshBasicMaterial).opacity = 0.7 + s * 0.2;
    }
  }
  if (props?.coals) {
    const c = props.coals.material as THREE.MeshStandardMaterial;
    c.emissiveIntensity = 1.3 + Math.sin(tavern.time * 5.2) * 0.35;
  }

  // ── The diorama is alive ── bumper caps chase, and the ball trundles a lap.
  // A machine that idles dead looks broken; this is the room's heartbeat.
  if (props) {
    for (let i = 0; i < props.bumpers.length; i++) {
      const m = props.bumpers[i].material as THREE.MeshStandardMaterial;
      m.emissiveIntensity = 0.35 + Math.max(0, Math.sin(tavern.time * 2.4 - i * 0.9)) * 0.9;
    }
    const orbit = tavern.time * 0.55;
    props.dioramaBall.position.set(Math.cos(orbit) * 0.85, 0.13, Math.sin(orbit) * 0.5 - 0.1);
  }

  if (tavern.scene && tavern.camera) {
    if (pixelPass) pixelPass.render(tavern.scene, tavern.camera);
    else tavern.renderer?.render(tavern.scene, tavern.camera);
  }
}

export interface TavernOptions {
  stats: TavernStats;
  onDescend: () => void;
}

/**
 * Open the walkable tavern. Returns false if WebGL is unavailable, so the caller
 * can fall back to the original DOM overlay rather than showing nothing.
 */
export function openTavernScene(container: HTMLElement, opts: TavernOptions): boolean {
  if (tavern.active) return true;

  let renderer: THREE.WebGLRenderer;
  try {
    renderer = new THREE.WebGLRenderer({ antialias: false, alpha: false, powerPreference: "high-performance" });
  } catch {
    return false; // no context — caller keeps the DOM tavern
  }

  tavern.active = true;
  tavern.container = container;
  tavern.stats = opts.stats;
  tavern.onDescend = opts.onDescend;
  tavern.time = 0;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x07090d);
  // Warm haze near the hearth end; the far corners fall into deep shadow, which
  // is what keeps the room feeling like a refuge rather than a lit box.
  scene.fog = new THREE.Fog(0x0b0d12, 18, 42);
  tavern.scene = scene;
  tavern.renderer = renderer;

  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  const canvas = renderer.domElement;
  canvas.style.cssText = "position:fixed;inset:0;width:100%;height:100%;z-index:10005;image-rendering:pixelated";
  container.appendChild(canvas);

  const camera = createDungeonCamera();
  camera.zoom = 0.78; // wide enough to hold the whole staged room in frame
  camera.updateProjectionMatrix();
  tavern.camera = camera;

  // ── Lights ── warm/cold contrast is the navigation aid: warm = people and
  // fire, cold = machinery and the way down. The base rig stays dim so the
  // station accents in props.ts are what actually draw the eye.
  // Brighter than the dungeon's rig, not dimmer: the dungeon earns its darkness
  // with a torch every few tiles, while this is one room lit by six fixtures. A
  // straight copy of those levels rendered the tavern almost black.
  const ambient = new THREE.AmbientLight(0x8a93a8, AMBIENT_INTENSITY * 1.9);
  const hemi = new THREE.HemisphereLight(0xa8b6cc, 0x2a2130, HEMI_INTENSITY * 1.5);
  const dir = new THREE.DirectionalLight(0xd8c8b0, DIR_INTENSITY * 1.1);
  dir.position.set(-6, DIR_HEIGHT, -4);
  dir.castShadow = true;
  dir.shadow.mapSize.set(1024, 1024);
  scene.add(ambient, hemi, dir);

  room = buildRoom(scene);
  props = buildProps(scene);
  fx = createStationFx(scene);
  prompt = createStationPrompt(container);

  tavern.player = createTavernPlayer(scene);
  tavern.camX = tavern.player.x;
  tavern.camZ = tavern.player.z;
  aimCamera(camera, tavern.camX, 0, tavern.camZ);

  input = createInput(canvas);
  hideDungeonHud(true);

  pixelPass = createPixelPass(renderer, {
    quantize: QUANTIZE_DEFAULT,
    dither: DITHER_DEFAULT,
    scanline: SCANLINE_DEFAULT,
    outline: OUTLINE_DEFAULT,
    bloom: BLOOM_DEFAULT,
    ao: AO_DEFAULT,
  });
  onKey = (e: KeyboardEvent): void => {
    if (!tavern.active) return;
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA")) return;
    if (e.key === "e" || e.key === "E") {
      e.preventDefault();
      interact();
    } else if (e.key === "Escape") {
      if (isRunSummaryOpen()) {
        closeRunSummary();
        tavern.openStation = null;
      }
    }
  };
  window.addEventListener("keydown", onKey);

  onResize = (): void => {
    pixelPass?.resize();
  };
  window.addEventListener("resize", onResize);

  // Dev/QA probe — the room is a 3D scene, so the only way to assert "walking
  // works" from a test harness is to read the player's actual pose back out.
  // Mirrors the dungeon's __dungeon* hooks.
  (window as unknown as { __tavernProbe?: () => unknown }).__tavernProbe = () => ({
    x: tavern.player?.x ?? null,
    z: tavern.player?.z ?? null,
    facing: tavern.player?.facing ?? null,
    speed: tavern.player?.speed ?? 0,
    focus: tavern.focus?.id ?? null,
    open: tavern.openStation?.id ?? null,
    panel: panelOpen(),
  });

  last = performance.now();
  raf = requestAnimationFrame(frame);
  return true;
}

/** Tear the scene down. Safe to call twice. */
export function closeTavern(): void {
  if (!tavern.active) return;
  tavern.active = false;
  if (raf) cancelAnimationFrame(raf);
  raf = 0;

  if (onKey) window.removeEventListener("keydown", onKey);
  if (onResize) window.removeEventListener("resize", onResize);
  onKey = null;
  onResize = null;

  closeRunSummary();
  prompt?.dispose();
  fx?.dispose();
  props?.dispose();
  room?.dispose();
  input?.dispose();
  disposeTavernPlayer();
  pixelPass?.dispose();

  tavern.player?.sprite.mesh.removeFromParent();
  tavern.renderer?.domElement.remove();
  tavern.renderer?.dispose();

  hideDungeonHud(false);
  prompt = null;
  fx = null;
  props = null;
  room = null;
  input = null;
  pixelPass = null;
  resetTavernState();
}

/** True while the walkable tavern owns the screen. */
export function isTavernSceneOpen(): boolean {
  return tavern.active;
}
