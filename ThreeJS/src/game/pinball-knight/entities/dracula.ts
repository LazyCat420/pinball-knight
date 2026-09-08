/**
 * 🧛 COUNT DRACULA — Vampire Lord & Bat Final Form Mechanics
 *
 * Dracula is a gothic vampire nobleman who stalks the dungeon corridors.
 * When in proximity to the player, he channels a dark crimson blood siphon
 * that drains the player's vitality, restoring his own health.
 *
 * Upon defeat in his humanoid form, Dracula bursts into a swirling vortex
 * of purple mist and shadows, metamorphosing into his Final Form: Dracula Bat.
 * The player must hunt down and slay this agile, empowered bat form to complete
 * the encounter and claim Dracula's true treasures (fangs, bat wings, grim bones).
 */
import { state, type Player, type Zombie } from "../state";
import { facingFromWorld } from "./zombie";
import {
  DRACULA_DRAIN_RANGE,
  DRACULA_DRAIN_TICK,
  DRACULA_DRAIN_DURATION,
  DRACULA_DRAIN_DAMAGE,
  DRACULA_DRAIN_HEAL,
  DRACULA_DRAIN_COOLDOWN,
  DRACULA_HP,
} from "../constants/enemies";

/**
 * Checks whether the player is within blood drain leash range of Dracula.
 */
export function isPlayerInDrainRange(
  z: { x: number; z: number },
  p: { x: number; z: number },
  range = DRACULA_DRAIN_RANGE,
): boolean {
  const dx = p.x - z.x;
  const dz = p.z - z.z;
  return Math.hypot(dx, dz) <= range + 1e-4;
}

/**
 * Updates Dracula's blood siphon state machine each frame.
 */
export function updateDraculaSiphon(z: Zombie, p: Player, dt: number): void {
  if (z.mode === "dead") {
    if (z.draculaDrainActive) {
      z.draculaDrainActive = false;
      z.draculaDrainT = 0;
      z.sprite.setTint(z.baseTint ?? null);
    }
    return;
  }

  // Interrupt siphon if Dracula is staggered or pain-stunned
  if (z.staggerT && z.staggerT > 0) {
    if (z.draculaDrainActive) {
      z.draculaDrainActive = false;
      z.draculaDrainT = DRACULA_DRAIN_COOLDOWN;
      z.sprite.setTint(z.baseTint ?? null);
    }
    return;
  }

  const inRange = isPlayerInDrainRange(z, p, DRACULA_DRAIN_RANGE);
  const tetherBreak = !isPlayerInDrainRange(z, p, DRACULA_DRAIN_RANGE * 1.35);

  if (z.draculaDrainActive) {
    // Check if player broke the tether distance
    if (tetherBreak) {
      z.draculaDrainActive = false;
      z.draculaDrainT = DRACULA_DRAIN_COOLDOWN;
      z.sprite.setTint(z.baseTint ?? null);
      return;
    }

    // Dracula faces toward the siphoned player and maintains channel
    const toPx = p.x - z.x;
    const toPz = p.z - z.z;
    z.anim.setFacing(facingFromWorld(toPx, toPz, "S"));
    z.anim.play("attack");

    // Vampire crimson channeling tint
    z.sprite.setTint(0xdd2244);

    // Channel countdown & pulse ticks
    const prevT = z.draculaDrainT ?? DRACULA_DRAIN_DURATION;
    const nextT = prevT - dt;
    z.draculaDrainT = nextT;

    // Check if a pulse threshold was crossed (every DRACULA_DRAIN_TICK seconds)
    const prevPulse = Math.floor((DRACULA_DRAIN_DURATION - prevT) / DRACULA_DRAIN_TICK);
    const nextPulse = Math.floor((DRACULA_DRAIN_DURATION - nextT) / DRACULA_DRAIN_TICK);

    if (nextPulse > prevPulse) {
      // Execute siphon pulse on player
      if (p.hp > 0 && !state.godMode && p.iframes <= 0 && p.shieldT <= 0) {
        p.hp = Math.max(0, p.hp - DRACULA_DRAIN_DAMAGE);
        p.flashT = 0.15;

        // Heal Dracula
        const maxHp = z.maxHp ?? DRACULA_HP;
        z.hp = Math.min(maxHp, z.hp + DRACULA_DRAIN_HEAL);

        // Visual blood motes & red spray
        state.vfx?.blood(p.x, 0.45, p.z, "red", 6);
        state.vfx?.mote(p.x, 0.4, p.z, 0xd00020);
        state.vfx?.heal?.(z.x, 0.5, z.z);
      }
    }

    // Channel ended naturally
    if (nextT <= 0) {
      z.draculaDrainActive = false;
      z.draculaDrainT = DRACULA_DRAIN_COOLDOWN;
      z.sprite.setTint(z.baseTint ?? null);
    }
  } else {
    // Cooldown countdown
    const currentCd = z.draculaDrainT ?? 0;
    if (currentCd > 0) {
      z.draculaDrainT = Math.max(0, currentCd - dt);
    } else if (inRange && p.hp > 0) {
      // Initiate blood siphon!
      z.draculaDrainActive = true;
      z.draculaDrainT = DRACULA_DRAIN_DURATION;
      z.anim.play("attack");
      z.sprite.setTint(0xdd2244);
    }
  }
}
