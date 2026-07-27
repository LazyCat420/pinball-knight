/**
 * Dev / QA window hooks — the `window.__dungeon*` surface.
 *
 * Extracted verbatim from core.ts (was ~500 lines inline in launchDungeonGame).
 * This is the scriptable counterpart to the ` god-mode panel: every hook a
 * headless harness (scripts/playtest.mjs, spawn debugger, art QA) reaches for
 * lives here, and NOTHING in the production frame path does.
 *
 * These hooks are load-bearing for testing, not decoration — `__dungeonSpawn`,
 * `__dungeonPad` and `__dungeonDebug` are the difference between a QA script
 * that works and one that silently screenshots an ability that never fired for
 * want of mana. Treat them as API.
 *
 * The handful of core-owned actions the hooks need (startLevel, descend, …) are
 * passed in as `DevHookDeps` rather than imported, so this module never imports
 * back up into core.ts and no cycle can form.
 */
import { state } from "../state";
import { ABILITIES, type AbilityId } from "../abilities";
import { CARDS } from "../cards";
import { MAGICIAN_FROM_LEVEL, PINBALL_MAX_SPEED, ZOMBIE_R } from "../constants";
import { coopSeed, enemyAuthorityIsMe, isCoop } from "../coop";
import { floorsWithPiles, loadResumeFloor, pilesOnFloor } from "../corpse-run";
import { syncActorMesh } from "../entities/combat";
import { debugCurSpeed, debugWallNormal } from "../entities/player";
import { railCap } from "../entities/rail";
import { exploredCount, exploredFraction } from "../fog";
import { POTIONS, POTION_IDS, WEAPONS, freshWeapon } from "../items";
import type { PotionId, WeaponId } from "../items";
import { isFloorMapOpen } from "../map-overlay";
import { at } from "../maze/generator";
import { myId, peers } from "../../../net/presence";
import { installBotHooks } from "../playtest-bot";
import { installProfilerHooks } from "../profiler";
import { rotateLanes } from "../shots";
import { enterTavern, isTavernSceneOpen } from "../../../scenes/tavern";
import { ZOMBIE_TYPE_IDS } from "../zombie-types";
import type { SpriteSheet } from "../render/sprite";
import type { DebugSpawnSpec, DebugSpawnResult } from "../debug-spawn";

/**
 * The core-owned actions the hooks drive. Injected (not imported) to keep the
 * dependency arrow pointing one way: core → dev, never dev → core.
 */
export interface DevHookDeps {
  startLevel: (level: number) => void;
  descend: () => void;
  onPlayerDeath: () => void;
  openShop: () => void;
  applyPotion: (id: PotionId) => void;
  debugSpawn: (spec: DebugSpawnSpec) => DebugSpawnResult;
  debugClearEnemies: () => void;
  exitDungeonGame: () => void;
  tearGraveHole: (x: number, z: number, name: string) => void;
}

/**
 * Install every `window.__dungeon*` hook. Call once from launchDungeonGame.
 * No-ops outside a browser (the `typeof window` guard the block always had).
 */
export function installDevHooks(deps: DevHookDeps): void {
  const { startLevel, descend, onPlayerDeath, openShop, applyPotion, debugSpawn, debugClearEnemies } = deps;
  const { exitDungeonGame, tearGraveHole } = deps;
  if (typeof window === "undefined") return;

  // Dev-only atlas preview hooks for headless art QA:
  //   `__dungeonAtlas(which)` → data URL of that actor's full sprite strip
  //   `__dungeonClips(which)` → the clip table ("S:idle"→[0,1], …) so a harness
  //                             can slice + label individual named frames.
  // `which` ∈ spider|brute|spitter|ghost|boss|knight|zombie.
    const sheetFor = (which: string): SpriteSheet | null =>
      which === "spider" ? state.spiderSheet :
      which === "brute" ? state.bruteSheet :
      which === "spitter" ? state.spitterSheet :
      which === "ghost" ? state.ghostSheet :
      which === "bat" ? state.batSheet :
      which === "slime" ? state.slimeSheet :
      which === "boss" ? state.bossSheet :
      which === "goblin" ? state.goblinSheet :
      which === "pin" ? state.pinSheet :
      which === "golem" ? state.golemSheet :
      which === "chomper" ? state.chomperSheet :
      which === "magnet" ? state.magnetSheet :
      which === "webspinner" ? state.webspinnerSheet :
      which === "knight" ? (state.playerArtKey ? state.playerSheets.get(state.playerArtKey) : null) ?? null :
      state.zombieVariantSheets[0] ?? null;
    (window as unknown as { __dungeonAtlas?: (which: string) => string | null }).__dungeonAtlas = (which: string) => {
      const img = sheetFor(which)?.texture.image as HTMLCanvasElement | undefined;
      return img ? img.toDataURL("image/png") : null;
    };
    (window as unknown as { __dungeonClips?: (which: string) => Record<string, number[]> | null }).__dungeonClips = (which: string) => {
      const sheet = sheetFor(which);
      return sheet ? Object.fromEntries(sheet.clips) : null;
    };
    // Dev telemetry for headless behaviour QA.
    (window as unknown as { __dungeonStats?: () => unknown }).__dungeonStats = () => ({
      projectiles: state.projectiles.length,
      hostileGlobs: state.projectiles.filter((pr) => pr.hostile).length,
      // x/z included so a harness can assert MOVEMENT (freeze stops the horde,
      // the magnet drags you in) — kind/hp alone cannot answer those.
      enemies: state.zombies.map((z) => ({ kind: z.kind, mode: z.mode, aggro: z.aggro, hp: z.hp, boss: !!z.boss, maxHp: z.maxHp, x: z.x, z: z.z })),
      playerHp: state.player?.hp,
      floorFx: state.floorFx.map((f) => f.kind),
    });
    // Dev: force a weapon into the active slot (QA the bow/gun/etc. without hunting
    // for a pickup). `__dungeonGive('bow')`.
    // Dev: bind any ability to a Q/E slot (QA a skill without the tree grind).
    // `__dungeonAbility(1, 'slickfield')`.
    (window as unknown as { __dungeonAbility?: (slot: number, id: string) => boolean }).__dungeonAbility = (slot: number, id: string) => {
      if (!(id in ABILITIES) || (slot !== 0 && slot !== 1)) return false;
      const aid = id as AbilityId;
      if (!state.unlockedAbilities.includes(aid)) state.unlockedAbilities.push(aid);
      state.abilitySlots[slot] = aid;
      state.hudDirty = true;
      return true;
    };
    (window as unknown as { __dungeonGive?: (id: string) => boolean }).__dungeonGive = (id: string) => {
      if (!(id in WEAPONS)) return false;
      state.weaponSlots[state.activeSlot] = freshWeapon(id as WeaponId);
      return true;
    };
    // Dev: die on demand. The corpse/resume loop is otherwise only reachable by
    // actually losing a fight, which a harness cannot do reliably — and "did my
    // kit drop where I fell" is exactly the thing that needs testing unattended.
    (window as unknown as { __dungeonDie?: () => unknown }).__dungeonDie = () => {
      onPlayerDeath();
      return { floor: state.level, piles: pilesOnFloor(state.level).length, resume: loadResumeFloor() };
    };
    // Dev: who is in the pool, where, and are we the floor authority. The only
    // way a harness can assert that per-floor scene isolation actually holds —
    // "8 players don't collide" is otherwise untestable without eyeballing two
    // browsers side by side.
    (window as unknown as { __dungeonPool?: () => unknown }).__dungeonPool = () => ({
      level: state.level,
      seed: state.runSeed,
      poolSeed: coopSeed(),
      connected: isCoop(),
      authority: enemyAuthorityIsMe(),
      me: myId(),
      peers: peers().map((p) => ({ name: p.name, scene: p.scene })),
      sameFloor: peers().filter((p) => p.scene === `dungeon:${state.level}`).length,
    });
    // Dev: read the corpse ledger without touching localStorage from the page.
    (window as unknown as { __dungeonCorpses?: (floor?: number) => unknown }).__dungeonCorpses = (floor?: number) => ({
      floors: floorsWithPiles(),
      piles: pilesOnFloor(floor ?? state.level),
      resume: loadResumeFloor(),
      onFloor: state.groundItems.filter((g) => g.corpseId).length,
    });
    // Dev: the floor map's exploration state — the only way a harness can see
    // whether fog is actually being revealed (the minimap is a canvas).
    (window as unknown as { __dungeonFog?: () => unknown }).__dungeonFog = () => {
      const g = state.grid;
      const f = state.fog;
      if (!g || !f) return null;
      return {
        w: f.w,
        h: f.h,
        rev: f.rev,
        seen: exploredCount(f),
        pct: Math.round(exploredFraction(f, g) * 100),
        mapOpen: isFloorMapOpen(),
      };
    };
    // Dev: the state VERIFY_CHECKLIST.md asserts on.
    //
    // Almost everything in that checklist is a canvas, a shader or a transient
    // DOM tile, so a harness driving the debug panel can click a control and
    // have no way to tell whether it did anything. This is the read-back.
    (window as unknown as { __dungeonProbe?: () => unknown }).__dungeonProbe = () => {
      const p = state.player;
      return {
        // §0 debug toggles
        godMode: state.godMode,
        infMana: state.infMana,
        noCooldown: state.noCooldown,
        // §2/§3 buffs — the timers the buff strip renders from
        buffs: p
          ? {
              rage: p.rageT,
              haste: p.hasteT,
              shield: p.shieldT,
              iron: p.ironT,
              turbo: p.turboT,
              spring: p.springT,
              curve: p.curveT,
              magBoots: p.magBootsT,
              multiBall: p.multiBallT,
              magnetAura: p.magnetAuraT,
              bladeStorm: p.bladeStormT,
              webbed: p.webbedT,
              oil: p.oilT,
              material: p.material,
              materialT: p.materialT,
              fuseMaterial: p.fuseMaterial,
            }
          : null,
        freezeT: state.freezeT ?? 0,
        potionIds: POTION_IDS.slice(),
        // §1 vitals
        hp: p?.hp ?? 0,
        mana: p?.mana ?? 0,
        // §4 rampage / HUD swap
        hudMode: state.hudMode,
        fpsActive: state.fpsActive,
        // The FPS camera ANGLE. Rampage is the one mode whose whole control
        // story is "where am I looking", and nothing else reads that back: a
        // harness can only infer it from where forward movement travels, which
        // is wrong — forward slides along walls, so two runs differ in heading
        // even when the camera never turned. That inference produced a false
        // PASS for a broken right-stick turn, which is why the angle is exposed
        // directly rather than derived.
        fpsYaw: state.fpsYaw,
        fpsPitch: state.fpsPitch,
        ultCharge: state.ultCharge,
        // §5 world.
        // `enemies` counts CORPSES too — Kill All damages every zombie to death
        // and they linger in the array playing their death FX, which is exactly
        // what distinguishes it from Clear (instant wipe, no FX). A harness
        // asserting "Kill All emptied the array" would be asserting the wrong
        // thing, so expose the live count separately.
        enemies: state.zombies.length,
        enemiesAlive: state.zombies.filter((z) => z.mode !== "dead").length,
        // Descending opens the TAVERN first; `level` only advances once you use
        // its descend plunger. Without this a harness reads "level stuck" and
        // calls a working hub a bug.
        tavernOpen: isTavernSceneOpen(),
        parts: state.pinballParts.length,
        level: state.level,
        gameOver: state.gameOver,
        weapon: state.weaponSlots[state.activeSlot]?.id ?? null,
      };
    };
    // Dev: socket a card straight into the active weapon. `__dungeonSocket('ember')`.
    // Card drops are random and socketing is several clicks deep in the tavern,
    // so without this there is no way for a harness to reach any state where a
    // weapon actually HAS cards — which is what the armory vice displays.
    (window as unknown as { __dungeonSocket?: (id: string) => boolean }).__dungeonSocket = (id: string) => {
      const w = state.weaponSlots[state.activeSlot];
      if (!w || !(id in CARDS)) return false;
      w.cards = [...(w.cards ?? []), id];
      return true;
    };
    // Dev: apply a potion directly (QA the Wave-F kit — freeze/turbo/curveshot/…
    // without hunting for a flask). `__dungeonPotion('freeze')`.
    (window as unknown as { __dungeonPotion?: (id: string) => boolean }).__dungeonPotion = (id: string) => {
      if (!(id in POTIONS)) return false;
      applyPotion(id as PotionId);
      return true;
    };
    // Dev: snapshot the live projectiles' velocities so a headless test can
    // confirm the arrow flew toward the aim point, not the movement facing.
    (window as unknown as { __dungeonProjectiles?: () => Array<{ kind: string; vx: number; vz: number }> }).__dungeonProjectiles = () =>
      state.projectiles.map((pr) => ({ kind: pr.kind, vx: pr.vx, vz: pr.vz }));
    // Dev: player movement/combat telemetry (sprint, roll, i-frames, position)
    // so a headless test can confirm sprint drains, a dodge rolls + grants
    // i-frames, and the roll covers ground.
    // Dev: the level's pinball parts (kind/position/direction) so a headless
    // test can navigate to a bumper/spring and verify the physics fire.
    (window as unknown as { __dungeonParts?: () => unknown }).__dungeonParts = () =>
      state.pinballParts.map((pt) => ({ kind: pt.kind, i: pt.i, j: pt.j, x: pt.x, z: pt.z, dirX: pt.dirX, dirZ: pt.dirZ, cooldownT: pt.cooldownT }));
    // Dev: NPC positions/kinds (merchant chase + shop QA).
    (window as unknown as { __dungeonNpcs?: () => unknown }).__dungeonNpcs = () =>
      state.npcs.map((n) => ({ kind: n.kind, x: n.x, z: n.z, phase: n.phase, shopped: !!n.shopped }));
    // Dev: the shot-identity layer (orbits/lanes/skill/named combos) — the
    // only way a headless harness can see whether a lap or a bank registered.
    (window as unknown as { __dungeonShots?: () => unknown }).__dungeonShots = () => ({
      orbitActive: state.orbitActive,
      orbitCount: state.orbitCount,
      orbitLaps: state.orbitLaps,
      laneLit: state.laneLit,
      lanesCleared: state.lanesCleared,
      skillArmed: state.skillArmed,
      skillT: Math.round(state.skillT * 10) / 10,
      shotChain: state.shotChain,
      namedPaid: Object.keys(state.namedPaid),
    });
    // Dev: light one lane of every bank, then rotate — proves the lane change
    // actually moves the lit lanes rather than being a no-op key.
    (window as unknown as { __dungeonLaneTest?: () => boolean }).__dungeonLaneTest = () => {
      const banks = new Set(state.pinballParts.filter((q) => q.lane !== undefined).map((q) => q.lane as number));
      if (banks.size === 0) return false;
      for (const id of banks) state.laneLit[id] = [true, false, false];
      const before = JSON.stringify(state.laneLit);
      rotateLanes();
      return JSON.stringify(state.laneLit) !== before;
    };
    // Dev: open the between-floor TAVERN without clearing a floor first — it's
    // where the holo cards live, and QA'ing them shouldn't need a full run.
    (window as unknown as { __dungeonTavern?: () => boolean }).__dungeonTavern = () => {
      if (!state.container || state.tavernEl || isTavernSceneOpen()) return false;
      enterTavern(state.container, {
        stats: { grade: "A", floor: state.level, kills: state.kills, bestCombo: state.levelBestCombo },
        onDescend: () => startLevel(state.level + 1),
        onAbandon: () => exitDungeonGame(),
      });
      return true;
    };
    // Dev: jump straight to a depth. The merchant, the magician and the reaper
    // all gate on level, so a harness that can't change floors can't test them.
    (window as unknown as { __dungeonLevel?: (n: number) => boolean }).__dungeonLevel = (n: number) => {
      if (state.gameOver || !Number.isFinite(n) || n < 1) return false;
      startLevel(Math.floor(n));
      return true;
    };
    // Dev: summon the Magician NOW (his visit clock is 45s ± 12 — far too long
    // to wait on to QA the room shuffle). He still bows before the trick.
    (window as unknown as { __dungeonMagician?: () => boolean }).__dungeonMagician = () => {
      if (state.npcs.some((n) => n.kind === "magician")) return false;
      state.magicianT = 0;
      state.level = Math.max(state.level, MAGICIAN_FROM_LEVEL);
      return true;
    };
    // Dev: force the merchant's shop open, and buy row i (shop-flow QA).
    (window as unknown as { __dungeonShop?: (buy?: number) => unknown }).__dungeonShop = (buy?: number) => {
      if (buy === undefined) openShop();
      else if (state.shopEl) (state.shopEl.querySelectorAll("[data-shop-row]")[buy] as HTMLElement | undefined)?.click();
      return { open: !!state.shopEl };
    };
    // Dev: the still-intact secret bands + the floor ledger (secret/reaper/grade QA).
    // ── Dev SPAWN CONSOLE ── the scriptable counterpart to the ` panel's enemy
    // chips. The chips are DOM clicks, which are unreliable to drive from a
    // harness (a silently-missed toggle cost this project two QA cycles), and
    // they place exactly one monster next to the knight — useless for the
    // questions worth asking, which almost all need a CROWD at a KNOWN RANGE.
    //
    //   __dungeonSpawn({kind:"zombie", count:8, ring:3})   ring at 3 tiles
    //   __dungeonSpawn({kind:"brute", count:1, at:{x,z}})  exact spot
    //   __dungeonSpawn({kind:"ghost", count:4, ring:2, hp:1, aggro:false})
    //   __dungeonSpawn({kind:"zombie", ztype:"hulk", count:1})  a SUB-TYPE
    //
    // Returns what was ACTUALLY placed (`spawned` can be < `requested` in a
    // tight room), so a test never asserts against a horde it did not get.
    (window as unknown as { __dungeonSpawn?: (spec: DebugSpawnSpec) => unknown }).__dungeonSpawn = (spec: DebugSpawnSpec) =>
      debugSpawn({ ...spec, count: spec?.count ?? 1 });
    // Dev: FRAME PROFILER — answers "why does it lag" with numbers.
    //   __dungeonProfile()      profile ~240 frames, print a table, auto-stop
    //   __dungeonProfileStop()  stop early
    // Play normally while it runs (bounce off walls to catch the jitter case).
    installProfilerHooks();
    // Dev: PLAYTEST BOT — drives the fake pad so a soak test needs no hands.
    //   __dungeonBot({ mode:"bounce", seconds:120, profile:true })
    //   __dungeonBotStop()
    // Reports stuck episodes, deaths, peak combo and any thrown errors.
    installBotHooks();
    // Dev: ONE OF EACH zombie sub-type in a ring — the silhouette check.
    //   __zombieTypes()          ring at 3 tiles, posed, not aggroed
    //   __zombieTypes(4)         wider ring
    // Returns each sub-type with where it landed and its resolved stats, so a
    // headless harness asserts against what was PLACED rather than what it hoped
    // for (a tight room can reject a hulk — see resolveZombieType).
    (window as unknown as { __zombieTypes?: (ring?: number) => unknown }).__zombieTypes = (ring = 3) => {
      const out: Array<{ ztype: string; x: number; z: number; hp: number; bodyR: number; scale: number }> = [];
      ZOMBIE_TYPE_IDS.forEach((t, i) => {
        const r = debugSpawn({
          kind: "zombie",
          ztype: t,
          count: 1,
          ring,
          // Fan them around the ring rather than stacking on one bearing.
          phase: (i / ZOMBIE_TYPE_IDS.length) * Math.PI * 2,
          aggro: false,
        });
        const zz = state.zombies[state.zombies.length - 1];
        if (r.spawned > 0 && zz) {
          out.push({
            ztype: zz.ztype ?? "shambler",
            x: +zz.x.toFixed(2),
            z: +zz.z.toFixed(2),
            hp: zz.hp,
            bodyR: zz.bodyR ?? ZOMBIE_R,
            scale: +zz.sprite.mesh.scale.x.toFixed(2),
          });
        }
      });
      return { placed: out.length, requested: ZOMBIE_TYPE_IDS.length, types: out };
    };
    // Dev: the live input picture — which keys are down, what the touch overlay
    // and the pad are reporting, and whether the poller is seeing a controller
    // at all. Controllers and touch have no other read-back headlessly.
    (window as unknown as { __dungeonInput?: () => unknown }).__dungeonInput = () => state.input?.debug() ?? null;
    // Dev: a FAKE CONTROLLER, because a headless harness has no pad and hand-
    // rolled `getGamepads` stubs get this wrong in a way that looks exactly like
    // a broken poller. A button already down on the pad's FIRST poll is treated
    // as held-at-connect and deliberately never fires (see gamepad.ts `prev:
    // null`) — so a stub that reports a press immediately, and holds it, can
    // never produce a tap no matter how many frames run. That cost a QA cycle.
    //
    // This hook always installs the pad AT REST and only presses when asked, so
    // the edge is real:
    //   __dungeonPad.connect()          plug in a resting pad
    //   __dungeonPad.tap(4)             press + release button 4 (LB → q)
    //   __dungeonPad.hold(4) / .release(4)
    //   __dungeonPad.stick(x, y)        left stick; .aim(x, y) for the right
    //   __dungeonPad.disconnect()
    // Buttons are the standard-mapping indices exported as BTN in gamepad.ts.
    // A tap needs TWO polls to be seen (press frame, release frame), so let at
    // least two animation frames pass before asserting.
    (window as unknown as { __dungeonPad?: unknown }).__dungeonPad = (() => {
      const buttons = Array.from({ length: 17 }, () => ({ pressed: false }));
      const axes = [0, 0, 0, 0];
      const fake = { axes, buttons, connected: true, id: "debug fake pad (standard)", index: 0, mapping: "standard", timestamp: 0 };
      let plugged = false;
      const real = navigator.getGamepads?.bind(navigator);
      // Merge rather than replace: a real pad plugged in alongside must keep
      // working, and the poller already merges every connected pad.
      navigator.getGamepads = () => {
        const live = real ? Array.from(real()) : [];
        return (plugged ? [...live, fake] : live) as ReturnType<Navigator["getGamepads"]>;
      };
      const press = (i: number, v: boolean) => {
        if (i >= 0 && i < buttons.length) buttons[i] = { pressed: v };
      };
      return {
        connect() {
          for (let i = 0; i < buttons.length; i++) buttons[i] = { pressed: false };
          axes.fill(0);
          plugged = true;
          return "pad connected at rest";
        },
        disconnect() {
          plugged = false;
          return "pad disconnected";
        },
        hold: (i: number) => (press(i, true), `hold ${i}`),
        release: (i: number) => (press(i, false), `release ${i}`),
        /** Press and auto-release after `frames` polls, so the edge is clean. */
        tap(i: number, frames = 2) {
          press(i, true);
          let n = 0;
          const step = () => (++n >= frames ? press(i, false) : requestAnimationFrame(step));
          requestAnimationFrame(step);
          return `tap ${i}`;
        },
        stick: (x: number, y: number) => ((axes[0] = x), (axes[1] = y), `stick ${x},${y}`),
        aim: (x: number, y: number) => ((axes[2] = x), (axes[3] = y), `aim ${x},${y}`),
        state: () => ({ plugged, axes: [...axes], down: buttons.map((b, i) => (b.pressed ? i : -1)).filter((i) => i >= 0) }),
      };
    })();
    // Dev: wipe the floor of enemies (and corpses). Returns how many went.
    (window as unknown as { __dungeonClear?: () => number }).__dungeonClear = () => {
      const n = state.zombies.length;
      debugClearEnemies();
      return n;
    };
    // Dev: the god-mode toggles, WITHOUT going through the panel's DOM. These
    // three are the difference between a QA script that works and one that
    // silently screenshots an ability that never fired for want of mana.
    // Call with no argument to read them back.
    (window as unknown as { __dungeonDebug?: (f?: Record<string, boolean>) => unknown }).__dungeonDebug = (f?: Record<string, boolean>) => {
      if (f) {
        if (f.god !== undefined) state.godMode = f.god;
        if (f.mana !== undefined) state.infMana = f.mana;
        if (f.noCd !== undefined) state.noCooldown = f.noCd;
        state.hudDirty = true;
      }
      return { god: state.godMode, mana: state.infMana, noCd: state.noCooldown };
    };
    // Dev: the BOOSTER rubber on the curved walls — world mid-point of each
    // band plus its live cooldown/flash, so a harness can warp beside one, fire
    // the ball into it and assert the kick actually fired (there is no other
    // read-back: the bands are geometry on a merged wall mesh).
    (window as unknown as { __dungeonKickers?: () => unknown }).__dungeonKickers = () =>
      (state.maze?.arcKickers ?? []).map((k) => ({ x: k.x, z: k.z, cooldownT: k.band.cooldownT, hitT: k.band.hitT }));
    // Dev: the BOOSTER LANES, same read-back plus the one thing a lane has that
    // rubber doesn't — `cw`, the direction it throws. A harness must enter WITH
    // the grain or the lane correctly ignores it, so a test that doesn't know
    // the direction is a test that fails for the wrong reason.
    // Dev: live BANKED RAIL state — the only read-back for a held ride. A rail
    // is invisible to __dungeonLanes (which reports authored geometry, not what
    // the knight is doing), so without this a harness cannot tell "riding" from
    // "touching a wall that happens to be curved".
    (window as unknown as { __dungeonRail?: () => unknown }).__dungeonRail = () => {
      const p = state.player;
      if (!p) return null;
      return {
        riding: p.rail.featureIdx >= 0,
        featureIdx: p.rail.featureIdx,
        rideT: +p.rail.rideT.toFixed(3),
        slipT: +p.rail.slipT.toFixed(3),
        speed: +p.momSpeed.toFixed(2),
        // The headline number: how far past the normal ceiling the ride has
        // pushed. 0 means the rail is not paying yet.
        overspeed: +Math.max(0, p.momSpeed - PINBALL_MAX_SPEED).toFixed(2),
        cap: PINBALL_MAX_SPEED,
        railCap: +railCap().toFixed(2),
      };
    };
    (window as unknown as { __dungeonLanes?: () => unknown }).__dungeonLanes = () =>
      (state.maze?.arcLanes ?? []).map((l) => ({
        x: l.x,
        z: l.z,
        cw: l.band.cw,
        a0: l.band.a0,
        span: l.band.span,
        cooldownT: l.band.cooldownT,
        hitT: l.band.hitT,
      }));
    // Dev: detonate a departing knight at (x,z) WITHOUT a second real client.
    // A pool departure needs two browsers and a disconnect timed by hand, which
    // is not a thing a harness can stage — so this calls the same function the
    // network path calls. Returns the tile the hole actually landed on (it
    // snaps, and refuses to stack), or null if the spot was unusable.
    (window as unknown as { __dungeonHole?: (x: number, z: number, n?: string) => unknown }).__dungeonHole = (x: number, z: number, n = "A KNIGHT") => {
      const before = state.pinballParts.length;
      tearGraveHole(x, z, n);
      const made = state.pinballParts.length > before ? state.pinballParts[state.pinballParts.length - 1] : null;
      return made ? { i: made.i, j: made.j, x: made.x, z: made.z } : null;
    };
    /** Dev: every grave pit on the floor — a harness cannot see parts otherwise. */
    (window as unknown as { __dungeonHoles?: () => unknown }).__dungeonHoles = () =>
      state.pinballParts.filter((p) => p.kind === "gravepit").map((p) => ({ i: p.i, j: p.j, x: p.x, z: p.z }));
    (window as unknown as { __dungeonSecrets?: () => unknown }).__dungeonSecrets = () =>
      state.maze?.secrets.map((s) => ({ i: s.i, j: s.j, x: s.x, z: s.z })) ?? [];
    (window as unknown as { __dungeonFloor?: () => unknown }).__dungeonFloor = () => ({
      levelT: state.levelT,
      // Where the floor began — a harness asserts NOTHING sends you back here.
      startX: state.levelStart.x,
      startZ: state.levelStart.z,
      hordeSize: state.levelHordeSize,
      killsThisFloor: state.kills - state.levelStartKills,
      bestCombo: state.levelBestCombo,
      reaperOut: state.reaperOut,
      // Wave A/E/F floor state, exposed for the headless harness.
      targets: `${state.targetsHit}/${state.targetsTotal}`,
      freezeT: state.freezeT,
      npcs: state.npcs.map((n) => n.kind),
      partKinds: Array.from(new Set(state.pinballParts.map((pt) => pt.kind))),
      shopOpen: !!state.shopEl,
      magicianT: state.magicianT,
      // Loop diagnostics (accumulator health for the harness).
      accumulator: state.accumulator,
      hitstopT: state.hitstopT,
      elapsed: state.elapsed,
      level: state.level,
    });
    // Dev: hurl the player into a pinball ride (headless secret-wall/physics
    // tests — spooling a real sprint with synthetic key events is flaky).
    (window as unknown as { __dungeonLaunch?: (dirX: number, dirZ: number, speed: number) => boolean }).__dungeonLaunch = (dirX: number, dirZ: number, speed: number) => {
      const p = state.player;
      const len = Math.hypot(dirX, dirZ);
      if (!p || len < 1e-4) return false;
      p.momX = dirX / len;
      p.momZ = dirZ / len;
      p.momSpeed = speed;
      return true;
    };
    // Dev: teleport the player (headless part-physics tests — a maze walk to a
    // specific bumper is unreliable to script with keys alone).
    (window as unknown as { __dungeonWarp?: (x: number, z: number) => boolean }).__dungeonWarp = (x: number, z: number) => {
      const p = state.player;
      if (!p) return false;
      p.x = x;
      p.z = z;
      p.momSpeed = 0;
      syncActorMesh(p);
      return true;
    };
    (window as unknown as { __dungeonPlayer?: () => unknown }).__dungeonPlayer = () => {
      const p = state.player;
      if (!p) return null;
      const ax = state.input?.axis() ?? { x: 0, z: 0 };
      return { plungerArmed: state.plungerArmed, plungerCharging: state.plungerCharging, x: p.x, z: p.z, hp: p.hp, rollT: p.rollT, iframes: p.iframes, clip: p.anim.getClip(), facing: p.facing, ax, sprint: state.input?.sprintHeld?.() ?? false, active: state.active, gameOver: state.gameOver, curSpeed: debugCurSpeed(), attackT: p.attackT, comboStep: p.comboStep, chargeT: p.chargeT, moving: !!p.move, kills: state.kills, sprintCharge: p.sprintCharge, wallMoveT: p.wallMoveT, wallMoveKind: p.wallMoveKind, wallNormal: debugWallNormal(), overcharge: p.overcharge, momSpeed: p.momSpeed, bounceCombo: p.bounceCombo, grabT: p.grabT, rideT: p.rideT, dropT: p.dropT, oilT: p.oilT, webbedT: p.webbedT, ironT: p.ironT, turboT: p.turboT, springT: p.springT, curveT: p.curveT, magBootsT: p.magBootsT };
    };
}
