/**
 * ONE FIXED STEP of the world, at 60Hz.
 *
 * Extracted verbatim from core.ts. Dense but SHALLOW: it is a dispatch list —
 * the floor clock, the flow field, the buff timers, the abilities, then ~15
 * subsystem `update*(dt)` calls, then the stairs check. Almost nothing is
 * decided here; the decisions live in the modules it calls.
 *
 * ⚠️ THE ORDER OF THESE CALLS IS THE SIMULATION. It is not a list of
 * independent updates that happen to be written in sequence — the player moves
 * before the horde reads its position, combat timers tick before damage
 * resolves, and the drain queues run last so anything spawned this step is not
 * also simulated this step. Reordering is invisible to the type checker, throws
 * nothing, and changes how the game plays.
 */
import * as THREE from "three";
import { state } from "../state";
import { isSimPaused } from "./paused";
import { tickAbilities } from "../abilities";
import { updateBoss } from "../boss";
import { FLOW_INTERVAL, FOG_RADIUS, REAPER_AFTER, REAPER_WARNING, TIMECRAWL_FACTOR } from "../constants";
import { isReplica, updateCoop } from "../coop";
import { checkPickups } from "../economy/pickups";
import { hordeFlowField } from "../engine/flow-field";
import { tickCombatTimers } from "../entities/combat";
import { momentumT } from "../entities/combo-curve";
import { updateFloorFx, updateGrooveHop } from "../entities/floor-fx";
import { simulateHazards } from "../entities/hazards";
import { updateMaterial, updateSquash, updateVampire, updatePhaseEject } from "../entities/marble";
import { updateMultiBall } from "../entities/multiball";
import { updateNpcs } from "../entities/npc";
import { updatePlayer } from "../entities/player";
import { updateProjectiles } from "../entities/projectiles";
import { updateZombies } from "../entities/zombie";
import { revealAround } from "../fog";
import { updateFps } from "../fps";
import { meterBlocksShown, setMeterBlocksShown } from "../hud-meter";
import { REGEN_HEAL_PER_TICK, REGEN_TICK_INTERVAL } from "../items";
import { T_STAIRS, at, worldToTile } from "../maze/generator";
import { onPlayerDeath } from "../run/death";
import { descend } from "../run/descend";
import { updateSecretDoors } from "../secrets";
import { playerMaxHp } from "../skill-runtime";
import { drainPendingMinis, drainPendingSummons } from "../spawn/factory";
import { spawnReaper } from "../spawn/reaper";
import { reapCorpses, tickTide } from "../spawn/tide";
import { showToast } from "../ui";

export function simulate(dt: number): void {
  const p = state.player;
  const g = state.grid;
  // The Gamepad API is PULL-ONLY — it never fires an event for stick movement —
  // so a pad has to be sampled every step, ahead of everything that reads the
  // input. Cheap and a no-op when nothing is plugged in.
  state.input?.poll();
  if (state.gameOver || !p || !g || !state.input) return;
  // Shop, tavern (both forms), card reader and menu all pause the world.
  if (isSimPaused()) return;

  // ── The floor clock: feeds the grade's pace axis and the Death Dealer. ──
  state.simT += dt;
  state.levelT += dt;
  // FLOW — the grade's pace axis. Integrate the momentum ramp over sim time, so
  // "pace" measures the speed you actually CARRIED rather than the stopwatch.
  // A brisk walk integrates to ~0; a floor ridden at terminal speed to ~1.
  state.levelFlowSum += momentumT(p.momSpeed) * dt;
  state.levelFlowT += dt;
  if (p.bounceCombo > state.levelBestCombo) state.levelBestCombo = p.bounceCombo;
  // Run-scoped twin of the line above — levelBestCombo is wiped every descent,
  // so without this the leaderboard would only ever see the FINAL floor's combo.
  if (p.bounceCombo > state.runBestCombo) state.runBestCombo = p.bounceCombo;
  if (!state.reaperWarned && state.levelT >= REAPER_AFTER - REAPER_WARNING) {
    state.reaperWarned = true;
    showToast("A COLD WIND RISES", "something is coming — find the stairs");
  }
  if (!state.reaperOut && state.levelT >= REAPER_AFTER) {
    spawnReaper();
  }

  // ── Flow field — one BFS serves the whole horde, every FLOW_INTERVAL ──
  state.flowTimer -= dt;
  if (state.flowTimer <= 0) {
    state.flowTimer = FLOW_INTERVAL;
    const pt = worldToTile(g, p.x, p.z);
    state.flowField = hordeFlowField(g, pt.i, pt.j); // snapped seed; RETAINED across frames
  }

  // ── Buff timers tick down; HUD refreshes each whole second so the
  // countdown reads live, plus once more when a buff ends. ──
  for (const key of ["rageT", "hasteT", "shieldT", "ironT", "turboT", "springT", "curveT", "magBootsT", "venomCoatT", "stoneT", "staticT", "greedT", "regenT"] as const) {
    const before = p[key];
    if (before <= 0) continue;
    p[key] = Math.max(0, before - dt);
    if (Math.ceil(p[key]) !== Math.ceil(before) || p[key] === 0) state.hudDirty = true;
  }
  // Storm-card thunderbolt cooldown — silent (no HUD), just gates re-fire.
  if (p.boltCdT > 0) p.boltCdT = Math.max(0, p.boltCdT - dt);
  // Regen Salve: heal a heart every REGEN_TICK_INTERVAL seconds while it runs.
  if (p.regenT > 0) {
    p.regenTickT -= dt;
    if (p.regenTickT <= 0) {
      p.regenTickT = REGEN_TICK_INTERVAL;
      if (p.hp < playerMaxHp()) {
        p.hp = Math.min(playerMaxHp(), p.hp + REGEN_HEAL_PER_TICK);
        state.vfx?.heal(p.x, 0.6, p.z, 0x8fd46b, 6);
        state.hudDirty = true;
      }
    }
  }
  // Active skills: mana regen, cooldowns, magnet pull + blade-storm ticks.
  tickAbilities(dt);
  // World freeze (freeze-ray potion) ticks here; zombies/gloves read it.
  if (state.freezeT > 0) {
    state.freezeT = Math.max(0, state.freezeT - dt);
    if (state.freezeT === 0) state.hudDirty = true;
  }
  // The sprint spool + pinball overcharge rails change continuously; repaint the
  // HUD only when their combined 20-block fill actually changes (same
  // block-boundary trick as the buffs above), so a smooth ramp doesn't rebuild
  // the HUD innerHTML every frame.
  {
    // + bounceCombo so the combo counter repaints on every bounce.
    const blocks = Math.round((p.sprintCharge + p.overcharge) * 20) + p.bounceCombo * 100;
    if (blocks !== meterBlocksShown()) {
      setMeterBlocksShown(blocks);
      state.hudDirty = true;
    }
  }

  // In RAMPAGE the FPS controller owns the player (look + move + hitscan) in
  // place of the iso player update; the horde and pickups still tick so the
  // world stays alive around you.
  if (state.fpsActive) {
    updateFps(dt, state.input);
  } else {
    updatePlayer(dt, state.input);
  }
  // Paint the fog from wherever the knight ended up this step.
  if (state.fog && state.grid && state.player) {
    const ft = worldToTile(state.grid, state.player.x, state.player.z);
    revealAround(state.fog, state.grid, ft.i, ft.j, FOG_RADIUS);
  }
  // TIME CRAWL: the ability scales the horde's dt so enemies move + wind up in
  // slow-mo while the player runs at full speed. Everything else keeps real dt.
  // Co-op replica: the floor authority simulates the horde; ours are snapshot-
  // driven ghosts advanced inside updateCoop. Everything else still ticks.
  if (!isReplica()) updateZombies(state.slowT > 0 ? dt * TIMECRAWL_FACTOR : dt);
  updateProjectiles(dt);
  updateFloorFx(dt); // marble scars (slick/fire) tick status/damage to overlappers
  updateGrooveHop(dt); // the little airborne arc when the ball clears a rut's lip
  updateMaterial(dt); // marble material + fusion timers
  updateSquash(dt); // impact deformation recovery (water/lava)
  updateVampire(dt); // shadow lifesteal cooldown
  updatePhaseEject(dt); // shadow: never leave the player sealed inside masonry
  simulateHazards(dt); // boxing-glove punches (player launch + lane damage)
  updateNpcs(dt); // the Magician's clock, witch/frog touches, ember trails
  updateMultiBall(dt); // 🔮 echo knights: trail the player, ram what they touch
  tickCombatTimers(dt); // the bowling STRIKE window
  drainPendingMinis(); // slime splits deferred past all combat resolution
  drainPendingSummons(); // necromancer adds, same deferral
  tickTide(dt); // THE TIDE: reinforcements walk in, ramping toward the Dealer
  reapCorpses(); // …and the oldest bodies are cleared to pay for them
  if (!isReplica()) updateBoss(dt); // ☠ Reaper King: skulls, slam, portal-on-death
  // Secret bands smashed this run are still swinging — spin them out. Runs on
  // replicas too: the door is pure spectacle, and a replica that smashed a wall
  // locally should see it turn like anyone else.
  updateSecretDoors(dt);
  updateCoop(dt); // co-op: broadcast our pose + advance party knights
  checkPickups(dt);

  // ── Stairs? ──
  // On a boss floor the exit is SEALED until the Reaper King dies (state.exitLocked,
  // set by boss.ts). Once slain, the portal blooms over the stairs and stepping
  // onto them descends as normal.
  const pt = worldToTile(g, p.x, p.z);
  if (at(g, pt.i, pt.j) === T_STAIRS && !state.exitLocked) {
    descend();
  } else if (p.hp <= 0) {
    onPlayerDeath();
  }
}
