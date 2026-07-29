/**
 * The RAF frame: simulate, then present, then render.
 *
 * Extracted verbatim from core.ts. Kept as ONE function rather than split into
 * loop/present halves, deliberately: frame ordering is invisible-failure
 * territory — a reorder here renders a plausible frame that is subtly wrong and
 * throws nothing — so this wave moved it without also rearranging it. Splitting
 * the presentation block out is a later, separately-verifiable step.
 *
 * The clock lives here too. `FixedStepLoop` owns the accumulator; the loop
 * mirrors it back onto `state.accumulator` because the headless harness reads
 * that as its loop-health diagnostic.
 */
import * as THREE from "three";
import { state } from "../state";
import { FixedStepLoop } from "../GameEngine";
import { simulate } from "./simulate";
import { isSimPaused } from "./paused";
import { isRenderHeld } from "../run/floor-hold";
import { isRendererReady, gpuTimingWanted } from "../boot/renderer";
import { FIXED_STEP, MAX_FRAME } from "../constants";
import { isTavernSceneOpen } from "../../../scenes/tavern";
import { followPlayer, tickShadowThrottle } from "../boot/lighting";
import { applyWeaponArt } from "../boot/sheets";
import { bossEngaged } from "../boss";
import { FINISHER_FLASH_MAX, FINISHER_FLASH_T, FLAME_FPS, FLAME_FRAMES, MOTE_RATE, PPU, WALL_H } from "../constants";
import { updateFollowCamera, worldToScreenPx } from "../engine/camera";
import { tickJuice } from "../engine/juice";
import { profBegin, profCount, profEnd, profFrame } from "../engine/profiler";
import { frenzyIntensity } from "../entities/combo-curve";
import { aimFpsCamera, billboardEnemiesToFps } from "../fps";
import { refreshHUD, renderHUD } from "../hud";
import { updateLampPuzzle } from "../lamp-puzzle";
import { updateArcKickers } from "../render/arc-kickers";
import { updateArcLanes } from "../render/arc-lanes";
import { updatePinballParts, updatePlungerRig } from "../render/pinball-parts";
import { updateShots } from "../shots";
import { showPickupNote, spawnFloatingCombo, updateBossBar, updatePlungerMeter } from "../ui";

/**
 * The 60Hz clock. One instance for the session; `resetSimClock()` is called
 * from `exitDungeonGame`, mirroring the single place `resetState()` zeroes
 * `state.accumulator`. A level change deliberately does NOT reset it —
 * `startLevel` re-bases `lastTime` but has never dropped banked time.
 */
const simLoop = new FixedStepLoop({ fixedStep: FIXED_STEP, maxFrame: MAX_FRAME });

/** Drop banked simulation time. Call beside `resetState()`. */
/**
 * One timestamp resolve in flight at a time. The resolve is a GPU readback; if
 * a new one is issued every frame they queue up behind each other and the
 * numbers drift further and further behind the frame that produced them.
 */
let gpuResolveInFlight = false;

export function resetSimClock(): void {
  simLoop.reset();
}

export function loop(now: number): void {
  if (!state.active) return;
  state.animFrameId = requestAnimationFrame(loop);
  // ── Held during a descent ── the descent screen owns the display while the
  // floor's pipelines compile (see startLevel). Rendering here would trigger
  // the lazy compile storm the warm-up exists to schedule, and simulating would
  // run the world for the several seconds the player cannot see or act.
  if (isRenderHeld()) return;
  profBegin("FRAME (total)");
  // Zero the per-frame render counters BEFORE anything draws.
  //
  // three only calls `info.reset()` from inside `setAnimationLoop`, and this
  // game drives its own rAF — so nothing here had ever reset them, and
  // `info.render.drawCalls` accumulated for the life of the page.
  state.renderer?.info.reset();

  // Clamped BOTH ways: MAX_FRAME is tab-out protection, and the 0 floor guards
  // against a first RAF timestamp that lags performance.now() (headless/pre-
  // render quirk) — one negative delta would otherwise poison the accumulator
  // and freeze the whole simulation for that long.
  const frame = Math.min(Math.max(0, (now - state.lastTime) / 1000), MAX_FRAME);
  state.lastTime = now;
  state.elapsed += frame;

  // Book paused wall-clock so the run's leaderboard duration excludes it.
  if (isSimPaused()) state.pausedRunS += frame;

  // ── Fixed-timestep simulation ──
  // Hit-freeze: while hitstopT is running the sim is paused so the impact reads
  // as a crunch. VFX and rendering (below) keep running through the freeze. We
  // clamp the accumulator so no time is banked — the world doesn't fast-forward
  // to catch up the instant the freeze ends.
  // Juice clocks run in REAL time, deliberately outside the fixed-step block
  // below: they measure the gap between crunches as the PLAYER feels it, and
  // sim time does not advance during a hitstop — clocking them inside would
  // freeze the limiter exactly when it is needed.
  tickJuice(frame);

  profBegin("sim (fixed steps)");
  // The accumulator lives in FixedStepLoop (GameEngine.ts), which was extracted
  // and unit-tested but — until now — never constructed: this block hand-rolled
  // the identical arithmetic beside it. Passing the ALREADY-CLAMPED `frame` is
  // deliberate; the clamp is idempotent, and computing it here keeps `tickJuice`
  // above running on the same value it always did.
  const stepped = simLoop.step(frame, state.hitstopT, simulate);
  state.hitstopT = stepped.hitstopT;
  // Mirror the private accumulator back onto state. NOT bookkeeping: the
  // headless harness reads `state.accumulator` as its loop-health diagnostic
  // (dev/window-hooks.ts). Without this line it would read a frozen 0 forever
  // while every test stayed green.
  state.accumulator = simLoop.accumulator;
  const simSteps = stepped.simSteps;
  profEnd("sim (fixed steps)");
  // A frame that runs 2+ fixed steps is CATCHING UP from a slow previous frame.
  // A rising count here means the lag is self-reinforcing (slow frame → more
  // sim work → slower frame), which reads as a stutter that will not settle.
  profCount("sim steps/frame", simSteps);

  // ── The tavern owns the screen ──
  // It runs its own renderer and covers the dungeon completely, so everything
  // below here is drawing a fully-hidden frame at full cost. Three renderers
  // were competing (dungeon pixel pass, tavern pixel pass, casino canvas) and
  // the panel canvas was getting ~4fps as a result. The rAF stays alive so the
  // loop resumes the moment the player descends.
  if (isTavernSceneOpen()) {
    // Close the open span; this frame drew nothing, so it must not be sampled
    // as a fast one (that would flatter the average).
    profEnd("FRAME (total)");
    return;
  }

  const p = state.player;
  const g = state.grid;

  // The held art follows the active hand — pickup, swap, break, retry all
  // funnel through this one check.
  applyWeaponArt();

  // ── Presentation (per rendered frame) ──
  // VFX use REAL frame time so particles keep flying through a hit-freeze.
  profBegin("vfx.update");
  state.vfx?.update(frame);
  profEnd("vfx.update");
  updatePinballParts(frame); // part cooldowns + pop/boing/chevron animations
  if (state.maze) updateArcKickers(state.maze.arcKickers, frame, state.elapsed); // curved-wall booster rubber
  if (state.maze) updateArcLanes(state.maze.arcLanes, frame, state.elapsed); // curved-wall booster lanes
  updateLampPuzzle(frame); // brazier glow + vault chest reveal
  updatePlungerRig(); // the visible launcher, shown only while parked to launch
  updateShots(frame); // orbit-lap + skill-shot windows, named-combo chain decay
  if (p) p.anim.update(frame);
  for (const z of state.zombies) z.anim.update(frame);

  // Loot bobs, snapped to the pixel grid so it doesn't shimmer. Coins are
  // skipped: they own their own Y across burst/rest/magnet (updateCoins), and
  // two writers on one position is a fight, not a bob.
  //
  // Playtest feedback said loot was easy to walk past, so it now ADVERTISES:
  // the bob is taller (0.05 → 0.09), and each item throws a small golden GLINT
  // once per ~2.4s cycle, staggered by its own bobPhase so a loot pile
  // twinkles rather than strobing in unison. The glint is a tinted burst —
  // its white-hot cores cross the bloom threshold, so it genuinely sparkles.
  for (const it of state.groundItems) {
    if (it.coin) continue;
    const y = 0.06 + Math.sin(state.elapsed * 2.6 + it.bobPhase) * 0.09;
    it.sprite.mesh.position.y = Math.round(y * PPU) / PPU;
    const cycle = (state.elapsed + it.bobPhase) % 2.4;
    if (cycle < frame) state.vfx?.burst(it.x, 0.4, it.z, 0xf0dc9a, 3, 1.4);
  }

  if (p && state.maze) {
    // Flip-book flames — every torch, lit or not, licks at FLAME_FPS with its
    // own phase so a corridor of torches never synchronizes.
    for (const f of state.maze.flames) {
      const idx = Math.floor(state.elapsed * FLAME_FPS + f.phase * FLAME_FRAMES) % FLAME_FRAMES;
      f.tex.offset.x = idx / FLAME_FRAMES;
    }
    // Ambient dust motes drifting through the air near the player.
    if (Math.random() < MOTE_RATE * frame) {
      state.vfx?.mote(p.x + (Math.random() - 0.5) * 7, 0.15 + Math.random() * 0.9, p.z + (Math.random() - 0.5) * 5);
    }
    // ── The stairs beacon LIVES ── a slow breathing pulse + a twist so the
    // beam reads as energy over the wall rims, and rising arcane sparks climb
    // it when you're near enough to see them. A static translucent cylinder
    // read as "unexplained prop" (players walked past the exit).
    const sb = state.maze.stairsBeam;
    sb.mat.opacity = 0.22 + 0.1 * (0.5 + 0.5 * Math.sin(state.elapsed * 2.1));
    sb.mesh.rotation.y = state.elapsed * 0.5;
    const sdx = sb.x - p.x;
    const sdz = sb.z - p.z;
    const sd2 = sdx * sdx + sdz * sdz;
    if (sd2 < 20 * 20 && Math.random() < 2.4 * frame) {
      const a = Math.random() * Math.PI * 2;
      state.vfx?.burst(sb.x + Math.cos(a) * 0.25, 0.2 + Math.random() * 2.2, sb.z + Math.sin(a) * 0.25, 0x6fd0e8, 1, 0.3);
    }
    // First time the way down comes into view each floor, say what it is —
    // the beacon's base (pit + pylons) hides behind wall rims, so the beam
    // alone reads as a mystery instead of an exit (same lesson as the
    // cracked-wall hint: nothing in the game teaches it otherwise).
    if (!state.stairsHintShown && sd2 < 8 * 8) {
      state.stairsHintShown = true;
      showPickupNote("⬇ THE BLUE BEACON — the stairs down; step into its base");
    }
  }

  if (p && g && state.maze) {
    // Park the pooled torch lights on the nearest torches. Sorting a handful
    // of anchors per frame is nothing; 20 live point lights would not be.
    //
    // MEASURED, NOT ASSUMED: this map+sort allocates a fresh array of objects
    // every frame and sorts ALL anchors to use only the first few. That is a
    // textbook GC-churn shape, so it is instrumented — if the sample says it is
    // cheap, leave it alone.
    profBegin("torch light sort");
    profCount("torch anchors", state.maze.torchAnchors.length);
    const anchors = state.maze.torchAnchors
      .map((a) => ({ a, d: (a.x - p.x) * (a.x - p.x) + (a.z - p.z) * (a.z - p.z) }))
      .sort((u, v) => u.d - v.d);
    profEnd("torch light sort");
    state.maze.lightPool.forEach((light, i) => {
      const anchor = anchors[i]?.a;
      if (anchor) light.position.set(anchor.x, WALL_H * 0.62 + 0.3, anchor.z);
      // Torch flicker: two out-of-phase sines — random flicker reads as a
      // broken lightbulb, layered sines read as a flame.
      const t = state.elapsed * 6 + i * 2.1;
      light.intensity = 6 + Math.sin(t) * 0.7 + Math.sin(t * 2.7) * 0.4;
      // Rising embers off the nearby lit torches (~7/sec each) — bright, so the
      // bloom pass gives them a warm halo. Only the closest few are lit anyway.
      if (anchor && Math.random() < 7 * frame) {
        state.vfx?.ember(anchor.x, WALL_H * 0.62 + 0.34, anchor.z);
      }
    });
  }

  // Camera: the iso follow-cam normally; the first-person cam during rampage.
  // (updateFps already re-aims the FPS camera each sim step; re-aim once more
  // here so mouse-look stays smooth between fixed steps.)
  if (state.fpsActive) {
    aimFpsCamera();
    billboardEnemiesToFps(); // keep enemy planes facing the FPS camera each frame
  } else if (p && state.camera) {
    updateFollowCamera(state.camera, p.x, p.z, frame);
  }

  // Keep the key light's small shadow frustum centred on the player: the light
  // rakes in from the world's north-west (opposite the south-east camera) so
  // wall shadows fall toward the viewer, into the corridors, not away.
  if (p) followPlayer(p.x, p.z);

  if (state.hudDirty) {
    state.hudDirty = false;
    // The DOM rebuild path. Guarded per-element in hud-diablo, but a bounce
    // still lands here every time the combo ticks.
    profBegin("refreshHUD (DOM)");
    refreshHUD();
    profEnd("refreshHUD (DOM)");
  }
  // Per-frame HUD animation: liquid globes, cooldown rings, the face's blink/
  // wince timers. Cheap even when a panel is slid off-screen.
  renderHUD(frame);

  // Score glue: spawn a Ragnarok-style floating ×N at the knight on every fresh
  // bounce-combo STEP, wherever the increment came from (wall, part, arc, ram) —
  // a rising count is the signal. It resets to 0 on lapse, arming the next spray.
  const combo = p?.bounceCombo ?? 0;
  if (combo > state.prevBounceCombo && combo >= 2 && p) {
    const sc = worldToScreenPx(p.x, p.z);
    if (sc) spawnFloatingCombo(combo, sc.x, sc.y);
  }
  state.prevBounceCombo = combo;

  // Frenzy screen FX (combo Part 2): vignette pull + chromatic aberration ramp
  // in with the deep combo and PULSE so the edge-of-control read breathes.
  // Driven per rendered frame (presentation only); eases back to 0 as the combo
  // lapses. sin() on real elapsed time is fine here — it never touches the sim.
  const fBase = frenzyIntensity(combo);
  const fPulse = fBase > 0 ? fBase * (0.78 + 0.22 * Math.sin(state.elapsed * 7)) : 0;
  state.pixelPass?.setFrenzyFx(fPulse);

  // Katana-finisher screen flash: decays on REAL frame time (not sim dt) so it
  // plays through the very hitstop the finisher causes — freeze + white-out
  // land on the same beat. Quadratic falloff: a hard pop, a fast fade.
  if (state.flashT > 0) {
    state.flashT = Math.max(0, state.flashT - frame);
    const k = state.flashT / FINISHER_FLASH_T;
    state.pixelPass?.setFlash(FINISHER_FLASH_MAX * k * k);
  }

  // Boss bar: while the overlord is alive AND HAS NOTICED YOU.
  //
  // It used to appear the instant the floor built, so every descent opened with
  // "☠ THE REAPER KING ☠" pinned to the top of the screen — which reads as "the
  // boss is right here" even though a census of 78 floors puts his spawn tile a
  // minimum of 56 BFS steps away. Gating on engagement (boss.ts, THE LEASH)
  // makes the announcement mean what it says. `bossEngaged` answers for
  // replicas too, off the streamed BossAux.
  const boss = state.zombies.find((z) => z.boss && z.mode !== "dead");
  const seen = boss && (bossEngaged() || boss.hp < (boss.maxHp ?? boss.hp));
  updateBossBar(state.bossBarEl, seen ? boss.hp : null, seen ? boss.maxHp ?? null : null);
  updatePlungerMeter(state.plungerMeterEl);

  const renderCam = state.fpsActive && state.fpsCamera ? state.fpsCamera : state.camera;
  // rendererReady: skip frames until the async backend init resolves. Simulation
  // above has already run, so a couple of dropped frames at launch cost nothing.
  if (state.scene && renderCam && state.pixelPass && isRendererReady()) {
    // Shadow throttle: per-light autoUpdate is off (see renderer setup); render
    // the shadow depth pass on alternate frames only.
    if (state.renderer) tickShadowThrottle();
    // GPU submission, not GPU completion: WebGL is async, so this measures the
    // CPU cost of building + submitting the passes. A small number here with a
    // large FRAME total means the cost is CPU-side, above this line.
    profBegin("pixelPass.render");
    state.pixelPass.render(state.scene, renderCam);
    profEnd("pixelPass.render");
    if (state.renderer) {
      // `render.calls` is "render calls SINCE THE APP STARTED" (three's own
      // docstring) — a monotonic counter, not a per-frame measure. Profiling it
      // produced a straight ramp that read as a plausible draw-call
      // distribution: avg was exactly (min+max)/2 and p95 exactly 0.95×max,
      // because percentiles of a ramp are just points on the line. Every
      // draw-call number ever quoted for this game came from that field.
      //
      // `drawCalls` is the per-frame one, and it only means anything because of
      // the `info.reset()` at the top of this function.
      // ── THE GPU NUMBER ──
      // Everything else in this profile is CPU submission. This is the only
      // figure that reflects what the GPU actually spent, read back from the
      // timestamp queries armed in boot/renderer.ts.
      //
      // The resolve is ASYNC and lands a frame or two late, which is fine for a
      // distribution and is why it is recorded outside the frame's own bracket.
      // Guarded so an adapter without `timestamp-query` (or a build with
      // profiling off) simply reports nothing instead of throwing every frame.
      if (gpuTimingWanted() && !gpuResolveInFlight) {
        gpuResolveInFlight = true;
        void state.renderer
          .resolveTimestampsAsync("render")
          .then(() => {
            const ms = state.renderer?.info.render.timestamp ?? 0;
            if (ms > 0) profCount("GPU render (µs)", Math.round(ms * 1000));
          })
          .catch(() => {
            /* adapter without timestamp-query — stay silent, never spam */
          })
          .finally(() => {
            gpuResolveInFlight = false;
          });
      }
      profCount("draw calls", state.renderer.info.render.drawCalls);
      profCount("render passes", state.renderer.info.render.frameCalls);
      profCount("triangles", state.renderer.info.render.triangles);
      // THE warm-up gate. `memory.programs` counts distinct COMPILED shader
      // programs (three: common/Info.js createProgram). It should be flat from
      // the moment the descent screen closes — every rise during play is a
      // material family the prewarm never saw, compiled mid-combat, which is a
      // hitch the player felt. Watch its `max`, not its average.
      profCount("gpu programs", state.renderer.info.memory.programs);
      // Textures are here to settle whether the per-actor texture clone in
      // render/sprite.ts really uploads one per zombie: ~135 at a full horde
      // confirms it, ~20 refutes it. Nobody should cost that fix before this
      // number has been read on real hardware.
      profCount("gpu textures", state.renderer.info.memory.textures);
    }
  }
  profEnd("FRAME (total)");
  profFrame();
}
