/**
 * FX LAB — the `__lab` equivalent for effects rather than monsters.
 *
 * ── WHY THIS HAD TO EXIST BEFORE THE SHADERS COULD BE JUDGED ─────────────────
 * `__lab` is monster-only: every one of its commands routes through `KIND_IDS`
 * and `debugSpawn`. There was NO way to put a fire puddle or a water slick in
 * front of the camera on demand. The only way to see one was to acquire the
 * ability that spills it, or to kill the right monster, and then to catch it
 * before it faded.
 *
 * That makes an A/B comparison of the elemental shaders impossible in practice —
 * you cannot compare two builds if you cannot reproduce the subject. So this is
 * a prerequisite for the work, not tooling added afterwards.
 *
 *   __fx()                       print the menu + the kind roster
 *   __fx.spawn("fire")           one, 2 units in front of you, long-lived
 *   __fx.spawn("slick", 3, 0)    one, at a player-relative (dx, dz)
 *   __fx.grid()                  THE CONTACT SHEET — one of every kind on a
 *                                fixed lattice, all in one screenshot
 *   __fx.pair("fire","slick")    two kinds side by side, for a hue/value read
 *   __fx.freeze()                stop the visual clock — the negative control
 *   __fx.thaw()                  start it again
 *   __fx.time()                  read a live decal's clock back
 *   __fx.list()                  every live decal, with its kind and clock
 *   __fx.clear()                 remove them all
 *
 * `spawn` here deliberately uses a LONG life (999s by default) and does not
 * fade, because a decal that is shrinking and dimming cannot be compared frame
 * to frame — the measurement would be reading the fade, not the shader.
 *
 * ── THE ONE THAT MATTERS MOST: `freeze()` ────────────────────────────────────
 * A screenshot cannot tell a working shader from a frozen one. `__fx.freeze()`
 * pins the clock so a capture script can prove the difference: frames must
 * differ while thawed, and must be identical while frozen. Without the frozen
 * control, "the frames differ" could just as well be camera jitter or a stray
 * particle, and the whole check is unfalsifiable.
 */
import * as THREE from "three";
import { state, type FloorFxKind } from "../state";
import { droppedHeatSources } from "../fx/heat";
import {
  elementOf,
  elementShaderKinds,
  isElementClockFrozen,
  liveElementCount,
  setElementClockFrozen,
} from "../fx/floor/decals";

export interface FxLabDeps {
  spawnFloorFx: (kind: FloorFxKind, x: number, z: number, radius: number, life: number, hostile?: boolean) => void;
  clearFloorFx: () => void;
  floorFxKinds: () => FloorFxKind[];
}

/** Long enough that nothing fades mid-measurement. */
const LAB_LIFE = 999;
const LAB_RADIUS = 1.2;

function resolveKind(name: string, roster: FloorFxKind[]): FloorFxKind | null {
  if ((roster as string[]).includes(name)) return name as FloorFxKind;
  const near = (roster as string[]).filter((k) => k.startsWith(name.slice(0, 3)));
  console.warn(
    `[fx] unknown kind "${name}".` + (near.length ? ` did you mean: ${near.join(", ")}?` : ""),
    `\n[fx] roster: ${(roster as string[]).join(", ")}`,
  );
  return null;
}

export function installFxLab(deps: FxLabDeps): void {
  if (typeof window === "undefined") return;
  const { spawnFloorFx, clearFloorFx, floorFxKinds } = deps;

  const help = (): string => {
    const roster = floorFxKinds();
    const shaders = new Set(elementShaderKinds());
    const rows = roster.map((k) => `  ${shaders.has(k) ? "shader" : "canvas"}  ${k}`);
    console.log(
      [
        "── FX LAB ───────────────────────────────────────────────",
        '  __fx.spawn("fire")            one, 2 ahead, life 999',
        '  __fx.spawn("slick", 3, 0)     one at a relative (dx, dz)',
        "  __fx.grid()                   ONE OF EVERY KIND — contact sheet",
        '  __fx.pair("fire", "slick")    two side by side',
        "  __fx.freeze() / __fx.thaw()   pin the visual clock",
        "  __fx.time()                   read the clocks back",
        "  __fx.list()                   live decals + their clocks",
        "  __fx.clear()                  remove them all",
        "",
        "  Decals spawn with life 999 and do not fade — a shrinking,",
        "  dimming decal cannot be compared frame to frame.",
        "",
        "  freeze() is the NEGATIVE CONTROL for the motion check:",
        "  frames must differ thawed and match frozen. Without it,",
        "  'the frames differ' proves nothing.",
        "",
        `── ROSTER (${roster.length}) ──`,
        ...rows,
      ].join("\n"),
    );
    return `${roster.length} kinds — see the table above`;
  };

  const placeAt = (kind: FloorFxKind, dx: number, dz: number, radius: number, life: number) => {
    const p = state.player;
    if (!p) {
      console.warn("[fx] no player — start a run first (__dungeonStartRun())");
      return null;
    }
    spawnFloorFx(kind, p.x + dx, p.z + dz, radius, life);
    return { kind, x: p.x + dx, z: p.z + dz, radius, life };
  };

  const fx = Object.assign(help, {
    kinds: (): FloorFxKind[] => floorFxKinds(),

    spawn: (name: string, dx = 0, dz = 2, radius = LAB_RADIUS, life = LAB_LIFE) => {
      const kind = resolveKind(name, floorFxKinds());
      if (!kind) return null;
      return placeAt(kind, dx, dz, radius, life);
    },

    /**
     * The contact sheet. One of every kind on a fixed lattice, so a before/after
     * is ONE screenshot rather than ten hand-placed ones — and the lattice is
     * fixed so the two screenshots are actually comparable.
     */
    grid: (spacing = 3) => {
      clearFloorFx();
      const roster = floorFxKinds();
      const cols = Math.ceil(Math.sqrt(roster.length));
      const placed: Array<{ kind: string; dx: number; dz: number }> = [];
      roster.forEach((kind, i) => {
        const dx = ((i % cols) - (cols - 1) / 2) * spacing;
        const dz = 2 + Math.floor(i / cols) * spacing;
        placeAt(kind, dx, dz, LAB_RADIUS, LAB_LIFE);
        placed.push({ kind, dx, dz });
      });
      return placed;
    },

    /** Two kinds side by side — for reading one against the other, which is how
     *  a value or hue collision actually gets noticed. */
    pair: (a: string, b: string, gap = 3) => {
      const roster = floorFxKinds();
      const ka = resolveKind(a, roster);
      const kb = resolveKind(b, roster);
      if (!ka || !kb) return null;
      clearFloorFx();
      placeAt(ka, -gap / 2, 2.5, LAB_RADIUS, LAB_LIFE);
      placeAt(kb, gap / 2, 2.5, LAB_RADIUS, LAB_LIFE);
      return [ka, kb];
    },

    /**
     * Pin the visual clock, by gating the increment inside the tick itself.
     *
     * The obvious implementation — re-write `uTime` back from a rAF callback —
     * DOES NOT WORK, and failed silently in a way worth recording. rAF callbacks
     * run in registration order, and the game loop registers before any dev
     * hook, so every frame the loop advanced the clock and RENDERED, and only
     * afterwards did the hold reset it. The frames kept moving while the API
     * reported "frozen", which made the motion script's negative control
     * useless — its whole job is to prove the shader is what moved.
     */
    freeze: () => {
      setElementClockFrozen(true);
      return `frozen ${liveElementCount()} decal clock(s) — __fx.thaw() to resume`;
    },

    thaw: () => {
      setElementClockFrozen(false);
      return "thawed";
    },

    frozen: () => isElementClockFrozen(),

    /** Read the clocks back. The cheapest possible smoke test for "is it even
     *  advancing" — run it twice a second apart. */
    time: () =>
      state.floorFx.map((f) => ({
        kind: f.kind,
        uTime: elementOf(f.mesh)?.uTime.value ?? null,
      })),

    list: () =>
      state.floorFx.map((f) => ({
        kind: f.kind,
        x: +f.x.toFixed(2),
        z: +f.z.toFixed(2),
        radius: f.radius,
        life: +f.life.toFixed(1),
        shader: elementOf(f.mesh) !== null,
        uTime: elementOf(f.mesh)?.uTime.value ?? null,
      })),

    live: () => liveElementCount(),

    /** Live puff counts + whether the pools are parented. */
    puffs: () => state.vfx?.puffDebug() ?? null,

    /**
     * Force the heat shimmer on or off, bypassing the setting.
     *
     * The A/B this exists for cannot be done any other way: the shimmer warps the
     * SCENE, so "is it working" is a question about pixels that belong to the
     * floor and the walls, not about pixels the effect drew. Two frames with the
     * same fire and the shimmer toggled is the only comparison that isolates it.
     */
    heat: (on = true) => {
      state.pixelPass?.setHeatEnabled(on);
      return on ? "shimmer ON" : "shimmer OFF";
    },

    /** How many heat sources the cap dropped last frame — a silent top-8 cap
     *  would read as "covered everything". */
    heatDropped: () => droppedHeatSources(),

    /**
     * Puff the smoke or steam pool in front of the knight.
     *
     * Separate from `spawn` because these are PARTICLES, not decals — they do not
     * appear in `__fx.list()`, they do not respond to `freeze()`, and they cannot
     * be given a 999s life. Anything that wants to look at them has to keep
     * calling; `__fx.puff("smoke", 40)` is a one-liner that fills a frame.
     */
    puff: (which: "smoke" | "steam" = "smoke", count = 20, dx = -1.5, dz = 1.5) => {
      const p = state.player;
      if (!p) {
        console.warn("[fx] no player — start a run first (__dungeonStartRun())");
        return null;
      }
      const fn = which === "steam" ? state.vfx?.steam : state.vfx?.smoke;
      if (!fn) {
        console.warn("[fx] no vfx system yet");
        return null;
      }
      fn.call(state.vfx, p.x + dx, 0.25, p.z + dz, count, 1.2);
      return { which, count, x: p.x + dx, z: p.z + dz };
    },

    /**
     * Where each live decal actually lands on screen, in CSS pixels.
     *
     * A capture script needs this. Guessing a crop box from the spawn offset
     * puts the knight, the torches and the ember stream inside the measured
     * region — and then a "did it move" metric measures THOSE and reports
     * motion whatever the shader is doing. That is not a hypothetical: the first
     * run of `scripts/fx-motion.mjs` passed its thawed case and its own frozen
     * control ALSO moved, which is exactly what a contaminated crop looks like.
     */
    screen: () => {
      const cam = state.camera;
      const el = state.renderer?.domElement;
      if (!cam || !el) return [];
      const w = el.clientWidth;
      const h = el.clientHeight;
      return state.floorFx.map((f) => {
        const v = new THREE.Vector3(f.x, 0.03, f.z).project(cam);
        // The decal is a disc of `radius` world units lying flat; project a
        // second point one radius away to get its on-screen extent, rather than
        // assuming a scale factor that a camera-distance setting would break.
        const e = new THREE.Vector3(f.x + f.radius, 0.03, f.z).project(cam);
        return {
          kind: f.kind,
          x: Math.round(((v.x + 1) / 2) * w),
          y: Math.round(((1 - v.y) / 2) * h),
          px: Math.max(8, Math.round((Math.abs(e.x - v.x) / 2) * w)),
        };
      });
    },

    /**
     * Pause the simulation so the ONLY thing left moving is the shader.
     *
     * Rendering and the visual clock both continue while paused (they are in the
     * presentation half of the frame loop), which is precisely the state a
     * motion measurement wants: the knight stops animating, no new embers are
     * emitted, and the torch light stops being re-sorted.
     */
    pause: (on = true) => {
      state.uiPauses = on;
      return on ? "sim paused — rendering and the fx clock continue" : "sim resumed";
    },

    clear: () => {
      clearFloorFx();
      return "cleared";
    },
  });

  (window as unknown as { __fx?: typeof fx }).__fx = fx;
}
