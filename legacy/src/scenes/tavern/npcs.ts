/**
 * The keepers — the people who make the tavern feel occupied.
 *
 * Art is the dungeon's existing `NPC_PAINTS`, which are SINGLE static frames
 * (there is no multi-frame NPC atlas). So personality has to come from motion
 * rather than from animation: each keeper gets a distinct idle curve, and the
 * smith's is a real work loop with a strike beat the VFX and audio hang off.
 *
 * That constraint is worth respecting rather than fighting. A hammer that lands
 * on a beat, throws sparks and makes a noise reads as a blacksmith working far
 * more convincingly than a smoothly-tweened sprite would, and costs no new art.
 */
import * as THREE from "three";
import { createStaticSprite } from "../dungeon/render/sprite";
import { NPC_PAINTS } from "../dungeon/render/cel-painter";
import type { VfxSystem } from "../dungeon/render/vfx";
import { KEEPER_SPOTS } from "./layout";

/** How a keeper idles. */
type Idle =
  /** Slow breathing bob — the default "standing about". */
  | "bob"
  /** Bob plus a side-to-side sway: wiping a glass down at the bar. */
  | "polish"
  /** A wind-up and a sharp drop. Returns a strike beat for sparks + sound. */
  | "hammer"
  /** A shuffling, fidgety rhythm — hands busy with cards. */
  | "deal";

interface KeeperSpec {
  id: string;
  paintKey: string;
  x: number;
  z: number;
  idle: Idle;
}

/** Art + idle style per station. Positions come from the floor plan. */
const KEEPER_ROLES: Record<string, { paintKey: string; idle: Idle }> = {
  forge: { paintKey: "merchant", idle: "hammer" },
  bar: { paintKey: "witch", idle: "polish" },
  dealer: { paintKey: "magician", idle: "deal" },
  armory: { paintKey: "frog", idle: "bob" },
};

const KEEPERS: KeeperSpec[] = KEEPER_SPOTS.flatMap((spot) => {
  const role = KEEPER_ROLES[spot.id];
  return role ? [{ id: spot.id, x: spot.x, z: spot.z, ...role }] : [];
});

interface Keeper extends KeeperSpec {
  mesh: THREE.Mesh;
  baseY: number;
  /** Phase offset so four keepers never move in lockstep. */
  phase: number;
  /** Rising edge of the hammer strike, for one-shot spark/sfx per swing. */
  struck: boolean;
}

export interface BuiltNpcs {
  group: THREE.Group;
  /** Advance idle motion. `onStrike` fires once per hammer blow. */
  update(time: number, vfx: VfxSystem | null, onStrike: (x: number, y: number, z: number) => void): void;
  dispose(): void;
}

/** Seconds per hammer cycle. Slow enough to read as work, not as a twitch. */
const HAMMER_PERIOD = 2.1;

export function buildNpcs(scene: THREE.Scene): BuiltNpcs {
  const group = new THREE.Group();
  const keepers: Keeper[] = [];
  const disposers: Array<() => void> = [];

  for (let i = 0; i < KEEPERS.length; i++) {
    const spec = KEEPERS[i];
    const paint = NPC_PAINTS[spec.paintKey];
    if (!paint) continue; // missing art is never fatal — the room just loses a body
    const sprite = createStaticSprite(paint);
    sprite.mesh.position.set(spec.x, 0, spec.z);
    group.add(sprite.mesh);
    disposers.push(sprite.dispose);
    keepers.push({ ...spec, mesh: sprite.mesh, baseY: 0, phase: i * 1.37, struck: false });
  }

  scene.add(group);

  return {
    group,
    update(time, vfx, onStrike): void {
      for (const k of keepers) {
        const t = time + k.phase;
        switch (k.idle) {
          case "bob":
            k.mesh.position.y = k.baseY + Math.sin(t * 1.5) * 0.035;
            break;

          case "polish":
            // Vertical breath plus a horizontal wipe, at different rates so the
            // two never sync into a single circular motion.
            k.mesh.position.y = k.baseY + Math.sin(t * 1.7) * 0.03;
            k.mesh.position.x = k.x + Math.sin(t * 2.9) * 0.055;
            break;

          case "deal":
            // Quick, fidgety, with a pause: |sin| gives a shuffle-and-settle
            // rhythm rather than a smooth oscillation.
            k.mesh.position.y = k.baseY + Math.abs(Math.sin(t * 2.6)) * 0.05;
            k.mesh.rotation.z = Math.sin(t * 1.9) * 0.03;
            break;

          case "hammer": {
            // Wind up slowly over most of the cycle, drop fast at the end. The
            // asymmetry is the whole read — a symmetric bob looks like breathing.
            const u = ((t % HAMMER_PERIOD) + HAMMER_PERIOD) % HAMMER_PERIOD;
            const p = u / HAMMER_PERIOD;
            const lift = p < 0.72 ? Math.sin((p / 0.72) * Math.PI * 0.5) * 0.14 : Math.max(0, 1 - (p - 0.72) / 0.1) * 0.14;
            k.mesh.position.y = k.baseY + lift;

            const striking = p >= 0.8;
            if (striking && !k.struck) {
              k.struck = true;
              // The anvil sits in front of the hearth block (props.ts), which is
              // not where the keeper stands — spark at the anvil, not at them.
              const ax = -6.2;
              const az = -1.3;
              vfx?.sparks(ax, 0.62, az, 0.4, 0.9, 7);
              onStrike(ax, 0.62, az);
            } else if (!striking) {
              k.struck = false;
            }
            break;
          }
        }
      }
    },
    dispose(): void {
      scene.remove(group);
      for (const d of disposers) d();
    },
  };
}
