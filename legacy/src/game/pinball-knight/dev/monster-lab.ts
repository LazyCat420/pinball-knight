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
import { floorLock, setFloorLock } from "./floor-lock";
import { importedArtEnabled } from "../boot/sheets";
import { DEFAULT_PLAYER_SHEET, playerSheetName, switchPlayerSheet } from "../render/knight-sheets";
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
        "  __lab.lock() / __lab.lock(3)  PIN every descent to that floor",
        "  __lab.unlock()                back to normal progression",
        "  __lab.clear()                 clear all enemies",
        "  __lab.kinds()                 roster as an array",
        '  __lab.playAs("mario")         PLAY AS a published sheet, live',
        "  __gui.characters()            the character-select screen",
        "  __lab.playAs(null)            back to the knight",
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

    /** Pin every descent to one floor (default 1) and go there now. Survives
     *  reloads — that is the point — so `unlock()` when you are done. */
    lock: (floor = 1) => {
      const n = setFloorLock(floor);
      console.log(`[lab] floor lock ON — every descent goes to floor ${n}. __lab.unlock() to clear.`);
      if (!state.gameOver && n) startLevel(n);
      return n;
    },

    unlock: () => {
      setFloorLock(null);
      console.log("[lab] floor lock OFF — normal progression");
      return true;
    },

    lockState: (): number | null => floorLock(),

    /**
     * Imported art on/off, then RELOAD. The A/B this whole pipeline exists for.
     *
     * A reload rather than a live swap because the comparison has to be
     * honest: atlases are palette-locked to 20 entries over the WHOLE sheet, so
     * a jester rebuilt next to a painted one would be locked against a
     * different histogram than one built at boot. Same reason the camera rung
     * applies on reload.
     */
    imported: (on?: boolean) => {
      if (on === undefined) {
        console.log(`[lab] imported art is ${importedArtEnabled() ? "ON" : "OFF"}`);
        return importedArtEnabled();
      }
      try {
        localStorage.setItem("pinball-knight-imported-art", on ? "1" : "0");
      } catch {
        console.warn("[lab] storage is blocked — cannot persist the toggle");
        return importedArtEnabled();
      }
      console.log(`[lab] imported art ${on ? "ON" : "OFF"} — RELOAD to apply.`);
      return on;
    },

    /**
     * PLAY AS a published sheet. `__lab.playAs("frog")` — LIVE, no reload.
     *
     * The player's clips come from `resolvePaints`, which merges imported over
     * PAINTED — so the creature walks, idles, runs and attacks as itself and
     * still curls into the knight's ball for the ride forms no generated sheet
     * authors.
     *
     * This used to end in "then RELOAD", on the reasoning that the atlas is
     * palette-locked over the whole sheet. The lock is real; the reload was not
     * the only way to satisfy it. `switchPlayerSheet` drops the memo and the
     * weapon+look cache and re-enters the loader — the same three lines the
     * loader already ran on its own success path — and the next rAF rebuilds.
     *
     * Call with no argument to see the current choice, `null` to go back to the
     * knight.
     */
    playAs: (name?: string | null) => {
      if (name === undefined) {
        console.log(`[lab] player sheet is "${playerSheetName()}"`);
        return playerSheetName();
      }
      const want = name ?? DEFAULT_PLAYER_SHEET;
      void switchPlayerSheet(want).then((ok) => {
        console.log(
          ok
            ? `[lab] player sheet → "${playerSheetName()}" — applied live`
            : `[lab] "${want}" did not load: it must be published ` +
                `(public/sprites/${want}-{S,N,E}.json) with an idle row. The painter stays.`,
        );
      });
      return want;
    },
  });

  (window as unknown as { __lab?: typeof lab }).__lab = lab;
  console.log("[lab] monster lab ready — call __lab() for the menu");
}
