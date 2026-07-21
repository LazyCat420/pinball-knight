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
import { createPixelPass, computeRenderSizing, type PixelPass } from "../dungeon/render/pixel-pass";
import { createDungeonCamera, aimCamera } from "../dungeon/camera";
import { createInput, type InputHandle } from "../dungeon/input";
import { openVendorCounter, isVendorCounterOpen, consumePendingTavernFx } from "../dungeon/tavern";
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
  PPU,
} from "../dungeon/constants";
import { buildRoom, type BuiltRoom } from "./build";
import { buildProps, type BuiltProps } from "./props";
import { createStationFx, createStationPrompt, refreshFocus, type StationFx, type StationPrompt } from "./stations";
import { createTavernPlayer, updateTavernPlayer, disposeTavernPlayer, refreshTavernPlayerArt, playTavernOneShot } from "./player";
import { stationAt, ROOM, type Station } from "./layout";
import { tavern, resetTavernState, readDiorama, type TavernStats, type DioramaState } from "./state";
import { showRunSummary, closeRunSummary, isRunSummaryOpen } from "./ui";
import { openGambler, closeGambler, isGamblerOpen, resetGamblerVisit } from "./gambler";
import { buildNpcs, type BuiltNpcs } from "./npcs";
import { createVfx, type VfxSystem } from "../dungeon/render/vfx";
import { startTavernAmbience, stopTavernAmbience, sfxAnvil, sfxDart, sfxKeeperGreet, sfxStationFocus, sfxPlunger } from "./audio";

const ROOM_CENTER_X = (ROOM.minX + ROOM.maxX) / 2;
const ROOM_CENTER_Z = (ROOM.minZ + ROOM.maxZ) / 2;

/**
 * How far the framing drifts from the room's centre toward the player
 * (0 = locked to centre, 1 = full follow).
 *
 * THIS IS A MOVEMENT-FEEL CONSTANT, not just a framing one. The camera target
 * is `centre + (player - centre) * CAM_LEAN`, so at 0.5 the camera moved
 * exactly half as far as the knight — and since the knight is what you are
 * watching, HALF YOUR APPARENT SPEED was being cancelled by the camera chasing
 * you. That is why the room read as sluggish even after the walk speed was
 * raised: the fix was fighting the camera rather than the controller.
 *
 * A full follow (1.0) was tried in an earlier pass and rejected, correctly —
 * it pushed half the stations out of frame, which is the one thing the hub's
 * fixed composition exists to prevent. 0.72 is the middle: the knight now
 * carries ~72% of their own motion, and the wider render target this codebase
 * now uses (the FOV cap went 1600 → 1920, so a 1080p window shows 30 tiles
 * against the 20 the room was composed for) leaves far more slack at the edges
 * than existed when 1.0 was rejected. The reason that experiment failed is
 * materially weaker than it was.
 */
const CAM_LEAN = 0.72;
/** Camera smoothing, higher = snappier. */
const CAM_LERP = 3.4;

/**
 * Camera zoom — wide enough to hold the whole staged room, easing IN when a
 * station takes focus so stepping up to a counter feels like stepping up to it.
 *
 * Kept small (about 18%) on purpose. The framing is a fixed iso composition with
 * six stations arranged to be visible at once; push in far enough to be dramatic
 * and the room stops reading as a hub. This is emphasis, not a cutscene.
 */
const CAM_ZOOM_WIDE = 0.78;

/**
 * THE CAMERA ZOOM NO LONGER ANIMATES, and that is a pixel-fidelity decision
 * rather than an art one.
 *
 * Sprite crispness rests on one texel landing on one render pixel:
 * `SPRITE_UNITS * PPU === SPRITE_PIXEL_GRID`. Screen pixels per world unit is
 * actually `PPU * camera.zoom`, so ANY zoom other than exactly 1 breaks it —
 * 72 texels get squeezed into `72 * zoom` pixels and NearestFilter drops rows
 * in an irregular comb. The dungeon never noticed because it never sets zoom.
 *
 * There used to be a push-in from 0.78 to 0.92 on station focus, EASED over
 * ~0.4s. That meant the comb pattern shifted every frame of the transition, so
 * the artifact crawled across every keeper and prop exactly as you walked up to
 * talk to one. An animated version of the precise defect the whole pixel pass
 * exists to prevent, and worse than a static offset.
 *
 * Focus is still signalled — `stations.ts` puts a spotlight on the floor and
 * pulses the station's accent light. Those cost no fidelity. The zoom did.
 *
 * `fitZoom()` picks ONE value at entry and on resize: exactly 1 (genuinely
 * pixel-perfect) when the render target can hold the room, else the wide
 * framing. The room's iso footprint is ~22.6 x 16.5 tiles, so it fits whenever
 * the render target is at least 1448 x 1053.
 *
 * MEASURED, not assumed: a 1920x1080 window resolves to a 1920x1080 target
 * (30 x 16.875 tiles) and therefore runs at zoom 1 — the tavern IS 1:1 there,
 * confirmed by driving the real scene headless. An earlier version of this
 * comment guessed the opposite ("most real windows... still sits at 0.78"),
 * which is what you get for reasoning about framing instead of looking at it.
 * Smaller windows and high-DPI setups that resolve to a shorter target do fall
 * back to 0.78 and are not 1:1.
 */
const ROOM_FOOTPRINT_TILES_W = 22.63;
const ROOM_FOOTPRINT_TILES_H = 16.45;

/**
 * The one zoom this visit uses. Exactly 1 when the room fits (so the tavern is
 * genuinely 1 texel : 1 pixel), otherwise the wide framing.
 *
 * Never returns anything BETWEEN the two and never magnifies: a zoom above 1
 * would break the texel identity just as badly as one below it.
 */
function fitZoom(): number {
  if (typeof window === "undefined") return CAM_ZOOM_WIDE;
  const { renderW, renderH } = computeRenderSizing(window.innerWidth, window.innerHeight);
  const fits = renderW / PPU >= ROOM_FOOTPRINT_TILES_W && renderH / PPU >= ROOM_FOOTPRINT_TILES_H;
  return fits ? 1 : CAM_ZOOM_WIDE;
}

/** Apply `fitZoom()` to the live camera. Safe to call before the camera exists. */
function applyZoom(): void {
  camZoom = fitZoom();
  if (!tavern.camera) return;
  tavern.camera.zoom = camZoom;
  tavern.camera.updateProjectionMatrix();
}

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
let npcs: BuiltNpcs | null = null;
let vfx: VfxSystem | null = null;
/** Ambient mote/ember cadence — atmosphere is emitted, not simulated. */
let moteT = 0;
/** Live camera zoom, eased toward the wide/focused target every frame. */
let camZoom = CAM_ZOOM_WIDE;
/** What the diorama should show. Read once on entry — the run can't change here. */
let diorama: DioramaState = { lit: 0, ballSpeed: 0 };
/** Diorama ball angle. Integrated, not derived from the clock, so a change of
 * speed never teleports the ball across the playfield. */
let ballAngle = 0;

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
  return isVendorCounterOpen() || isRunSummaryOpen() || isGamblerOpen();
}

/** Act on the focused station. */
function interact(): void {
  const s = tavern.focus;
  const host = tavern.container;
  if (!s || !host || panelOpen()) return;

  tavern.openStation = s;
  prompt?.hide();

  if (s.action.kind === "descend") {
    sfxPlunger();
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
  if (s.action.kind === "gambler") {
    openGambler(host, () => {
      tavern.openStation = null;
    });
    return;
  }
  openVendorCounter(host, s.action.vendor, tavern.stats, () => {
    tavern.openStation = null;
    // You socketed a card at that counter — put it on the blade in the vice.
    props?.syncViceCards();
    // ── The counter's work lands ON the knight the moment it closes ──
    // Gear buys: hoist the new plate overhead, and re-dress mid-hoist so the
    // shine and the flourish arrive together. Smith work (repair / new slot /
    // forge): hammer the anvil, with an ember burst per beat.
    const fx = consumePendingTavernFx();
    if (fx.includes("gear")) {
      playTavernOneShot("equip", () => refreshTavernPlayerArt());
      refreshTavernPlayerArt();
    } else if (fx.length > 0) {
      playTavernOneShot("forge");
      sfxAnvil();
      const p = tavern.player;
      if (p && vfx) {
        vfx.sparks(p.x, 0.9, p.z, 0, 0, 10);
        for (let i = 0; i < 5; i++) vfx.ember(p.x + (Math.random() - 0.5) * 0.6, 0.7 + Math.random() * 0.5, p.z + (Math.random() - 0.5) * 0.6);
      }
    } else {
      refreshTavernPlayerArt(); // no flourish, but never leave stale art
    }
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
      if (next) {
        prompt?.show(next);
        sfxStationFocus();
      } else {
        prompt?.hide();
      }
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

    // NB: no zoom work here any more. The focus push-in used to live on this
    // line and it is deliberately gone — see the note on CAM_ZOOM_WIDE. Zoom is
    // now set once by `fitZoom()` at entry and on resize.
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

  // ── The diorama reports the run ── lit caps are targets you actually
  // completed (`readDiorama`), and the ball only laps after a strong floor. The
  // caps still breathe, because a live machine shouldn't be a static readout —
  // but an unlit cap stays dark no matter how long you stand there.
  if (props) {
    for (let i = 0; i < props.bumpers.length; i++) {
      const m = props.bumpers[i].material as THREE.MeshStandardMaterial;
      m.emissiveIntensity = i < diorama.lit ? 0.5 + Math.max(0, Math.sin(tavern.time * 2.4 - i * 0.9)) * 0.85 : 0.04;
    }
    if (diorama.ballSpeed > 0) {
      ballAngle += dt * diorama.ballSpeed;
      props.dioramaBall.position.set(Math.cos(ballAngle) * 0.85, 0.13, Math.sin(ballAngle) * 0.5 - 0.1);
    }
  }

  // ── Keepers ── the work-loop beats drive their own sparks and sound, and the
  // station focus computed above is what tells them you have walked up.
  npcs?.update({
    time: tavern.time,
    dt,
    vfx,
    focusId: tavern.focus?.id ?? null,
    playerX: p?.x ?? 0,
    onBeat: (kind) => {
      if (kind === "anvil") sfxAnvil();
      else if (kind === "dart") sfxDart();
      else sfxKeeperGreet();
    },
  });

  // ── Ambient particles ── embers off the hearth and the forge coals, plus dust
  // drifting through the room. Emitted on a cadence rather than per-frame, so
  // the density is the same whether the machine runs at 15fps or 144.
  moteT -= dt;
  if (moteT <= 0 && vfx) {
    moteT = 0.14;
    vfx.ember(-8.0, 0.55 + Math.random() * 0.4, 0.2 + (Math.random() - 0.5) * 1.6);
    vfx.ember(-6.8, 1.5 + Math.random() * 0.3, -2.6 + (Math.random() - 0.5) * 0.9);
    vfx.mote(ROOM.minX + Math.random() * (ROOM.maxX - ROOM.minX), 0.5 + Math.random() * 2.0, ROOM.minZ + Math.random() * (ROOM.maxZ - ROOM.minZ));
  }
  vfx?.update(dt);

  // ── Render ──
  // Skip the 3D pass entirely while a full-screen panel is up. The room is
  // almost fully obscured by the overlay and the player is frozen, so it is
  // redrawing a near-static image at full cost — and it was STARVING the panel:
  // the casino cabinet's canvas ran at ~2fps behind the tavern's pixel pass,
  // which turned a 2.6s wheel spin into 26 seconds of wall clock.
  if (frozen) return;
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
  // Warm haze at the room's edges. THE NUMBERS USED TO BE 18/42 AND THAT WAS THE
  // SINGLE BIGGEST REASON THE TAVERN RENDERED NEAR-BLACK — not the light rig.
  // The iso camera sits at CAMERA_DIST 24, so its own target was already 25% of
  // the way to full fog, and the north-west corner of the room (~34 units out)
  // was 67% faded to 0x0b0d12. Two thirds of the furniture in the far half was
  // being crossfaded into the background colour before a single light was
  // considered. The dungeon uses 30/58 for exactly this reason. 28/64 keeps a
  // little falloff at the corners without eating the room.
  scene.fog = new THREE.Fog(0x141018, 28, 64);
  tavern.scene = scene;
  tavern.renderer = renderer;

  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  const canvas = renderer.domElement;
  canvas.style.cssText = "position:fixed;inset:0;width:100%;height:100%;z-index:10005;image-rendering:pixelated";
  container.appendChild(canvas);

  const camera = createDungeonCamera();
  // Module-level, so a second visit must not inherit the last one. Picks 1
  // (pixel-perfect) when the render target can hold the room, else wide.
  tavern.camera = camera;
  applyZoom();

  // ── Lights ── warm/cold contrast is the navigation aid: warm = people and
  // fire, cold = machinery and the way down. The base rig stays dim so the
  // station accents in props.ts are what actually draw the eye.
  // Brighter than the dungeon's rig, not dimmer: the dungeon earns its darkness
  // with a torch every few tiles, while this is one room lit by six fixtures. A
  // straight copy of those levels rendered the tavern almost black.
  //
  // THE MULTIPLIERS BELOW ARE TAVERN-LOCAL OVERRIDES. `AMBIENT_INTENSITY` and
  // friends are the DUNGEON's constants and are deliberately not touched — the
  // dungeon earns its darkness with a torch every few tiles and a fog radius,
  // and raising them there would flatten it. This room is a safehouse between
  // floors: it is supposed to be warm and legible, and a screenshot showed the
  // left and bottom thirds of the frame were unreadable — props sitting in
  // shadow you could not name. 1.9/1.5/1.1 -> 3.2/2.6/1.35.
  const ambient = new THREE.AmbientLight(0x99a0b2, AMBIENT_INTENSITY * 3.2);
  // The ground half of the hemisphere is a warm timber bounce rather than the
  // old cold purple: every floor in here is planking lit by fire, and bouncing
  // violet up into the furniture was fighting the warm/cold discipline.
  const hemi = new THREE.HemisphereLight(0xb2c0d6, 0x4a3324, HEMI_INTENSITY * 2.6);
  const dir = new THREE.DirectionalLight(0xdccbb2, DIR_INTENSITY * 1.35);
  dir.position.set(-6, DIR_HEIGHT, -4);
  dir.castShadow = true;
  dir.shadow.mapSize.set(1024, 1024);
  scene.add(ambient, hemi, dir);

  // Two soft fills over the halves of the room that no fixture reaches. The
  // stations all light themselves from their own accents, so the DEAD ZONES are
  // the open floor between them — the south-west quarter (armory approach) and
  // the south spine the player actually walks in along. Wide radius and low
  // intensity: these are meant to lift the floor off black, not to cast a pool
  // that competes with a station's accent for the eye.
  const fillSW = new THREE.PointLight(0xffb271, 3.4, 16, 2);
  fillSW.position.set(-4.5, 3.6, 2.6);
  const fillS = new THREE.PointLight(0xd9b48c, 2.8, 15, 2);
  fillS.position.set(1.5, 3.6, 4.4);
  scene.add(fillSW, fillS);

  room = buildRoom(scene);
  props = buildProps(scene);
  fx = createStationFx(scene);
  prompt = createStationPrompt(container);

  resetGamblerVisit(); // the round limit is PER VISIT, so clear it on entry
  // Read the run ONCE: the stats are handed in at entry and nothing in the
  // tavern can change them, so re-deriving this per frame would only allocate.
  diorama = readDiorama(tavern.stats, props.bumpers.length);
  ballAngle = 0;
  vfx = createVfx(scene);
  npcs = buildNpcs(scene);
  props.syncViceCards();
  tavern.player = createTavernPlayer(scene);
  tavern.camX = tavern.player.x;
  tavern.camZ = tavern.player.z;
  aimCamera(camera, tavern.camX, 0, tavern.camZ);

  input = createInput(canvas);
  hideDungeonHud(true);
  startTavernAmbience();

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
    applyZoom(); // the render size just changed, so the fit decision may have too
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
    // Socketed-card display on the armory vice: how many rune plates are lit,
    // so a harness can confirm the blade actually shows what is fitted.
    vicePlates: props?.plateCount() ?? 0,
    // The diorama is meant to REPORT the run, so a harness has to be able to
    // read what it claims and compare it against the stats it was handed.
    dioramaLit: diorama.lit,
    dioramaBallSpeed: diorama.ballSpeed,
    camZoom,
  });
  // Dev/QA: leave the tavern without descending, so a harness can re-enter it
  // after changing run state (e.g. socketing a card) and see the room rebuild.
  (window as unknown as { __tavernClose?: () => boolean }).__tavernClose = () => {
    if (!tavern.active) return false;
    closeTavern();
    return true;
  };

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
  closeGambler();
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
  stopTavernAmbience();
  npcs?.dispose();
  vfx?.dispose();
  npcs = null;
  vfx = null;
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
