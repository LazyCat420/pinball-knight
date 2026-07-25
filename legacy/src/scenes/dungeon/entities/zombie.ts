/**
 * Zombies — slow, dumb, numerous. Threatening in a group, trivial alone.
 *
 * Pathing: each zombie walks downhill on the shared BFS flow field that core.ts
 * recomputes every FLOW_INTERVAL. Within a couple of tiles it steers straight
 * at the player instead (the field only knows tile centres, and door-frame
 * shuffling at close range looks robotic). A cheap pairwise separation shove
 * keeps the horde from stacking into a single sprite.
 */
import { state, type Zombie, type EnemyKind } from "../state";
import {
  ZOMBIE_R,
  ZOMBIE_CONTACT_RANGE,
  ZOMBIE_ATTACK_WINDUP,
  ZOMBIE_ATTACK_COOLDOWN,
  SPIDER_R,
  SPIDER_CONTACT_RANGE,
  SPIDER_ATTACK_WINDUP,
  SPIDER_ATTACK_COOLDOWN,
  BRUTE_R,
  BRUTE_CONTACT_RANGE,
  BRUTE_ATTACK_WINDUP,
  BRUTE_ATTACK_COOLDOWN,
  SPITTER_R,
  SPITTER_WINDUP,
  SPITTER_COOLDOWN,
  SPITTER_FIRE_RANGE,
  SPITTER_KITE_RANGE,
  GHOST_R,
  GHOST_CONTACT_RANGE,
  GHOST_ATTACK_WINDUP,
  GHOST_ATTACK_COOLDOWN,
  GHOST_HOVER_Y,
  GHOST_BOB_AMP,
  GHOST_BOB_SPEED,
  BAT_R,
  BAT_CONTACT_RANGE,
  BAT_ATTACK_WINDUP,
  BAT_ATTACK_COOLDOWN,
  BAT_WOBBLE_AMP,
  BAT_WOBBLE_FREQ,
  OIL_STEER_BLEND,
  BAT_HOVER_Y,
  SLIME_R,
  SLIME_CONTACT_RANGE,
  SLIME_ATTACK_WINDUP,
  SLIME_ATTACK_COOLDOWN,
  REAPER_CONTACT_RANGE,
  REAPER_ATTACK_WINDUP,
  REAPER_ATTACK_COOLDOWN,
  REAPER_SPEED_RAMP,
  REAPER_SPEED_MAX,
  AGGRO_TILES,
  SEPARATION_R,
  GOBLIN_R,
  GOBLIN_KICK_SPEED,
  GOBLIN_KICK_COOLDOWN,
  PIN_R,
  PIN_SLIDE_DECAY,
  PIN_CHAIN_SPEED,
  GOLEM_R,
  GOLEM_CONTACT_RANGE,
  GOLEM_ATTACK_WINDUP,
  GOLEM_ATTACK_COOLDOWN,
  CHOMPER_R,
  CHOMPER_CONTACT_RANGE,
  CHOMPER_ATTACK_WINDUP,
  CHOMPER_ATTACK_COOLDOWN,
  MAGNET_R,
  MAGNET_CONTACT_RANGE,
  MAGNET_ATTACK_WINDUP,
  MAGNET_ATTACK_COOLDOWN,
  MAGNET_PULL_RANGE,
  MAGBOOTS_REPEL,
  MAGNET_PULL,
  MAGNET_BREAK_SPEED,
  WEBSPIN_R,
  GHOST_VULN_TIME,
  PINBALL_MAX_SPEED,
  PLAYER_R,
  WALL_CONTACT_PROBE,
  CARD_CHILL_SLOW,
  CARD_BURN_TICK,
  CARD_BURN_DMG,
  HOUND_R, HOUND_CONTACT_RANGE, HOUND_ATTACK_WINDUP, HOUND_ATTACK_COOLDOWN,
  HOUND_CHARGE_RANGE, HOUND_CHARGE_SPEED, HOUND_CHARGE_TIME,
  BLOATER_R, BLOATER_CONTACT_RANGE, BLOATER_ATTACK_WINDUP, BLOATER_ATTACK_COOLDOWN,
  NECRO_R, NECRO_CONTACT_RANGE, NECRO_ATTACK_WINDUP, NECRO_ATTACK_COOLDOWN, NECRO_SUMMON_CD, NECRO_SUMMON_MAX,
  WARDEN_R, WARDEN_CONTACT_RANGE, WARDEN_ATTACK_WINDUP, WARDEN_ATTACK_COOLDOWN, WARDEN_SHIELD_RADIUS, WARDEN_SHIELD_HP, WARDEN_PULSE_CD,
  WISP_R, WISP_CONTACT_RANGE, WISP_ATTACK_WINDUP, WISP_ATTACK_COOLDOWN, WISP_BLINK_DIST, WISP_BLINK_CD,
  SAPPER_R, SAPPER_CONTACT_RANGE, SAPPER_ATTACK_WINDUP, SAPPER_ATTACK_COOLDOWN,
  CRYSTAL_R, CRYSTAL_CONTACT_RANGE, CRYSTAL_ATTACK_WINDUP, CRYSTAL_ATTACK_COOLDOWN,
  MIMIC_R, MIMIC_CONTACT_RANGE, MIMIC_ATTACK_WINDUP, MIMIC_ATTACK_COOLDOWN, MIMIC_WAKE_RANGE,
  BRUTE_HP,
} from "../constants";
import { spawnFloorFx } from "./floor-fx";
import { comboWindow } from "./combo-curve";
import { moveCircle, wallContact } from "../collision";
import { worldToTile, tileCenter, idx } from "../maze/generator";
import { flowStep } from "./ai";
import { facingFromVelocity, type Facing } from "../render/animator";
import { worldDirToScreen } from "../camera";
import { hitPlayer, syncActorMesh, updateFlash, damageZombie } from "./combat";
import { spitGlob, spitWeb } from "./projectiles";
import { sfxGroan, sfxGoblin } from "../audio";

/** Per-family combat tuning, looked up once per zombie per frame. */
interface EnemyStats {
  bodyR: number;
  contactRange: number;
  windup: number;
  cooldown: number;
  ranged: boolean; // spitter: attacks from afar instead of biting
}
const STATS: Record<EnemyKind, EnemyStats> = {
  zombie: { bodyR: ZOMBIE_R, contactRange: ZOMBIE_CONTACT_RANGE, windup: ZOMBIE_ATTACK_WINDUP, cooldown: ZOMBIE_ATTACK_COOLDOWN, ranged: false },
  spider: { bodyR: SPIDER_R, contactRange: SPIDER_CONTACT_RANGE, windup: SPIDER_ATTACK_WINDUP, cooldown: SPIDER_ATTACK_COOLDOWN, ranged: false },
  brute: { bodyR: BRUTE_R, contactRange: BRUTE_CONTACT_RANGE, windup: BRUTE_ATTACK_WINDUP, cooldown: BRUTE_ATTACK_COOLDOWN, ranged: false },
  spitter: { bodyR: SPITTER_R, contactRange: SPITTER_FIRE_RANGE, windup: SPITTER_WINDUP, cooldown: SPITTER_COOLDOWN, ranged: true },
  ghost: { bodyR: GHOST_R, contactRange: GHOST_CONTACT_RANGE, windup: GHOST_ATTACK_WINDUP, cooldown: GHOST_ATTACK_COOLDOWN, ranged: false },
  bat: { bodyR: BAT_R, contactRange: BAT_CONTACT_RANGE, windup: BAT_ATTACK_WINDUP, cooldown: BAT_ATTACK_COOLDOWN, ranged: false },
  slime: { bodyR: SLIME_R, contactRange: SLIME_CONTACT_RANGE, windup: SLIME_ATTACK_WINDUP, cooldown: SLIME_ATTACK_COOLDOWN, ranged: false },
  reaper: { bodyR: GHOST_R, contactRange: REAPER_CONTACT_RANGE, windup: REAPER_ATTACK_WINDUP, cooldown: REAPER_ATTACK_COOLDOWN, ranged: false },
  // Wave-B roster (PINBALL_ROADMAP.md). Goblin/pin never bite (their contact
  // behaviour is bespoke below); their windup numbers are unused placeholders.
  goblin: { bodyR: GOBLIN_R, contactRange: 0.6, windup: 0.2, cooldown: GOBLIN_KICK_COOLDOWN, ranged: false },
  pin: { bodyR: PIN_R, contactRange: 0, windup: 1, cooldown: 1, ranged: false },
  golem: { bodyR: GOLEM_R, contactRange: GOLEM_CONTACT_RANGE, windup: GOLEM_ATTACK_WINDUP, cooldown: GOLEM_ATTACK_COOLDOWN, ranged: false },
  chomper: { bodyR: CHOMPER_R, contactRange: CHOMPER_CONTACT_RANGE, windup: CHOMPER_ATTACK_WINDUP, cooldown: CHOMPER_ATTACK_COOLDOWN, ranged: false },
  magnet: { bodyR: MAGNET_R, contactRange: MAGNET_CONTACT_RANGE, windup: MAGNET_ATTACK_WINDUP, cooldown: MAGNET_ATTACK_COOLDOWN, ranged: false },
  webspinner: { bodyR: WEBSPIN_R, contactRange: SPITTER_FIRE_RANGE, windup: SPITTER_WINDUP, cooldown: SPITTER_COOLDOWN, ranged: true },
  // ── Expansion roster (bespoke branches below carry the behaviour) ──
  hound: { bodyR: HOUND_R, contactRange: HOUND_CONTACT_RANGE, windup: HOUND_ATTACK_WINDUP, cooldown: HOUND_ATTACK_COOLDOWN, ranged: false },
  bloater: { bodyR: BLOATER_R, contactRange: BLOATER_CONTACT_RANGE, windup: BLOATER_ATTACK_WINDUP, cooldown: BLOATER_ATTACK_COOLDOWN, ranged: false },
  necromancer: { bodyR: NECRO_R, contactRange: NECRO_CONTACT_RANGE, windup: NECRO_ATTACK_WINDUP, cooldown: NECRO_ATTACK_COOLDOWN, ranged: true },
  warden: { bodyR: WARDEN_R, contactRange: WARDEN_CONTACT_RANGE, windup: WARDEN_ATTACK_WINDUP, cooldown: WARDEN_ATTACK_COOLDOWN, ranged: false },
  wisp: { bodyR: WISP_R, contactRange: WISP_CONTACT_RANGE, windup: WISP_ATTACK_WINDUP, cooldown: WISP_ATTACK_COOLDOWN, ranged: false },
  sapper: { bodyR: SAPPER_R, contactRange: SAPPER_CONTACT_RANGE, windup: SAPPER_ATTACK_WINDUP, cooldown: SAPPER_ATTACK_COOLDOWN, ranged: false },
  crystalback: { bodyR: CRYSTAL_R, contactRange: CRYSTAL_CONTACT_RANGE, windup: CRYSTAL_ATTACK_WINDUP, cooldown: CRYSTAL_ATTACK_COOLDOWN, ranged: false },
  mimic: { bodyR: MIMIC_R, contactRange: MIMIC_CONTACT_RANGE, windup: MIMIC_ATTACK_WINDUP, cooldown: MIMIC_ATTACK_COOLDOWN, ranged: false },
};

/** World velocity → the facing the ART thinks in (screen-relative). */
function facingFromWorld(wx: number, wz: number, fallback: Facing): Facing {
  const s = worldDirToScreen(wx, wz);
  return facingFromVelocity(s.x, s.z, fallback);
}

// Attack-telegraph colours: melee bites flash hot red-orange (the "it's about to
// bite" tell), the spitter's ranged gob flashes acid-green to match its glob.
const TELL_MELEE = 0xff7a2a;
const TELL_RANGED = 0x8fc46b;
/** Blend white (no tint) → a warning colour by k∈0..1; k grows across the windup. */
function lerpTint(target: number, k: number): number {
  const tr = (target >> 16) & 0xff;
  const tg = (target >> 8) & 0xff;
  const tb = target & 0xff;
  // start from white (0xffffff = unmodified) so the pulse eases IN from neutral
  const r = Math.round(255 + (tr - 255) * k);
  const gg = Math.round(255 + (tg - 255) * k);
  const b = Math.round(255 + (tb - 255) * k);
  return (r << 16) | (gg << 8) | b;
}

/** Straight-line pursuit inside this range; flow field beyond it. */
const DIRECT_STEER_RANGE = 1.6;

/** One groan per window, not one per zombie — a chorus is just noise. */
let _groanCooldown = 0;

/** NECROMANCER summon hook (injected by core to defer the spawn past the loop,
 *  like slime-split — spawning mid-iteration would corrupt the horde array). */
let onSummon: ((x: number, z: number) => void) | null = null;
export function setSummonHandler(fn: (x: number, z: number) => void): void {
  onSummon = fn;
}

/** Lock a committed dash toward (pdx,pdz). Used by Hound + woken Mimic. */
function startCharge(z: Zombie, pdx: number, pdz: number, pdist: number): void {
  const d = pdist > 1e-4 ? pdist : 1;
  z.mode = "charge";
  z.chargeT = HOUND_CHARGE_TIME;
  z.chargeDirX = pdx / d;
  z.chargeDirZ = pdz / d;
}

/** BRUTE ground-slam: a radial haymaker with wider reach than a point bite. */
function bruteSlam(z: Zombie, pdist: number, contactRange: number): void {
  const p = state.player;
  if (!p || p.hp <= 0) return;
  if (pdist <= contactRange * 1.7) hitPlayer(z);
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    state.vfx?.dust(z.x + Math.cos(a) * 0.6, 0.05, z.z + Math.sin(a) * 0.6);
  }
  state.shakeT = Math.max(state.shakeT, 0.2);
}

/** NECROMANCER: raise one add (deferred), unless the local horde is already thick. */
function necroSummon(z: Zombie): void {
  let near = 0;
  for (const o of state.zombies) {
    if (o.mode === "dead") continue;
    if (Math.hypot(o.x - z.x, o.z - z.z) < 7) near++;
  }
  if (near >= NECRO_SUMMON_MAX) return;
  onSummon?.(z.x, z.z);
  state.vfx?.sparks(z.x, 0.6, z.z, 0, 1, 14);
  state.vfx?.blood(z.x, 0.4, z.z, "green", 6);
}

/** WARDEN aura: top up a damage-absorb shield on every nearby living foe. */
function wardenPulse(z: Zombie): void {
  let shielded = 0;
  for (const o of state.zombies) {
    if (o === z || o.mode === "dead") continue;
    if (Math.hypot(o.x - z.x, o.z - z.z) > WARDEN_SHIELD_RADIUS) continue;
    o.shieldHp = Math.max(o.shieldHp ?? 0, WARDEN_SHIELD_HP);
    shielded++;
  }
  if (shielded > 0) state.vfx?.sparks(z.x, 0.6, z.z, 0, 1, 8);
}

export function updateZombies(dt: number): void {
  const g = state.grid;
  const p = state.player;
  if (!g || !p) return;

  _groanCooldown = Math.max(0, _groanCooldown - dt);

  for (const z of state.zombies) {
    updateFlash(z, dt);
    if (z.mode === "dead") continue; // the death clip plays out; the corpse stays

    // ── FREEZE RAY ── the whole machine holds its breath. Enemies stop
    // mid-stride, iced blue; timers don't tick, so nobody bites out of a thaw.
    if (state.freezeT > 0) {
      if (z.flashT <= 0) z.sprite.setTint(0xbfe8ff);
      z.anim.play("idle");
      continue;
    }

    // ── Ghost materialize window ── ticks down toward immunity.
    if (z.kind === "ghost") {
      z.vulnT = Math.max(0, (z.vulnT ?? 0) - dt);
      // The tell: a materialized (vulnerable) ghost is nearly solid.
      const mat = z.sprite.mesh.material as { opacity: number };
      mat.opacity = z.vulnT > 0 || z.mode === "windup" ? 0.92 : 0.55;
    }

    // ── BOWLING PIN ── never chases, never bites. It stands in formation
    // until something knocks it: then it SLIDES (velocity set by combat),
    // chains into pins it hits, and a wall slam finishes it.
    if (z.kind === "pin") {
      updatePin(z, dt);
      continue;
    }

    // Per-family combat feel (bite range, windup, cooldown, body size, whether
    // it attacks at range) comes from the STATS table.
    const st = STATS[z.kind];
    const { contactRange, windup } = st;
    // BODY RADIUS is per-KIND by default, but an actor whose sprite was scaled
    // up needs a collider that matches or it walks its visible body into walls.
    // The Reaper King was the case that exposed this: boss.ts scales its mesh
    // by 2.17x, so a 0.42 collider let a ~0.91-wide body sit half-buried in
    // 1-tile corridors. `bodyR` on the zombie overrides the table.
    const bodyR = z.bodyR ?? st.bodyR;
    const attackCooldown = st.cooldown;
    const ranged = st.ranged;

    z.cooldown = Math.max(0, z.cooldown - dt);
    z.burnT = Math.max(0, z.burnT - dt); // flame-tick immunity window

    // ── CARD statuses (cards.ts) ── CHILL slows this frame's movement; BURN
    // ticks damage over time. Chill's factor is read at the grounded move below.
    const chillMul = (z.chillT ?? 0) > 0 ? CARD_CHILL_SLOW : 1;
    if (z.chillT) z.chillT = Math.max(0, z.chillT - dt);
    if (z.dotT && z.dotT > 0) {
      z.dotT -= dt;
      z.dotTickT = (z.dotTickT ?? 0) - dt;
      if (z.dotTickT <= 0) {
        z.dotTickT = CARD_BURN_TICK;
        state.vfx?.sparks(z.x, 0.5, z.z, 0, 1, 3);
        damageZombie(z, z.dotDmg ?? CARD_BURN_DMG, 0, 0, 0);
        if ((z.mode as string) === "dead") continue; // burn was the finishing blow (mutated in damageZombie)
      }
    }

    // ── MIMIC ── dormant + item-like until you step close, then it BURSTS into
    // a charge. While dormant it neither chases nor is aggro'd.
    if (z.dormant) {
      const dd = Math.hypot(p.x - z.x, p.z - z.z);
      if (dd <= MIMIC_WAKE_RANGE && p.hp > 0) {
        z.dormant = false;
        z.aggro = true;
        if (z.flashT <= 0) z.sprite.setTint(z.baseTint ?? null);
        sfxGroan();
        startCharge(z, p.x - z.x, p.z - z.z, dd);
      } else {
        z.anim.play("idle");
      }
      continue; // dormant: no AI; woken: the charge runs next frame
    }

    // ── WARDEN ── a support aura: periodically grants a damage-absorb shield to
    // nearby foes (a stickier horde; kill the Warden first). It otherwise chases.
    if (z.kind === "warden") {
      z.castT = (z.castT ?? 0) - dt;
      if (z.castT <= 0) {
        z.castT = WARDEN_PULSE_CD;
        wardenPulse(z);
      }
    }

    // ── BRUTE ENRAGE ── below 40% HP it flies into a faster, angrier rage.
    if (z.kind === "brute" && !z.enraged && z.hp <= BRUTE_HP * 0.4) {
      z.enraged = true;
      z.speed *= 1.4;
      state.vfx?.sparks(z.x, 0.75, z.z, 0, 1, 12);
      state.vfx?.blood(z.x, 0.6, z.z, "red", 6);
    }

    // ── SLIME ACID TRAIL ── it oozes a hostile burning puddle behind it on a
    // slow cadence — don't chase one down a corridor into its own wake.
    if (z.kind === "slime") {
      z.castT = (z.castT ?? 0) - dt;
      if (z.castT <= 0) {
        z.castT = 1.5;
        spawnFloorFx("fire", z.x, z.z, 0.5, 1.4, true);
      }
    }

    // ── WATER SLICK ── stepped on a marble-water scar: lost its footing and
    // slides (drift set where the slick was applied). No AI this frame — a brief
    // slapstick skid that opens the horde up. Wall-bound via moveCircle.
    if (z.slipT && z.slipT > 0) {
      z.slipT = Math.max(0, z.slipT - dt);
      const sres = moveCircle(g, z.x, z.z, bodyR, (z.slipVX ?? 0) * dt, (z.slipVZ ?? 0) * dt);
      z.x = sres.x;
      z.z = sres.z;
      z.sprite.mesh.position.set(z.x, z.sprite.mesh.position.y, z.z);
      z.anim.play("idle");
      continue;
    }

    // ── Aggro ──
    if (!z.aggro && state.flowField) {
      const t = worldToTile(g, z.x, z.z);
      const d = state.flowField[idx(g, t.i, t.j)];
      if (d >= 0 && d <= AGGRO_TILES) {
        z.aggro = true;
        if (_groanCooldown <= 0) {
          _groanCooldown = 1.2;
          sfxGroan();
        }
      }
    }
    if (!z.aggro) {
      z.mode = "idle";
      z.anim.play("idle");
      continue;
    }

    // ── GHOST / REAPER ── float STRAIGHT AT the player THROUGH walls (no flow
    // field, no moveCircle, no separation), hovering with a bob. Their own
    // self-contained update so none of the grounded steering applies. The
    // REAPER additionally accelerates FOREVER — the floor timer closing in.
    if (z.kind === "ghost" || z.kind === "reaper") {
      if (z.kind === "reaper") z.speed = Math.min(REAPER_SPEED_MAX, z.speed + REAPER_SPEED_RAMP * dt);
      updateGhost(z, dt);
      continue;
    }

    const pdx = p.x - z.x;
    const pdz = p.z - z.z;
    const pdist = Math.hypot(pdx, pdz);

    // ── BUMPER GOBLIN ── it never bites: contact POPS the knight away like a
    // bumper (combo tick and all), and the goblin recoils the other way. The
    // annoyance is the point; momentum is the answer.
    if (z.kind === "goblin") {
      if (pdist <= GOBLIN_R + PLAYER_R + 0.12 && z.cooldown <= 0 && p.hp > 0) {
        z.cooldown = GOBLIN_KICK_COOLDOWN;
        const nx = pdist > 1e-4 ? pdx / pdist : 1;
        const nz = pdist > 1e-4 ? pdz / pdist : 0;
        p.momX = nx;
        p.momZ = nz;
        p.momSpeed = Math.min(PINBALL_MAX_SPEED, Math.max(p.momSpeed, GOBLIN_KICK_SPEED));
        p.bounceCombo += 1;
        p.bounceComboT = comboWindow(p.bounceCombo);
        p.iframes = Math.max(p.iframes, 0.2);
        // The goblin recoils too — rubber meets rubber.
        const res = moveCircle(g, z.x, z.z, GOBLIN_R, -nx * 0.5, -nz * 0.5);
        z.x = res.x;
        z.z = res.z;
        state.vfx?.sparks(z.x, 0.4, z.z, nx, nz, 10);
        state.shakeT = Math.max(state.shakeT, 0.14);
        sfxGoblin();
      }
      // fall through to normal chase steering below (it keeps bouncing after you)
    }

    // ── MAGNET CRAWLER ── drags the knight in while the field holds. Wall
    // contact snaps the tether (the map is the counter); real momentum punches
    // straight through it. MAGNET BOOTS invert the field to a REPEL — the
    // crawlers become momentum ramps instead of traps.
    if (z.kind === "magnet" && p.hp > 0 && pdist < MAGNET_PULL_RANGE && pdist > 0.4) {
      const boots = p.magBootsT > 0;
      const riding = p.momSpeed >= MAGNET_BREAK_SPEED;
      const grounded = wallContact(g, p.x, p.z, PLAYER_R, WALL_CONTACT_PROBE) !== null;
      if (boots) {
        // repel: shove the knight AWAY, harder the closer they are
        const k = 1 - pdist / MAGNET_PULL_RANGE;
        const push = MAGBOOTS_REPEL * k * dt;
        const res = moveCircle(g, p.x, p.z, PLAYER_R, (pdx / pdist) * push, (pdz / pdist) * push);
        p.x = res.x;
        p.z = res.z;
        if (Math.random() < 6 * dt) state.vfx?.sparks(p.x + (pdx / pdist) * 0.4, 0.35, p.z + (pdz / pdist) * 0.4, pdx, pdz, 2);
      } else if (!riding && !grounded && p.rideT < 0) {
        const k = 1 - pdist / MAGNET_PULL_RANGE; // stronger up close
        const pull = MAGNET_PULL * k * dt;
        // pdx points magnet→player, so the drag on the player is along -pdx.
        const res = moveCircle(g, p.x, p.z, PLAYER_R, (-pdx / pdist) * pull, (-pdz / pdist) * pull);
        p.x = res.x;
        p.z = res.z;
        if (Math.random() < 6 * dt) state.vfx?.sparks(p.x - (pdx / pdist) * 0.4, 0.35, p.z - (pdz / pdist) * 0.4, -pdx, -pdz, 2);
      }
    }

    // ── CHARGE: a committed locked-line dash (Hound / woken Mimic). Bowls into
    // you for a heavy hit; slams the wall and self-stuns if it whiffs. ──
    if (z.mode === "charge") {
      z.chargeT = (z.chargeT ?? 0) - dt;
      const cdx = z.chargeDirX ?? 0;
      const cdz = z.chargeDirZ ?? 0;
      z.anim.setFacing(facingFromWorld(cdx, cdz, "S"));
      z.anim.play("walk", { force: true });
      const step = HOUND_CHARGE_SPEED * dt;
      const res = moveCircle(g, z.x, z.z, bodyR, cdx * step, cdz * step);
      const moved = Math.hypot(res.x - z.x, res.z - z.z);
      z.x = res.x;
      z.z = res.z;
      syncActorMesh(z);
      if (Math.random() < 0.6) state.vfx?.dust(z.x, 0.04, z.z);
      if (p.hp > 0 && Math.hypot(p.x - z.x, p.z - z.z) <= bodyR + PLAYER_R + 0.14) {
        hitPlayer(z);
        z.mode = "chase";
        z.cooldown = attackCooldown;
        z.chargeT = 0;
      } else if ((z.chargeT ?? 0) <= 0 || moved < step * 0.4) {
        // Whiffed or slammed a wall — recover; a wall slam costs a longer stun.
        const slammed = moved < step * 0.4;
        z.mode = "chase";
        z.cooldown = attackCooldown + (slammed ? 0.5 : 0);
        if (slammed) {
          state.vfx?.dust(z.x, 0.05, z.z);
          state.vfx?.sparks(z.x, 0.4, z.z, cdx, cdz, 6);
        }
      }
      continue;
    }

    // ── Attack windup: rooted, facing you. A melee kind bites when the windup
    // completes; a spitter (ranged) launches an acid glob instead. ──
    if (z.mode === "windup") {
      z.windupT += dt;
      z.anim.setFacing(facingFromWorld(pdx, pdz, "S"));
      z.anim.play(ranged ? "attack" : "idle"); // spitter shows its rear-back clip

      // TELEGRAPH: pulse the body toward its attack colour across the windup, so
      // the bite is READABLE and a well-timed dodge-roll's i-frames can pass
      // through it (the "roll into the attack" skill). The pulse ramps up as the
      // strike nears — a brute's slow haymaker glows longest, a spider's snappy
      // bite barely flickers, matching each family's windup length. A live hit
      // flash (flashT) owns the tint, so don't fight it.
      if (z.flashT <= 0) {
        const k = Math.min(1, z.windupT / Math.max(windup, 1e-4));
        const warn = ranged ? TELL_RANGED : TELL_MELEE;
        z.sprite.setTint(lerpTint(warn, k));
      }

      if (z.windupT >= windup) {
        z.mode = "chase";
        z.cooldown = attackCooldown;
        if (z.flashT <= 0) z.sprite.setTint(z.baseTint ?? null); // drop the telegraph on release
        if (p.hp > 0) {
          if (z.kind === "hound" || z.kind === "mimic") {
            startCharge(z, pdx, pdz, pdist); // the windup ends in a DASH, not a bite
            continue;
          } else if (z.kind === "brute") {
            bruteSlam(z, pdist, contactRange); // a radial haymaker, not a point bite
          } else if (z.kind === "necromancer") {
            necroSummon(z); // raise an add instead of a projectile
          } else if (ranged) {
            // Webspinners shoot silk (a slow, cleansed by parts); spitters lob a
            // TRIPLE-SPREAD acid volley (harder to sidestep than one glob).
            if (pdist > 1e-4) {
              const ux = pdx / pdist;
              const uz = pdz / pdist;
              if (z.kind === "webspinner") {
                spitWeb(z.x, z.z, ux, uz);
              } else {
                for (const ang of [-0.32, 0, 0.32]) {
                  const c = Math.cos(ang);
                  const s = Math.sin(ang);
                  spitGlob(z.x, z.z, ux * c - uz * s, ux * s + uz * c);
                }
              }
            }
          } else if (pdist <= contactRange * 1.3) {
            hitPlayer(z);
          }
        }
      }
      continue;
    }
    // Left windup without releasing (player fled out of range): clear any tell.
    if (z.flashT <= 0) z.sprite.setTint(z.baseTint ?? null);

    z.mode = "chase";
    // HOUND telegraphs its charge from RANGE (not just contact) — the windup
    // then releases into a dash (see the windup branch).
    if (z.kind === "hound" && z.cooldown <= 0 && pdist <= HOUND_CHARGE_RANGE && p.hp > 0) {
      z.mode = "windup";
      z.windupT = 0;
      continue;
    }
    // Melee bites in contact range; a spitter fires from anywhere in its long
    // fire range (contactRange for it is SPITTER_FIRE_RANGE). The goblin never
    // bites — its contact behaviour is the bumper kick above.
    if (z.kind !== "goblin" && pdist <= contactRange && z.cooldown <= 0 && p.hp > 0) {
      z.mode = "windup";
      z.windupT = 0;
      continue;
    }

    // ── Steering ──
    // A spitter KITES: too close → back away to keep firing distance; in the
    // sweet spot → hold and shoot; too far → path in via the flow field like
    // any other enemy.
    let vx = 0;
    let vz = 0;
    if (ranged) {
      if (pdist < SPITTER_KITE_RANGE && pdist > 1e-4) {
        vx = -pdx / pdist; // retreat
        vz = -pdz / pdist;
      } else if (pdist <= contactRange) {
        // in fire range and not too close: hold position and shoot
      } else if (state.flowField) {
        const t = worldToTile(g, z.x, z.z);
        const next = flowStep(g, state.flowField, t.i, t.j);
        if (next) {
          const c = tileCenter(g, next.i, next.j);
          const dx = c.x - z.x;
          const dz = c.z - z.z;
          const d = Math.hypot(dx, dz) || 1;
          vx = dx / d;
          vz = dz / d;
        }
      }
    } else if (pdist <= DIRECT_STEER_RANGE) {
      if (pdist > 1e-4) {
        vx = pdx / pdist;
        vz = pdz / pdist;
      }
    } else if (state.flowField) {
      const t = worldToTile(g, z.x, z.z);
      const next = flowStep(g, state.flowField, t.i, t.j);
      if (next) {
        const c = tileCenter(g, next.i, next.j);
        const dx = c.x - z.x;
        const dz = c.z - z.z;
        const d = Math.hypot(dx, dz) || 1;
        vx = dx / d;
        vz = dz / d;
      }
    }

    // ── SHADOW LURE ── a shadow-clone decoy has this foe's attention: it walks
    // toward the clone instead of you until the lure lapses (or it arrives).
    if (z.lureT && z.lureT > 0) {
      z.lureT = Math.max(0, z.lureT - dt);
      const lx = (z.lureX ?? z.x) - z.x;
      const lz = (z.lureZ ?? z.z) - z.z;
      const ld = Math.hypot(lx, lz) || 1;
      vx = lx / ld;
      vz = lz / ld;
    }

    // ── Separation — shove apart any living neighbours that overlap ──
    let sx = 0;
    let sz = 0;
    for (const other of state.zombies) {
      if (other === z || other.mode === "dead") continue;
      const dx = z.x - other.x;
      const dz = z.z - other.z;
      const d = Math.hypot(dx, dz);
      if (d > 1e-4 && d < SEPARATION_R) {
        const push = (SEPARATION_R - d) / SEPARATION_R;
        sx += (dx / d) * push;
        sz += (dz / d) * push;
      }
    }

    // ── OIL skid ── a greased foe can't steer: its travelled heading only
    // BLENDS toward where it wants to go, so it slides past turns (and past
    // you) until the grease wears off. Bats fly above the pool — unaffected.
    if (z.oiledT && z.oiledT > 0 && z.kind !== "bat") {
      z.oiledT = Math.max(0, z.oiledT - dt);
      if (vx !== 0 || vz !== 0) {
        const hx = z.oilHX ?? vx;
        const hz = z.oilHZ ?? vz;
        const k = Math.min(1, OIL_STEER_BLEND * dt);
        const nx = hx + (vx - hx) * k;
        const nz = hz + (vz - hz) * k;
        const len = Math.hypot(nx, nz) || 1;
        z.oilHX = nx / len;
        z.oilHZ = nz / len;
        vx = z.oilHX;
        vz = z.oilHZ;
      }
      if (z.oiledT === 0) {
        z.oilHX = undefined;
        z.oilHZ = undefined;
      }
    }

    // ── BAT wobble ── a sine weave ACROSS the flight line so it's hard to
    // line up a swing on: perturb the steer direction with a perpendicular
    // oscillation (still wall-bound via moveCircle — it flies the corridors).
    if (z.kind === "bat" && (vx !== 0 || vz !== 0)) {
      z.bobT = (z.bobT ?? 0) + dt;
      const w = Math.sin(z.bobT * BAT_WOBBLE_FREQ) * BAT_WOBBLE_AMP;
      const px = -vz * w;
      const pz = vx * w;
      const len = Math.hypot(vx + px, vz + pz) || 1;
      vx = (vx + px) / len;
      vz = (vz + pz) / len;
    }

    // Golems and chompers are FURNITURE WITH TEETH: rooted, never shoved by
    // the horde's separation pass — they hold their chokepoint.
    const rooted = z.kind === "golem" || z.kind === "chomper";
    const mx = rooted ? 0 : (vx * z.speed * chillMul + sx * 1.5) * dt;
    const mz = rooted ? 0 : (vz * z.speed * chillMul + sz * 1.5) * dt;
    if (mx !== 0 || mz !== 0) {
      const res = moveCircle(g, z.x, z.z, bodyR, mx, mz);
      z.x = res.x;
      z.z = res.z;
    }

    if (vx !== 0 || vz !== 0) {
      z.anim.setFacing(facingFromWorld(vx, vz, "S"));
      z.anim.play("walk");
    } else {
      z.anim.play("idle");
    }

    syncActorMesh(z);
    // A bat FLIES: lift its billboard off the floor with a quick flutter-bob.
    if (z.kind === "bat") {
      z.sprite.mesh.position.y = BAT_HOVER_Y + Math.sin((z.bobT ?? 0) * 9) * 0.06;
    }
  }
}

/**
 * The GHOST update (also the REAPER — same spectral drift, meaner numbers):
 * drift STRAIGHT toward the player through walls (no maze pathing, no
 * collision), hovering with a gentle bob. It still winds up and lands a
 * chilling touch in contact range, reusing the same telegraph pulse.
 * Self-contained — called in place of all the grounded steering above.
 */
function updateGhost(z: Zombie, dt: number): void {
  const p = state.player;
  if (!p) return;
  const st = STATS[z.kind];
  // The reaper's resting look is blood-red, not untinted — every place the
  // ghost path clears its telegraph tint, the reaper re-dyes instead.
  const baseTint = z.baseTint ?? null;
  const pdx = p.x - z.x;
  const pdz = p.z - z.z;
  const pdist = Math.hypot(pdx, pdz);

  z.bobT = (z.bobT ?? 0) + dt;

  // ── Windup: reach out, then the touch lands. Same telegraph as the melee kinds. ──
  if (z.mode === "windup") {
    z.windupT += dt;
    z.anim.setFacing(facingFromWorld(pdx, pdz, "S"));
    z.anim.play("idle");
    if (z.flashT <= 0) {
      const k = Math.min(1, z.windupT / Math.max(st.windup, 1e-4));
      z.sprite.setTint(lerpTint(TELL_MELEE, k));
    }
    if (z.windupT >= st.windup) {
      z.mode = "chase";
      z.cooldown = st.cooldown;
      if (z.flashT <= 0) z.sprite.setTint(baseTint);
      if (p.hp > 0 && pdist <= st.contactRange * 1.3) hitPlayer(z);
    }
    syncGhostMesh(z);
    return;
  }
  if (z.flashT <= 0) z.sprite.setTint(baseTint);

  // Enter windup in contact range; otherwise drift straight in (through walls).
  z.mode = "chase";
  if (pdist <= st.contactRange && z.cooldown <= 0 && p.hp > 0) {
    z.mode = "windup";
    z.windupT = 0;
    // A ghost MATERIALIZES to strike — and stays touchable for the window
    // after (the only time steel can find it). The reaper stays immune.
    if (z.kind === "ghost") z.vulnT = GHOST_VULN_TIME;
    syncGhostMesh(z);
    return;
  }

  if (pdist > 1e-4) {
    const nx = pdx / pdist;
    const nz = pdz / pdist;
    // NO moveCircle — the ghost passes through walls. Just integrate position.
    z.x += nx * z.speed * dt;
    z.z += nz * z.speed * dt;
    z.anim.setFacing(facingFromWorld(nx, nz, "S"));
  }
  z.anim.play("walk");
  syncGhostMesh(z);
}

/**
 * Position a ghost's billboard: the shared iso transform, then LIFT it off the
 * floor to GHOST_HOVER_Y plus a sine bob so it visibly floats. syncActorMesh
 * pins y=0; we override just the y after it runs.
 */
function syncGhostMesh(z: Zombie): void {
  syncActorMesh(z);
  const bob = Math.sin((z.bobT ?? 0) * GHOST_BOB_SPEED) * GHOST_BOB_AMP;
  z.sprite.mesh.position.y = GHOST_HOVER_Y + bob;
}

/**
 * The BOWLING PIN update: integrate the slide velocity a knockback handed it
 * (combat.ts sets slideVX/VZ instead of an instant shove for pins), decaying
 * with floor friction. A sliding pin that reaches another pin passes the hit
 * on (the chain reaction — this is the whole bowling fantasy); a pin that
 * slams a wall at speed goes down on the spot.
 */
function updatePin(z: Zombie, dt: number): void {
  const g = state.grid;
  if (!g) return;
  const vx = z.slideVX ?? 0;
  const vz = z.slideVZ ?? 0;
  const speed = Math.hypot(vx, vz);
  if (speed < 0.05) {
    z.slideVX = 0;
    z.slideVZ = 0;
    z.anim.play("idle");
    syncActorMesh(z);
    return;
  }

  const res = moveCircle(g, z.x, z.z, PIN_R, vx * dt, vz * dt);
  const blockedX = Math.abs(res.x - (z.x + vx * dt)) > 1e-3;
  const blockedZ = Math.abs(res.z - (z.z + vz * dt)) > 1e-3;
  z.x = res.x;
  z.z = res.z;

  // Wall slam: the pin goes down (damage routed through the shared funnel so
  // strikes/kill bookkeeping all fire). Push 0 — it's already at the wall.
  if ((blockedX || blockedZ) && speed >= PIN_CHAIN_SPEED) {
    z.slideVX = 0;
    z.slideVZ = 0;
    state.vfx?.dust(z.x, 0.1, z.z);
    damageZombie(z, 1, vx, vz, 0);
    return;
  }

  // Chain: a fast pin reaching a standing pin knocks it onward.
  if (speed >= PIN_CHAIN_SPEED) {
    for (const other of state.zombies) {
      if (other === z || other.kind !== "pin" || other.mode === "dead") continue;
      const dx = other.x - z.x;
      const dz = other.z - z.z;
      if (dx * dx + dz * dz > (PIN_R * 2.2) * (PIN_R * 2.2)) continue;
      damageZombie(other, 1, vx, vz, 0.9); // combat hands ITS pins a slide too
      // This pin spends most of its speed on the impact.
      z.slideVX = vx * 0.35;
      z.slideVZ = vz * 0.35;
      break;
    }
  }

  // Floor friction.
  const decel = PIN_SLIDE_DECAY * dt;
  const ns = Math.max(0, speed - decel);
  z.slideVX = (vx / speed) * ns;
  z.slideVZ = (vz / speed) * ns;
  z.anim.play("walk"); // the wobble clip doubles as the slide
  syncActorMesh(z);
}

