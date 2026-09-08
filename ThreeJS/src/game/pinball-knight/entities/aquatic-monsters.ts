/**
 * Aquatic & Mafia Monsters Subsystem
 *
 * Dedicated behavioral routines for the 10 aquatic/mobster creatures:
 * 1. Shark Trapper (Hook & Reel)
 * 2. Dolphin Brawler (Rushdown Boxer)
 * 3. Octopus Mob Boss (8-Way Revolver Barrage & Ink Smokescreen)
 * 4. Clownfish Mobster (4-Round Tommy Gun Burst)
 * 5. Lionfish Enforcer (5-Way Venom Spine Shotgun)
 * 6. Anglerfish Hitman (Lure Stun Flash & High-Velocity Sniper)
 * 7. Pufferfish Capo (Blunderbuss Slug & 360 Spike Nova)
 * 8. Swordfish Mobster (Harpoon Speargun & Bill Lunge)
 * 9. Moray Eel Extortionist (Twin Electric Shock Orbs & Persistent Floor Hazards)
 * 10. Seahorse Gunner (High-Angle Water Mortar Lobbing Over Walls)
 */

import { state, type Zombie, type Player } from "../state";
import {
  SHARK_TRAPPER_HOOK_RANGE,
  SHARK_TRAPPER_HOOK_DAMAGE,
  SHARK_TRAPPER_PULL_SPEED,
  SHARK_TRAPPER_BITE_DAMAGE,
  SHARK_TRAPPER_WINDUP,
  SHARK_TRAPPER_COOLDOWN,
  DOLPHIN_BRAWLER_CONTACT_RANGE,
  DOLPHIN_BRAWLER_DAMAGE,
  DOLPHIN_BRAWLER_UPPERCUT_DAMAGE,
  DOLPHIN_BRAWLER_UPPERCUT_LAUNCH,
  DOLPHIN_BRAWLER_WINDUP,
  DOLPHIN_BRAWLER_COOLDOWN,
  OCTOPUS_GUNNER_FIRE_RANGE,
  OCTOPUS_GUNNER_INK_RADIUS,
  OCTOPUS_GUNNER_INK_DURATION,
  OCTOPUS_GUNNER_WINDUP,
  OCTOPUS_GUNNER_COOLDOWN,
  CLOWNFISH_MOB_FIRE_RANGE,
  CLOWNFISH_MOB_BURST_COUNT,
  CLOWNFISH_MOB_BURST_INTERVAL,
  CLOWNFISH_MOB_WINDUP,
  CLOWNFISH_MOB_COOLDOWN,
  LIONFISH_MOB_FIRE_RANGE,
  LIONFISH_MOB_WINDUP,
  LIONFISH_MOB_COOLDOWN,
  ANGLERFISH_MOB_FIRE_RANGE,
  ANGLERFISH_MOB_FLASH_RANGE,
  ANGLERFISH_MOB_WINDUP,
  ANGLERFISH_MOB_COOLDOWN,
  PUFFERFISH_MOB_FIRE_RANGE,
  PUFFERFISH_MOB_WINDUP,
  PUFFERFISH_MOB_COOLDOWN,
  SWORDFISH_MOB_HARPOON_RANGE,
  SWORDFISH_MOB_LUNGE_RANGE,
  SWORDFISH_MOB_LUNGE_SPEED,
  SWORDFISH_MOB_LUNGE_DAMAGE,
  SWORDFISH_MOB_WINDUP,
  SWORDFISH_MOB_COOLDOWN,
  MORAY_MOB_FIRE_RANGE,
  MORAY_MOB_WINDUP,
  MORAY_MOB_COOLDOWN,
  SEAHORSE_MOB_FIRE_RANGE,
  SEAHORSE_MOB_WINDUP,
  SEAHORSE_MOB_COOLDOWN,
} from "../constants";
import {
  launchFishingHook,
  shootOctoBullet,
  shootFishBullet,
  shootLionSpine,
  shootMagnumBullet,
  shootPufferSlug,
  burstPufferSpikes,
  shootSpearBolt,
  shootElectricBullet,
  launchWaterMortar,
} from "./projectiles";
import { spawnFloorFx } from "./floor-fx";
import { hitPlayer, hitPlayerRanged, webPlayer } from "./combat";
import { moveCircle } from "../engine/collision";
import type { Grid } from "../maze/generator";

export function isAquaticMonster(kind: string): boolean {
  return (
    kind === "shark_trapper" ||
    kind === "dolphin_brawler" ||
    kind === "octopus_gunner" ||
    kind === "clownfish_mob" ||
    kind === "lionfish_mob" ||
    kind === "anglerfish_mob" ||
    kind === "pufferfish_mob" ||
    kind === "swordfish_mob" ||
    kind === "moray_mob" ||
    kind === "seahorse_mob"
  );
}

/**
 * Main update tick for aquatic monsters.
 * Returns true if the monster performed exclusive action handling and should skip standard melee bite.
 */
export function updateAquaticMonster(z: Zombie, p: Player, dt: number, g: Grid): boolean {
  if (z.mode === "dead") return false;

  const pdx = p.x - z.x;
  const pdz = p.z - z.z;
  const pdist = Math.hypot(pdx, pdz) || 1;
  const dirX = pdx / pdist;
  const dirZ = pdz / pdist;

  switch (z.kind) {
    // ── 1. SHARK TRAPPER ──────────────────────────────────────────────
    case "shark_trapper": {
      // Reeling tether state
      if (z.hookTetherT && z.hookTetherT > 0) {
        z.hookTetherT -= dt;
        // Line breaks if player rolls, staggers shark, or iframe
        if (p.rollT > 0 || (z.staggerT && z.staggerT > 0) || p.hp <= 0) {
          z.hookTetherT = 0;
          state.vfx?.sparks(p.x, 0.5, p.z, 0, 0, 6);
        } else {
          // Reel player in toward shark
          p.momX = -dirX;
          p.momZ = -dirZ;
          p.momSpeed = SHARK_TRAPPER_PULL_SPEED;
          p.iframes = Math.max(p.iframes, 0.1);

          // Close-range jaws bite
          if (pdist <= 0.9) {
            z.hookTetherT = 0;
            hitPlayerRanged(SHARK_TRAPPER_BITE_DAMAGE, z.x, z.z);
            z.anim.play("attack");
            state.vfx?.blood(p.x, 0.5, p.z, "red", 10);
            z.cooldown = SHARK_TRAPPER_COOLDOWN;
          }
          return true;
        }
      }

      // Fishing rod cast attack
      if (z.cooldown <= 0 && pdist <= SHARK_TRAPPER_HOOK_RANGE && p.hp > 0) {
        z.windupT += dt;
        z.anim.setFacing(dirX < 0 ? "E" : "S");
        if (z.windupT >= SHARK_TRAPPER_WINDUP) {
          z.windupT = 0;
          z.cooldown = SHARK_TRAPPER_COOLDOWN;
          launchFishingHook(z.x, z.z, dirX, dirZ, z.nid);
          z.anim.play("attack");
        }
        return true;
      }
      return false;
    }

    // ── 2. DOLPHIN BRAWLER ────────────────────────────────────────────
    case "dolphin_brawler": {
      if (pdist <= DOLPHIN_BRAWLER_CONTACT_RANGE && z.cooldown <= 0 && p.hp > 0) {
        z.dolphinComboStep = z.dolphinComboStep || 1;
        z.dolphinComboT = (z.dolphinComboT || 0) + dt;

        if (z.dolphinComboStep === 1 && z.dolphinComboT >= DOLPHIN_BRAWLER_WINDUP) {
          // Punch 1: Left Jab
          hitPlayerRanged(DOLPHIN_BRAWLER_DAMAGE, z.x, z.z);
          z.anim.play("attack");
          state.vfx?.burst(p.x, 0.5, p.z, 0x38bdf8, 6, 1.0);
          z.dolphinComboStep = 2;
          z.dolphinComboT = 0;
        } else if (z.dolphinComboStep === 2 && z.dolphinComboT >= 0.22) {
          // Punch 2: Right Cross
          hitPlayerRanged(DOLPHIN_BRAWLER_DAMAGE, z.x, z.z);
          z.anim.play("attack");
          state.vfx?.burst(p.x, 0.5, p.z, 0x0284c7, 8, 1.2);
          z.dolphinComboStep = 3;
          z.dolphinComboT = 0;
        } else if (z.dolphinComboStep === 3 && z.dolphinComboT >= 0.32) {
          // Punch 3: Fin Uppercut -> pinball launch!
          hitPlayerRanged(DOLPHIN_BRAWLER_UPPERCUT_DAMAGE, z.x, z.z);
          p.momX = dirX;
          p.momZ = dirZ;
          p.momSpeed = DOLPHIN_BRAWLER_UPPERCUT_LAUNCH;
          p.bounceCombo = (p.bounceCombo || 0) + 1;
          p.iframes = Math.max(p.iframes, 0.25);
          state.vfx?.burst(p.x, 0.6, p.z, 0x60a5fa, 16, 2.0);
          z.anim.play("attack");
          z.dolphinComboStep = 1;
          z.dolphinComboT = 0;
          z.cooldown = DOLPHIN_BRAWLER_COOLDOWN;
        }
        return true;
      }
      return false;
    }

    // ── 3. OCTOPUS MOB BOSS ───────────────────────────────────────────
    case "octopus_gunner": {
      if (z.cooldown <= 0 && pdist <= OCTOPUS_GUNNER_FIRE_RANGE && p.hp > 0) {
        z.windupT += dt;
        if (z.windupT >= OCTOPUS_GUNNER_WINDUP) {
          z.windupT = 0;
          z.cooldown = OCTOPUS_GUNNER_COOLDOWN;
          // 8-way radial revolver bullet barrage
          for (let i = 0; i < 8; i++) {
            const angle = (i / 8) * Math.PI * 2;
            shootOctoBullet(z.x, z.z, Math.cos(angle), Math.sin(angle));
          }
          // Ink smokescreen discharge
          spawnFloorFx("ink", z.x, z.z, OCTOPUS_GUNNER_INK_RADIUS, OCTOPUS_GUNNER_INK_DURATION, true);
          z.anim.play("attack");
          state.vfx?.burst(z.x, 0.5, z.z, 0x0f172a, 14, 1.5);
        }
        return true;
      }
      return false;
    }

    // ── 4. CLOWNFISH MOBSTER ──────────────────────────────────────────
    case "clownfish_mob": {
      // Active burst strafe
      if (z.clownBurstCount && z.clownBurstCount > 0) {
        z.clownBurstT = (z.clownBurstT || 0) + dt;
        if (z.clownBurstT >= CLOWNFISH_MOB_BURST_INTERVAL) {
          z.clownBurstT = 0;
          z.clownBurstCount--;
          const aimX = z.clownAimX ?? dirX;
          const aimZ = z.clownAimZ ?? dirZ;
          shootFishBullet(z.x, z.z, aimX, aimZ);
          z.anim.play("attack");
          state.vfx?.sparks(z.x + aimX * 0.4, 0.5, z.z + aimZ * 0.4, aimX * 2, aimZ * 2, 3);
          if (z.clownBurstCount <= 0) {
            z.cooldown = CLOWNFISH_MOB_COOLDOWN;
          }
        }
        return true;
      }

      if (z.cooldown <= 0 && pdist <= CLOWNFISH_MOB_FIRE_RANGE && p.hp > 0) {
        z.windupT += dt;
        if (z.windupT >= CLOWNFISH_MOB_WINDUP) {
          z.windupT = 0;
          z.clownBurstCount = CLOWNFISH_MOB_BURST_COUNT;
          z.clownBurstT = 0;
          z.clownAimX = dirX;
          z.clownAimZ = dirZ;
        }
        return true;
      }
      return false;
    }

    // ── 5. LIONFISH MOB ENFORCER ──────────────────────────────────────
    case "lionfish_mob": {
      if (z.cooldown <= 0 && pdist <= LIONFISH_MOB_FIRE_RANGE && p.hp > 0) {
        z.windupT += dt;
        if (z.windupT >= LIONFISH_MOB_WINDUP) {
          z.windupT = 0;
          z.cooldown = LIONFISH_MOB_COOLDOWN;
          // 5-way venom spine fan spread
          const baseAngle = Math.atan2(dirZ, dirX);
          const fanSpread = [ -0.35, -0.175, 0, 0.175, 0.35 ];
          for (const off of fanSpread) {
            const a = baseAngle + off;
            shootLionSpine(z.x, z.z, Math.cos(a), Math.sin(a));
          }
          z.anim.play("attack");
          state.vfx?.burst(z.x, 0.5, z.z, 0xa855f7, 10, 1.2);
        }
        return true;
      }
      return false;
    }

    // ── 6. ANGLERFISH HITMAN ──────────────────────────────────────────
    case "anglerfish_mob": {
      if (z.cooldown <= 0 && pdist <= ANGLERFISH_MOB_FIRE_RANGE && p.hp > 0) {
        z.windupT += dt;
        // Lure pulse sparks during windup
        if (Math.random() < 0.3) {
          state.vfx?.sparks(z.x, 0.8, z.z, 0, 0.5, 2);
        }
        if (z.windupT >= ANGLERFISH_MOB_WINDUP) {
          z.windupT = 0;
          z.cooldown = ANGLERFISH_MOB_COOLDOWN;
          // Bioluminescent flashbang stun
          if (pdist <= ANGLERFISH_MOB_FLASH_RANGE) {
            webPlayer();
            state.vfx?.burst(z.x, 0.7, z.z, 0xfef08a, 20, 2.2);
          }
          // High-velocity piercing magnum shot
          shootMagnumBullet(z.x, z.z, dirX, dirZ);
          z.anim.play("attack");
        }
        return true;
      }
      return false;
    }

    // ── 7. PUFFERFISH CAPO ────────────────────────────────────────────
    case "pufferfish_mob": {
      if (z.cooldown <= 0 && pdist <= PUFFERFISH_MOB_FIRE_RANGE && p.hp > 0) {
        z.windupT += dt;
        if (z.windupT >= PUFFERFISH_MOB_WINDUP) {
          z.windupT = 0;
          z.cooldown = PUFFERFISH_MOB_COOLDOWN;
          shootPufferSlug(z.x, z.z, dirX, dirZ);
          z.anim.play("attack");
        }
        return true;
      }
      return false;
    }

    // ── 8. SWORDFISH MOBSTER ──────────────────────────────────────────
    case "swordfish_mob": {
      // Rapier bill lunge in progress
      if (z.swordLungeT && z.swordLungeT > 0) {
        z.swordLungeT -= dt;
        const lx = z.swordLungeDirX ?? dirX;
        const lz = z.swordLungeDirZ ?? dirZ;
        const res = moveCircle(g, z.x, z.z, z.bodyR ?? 0.42, lx * SWORDFISH_MOB_LUNGE_SPEED * dt, lz * SWORDFISH_MOB_LUNGE_SPEED * dt);
        z.x = res.x;
        z.z = res.z;
        state.vfx?.sparks(z.x, 0.5, z.z, -lx, -lz, 2);

        // Contact damage during lunge
        if (pdist <= 0.8 && p.hp > 0 && p.iframes <= 0) {
          hitPlayerRanged(SWORDFISH_MOB_LUNGE_DAMAGE, z.x, z.z);
          state.vfx?.blood(p.x, 0.5, p.z, "red", 8);
          z.swordLungeT = 0;
        }
        return true;
      }

      if (z.cooldown <= 0 && p.hp > 0) {
        // Melee range -> bill lunge
        if (pdist <= SWORDFISH_MOB_LUNGE_RANGE) {
          z.windupT += dt;
          if (z.windupT >= SWORDFISH_MOB_WINDUP) {
            z.windupT = 0;
            z.cooldown = SWORDFISH_MOB_COOLDOWN;
            z.swordLungeT = 0.35;
            z.swordLungeDirX = dirX;
            z.swordLungeDirZ = dirZ;
            z.anim.play("attack");
          }
          return true;
        }
        // Mid range -> harpoon speargun bolt
        if (pdist <= SWORDFISH_MOB_HARPOON_RANGE) {
          z.windupT += dt;
          if (z.windupT >= SWORDFISH_MOB_WINDUP) {
            z.windupT = 0;
            z.cooldown = SWORDFISH_MOB_COOLDOWN;
            shootSpearBolt(z.x, z.z, dirX, dirZ);
            z.anim.play("attack");
          }
          return true;
        }
      }
      return false;
    }

    // ── 9. MORAY EEL MOBSTER ──────────────────────────────────────────
    case "moray_mob": {
      if (z.cooldown <= 0 && pdist <= MORAY_MOB_FIRE_RANGE && p.hp > 0) {
        z.windupT += dt;
        if (z.windupT >= MORAY_MOB_WINDUP) {
          z.windupT = 0;
          z.cooldown = MORAY_MOB_COOLDOWN;
          // Twin electric shock orbs with slight spread
          const angle = Math.atan2(dirZ, dirX);
          shootElectricBullet(z.x, z.z, Math.cos(angle - 0.18), Math.sin(angle - 0.18));
          shootElectricBullet(z.x, z.z, Math.cos(angle + 0.18), Math.sin(angle + 0.18));
          z.anim.play("attack");
          state.vfx?.sparks(z.x, 0.5, z.z, 0, 0, 8);
        }
        return true;
      }
      return false;
    }

    // ── 10. SEAHORSE MOBSTER ──────────────────────────────────────────
    case "seahorse_mob": {
      if (z.cooldown <= 0 && pdist <= SEAHORSE_MOB_FIRE_RANGE && p.hp > 0) {
        z.windupT += dt;
        if (z.windupT >= SEAHORSE_MOB_WINDUP) {
          z.windupT = 0;
          z.cooldown = SEAHORSE_MOB_COOLDOWN;
          // Target predicted player landing
          const targetX = p.x + (p.momSpeed > 0.5 ? p.momX * 0.4 : 0);
          const targetZ = p.z + (p.momSpeed > 0.5 ? p.momZ * 0.4 : 0);
          launchWaterMortar(z.x, z.z, targetX, targetZ);
          z.anim.play("attack");
          state.vfx?.burst(z.x, 0.6, z.z, 0x0284c7, 8, 1.2);
        }
        return true;
      }
      return false;
    }

    default:
      return false;
  }
}

/**
 * Handle aquatic monster death events (e.g. Pufferfish 360-degree spike explosion).
 */
export function onAquaticMonsterDeath(z: Zombie): void {
  if (z.kind === "pufferfish_mob") {
    burstPufferSpikes(z.x, z.z);
    state.vfx?.burst(z.x, 0.5, z.z, 0xf1f5f9, 20, 2.2);
  }
}
