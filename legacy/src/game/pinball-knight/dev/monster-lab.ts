/**
 * MONSTER LAB — the one dev hook you can find without grepping.
 *
 * The `__dungeon*` surface already had everything needed to test a monster
 * (`__dungeonSpawn`, `__dungeonLevel`, `__dungeonClearEnemies`), and that was
 * the problem: they are scattered through a 700-line file, so the discoverable
 * path to "look at the new monster" was to restart the run and grind to the
 * floor it spawns on. It is not a missing capability, it is a missing INDEX.
 *
 * So this module adds no new powers. It adds a menu:
 *
 *   __lab()                  print every lab command + the full monster roster
 *   __lab.spawn("sporeling") one, in front of you, aggroed
 *   __lab.spawn("hound", 5)  five of them
 *   __lab.only("sporeling")  clear the room, then spawn 3 — the art-QA pose
 *   __lab.ring()             ONE OF EVERY KIND in a ring — the roster check
 *   __lab.floor(5)           jump to a floor (spawn gates are irrelevant to
 *                            __lab.spawn — it bypasses them entirely)
 *   __lab.clear()            clear all enemies
 *   __lab.kinds()            the roster as an array
 *
 * THE POINT: `spawn` ignores `<NAME>_FROM_LEVEL`. You never have to reach the
 * floor a monster is gated to in order to look at it, and you never have to
 * abandon your run to test one on floor 1.
 *
 * Roster comes from bestiary.ts KIND_IDS, which is derived from KIND_INFO — so
 * a new EnemyKind joins this menu automatically rather than needing a second
 * hardcoded list to fall out of date (the `__dungeonAtlas` trap).
 */
import { KIND_IDS, KIND_INFO } from "../bestiary";
import { state } from "../state";
import type { EnemyKind } from "../state";
import type { DebugSpawnSpec, DebugSpawnResult } from "../debug-spawn";

export interface MonsterLabDeps {
  startLevel: (level: number) => void;
  debugSpawn: (spec: DebugSpawnSpec) => DebugSpawnResult;
  debugClearEnemies: () => void;
}

/** Narrow an arbitrary string to a real EnemyKind, with a useful complaint. */
function resolveKind(name: string): EnemyKind | null {
  if ((KIND_IDS as string[]).includes(name)) return name as EnemyKind;
  const near = (KIND_IDS as string[]).filter((k) => k.startsWith(name.slice(0, 3)));
  console.warn(
    `[lab] unknown kind "${name}".` + (near.length ? ` did you mean: ${near.join(", ")}?` : ""),
    `\n[lab] roster: ${(KIND_IDS as string[]).join(", ")}`,
  );
  return null;
}

export function installMonsterLab(deps: MonsterLabDeps): void {
  if (typeof window === "undefined") return;
  const { startLevel, debugSpawn, debugClearEnemies } = deps;

  const help = (): string => {
    const rows = (KIND_IDS as EnemyKind[]).map((k) => {
      const info = KIND_INFO[k];
      return `  ${info.icon} ${k.padEnd(12)} ${info.label}`;
    });
    console.log(
      [
        "── MONSTER LAB ──────────────────────────────────────────",
        '  __lab.spawn("sporeling")      one, aggroed, in front of you',
        '  __lab.spawn("hound", 5)       five of them',
        '  __lab.only("sporeling")       clear the room, then 3 — art QA',
        "  __lab.ring()                  ONE OF EVERY KIND in a ring",
        "  __lab.floor(5)                jump to a floor",
        "  __lab.clear()                 clear all enemies",
        "  __lab.kinds()                 roster as an array",
        "",
        "  spawn() IGNORES level gates — you never need to reach a",
        "  monster's floor to look at it.",
        "",
        `── ROSTER (${KIND_IDS.length}) ──`,
        ...rows,
      ].join("\n"),
    );
    return `${KIND_IDS.length} kinds — see the table above`;
  };

  const lab = Object.assign(help, {
    kinds: (): EnemyKind[] => [...(KIND_IDS as EnemyKind[])],

    spawn: (name: string, count = 1, opts: Partial<DebugSpawnSpec> = {}) => {
      const kind = resolveKind(name);
      if (!kind) return null;
      return debugSpawn({ kind, count, ring: 3, aggro: true, ...opts });
    },

    /** The art-QA pose: nothing else on screen, three of one kind, not aggroed
     *  so they idle in place instead of piling onto the knight. */
    only: (name: string, count = 3) => {
      const kind = resolveKind(name);
      if (!kind) return null;
      debugClearEnemies();
      return debugSpawn({ kind, count, ring: 3, aggro: false });
    },

    /** One of every kind, fanned around a ring — the whole-roster silhouette
     *  check. Not aggroed, so they hold still to be looked at. */
    ring: (radius = 5) => {
      debugClearEnemies();
      const kinds = KIND_IDS as EnemyKind[];
      const placed: Array<{ kind: string; ok: boolean }> = [];
      kinds.forEach((kind, i) => {
        const r = debugSpawn({
          kind,
          count: 1,
          ring: radius,
          phase: (i / kinds.length) * Math.PI * 2,
          aggro: false,
        });
        placed.push({ kind, ok: Boolean(r) });
      });
      const missed = placed.filter((p) => !p.ok).map((p) => p.kind);
      if (missed.length) console.warn(`[lab] could not place: ${missed.join(", ")} (tight room?)`);
      return placed;
    },

    floor: (n: number) => {
      if (state.gameOver || !Number.isFinite(n) || n < 1) {
        console.warn("[lab] floor(): need a live run and n >= 1");
        return false;
      }
      startLevel(Math.floor(n));
      return true;
    },

    clear: () => {
      debugClearEnemies();
      return true;
    },
  });

  (window as unknown as { __lab?: typeof lab }).__lab = lab;
  console.log("[lab] monster lab ready — call __lab() for the menu");
}
