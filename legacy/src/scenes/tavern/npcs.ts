/**
 * The keepers — the people who make the tavern feel occupied.
 *
 * Art is the dungeon's existing `NPC_PAINTS`, which are SINGLE static frames
 * (there is no multi-frame NPC atlas). So personality has to come from motion
 * rather than from animation: each keeper gets a distinct idle curve, and two of
 * them (the smith's hammer, the gambler's darts) are real work loops with a
 * strike beat the VFX and audio hang off.
 *
 * That constraint is worth respecting rather than fighting. A hammer that lands
 * on a beat, throws sparks and makes a noise reads as a blacksmith working far
 * more convincingly than a smoothly-tweened sprite would, and costs no new art.
 *
 * The OTHER old constraint is gone: there used to be four paints for five
 * keepers, so the tout was a gold-tinted copy of the armory keeper's frog. He
 * now has his own `tout` paint in `cel-painter.ts`, which matters more than it
 * sounds — the two share no station, but they did share a body, and a tinted
 * duplicate is exactly the kind of thing a player notices and can't unsee.
 * Every keeper is now a distinct silhouette.
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
  | "deal"
  /** Aim, hold, release at the wall dartboard. Returns a throw beat. */
  | "dart";

/** What a keeper's idle loop just did, for the caller's VFX and audio. */
export type KeeperBeat =
  /** The smith's hammer landed. */
  | "anvil"
  /** The gambler's dart hit the board. */
  | "dart"
  /** A keeper noticed you walk up. */
  | "greet";

export interface KeeperSpec {
  id: string;
  paintKey: string;
  x: number;
  z: number;
  idle: Idle;
  /**
   * Which way the sprite is mirrored while WORKING (+1 faces +x, -1 faces -x),
   * chosen so each keeper faces the prop they're using. This is what makes the
   * turn-to-face read as a turn: the player always approaches from the other
   * side, so noticing you means breaking off from the counter.
   */
  home: 1 | -1;
  /**
   * Optional tint multiplied over the art, for when a paint has to be reused.
   * Nothing sets it today — every keeper has their own painter — but it stays
   * as the escape hatch the moment a sixth station lands before its art does,
   * and `npcs.test.ts` still enforces that any SHARED paint is tinted.
   */
  tint?: number;
}

/** Art + idle style per station. Positions come from the floor plan. */
const KEEPER_ROLES: Record<string, Omit<KeeperSpec, "id" | "x" | "z">> = {
  forge: { paintKey: "merchant", idle: "hammer", home: -1 }, // forge sits west of him
  bar: { paintKey: "witch", idle: "polish", home: 1 }, // bar counter east
  dealer: { paintKey: "magician", idle: "deal", home: 1 }, // card table east
  armory: { paintKey: "frog", idle: "bob", home: -1 }, // bench west
  // The tout at the casino cabinet, throwing darts at the wall board while he
  // waits for someone to take a bet. He has his OWN art now (see the header) —
  // the dart cocked in his raised hand is the one his idle loop throws.
  gambler: { paintKey: "tout", idle: "dart", home: 1 },
};

/**
 * The cast actually built, joining placement (`layout.ts`) to role.
 *
 * Exported for tests: a spot with no role, or a role naming art that doesn't
 * exist, is DROPPED here without a word — the same class of silent failure as
 * placing a keeper inside a counter, and just as invisible outside a screenshot.
 */
export const KEEPERS: KeeperSpec[] = KEEPER_SPOTS.flatMap((spot) => {
  const role = KEEPER_ROLES[spot.id];
  return role ? [{ id: spot.id, x: spot.x, z: spot.z, ...role }] : [];
});

interface Keeper extends KeeperSpec {
  mesh: THREE.Mesh;
  baseY: number;
  /** Phase offset so the keepers never move in lockstep. */
  phase: number;
  /** Rising edge of a work beat, for one-shot spark/sfx per swing or throw. */
  struck: boolean;
  /** 0..1, eased. How much this keeper has broken off work to look at you. */
  attention: number;
  /** Signed mirror, eased through zero so a flip reads as turning round. */
  face: number;
  /** Counts 1→0 across the one-shot greeting beat. */
  greet: number;
  /** Latches the rising edge of focus so the greeting fires once per approach. */
  noticed: boolean;
}

/** Everything the idle loops need from the frame. */
export interface NpcFrame {
  /** Scene clock, seconds. */
  time: number;
  dt: number;
  vfx: VfxSystem | null;
  /** Id of the station the player is standing at, or null. From `stations.ts`. */
  focusId: string | null;
  playerX: number;
  /** Fired once per beat, for the caller's sound. */
  onBeat(kind: KeeperBeat, x: number, y: number, z: number): void;
}

export interface BuiltNpcs {
  group: THREE.Group;
  update(frame: NpcFrame): void;
  dispose(): void;
}

/** Seconds per hammer cycle. Slow enough to read as work, not as a twitch. */
const HAMMER_PERIOD = 2.1;
/** Seconds per dart cycle. Longer than the hammer — he aims before he throws. */
const DART_PERIOD = 2.9;

/** Where the smith's anvil stands (props.ts) — not where the smith stands. */
const ANVIL = { x: -6.2, y: 0.62, z: -1.3 } as const;
/** The wall dartboard (props.ts), a hair off the wall so sparks read. */
const DARTBOARD = { x: 5.9, y: 1.9, z: 6.6 } as const;

/** Ease `v` toward `target` at `rate` per second, without overshooting. */
function approach(v: number, target: number, rate: number, dt: number): number {
  const d = target - v;
  return v + Math.sign(d) * Math.min(Math.abs(d), rate * dt);
}

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
    if (spec.tint !== undefined) (sprite.mesh.material as THREE.MeshBasicMaterial).color.setHex(spec.tint);
    sprite.mesh.scale.x = spec.home;
    group.add(sprite.mesh);
    disposers.push(sprite.dispose);
    keepers.push({
      ...spec,
      mesh: sprite.mesh,
      baseY: 0,
      phase: i * 1.37,
      struck: false,
      attention: 0,
      face: spec.home,
      greet: 0,
      noticed: false,
    });
  }

  scene.add(group);

  return {
    group,
    update({ time, dt, vfx, focusId, playerX, onBeat }: NpcFrame): void {
      for (const k of keepers) {
        const t = time + k.phase;

        // ── Being approached ──────────────────────────────────────────────
        // Reuses the station focus that `stations.ts` already computed rather
        // than running a second distance scan, so the keeper, the spotlight and
        // the prompt can never disagree about whether you have arrived.
        const attentive = focusId === k.id;
        if (attentive && !k.noticed) {
          k.noticed = true;
          k.greet = 1;
          onBeat("greet", k.x, 1.0, k.z);
        } else if (!attentive) {
          k.noticed = false;
        }
        k.attention = approach(k.attention, attentive ? 1 : 0, 3, dt);
        k.greet = Math.max(0, k.greet - dt * 1.7);

        // Turn to face you, or back to the work. The art is a billboard, so the
        // only honest "turn" available is a mirror — eased THROUGH zero, which
        // is what makes it read as pivoting rather than as a texture swap.
        const want = attentive ? (playerX >= k.x ? 1 : -1) : k.home;
        k.face = approach(k.face, want, 7, dt);
        // Never let the scale actually reach 0: a zero-determinant matrix makes
        // THREE's normal maths NaN out and the sprite vanishes for good.
        k.mesh.scale.x = Math.abs(k.face) < 0.06 ? 0.06 * (want >= 0 ? 1 : -1) : k.face;

        // A single dip of the head on the frame you walk up, and a small lean
        // held while you stand there. Both scaled small on purpose — these are
        // background characters, and a keeper who lunges at you is worse than
        // one who ignores you.
        const greetHop = Math.sin((1 - k.greet) * Math.PI) * 0.075;
        let rz = k.attention * 0.05 * (playerX >= k.x ? -1 : 1);
        let y = k.baseY + greetHop;
        let x = k.x;

        // ── Idle loop ─────────────────────────────────────────────────────
        switch (k.idle) {
          case "bob":
            y += Math.sin(t * 1.5) * 0.035;
            break;

          case "polish":
            // Vertical breath plus a horizontal wipe, at different rates so the
            // two never sync into a single circular motion.
            y += Math.sin(t * 1.7) * 0.03;
            x += Math.sin(t * 2.9) * 0.055;
            break;

          case "deal":
            // Quick, fidgety, with a pause: |sin| gives a shuffle-and-settle
            // rhythm rather than a smooth oscillation.
            y += Math.abs(Math.sin(t * 2.6)) * 0.05;
            rz += Math.sin(t * 1.9) * 0.03;
            break;

          case "hammer": {
            // Wind up slowly over most of the cycle, drop fast at the end. The
            // asymmetry is the whole read — a symmetric bob looks like breathing.
            const p = phase01(t, HAMMER_PERIOD);
            const lift = p < 0.72 ? Math.sin((p / 0.72) * Math.PI * 0.5) * 0.14 : Math.max(0, 1 - (p - 0.72) / 0.1) * 0.14;
            y += lift;

            const striking = p >= 0.8;
            if (striking && !k.struck) {
              k.struck = true;
              // The anvil sits in front of the hearth block (props.ts), which is
              // not where the keeper stands — spark at the anvil, not at them.
              vfx?.sparks(ANVIL.x, ANVIL.y, ANVIL.z, 0.4, 0.9, 7);
              onBeat("anvil", ANVIL.x, ANVIL.y, ANVIL.z);
            } else if (!striking) {
              k.struck = false;
            }
            break;
          }

          case "dart": {
            // The mirror of the hammer: a long LEAN BACK to sight the board,
            // then a snap forward. Same rising-edge trick, opposite silhouette,
            // so the two work loops don't read as the same animation retimed.
            const p = phase01(t, DART_PERIOD);
            const aim = p < 0.62 ? Math.sin((p / 0.62) * Math.PI * 0.5) : Math.max(0, 1 - (p - 0.62) / 0.07);
            y += aim * 0.03;
            rz += -aim * 0.1 * k.home; // rock away from the board, then whip back

            const throwing = p >= 0.66 && p < 0.9;
            if (throwing && !k.struck) {
              k.struck = true;
              // Land it on the board on the wall, not on him.
              vfx?.sparks(DARTBOARD.x, DARTBOARD.y, DARTBOARD.z, 0.15, -0.6, 5);
              onBeat("dart", DARTBOARD.x, DARTBOARD.y, DARTBOARD.z);
            } else if (!throwing) {
              k.struck = false;
            }
            break;
          }
        }

        k.mesh.position.set(x, y, k.z);
        k.mesh.rotation.z = rz;
      }
    },
    dispose(): void {
      scene.remove(group);
      for (const d of disposers) d();
    },
  };
}

/** Position within a loop, 0..1. Safe for a negative clock. */
function phase01(t: number, period: number): number {
  return (((t % period) + period) % period) / period;
}
