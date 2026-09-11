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
import { createStaticSprite, createActorSprite, type ActorSprite, type SpriteSheet } from "../../game/pinball-knight/engine/render/sprite";
import { NPC_PAINTS } from "../../game/pinball-knight/render/cel-painter";
import type { VfxSystem } from "../../game/pinball-knight/fx/system";
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
  sheetKey?: string;
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
  forge: { paintKey: "merchant", sheetKey: "tavern_smith", idle: "hammer", home: -1 }, // forge sits west of him
  bar: { paintKey: "witch", sheetKey: "tavern_alchemist", idle: "polish", home: 1 }, // bar counter east
  dealer: { paintKey: "magician", sheetKey: "tavern_dealer", idle: "deal", home: 1 }, // card table east
  armory: { paintKey: "frog", sheetKey: "tavern_armorer", idle: "bob", home: -1 }, // bench west
  // The tout at the casino cabinet, throwing darts at the wall board while he
  // waits for someone to take a bet. He has his OWN art now (see the header) —
  // the dart cocked in his raised hand is the one his idle loop throws.
  gambler: { paintKey: "tout", sheetKey: "tavern_gambler", idle: "dart", home: 1 },
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
  actorSprite?: ActorSprite;
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

const keeperSheetCache = new Map<string, SpriteSheet>();

export function getKeeperSheet(sheetKey: string): SpriteSheet | null {
  return keeperSheetCache.get(sheetKey) ?? null;
}

export function loadKeeperSheet(name: string): Promise<SpriteSheet | null> {
  if (keeperSheetCache.has(name)) return Promise.resolve(keeperSheetCache.get(name)!);
  if (typeof Image === "undefined") return Promise.resolve(null);
  return new Promise((resolve) => {
    const loader = new THREE.TextureLoader();
    loader.load(
      `/sprites/${name}-S.png`,
      (texture) => {
        texture.magFilter = THREE.NearestFilter;
        texture.minFilter = THREE.NearestFilter;
        texture.generateMipmaps = false;
        texture.colorSpace = THREE.SRGBColorSpace;
        const sheet: SpriteSheet = {
          texture: texture as unknown as THREE.CanvasTexture,
          clips: new Map([
            ["S:idle", [0, 1, 2, 3]],
            ["S:walk", [4, 5, 6, 7]],
            ["S:attack", [8, 9, 10, 11]],
            ["S:death", [12, 13, 14, 15]],
          ]),
          frameCount: 16,
          cols: 4,
          rows: 4,
        };
        keeperSheetCache.set(name, sheet);
        resolve(sheet);
      },
      undefined,
      () => resolve(null),
    );
  });
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
    const keeper: Keeper = {
      ...spec,
      mesh: sprite.mesh,
      baseY: 0,
      phase: i * 1.37,
      struck: false,
      attention: 0,
      face: spec.home,
      greet: 0,
      noticed: false,
    };
    keepers.push(keeper);

    if (spec.sheetKey) {
      loadKeeperSheet(spec.sheetKey).then((sheet) => {
        if (!sheet) return;
        const actor = createActorSprite(sheet, false);
        actor.mesh.position.copy(keeper.mesh.position);
        actor.mesh.rotation.copy(keeper.mesh.rotation);
        actor.mesh.scale.x = keeper.face;
        group.remove(keeper.mesh);
        group.add(actor.mesh);
        keeper.mesh = actor.mesh;
        keeper.actorSprite = actor;
        disposers.push(actor.dispose);
      });
    }
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

        // Turn to face you, or back to the work.
        // Rather than linearly squashing scale.x through zero (which collapses
        // the character into a paper-thin line edge-on), we snap the horizontal
        // facing with an energetic hop that maintains full character volume.
        const want = attentive ? (playerX >= k.x ? 1 : -1) : k.home;
        if (k.face !== want) {
          k.face = want;
          k.greet = Math.max(k.greet, 0.45); // cute hop on turn
        }
        k.mesh.scale.x = want;

        // A single dip of the head on the frame you walk up, and a small lean
        // held while you stand there. Both scaled small on purpose — these are
        // background characters, and a keeper who lunges at you is worse than
        // one who ignores you.
        const greetHop = Math.sin((1 - k.greet) * Math.PI) * 0.085;
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

        // ── Frame Animation (Multi-frame Sprite Sheet) ─────────────────
        if (k.actorSprite) {
          if (k.attention > 0.35) {
            // Player is interacting with this station: play Row 3 (react / offer / greet)
            const frame = Math.floor((time * 4) % 4);
            k.actorSprite.setFrame(12 + frame);
          } else {
            // Idle / work loop
            switch (k.idle) {
              case "hammer": {
                // Smith: alternates between anvil striking work (row 1) and blade quench / steam inspect (row 2)
                const p = phase01(t, HAMMER_PERIOD);
                const subCycle = Math.floor(t / (HAMMER_PERIOD * 3)) % 2;
                if (subCycle === 0) {
                  let col = 0;
                  if (p < 0.65) {
                    col = p < 0.35 ? 0 : 1; // Windup
                  } else if (p < 0.85) {
                    col = 2; // Anvil impact strike
                  } else {
                    col = 3; // Follow-through / recover
                  }
                  k.actorSprite.setFrame(4 + col);
                } else {
                  const col = Math.floor((p * 4) % 4);
                  k.actorSprite.setFrame(8 + col);
                }
                break;
              }
              case "dart": {
                // Gambler: alternates between dart throw cycle (row 1) and rolling dice / fist pump (row 2)
                const p = phase01(t, DART_PERIOD);
                const subCycle = Math.floor(t / (DART_PERIOD * 2)) % 2;
                if (subCycle === 0) {
                  let col = 0;
                  if (p < 0.55) {
                    col = p < 0.28 ? 0 : 1; // Aiming dart
                  } else if (p < 0.8) {
                    col = 2; // Throwing
                  } else {
                    col = 3; // Release follow-through
                  }
                  k.actorSprite.setFrame(4 + col);
                } else {
                  const col = Math.floor((p * 4) % 4);
                  k.actorSprite.setFrame(8 + col);
                }
                break;
              }
              case "polish": {
                // Alchemist: alternates between shaking potion (row 1) and violent bubble pop / smoke (row 2)
                const subCycle = Math.floor(t / 4) % 2;
                const frame = Math.floor((t * 3.5) % 4);
                const row = subCycle === 0 ? 1 : 2;
                k.actorSprite.setFrame(row * 4 + frame);
                break;
              }
              case "deal": {
                // Card dealer: alternates between waterfall bridge shuffle (row 1) and glowing card fan flourish (row 2)
                const subCycle = Math.floor(t / 4) % 2;
                const frame = Math.floor((t * 4) % 4);
                const row = subCycle === 0 ? 1 : 2;
                k.actorSprite.setFrame(row * 4 + frame);
                break;
              }
              case "bob": {
                // Armorer: alternates between heavy plate stance (row 0), shield dent hammering (row 1), and armor inspect (row 2)
                const subCycle = Math.floor(t / 3.5) % 3;
                const frame = Math.floor((t * 3) % 4);
                const row = subCycle === 0 ? 0 : (subCycle === 1 ? 1 : 2);
                k.actorSprite.setFrame(row * 4 + frame);
                break;
              }
            }
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
