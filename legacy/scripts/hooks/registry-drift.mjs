#!/usr/bin/env node
/**
 * Registry-drift check for src/game/pinball-knight.
 *
 * The nine `Record<EnemyKind, X>` tables in this subtree are compile-enforced:
 * add a kind, and tsc reddens until every one of them has an entry. This script
 * covers the registries that are NOT — the array literals, the `switch` arms and
 * the duplicated literal tables, where adding a kind is silently accepted and
 * the thing just never happens.
 *
 * Four checks, all pure text over source (no imports, no build, ~50ms):
 *
 *   A. union coverage   — a `: EnemyKind[]` / `: SheetKey[]` array literal must
 *                         list every member of its union. The stale ones here
 *                         were TESTS, which is the whole point: a completeness
 *                         suite that hand-lists its own roster stops being a
 *                         completeness suite the moment the roster grows.
 *   B. themed spawns    — every kind weighted in a biome `enemies` table must
 *                         have a `case` in `spawnKind`, or that weight is dead
 *                         and the pick silently falls through to the cascade.
 *   C. skin ↔ portrait  — `EXPANSION_SKIN` (spawn/factory.ts) and `KIND_PORTRAIT`
 *                         (render/monster-portrait.ts) hold duplicated tint/scale
 *                         literals. Drift means the card lies about what you hunt.
 *   D. floor-1 atlases  — a kind gated at level 1 must have its sheet in
 *                         `ESSENTIAL`, or its atlas builds on a gameplay frame.
 *                         The gate constant is read out of spawnKind's own arm,
 *                         so the irregular names (CRYSTAL_/NECRO_/WEBSPIN_) come
 *                         from the code rather than a convention we'd have to
 *                         guess at.
 *   E. debug spawn route — every kind the ` panel offers a chip for must have a
 *                         construction path in `makeDebugEnemy`: the zombie /
 *                         reaper special cases, a RESKIN entry, or a `case` in
 *                         spawnKind. Otherwise the chip routes to spawnKind's
 *                         `default: return null` and the click does NOTHING.
 *                         This is check B's blind spot — B only walks the biome
 *                         weight tables, so `sporeling` (2026-07-28), which has
 *                         a bespoke atlas and a horde-cascade line but no
 *                         spawnKind arm, passed A–D while its chip was dead.
 *
 * Exit 0 = clean, 1 = drift found (details on stdout).
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const GAME = join(ROOT, "src/game/pinball-knight");

const read = (p) => readFileSync(join(GAME, p), "utf8");
const problems = [];
const fail = (check, msg) => problems.push({ check, msg });

/** Every .ts under the game subtree, minus any stray nested node_modules. */
function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules") continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith(".ts")) out.push(p);
  }
  return out;
}

/** Members of `export type Name = | "a" | "b";` — tolerates several per line. */
function unionMembers(src, name) {
  const m = src.match(new RegExp(`export type ${name}\\s*=([\\s\\S]*?);`, "m"));
  if (!m) throw new Error(`could not find "export type ${name}"`);
  return [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]);
}

/** The bracketed run starting at the first `open` at or after `from`, matched. */
function spanAt(src, from, open = "{", close = "}") {
  const start = src.indexOf(open, from);
  let depth = 0;
  for (let i = start; i < src.length; i++) {
    if (src[i] === open) depth++;
    else if (src[i] === close && --depth === 0) return src.slice(start, i + 1);
  }
  throw new Error(`unbalanced ${open}${close} from ${from}`);
}
const blockAt = (src, from) => spanAt(src, from, "{", "}");
const listAt = (src, from) => spanAt(src, from, "[", "]");

const files = walk(GAME);
const UNIONS = {
  EnemyKind: unionMembers(read("state.ts"), "EnemyKind"),
  SheetKey: unionMembers(read("boot/sheets.ts"), "SheetKey"),
  MarbleMaterial: unionMembers(read("state.ts"), "MarbleMaterial"),
};

// ── A. union coverage ───────────────────────────────────────────────────────
//
// Only for literals that CLAIM to be complete. Plenty of `SheetKey[]` lists are
// partial on purpose — `ESSENTIAL` is "build these before the first frame",
// `BACKFILL` is an ordering — and demanding they be exhaustive would be noise
// that trains you to ignore the check. The two shapes that do claim it:
//   · anything named ALL_* / EVERY_* (the convention already in this subtree)
//   · any such literal inside a .test.ts — a suite that hand-lists its roster
//     stops covering the roster the moment it grows, which is exactly how
//     reagents.test.ts came to be nine kinds short while passing.
for (const file of files) {
  const src = readFileSync(file, "utf8");
  const rel = file.slice(ROOT.length + 1);
  const isTest = file.endsWith(".test.ts");
  for (const [union, members] of Object.entries(UNIONS)) {
    const re = new RegExp(`(\\w+)\\s*:\\s*${union}\\[\\]\\s*=\\s*\\[`, "g");
    for (const m of src.matchAll(re)) {
      const varName = m[1];
      if (!isTest && !/^(ALL|EVERY)_/.test(varName)) continue;
      // Anchor past the match so we open the VALUE's `[`, not the `[]` that
      // closes the type annotation.
      const valueAt = m.index + m[0].length - 1;
      const listed = new Set([...listAt(src, valueAt).matchAll(/"([^"]+)"/g)].map((x) => x[1]));
      const missing = members.filter((k) => !listed.has(k));
      if (missing.length) {
        fail("A", `${rel}: ${varName}: ${union}[] is missing ${missing.length} of ${members.length} — ${missing.join(", ")}`);
      }
    }
  }
}

// ── B. themed spawns reach spawnKind ────────────────────────────────────────
{
  const factory = read("spawn/factory.ts");
  const swStart = factory.indexOf("export function spawnKind");
  const cases = new Set([...blockAt(factory, swStart).matchAll(/case\s+"([^"]+)"/g)].map((x) => x[1]));
  // Known-dead weights, left in place deliberately: spawnKind's own `default`
  // arm names zombie/pin/reaper as not horde-rollable via theme bias, so these
  // two picks fall through to the base cascade. That is a balance question
  // (prefabs weights them anyway), not a drift — allowlisted so the check stays
  // quiet enough to mean something when a NEW kind goes dead.
  const KNOWN_DEAD = new Set(["zombie", "pin"]);
  const prefabs = read("maze/prefabs.ts");
  for (const m of prefabs.matchAll(/enemies:\s*\{([^}]*)\}/g)) {
    for (const e of m[1].matchAll(/(\w+)\s*:\s*\d+/g)) {
      if (KNOWN_DEAD.has(e[1])) continue;
      if (!cases.has(e[1])) {
        fail("B", `maze/prefabs.ts: biome table weights "${e[1]}", but spawnKind has no case for it — that weight is dead, the pick falls through to the base cascade`);
      }
    }
  }
}

// ── C. EXPANSION_SKIN ↔ KIND_PORTRAIT ───────────────────────────────────────
{
  // Anchored at the `=` in both cases. Both tables are declared
  // `Partial<Record<EnemyKind, { … }>>`, so opening at the first `{` after the
  // NAME lands inside the type annotation and the span closes there — which
  // parsed EXPANSION_SKIN as ZERO entries and made this whole check a silent
  // no-op (it looped over `{}` and compared nothing) until 2026-07-29.
  const factorySrc = read("spawn/factory.ts");
  const skinBlock = blockAt(factorySrc, factorySrc.indexOf("=", factorySrc.indexOf("const EXPANSION_SKIN")));
  const portraitSrc = read("render/monster-portrait.ts");
  const portraitBlock = blockAt(portraitSrc, portraitSrc.indexOf("=", portraitSrc.indexOf("const KIND_PORTRAIT")));
  const entries = (block) => {
    const out = {};
    for (const m of block.matchAll(/(\w+):\s*\{([^}]*)\}/g)) {
      const tint = m[2].match(/tint:\s*(0x[0-9a-fA-F]+|null)/);
      const scale = m[2].match(/scale:\s*([\d.]+)/);
      if (tint && scale) out[m[1]] = { tint: tint[1].toLowerCase(), scale: scale[1] };
    }
    return out;
  };
  const skin = entries(skinBlock);
  const portrait = entries(portraitBlock);
  for (const [kind, s] of Object.entries(skin)) {
    const p = portrait[kind];
    if (!p) { fail("C", `KIND_PORTRAIT has no entry for expansion kind "${kind}"`); continue; }
    if (s.tint !== p.tint || s.scale !== p.scale) {
      fail("C", `"${kind}": EXPANSION_SKIN has tint ${s.tint}/scale ${s.scale}, KIND_PORTRAIT has tint ${p.tint}/scale ${p.scale} — the bestiary card would lie about what you're hunting`);
    }
  }
}

// ── D. floor-1 kinds have their atlas in ESSENTIAL ──────────────────────────
{
  const factory = read("spawn/factory.ts");
  const sheets = read("boot/sheets.ts");

  // Gate constant per kind, taken from spawnKind's own arm.
  const swBlock = blockAt(factory, factory.indexOf("export function spawnKind"));
  const gateOf = {};
  for (const m of swBlock.matchAll(/case\s+"([^"]+)":([\s\S]*?)(?=\n\s*case\s+"|\n\s*default:)/g)) {
    const g = m[2].match(/(\w+_FROM_LEVEL)/);
    if (g) gateOf[m[1]] = g[1];
  }

  // Constant values, from anywhere under constants/.
  const values = {};
  for (const file of files.filter((f) => f.includes("/constants/"))) {
    for (const m of readFileSync(file, "utf8").matchAll(/export const (\w+_FROM_LEVEL)\s*=\s*(\d+)/g)) {
      values[m[1]] = Number(m[2]);
    }
  }

  // kind → sheet key: own atlas, else the one its reskin/expansion borrows.
  const byKind = {};
  const mapBlock = blockAt(sheets, sheets.indexOf("SHEET_KEY_BY_KIND"));
  for (const m of mapBlock.matchAll(/(\w+):\s*"([^"]+)"/g)) byKind[m[1]] = m[2];
  for (const table of ["EXPANSION_SKIN", "RESKIN"]) {
    const block = blockAt(factory, factory.indexOf(`const ${table}`));
    for (const m of block.matchAll(/(\w+):\s*\{[^}]*sheetFor\("([^"]+)"\)/g)) byKind[m[1]] ??= m[2];
  }

  const essential = new Set(
    // From the `=`, so we read the value and not the `SheetKey[]` annotation.
    [...listAt(sheets, sheets.indexOf("=", sheets.indexOf("const ESSENTIAL"))).matchAll(/"([^"]+)"/g)].map((x) => x[1]),
  );

  for (const [kind, gate] of Object.entries(gateOf)) {
    if (values[gate] !== 1) continue;
    const key = byKind[kind];
    if (key && !essential.has(key)) {
      fail("D", `"${kind}" is admitted on floor 1 (${gate}=1) but its atlas "${key}" is not in boot/sheets.ts ESSENTIAL — it builds on a gameplay frame`);
    }
  }
}

// ── E. every debug-panel chip actually builds something ─────────────────────
//
// The panel derives its chips from the bestiary (`KIND_IDS`), which is itself
// exhaustive over EnemyKind — so a chip EXISTS for every kind automatically and
// debug-panel.test.ts passes. But the click routes
// debugSpawnEnemy → makeDebugEnemy → spawnKind, and that last hop is a `switch`
// with a `default: return null`. A kind that reaches the default is a chip that
// silently does nothing, which is worse than a missing chip: the panel says the
// monster is spawnable and the floor stays empty.
{
  const factory = read("spawn/factory.ts");
  const swBlock = blockAt(factory, factory.indexOf("export function spawnKind"));
  const cases = new Set([...swBlock.matchAll(/case\s+"([^"]+)"/g)].map((x) => x[1]));
  // Anchor at the `=`, not the declaration: RESKIN's type annotation is
  // `Partial<Record<EnemyKind, { sheet … }>>`, so the first `{` after the name
  // belongs to the TYPE and the span would close on it — capturing one entry.
  // (Check D reads ESSENTIAL the same way, for the same reason.)
  const reskin = new Set(
    [...blockAt(factory, factory.indexOf("=", factory.indexOf("export const RESKIN"))).matchAll(/(\w+):\s*\{/g)].map((x) => x[1]),
  );
  // makeDebugEnemy's own special cases: "zombie" picks a variant sheet directly,
  // and debugSpawn intercepts "reaper" before makeDebugEnemy (it's a floor-wide
  // singleton with a summon ritual, not a thing you place N of).
  const SPECIAL_CASED = new Set(["zombie", "reaper"]);

  for (const kind of UNIONS.EnemyKind) {
    if (SPECIAL_CASED.has(kind) || reskin.has(kind) || cases.has(kind)) continue;
    fail(
      "E",
      `"${kind}" has a debug-panel chip (KIND_IDS is exhaustive) but no construction path — not RESKIN, not special-cased, and no spawnKind case. Clicking it hits spawnKind's \`default: return null\` and spawns nothing`,
    );
  }
}

// ── F. marble-material registries ───────────────────────────────────────────
//
// `MarbleMaterial` has exactly ONE compile-enforced table (`MATERIALS`, a
// `Record<MarbleMaterial, MaterialMeta>`). Everything else that must know all
// six is a hand-maintained array literal, an `||` chain, an object literal
// annotated `Record<string, …>`, or — since MARBLE FORMS — a clip name that
// only exists as a string in four separate registries. tsc sees none of it.
//
// The failure mode is not a crash: a material missing from MATERIAL_LIST simply
// never drops, one missing from the ClipName union silently renders the KNIGHT
// instead of the marble, and one missing from `isMaterial` can't be granted from
// the debug panel. Each looks like "that material is just rare".
{
  const materials = UNIONS.MarbleMaterial;

  /** The bracketed span introduced by `anchor`, opened at its first `=`. */
  const valueSpan = (src, anchor, open, close, file) => {
    const at = src.indexOf(anchor);
    if (at < 0) {
      fail("F", `${file}: could not find "${anchor}" — the drift check itself is stale, fix it before trusting a clean run`);
      return null;
    }
    // Anchor past the `=` so a `Record<…>`/`X[]` TYPE annotation's own brackets
    // don't close the span early (checks D and E dodge the same trap).
    return spanAt(src, src.indexOf("=", at), open, close);
  };

  // Each entry: the span that must name every material, and what breaks if it
  // doesn't. `token` builds the string we look for inside that span.
  const REGISTRIES = [
    { file: "entities/marble.ts", anchor: "export const MATERIAL_LIST", open: "[", close: "]", why: "the material never drops or rolls" },
    { file: "constants/pinball.ts", anchor: "export const MATERIAL_DURATION", open: "{", close: "}", why: "its pickup timer is undefined" },
    { file: "ui.ts", anchor: "const MATERIAL_CHIP", open: "{", close: "}", why: "the buff strip shows no chip for it" },
    { file: "hud-diablo.ts", anchor: "const M: Record<string, { icon: string; color: string; max: number; label: string }>", open: "{", close: "}", why: "the HUD tile is missing" },
    { file: "debug-panel.ts", anchor: "const MATERIALS_DBG", open: "[", close: "]", why: "the debug grant chip is missing" },
    { file: "render/cel-painter.ts", anchor: "export const MARBLE_SKINS", open: "{", close: "}", why: "it has no painted body" },
  ];

  for (const { file, anchor, open, close, why } of REGISTRIES) {
    const src = read(file);
    const span = valueSpan(src, anchor, open, close, file);
    if (span == null) continue;
    const listed = new Set([...span.matchAll(/"?([a-z]+)"?\s*[:,\]]/g)].map((x) => x[1]));
    const missing = materials.filter((m) => !listed.has(m) && !span.includes(`"${m}"`));
    if (missing.length) fail("F", `${file}: ${anchor.replace(/^(export )?const /, "")} is missing ${missing.join(", ")} — ${why}`);
  }

  // `isMaterial` is an `||` chain, not a table — its own shape, its own read.
  {
    const src = read("entities/marble.ts");
    const body = blockAt(src, src.indexOf("export function isMaterial"));
    const missing = materials.filter((m) => !body.includes(`"${m}"`));
    if (missing.length) fail("F", `entities/marble.ts: isMaterial() is missing ${missing.join(", ")} — the debug grant and the pickup route both reject it as an unknown id`);
  }

  // The pickup sprite lives in a run of ITEM_PAINTS entries under one comment,
  // not in a table of its own.
  {
    const src = read("render/cel-painter.ts");
    const at = src.indexOf("// Marble materials —");
    const span = at < 0 ? "" : src.slice(at, at + 600);
    const missing = materials.filter((m) => !new RegExp(`\\b${m}:`).test(span));
    if (missing.length) fail("F", `render/cel-painter.ts: the ITEM_PAINTS marble run is missing ${missing.join(", ")} — its floor pickup draws as the fallback, so you cannot tell what you are about to grab`);
  }

  // ── The four CLIP registries. A material's body is `<material>ball`, and it
  // must be declared in all four or the ball silently falls back to the knight.
  const CLIP_REGISTRIES = [
    { file: "engine/render/paint-types.ts", label: "the ClipName union", why: "the clip cannot be named at all" },
    { file: "engine/render/animator.ts", label: "the cadence switch + LOOPS", why: "it has no frame timing and would not loop" },
    { file: "engine/render/sprite.ts", label: "buildSpriteSheet's clipNames", why: "the frames are never packed into the atlas" },
  ];
  for (const { file, label, why } of CLIP_REGISTRIES) {
    const src = read(file);
    const missing = materials.filter((m) => !src.includes(`${m}ball`));
    if (missing.length) fail("F", `${file}: ${label} is missing ${missing.map((m) => `"${m}ball"`).join(", ")} — ${why}, so the material renders as the plain knight`);
  }
}

// ── report ──────────────────────────────────────────────────────────────────
if (!problems.length) {
  console.log("registry-drift: clean");
  process.exit(0);
}
const LABEL = {
  A: "union coverage",
  B: "themed spawn reachability",
  C: "EXPANSION_SKIN ↔ KIND_PORTRAIT",
  D: "floor-1 atlas preload",
  E: "debug-panel spawn route",
  F: "marble-material registries",
};
console.log(`registry-drift: ${problems.length} problem(s)\n`);
for (const check of ["A", "B", "C", "D", "E", "F"]) {
  const hits = problems.filter((p) => p.check === check);
  if (!hits.length) continue;
  console.log(`  [${check}] ${LABEL[check]}`);
  for (const h of hits) console.log(`      · ${h.msg}`);
  console.log("");
}
process.exit(1);
