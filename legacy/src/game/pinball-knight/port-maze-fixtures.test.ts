/**
 * PORT-PARITY FIXTURES — the maze generator's per-pass tripwire.
 *
 * Sibling of `port-fixtures.test.ts`, which pins motion traces. This one pins
 * FLOOR GENERATION, and it is a different problem: a trace diverges at a tick
 * you can name, but `buildTrackFloor` is twenty-three ordered passes sharing
 * one rng stream, each mutating the grid the next one reads. A whole-floor
 * digest taken at the end can only ever say "wrong", and every pass after the
 * real mistake is wrong too — so the port would be debugged by bisecting a
 * 1,100-line pipeline by hand, on a floor with 3,975 tiles.
 *
 * So: a digest AT EVERY PASS BOUNDARY, plus the cumulative rng draw count.
 * Together they localise a divergence in one read.
 *
 *   · first differing pass          → which pass is wrong
 *   · draws already differ there    → the mistake is UPSTREAM, in what the
 *                                     previous pass drew, not in this pass
 *   · draws match, digest differs   → this pass consumed the same stream and
 *                                     did something different with it
 *   · draws match, only `lane`
 *     differs                       → the geometry is right and the mask is not
 *
 * ── The counting RNG ────────────────────────────────────────────────────────
 *
 * `countingRng` wraps the floor's own `floorRng` and counts calls. It changes
 * nothing about the stream — the same values in the same order — so the floor
 * it produces is bit-identical to the shipping one. The count is the cheapest
 * possible localiser: two implementations that draw the same NUMBER of values
 * up to pass K agree about everything that consumed randomness before K.
 *
 * ── Debugging a divergence ──────────────────────────────────────────────────
 *
 * When the Rust side reports pass K on floor (level L, seed S), dump the legacy
 * grid at that boundary and diff it yourself:
 *
 *     PK_DUMP="L:S:pass-name" npx vitest run src/game/pinball-knight/port-maze-fixtures.test.ts
 *
 * writes `<repo>/target/maze-dump-<L>-<S>-<pass>.json` (tiles, shapes, lane,
 * sealed as plain arrays). Deliberately NOT committed: 23 passes of full grids
 * is ~200 KB of hex that goes stale the first time the generator legitimately
 * changes, and a dump you can regenerate in two seconds is worth more than a
 * pinned one you have to trust.
 *
 *   - Run normally: recomputes and asserts the committed fixture still matches,
 *     so drift on the TS side is caught too.
 *   - RUN_EXPORT=1: (re)writes the fixture.
 *
 * Rust twin: `crates/pk-core/tests/maze_pass_digests.rs`. If either side fails,
 * fix the PORT, never the pins.
 */
import { describe, it, expect } from "vitest";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { levelConfig } from "./constants";
import { ARCHETYPES, archetypeFor, windinessFor, DEFAULT_TRACK_PROFILE, type TrackProfile } from "./maze/archetypes";
import { DEFAULT_RULE_WEIGHTS } from "./maze/floor-rules";
import { floorRng, floorSeed } from "./maze/floor-seed";
import { isWalkable, type Grid } from "./maze/generator";
import { MODIFIERS, MODIFIER_CHANCE, MODIFIER_FROM_LEVEL, rollModifier } from "./maze/modifiers";
import { buildTrackFloor, type PassSnapshot } from "./maze/track-floor";
import type { ArcFeature } from "./engine/tile-shape";

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE_DIR = join(HERE, "../../../../assets/fixtures");
const DUMP_DIR = join(HERE, "../../../../target");

// ── THE DIGEST ───────────────────────────────────────────────────────────────
//
// FNV-1a 32, `Math.imul` — the same hash and the same idiom `dev/floor-census.ts`
// already uses for the same job (catching a reordered draw). Kept 32-bit rather
// than widened to 64 because it is not the only thing being compared: each pass
// pins SEVEN independent digests plus six exact counts plus the exact draw
// count, so a divergence has to collide in all of them to slip through, and the
// counts do not collide at all. `Math.imul` is exactly `u32::wrapping_mul`, so
// the Rust twin is a transcription rather than a reimplementation.
const FNV_OFFSET = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

/** Streaming FNV-1a 32 state — a plain number, folded one byte at a time. */
function fold(h: number, byte: number): number {
  return Math.imul(h ^ (byte & 0xff), FNV_PRIME) >>> 0;
}

/**
 * Digest a byte array, LENGTH INCLUDED.
 *
 * Folding the length in is not ceremony: without it a truncated array digests
 * identically to a shorter one that happens to end the same way, and "the port
 * allocated the wrong grid size" is a defect this harness must not be able to
 * miss.
 */
function digestBytes(a: ArrayLike<number>): number {
  let h = FNV_OFFSET;
  for (let i = 0; i < a.length; i++) h = fold(h, a[i]);
  return foldLen(h, a.length);
}

/** Fold a 32-bit length in, low byte first — the same order as the data. */
function foldLen(h: number, n: number): number {
  let out = h;
  for (let b = 0; b < 4; b++) out = fold(out, (n >>> (b * 8)) & 0xff);
  return out >>> 0;
}

/** Little-endian f64 bits, folded. The wire format the Rust twin reads. */
function foldF64(h: number, v: number, view: DataView): number {
  view.setFloat64(0, v, true);
  let out = h;
  for (let b = 0; b < 8; b++) out = fold(out, view.getUint8(b));
  return out;
}

/** Little-endian f32 bits, folded. `mask.dist` carries Infinity off-track. */
function digestF32(a: Float32Array): number {
  const view = new DataView(new ArrayBuffer(8));
  let h = FNV_OFFSET;
  for (let i = 0; i < a.length; i++) {
    view.setFloat32(0, a[i], true);
    for (let b = 0; b < 4; b++) h = fold(h, view.getUint8(b));
  }
  return foldLen(h, a.length);
}

/** Little-endian i16 bits, folded. `grid.arcIdx` is -1 where no feature owns. */
function digestI16(a: Int16Array): number {
  const view = new DataView(new ArrayBuffer(8));
  let h = FNV_OFFSET;
  for (let i = 0; i < a.length; i++) {
    view.setInt16(0, a[i], true);
    h = fold(h, view.getUint8(0));
    h = fold(h, view.getUint8(1));
  }
  return foldLen(h, a.length);
}

/** `owner` as one byte. Absent reads as "sweep" — see ArcFeature. */
const OWNER_CODE: Record<string, number> = { sweep: 0, track: 1, island: 2, funnel: 3 };

/**
 * Digest the arc features IN AUTHORING ORDER.
 *
 * The order is itself the signal, exactly as it is in `floor-census`'s fold: it
 * is the order the passes published them in, and two passes swapping would
 * leave every count identical. `compactArcs` remaps `arcIdx` against this
 * order, so a port that authors the same features in a different order has a
 * different floor even though the walls are in the same places.
 */
function digestArcs(arcs: ArcFeature[] | undefined): number {
  const view = new DataView(new ArrayBuffer(8));
  let h = FNV_OFFSET;
  for (const f of arcs ?? []) {
    for (const v of [f.cx, f.cz, f.r, f.a0, f.span]) h = foldF64(h, v, view);
    h = fold(h, f.solidOut === true ? 1 : 0);
    h = fold(h, OWNER_CODE[f.owner ?? "sweep"]);
    h = foldLen(h, f.kicks?.length ?? 0);
    for (const k of f.kicks ?? []) for (const v of [k.a0, k.span, k.cooldownT, k.hitT]) h = foldF64(h, v, view);
    h = foldLen(h, f.lanes?.length ?? 0);
    for (const l of f.lanes ?? []) {
      for (const v of [l.a0, l.span]) h = foldF64(h, v, view);
      h = fold(h, l.cw ? 1 : 0);
      for (const v of [l.cooldownT, l.hitT]) h = foldF64(h, v, view);
    }
  }
  return foldLen(h, arcs?.length ?? 0);
}

/**
 * SELF-TEST VECTORS — how the Rust twin certifies its own digest before any
 * maze code exists.
 *
 * Without these, a Rust digest that is subtly wrong (a missed length fold, a
 * big-endian f64) fails against every pass of every floor and reads exactly
 * like a broken generator. These pin the hash itself, so the first thing the
 * Rust test can say is "the instrument agrees" — and only then start blaming
 * the port. The vectors deliberately include the degenerate cases: empty, one
 * byte, a length that differs with identical content, and a float.
 */
interface SelfTestVector {
  name: string;
  /** Element type, so the Rust twin knows which encoder to exercise. */
  kind: "u8" | "f64" | "f32" | "i16";
  /** How many ELEMENTS — which is what the length fold folds, not bytes. */
  elements: number;
  /**
   * The little-endian byte stream the elements encode to, before the length
   * fold. Pinned as bytes rather than as the numbers themselves because JSON
   * cannot carry either of the two values that matter most here: `-0`
   * stringifies to `0` and `Infinity` to `null`, and both have bit patterns
   * this digest must reproduce exactly.
   */
  bytes: string;
  digest: number;
}

function selfTestVectors(): SelfTestVector[] {
  const view = new DataView(new ArrayBuffer(8));
  const hex = (a: ArrayLike<number>): string =>
    Array.from(a, (b: number) => b.toString(16).padStart(2, "0")).join("");
  const u8 = (name: string, a: number[]): SelfTestVector => ({
    name,
    kind: "u8",
    elements: a.length,
    bytes: hex(a),
    digest: digestBytes(Uint8Array.from(a)),
  });
  const wide = (name: string, kind: "f64" | "f32" | "i16", a: ArrayLike<number>, raw: ArrayBufferLike, digest: number): SelfTestVector => ({
    name,
    kind,
    elements: a.length,
    bytes: hex(new Uint8Array(raw)),
    digest,
  });
  const f64s = [0, -0, 1, Math.PI, Infinity, -1.5e-300];
  let hf = FNV_OFFSET;
  const f64Raw = new ArrayBuffer(f64s.length * 8);
  const f64View = new DataView(f64Raw);
  f64s.forEach((v, k) => {
    f64View.setFloat64(k * 8, v, true);
    hf = foldF64(hf, v, view);
  });
  const f32s = Float32Array.from([0, -0, 1, 3.5, Infinity]);
  const i16s = Int16Array.from([-1, 0, 1, -32768, 32767]);
  return [
    u8("empty", []),
    u8("one-zero", [0]),
    u8("two-zero", [0, 0]),
    u8("ascending", [...Array(32).keys()]),
    u8("high-bytes", [255, 128, 1, 0, 255]),
    wide("f64-le", "f64", f64s, f64Raw, foldLen(hf, f64s.length)),
    wide("f32-le", "f32", f32s, f32s.buffer, digestF32(f32s)),
    wide("i16-le", "i16", i16s, i16s.buffer, digestI16(i16s)),
  ];
}

// ── THE COUNTING RNG ─────────────────────────────────────────────────────────

/** The floor's own stream, with a call counter on it. Same values, same order. */
function countingRng(inner: () => number): { rng: () => number; draws: () => number } {
  let n = 0;
  return {
    rng: () => {
      n++;
      return inner();
    },
    draws: () => n,
  };
}

// ── ONE PASS RECORD ──────────────────────────────────────────────────────────

interface PassRecord {
  pass: string;
  /** Cumulative rng draws at this boundary, counted from the floor's first. */
  draws: number;
  t: number;
  shapes: number;
  arcs: number;
  arcIdx: number | null;
  lane: number | null;
  sealed: number | null;
  dist: number | null;
  /** Exact counts, so a mismatch is legible without a grid dump. */
  walkable: number;
  shaped: number;
  arcTiles: number;
  laneTiles: number;
  sealedTiles: number;
  extra: Record<string, unknown>;
}

function countIf(a: ArrayLike<number>, pred: (v: number) => boolean): number {
  let n = 0;
  for (let i = 0; i < a.length; i++) if (pred(a[i])) n++;
  return n;
}

function walkableCountOf(g: Grid): number {
  let n = 0;
  for (let j = 0; j < g.h; j++) for (let i = 0; i < g.w; i++) if (isWalkable(g, i, j)) n++;
  return n;
}

function record(snap: PassSnapshot, draws: number): PassRecord {
  const { grid: g, mask } = snap;
  return {
    pass: snap.pass,
    draws,
    t: digestBytes(g.t),
    shapes: digestBytes(g.shapes),
    arcs: digestArcs(g.arcs),
    arcIdx: g.arcIdx ? digestI16(g.arcIdx) : null,
    lane: mask ? digestBytes(mask.lane) : null,
    sealed: mask ? digestBytes(mask.sealed) : null,
    dist: mask ? digestF32(mask.dist) : null,
    walkable: walkableCountOf(g),
    shaped: countIf(g.shapes, (v) => v !== 0),
    arcTiles: g.arcIdx ? countIf(g.arcIdx, (v) => v >= 0) : 0,
    laneTiles: mask ? countIf(mask.lane, (v) => v === 1) : 0,
    sealedTiles: mask ? countIf(mask.sealed, (v) => v === 1) : 0,
    extra: snap.extra,
  };
}

// ── ONE FLOOR ────────────────────────────────────────────────────────────────

/**
 * Build one floor EXACTLY as `spawn/floor-authoring.ts authorFloor` does.
 *
 * The three draws before `buildTrackFloor` are part of the contract and are
 * reproduced here rather than skipped: `rollModifier` and `windinessFor` shift
 * the stream, so a harness that starts the generator at draw 0 measures a floor
 * the game never builds. That is exactly the defect `dev/headless-floor.ts`'s
 * header records, and the reason `drawsBeforeTrack` is pinned separately — if
 * it ever moves, the floor moved with it and the fixture says so.
 *
 * ⚠️ MIRROR: if `authorFloor`'s pre-track sequence changes, change it here in
 * the same commit. There is no way to import the sequence itself — the rest of
 * `authorFloor` needs `state`, a THREE scene and the DOM.
 */
interface FloorTrace {
  level: number;
  runSeed: number;
  floorSeed: number;
  cellsW: number;
  cellsH: number;
  w: number;
  h: number;
  density: number;
  drawsBeforeTrack: number;
  profile: TrackProfile;
  passes: PassRecord[];
  totalDraws: number;
  result: {
    start: number[];
    stairs: number[];
    relaxed: string[];
    doorways: number;
    chute: number[] | null;
    orbit: number[] | null;
    bossRoom: number[] | null;
  };
}

function buildFloorTrace(level: number, runSeed: number, dumpPass: string | null): { floor: FloorTrace; dumped: unknown } {
  const cfg = levelConfig(level);
  const arch = archetypeFor(level);
  const { rng, draws } = countingRng(floorRng(runSeed, level));
  rollModifier(level, rng);
  const windiness = windinessFor(level, arch, rng);
  const drawsBeforeTrack = draws();

  const passes: PassRecord[] = [];
  let dumped: unknown = null;
  const track = buildTrackFloor(cfg.cellsW, cfg.cellsH, rng, {
    profile: arch.track,
    density: Math.max(0.35, Math.min(0.85, windiness)),
    onPass: (snap) => {
      passes.push(record(snap, draws()));
      if (dumpPass !== null && snap.pass === dumpPass) {
        dumped = {
          pass: snap.pass,
          w: snap.grid.w,
          h: snap.grid.h,
          t: [...snap.grid.t],
          shapes: [...snap.grid.shapes],
          lane: snap.mask ? [...snap.mask.lane] : null,
          sealed: snap.mask ? [...snap.mask.sealed] : null,
          arcs: snap.grid.arcs ?? [],
        };
      }
    },
  });
  if (!track) throw new Error(`buildTrackFloor declined level ${level} seed ${runSeed} — no fixture to pin`);

  return {
    floor: {
      level,
      runSeed,
      floorSeed: floorSeed(runSeed, level),
      cellsW: cfg.cellsW,
      cellsH: cfg.cellsH,
      w: track.grid.w,
      h: track.grid.h,
      density: Math.max(0.35, Math.min(0.85, windiness)),
      drawsBeforeTrack,
      // The archetype's profile, VERBATIM. It pins maze/archetypes.ts's tables
      // as a side effect, and — the reason it is here — it lets the Rust
      // pipeline replay a floor before those tables are ported at all.
      profile: arch.track as TrackProfile,
      passes,
      totalDraws: draws(),
      result: {
        start: [track.start.i, track.start.j],
        stairs: [track.stairs.i, track.stairs.j],
        relaxed: track.relaxed,
        doorways: track.doorways.length,
        chute: track.chute ? [track.chute.base.i, track.chute.base.j, track.chute.mouth.i, track.chute.mouth.j] : null,
        orbit: track.orbit ? [track.orbit.ci, track.orbit.cj] : null,
        bossRoom: track.bossRoom ? [track.bossRoom.ci, track.bossRoom.cj, track.bossRoom.r] : null,
      },
    },
    dumped,
  };
}

/**
 * THE CORPUS.
 *
 * Levels 1-5 are the five archetypes in order (`archetypeFor` cycles every 5),
 * so every `TrackProfile` in the table is exercised at least once; 8 and 13 add
 * the depth ramp, where the grid roughly triples in area and the node counts
 * with it. Two run seeds each, because a single seed cannot tell "the port is
 * right" from "the port is wrong in a way this floor does not reach" — 424242
 * is the seed `floor-rules` uses for its own awkward-floor cases.
 *
 * Deliberately NOT the whole vitest seed corpus: this is a tripwire, and it
 * runs on every Rust test invocation. Breadth belongs in the property tests
 * that already exist on the TS side.
 */
const CORPUS: Array<[level: number, runSeed: number]> = [
  [1, 1],
  [2, 1],
  [3, 1],
  [4, 1],
  [5, 1],
  [8, 1],
  [13, 1],
  [1, 424242],
  [3, 424242],
  [8, 424242],
];

function pinFixture(name: string, computed: unknown): void {
  const file = join(FIXTURE_DIR, name);
  if (process.env.RUN_EXPORT === "1" || !existsSync(file)) {
    mkdirSync(FIXTURE_DIR, { recursive: true });
    writeFileSync(file, JSON.stringify(computed));
  }
  expect(computed).toEqual(JSON.parse(readFileSync(file, "utf8")));
}

// ── THE LOCALISER ────────────────────────────────────────────────────────────

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

/**
 * WHERE it diverged, in one paragraph — and this is the harness, not a nicety.
 *
 * A deep-equal on the whole fixture reports "expected {…} to deeply equal {…}"
 * and then prints every differing line of all twenty-three passes, because a
 * mistake in pass 6 makes passes 6-23 differ too. Measured on a deliberate
 * one-draw sabotage before `arc-sweeps`: the raw diff was 300 lines long and
 * the earliest divergence was not in the first screen of it. The reader's job
 * is to find the FIRST wrong pass, so that is what this prints — and nothing
 * after it, because everything after it is downstream noise.
 *
 * ⚠️ THE FIRST DIVERGENCE IS SPECIAL, and the report leans on it: every pass
 * before it matched on all seven digests AND the cumulative draw count, so the
 * pass entered with a bit-identical grid and the rng at the same position. The
 * mistake is therefore IN THIS PASS — not somewhere upstream — and the draw
 * DELTA says which half of it:
 *
 *   · drew a different number of values → the pass's own draw sequence is
 *     wrong (a loop that iterates differently, a guard that skips a roll).
 *   · drew the same number → it consumed the identical values and did
 *     something different with them. The arithmetic is wrong, not the order.
 *
 * The one thing it cannot rule out is state this harness does not digest — the
 * track graph beyond its node/edge counts, the leg list, the doorway plan. If a
 * pass looks innocent, that is where to look next, and it is a reason to widen
 * the record rather than to squint at the pass.
 */
function firstDivergence(want: FloorTrace, got: FloorTrace): string | null {
  const head = `L${want.level} seed ${want.runSeed} (${want.w}×${want.h})`;
  const out: string[] = [];
  for (const key of ["cellsW", "cellsH", "w", "h", "density", "drawsBeforeTrack", "profile"] as const) {
    if (!same(want[key], got[key])) out.push(`  setup.${key}: ${JSON.stringify(want[key])} → ${JSON.stringify(got[key])}`);
  }
  if (out.length > 0) return `${head}: the floor was SET UP differently — the pipeline never ran the same job.\n${out.join("\n")}`;

  const n = Math.min(want.passes.length, got.passes.length);
  for (let k = 0; k < n; k++) {
    const a = want.passes[k];
    const b = got.passes[k];
    const keys = (Object.keys(a) as Array<keyof PassRecord>).filter((key) => !same(a[key], b[key]));
    if (keys.length === 0) continue;
    const lines = keys.map((key) => `    ${String(key).padEnd(14)} ${JSON.stringify(a[key])} → ${JSON.stringify(b[key])}`);
    // The DELTA, not the cumulative total: `draws` is counted at the pass's
    // EXIT, so a pass that draws a variable number can land on the oracle's
    // total from a different starting point and read as "the same". Against the
    // previous boundary — which by construction matched — the delta is exactly
    // what this pass drew.
    const drewWant = a.draws - (k > 0 ? want.passes[k - 1].draws : 0);
    const drewGot = b.draws - (k > 0 ? got.passes[k - 1].draws : 0);
    lines.push(
      drewWant === drewGot
        ? `    → this pass drew the same ${drewWant} value(s) and used them differently — every pass before it is bit-identical.`
        : `    → this pass drew ${drewGot} value(s) against the oracle's ${drewWant} — its own draw sequence differs.`,
    );
    return `${head}: first divergence at pass ${k + 1}/${want.passes.length} "${a.pass}"\n${lines.join("\n")}`;
  }
  if (want.passes.length !== got.passes.length) {
    return `${head}: pass COUNT ${want.passes.length} → ${got.passes.length} — a pass was added, dropped or renamed.`;
  }
  if (!same(want.result, got.result) || want.totalDraws !== got.totalDraws) {
    return `${head}: every pass agrees but the RESULT does not — ${JSON.stringify(want.result)} → ${JSON.stringify(got.result)} (draws ${want.totalDraws} → ${got.totalDraws}).`;
  }
  return null;
}

/** `PK_DUMP="<level>:<seed>:<pass>"` — see the header. */
function dumpRequest(): { level: number; runSeed: number; pass: string } | null {
  const raw = process.env.PK_DUMP;
  if (!raw) return null;
  const [l, s, ...rest] = raw.split(":");
  return { level: Number(l), runSeed: Number(s), pass: rest.join(":") };
}

/**
 * THE CONSTANTS THE CORPUS CANNOT DISCRIMINATE.
 *
 * Ten floors pin an enormous amount — but not everything, and the gap is not
 * theoretical. Measured: changing `MODIFIER_CHANCE` from 0.45 to 0.5 in the
 * Rust port changed NO floor in the corpus, because discriminating those two
 * needs a floor whose modifier draw lands in [0.45, 0.5) and none does. A
 * constant a corpus cannot separate from a wrong constant is a constant the
 * corpus does not pin, and transcribing it by eye is exactly how a table
 * acquires a typo that only shows up nine floors deep.
 *
 * So the constants are exported directly. This is not a substitute for the
 * digests — it is the part of the transcription the digests provably do not
 * cover, and keeping the two separate is what stops "the corpus is green" from
 * being read as "every number is right".
 *
 * `levelCells` is here for the same reason: `cellsW/cellsH` cap at L23/L24 and
 * the corpus stops at 13, so the clamp itself is untested by the floors.
 */
function constantsFixture() {
  return {
    modifiers: {
      fromLevel: MODIFIER_FROM_LEVEL,
      chance: MODIFIER_CHANCE,
      // In table order, "none" first — the roll indexes the REST of it, so a
      // shortened or reordered pool picks a different twist.
      ids: MODIFIERS.map((m) => m.id),
    },
    ruleWeights: DEFAULT_RULE_WEIGHTS,
    defaultTrackProfile: DEFAULT_TRACK_PROFILE,
    archetypes: ARCHETYPES.map((a) => ({
      id: a.id,
      label: a.label,
      flavour: a.flavour,
      windiness: a.windiness,
    })),
    // Past the caps on purpose: L23/L24 are where cellsW/cellsH stop growing.
    levelCells: Array.from({ length: 30 }, (_, k) => {
      const cfg = levelConfig(k + 1);
      return [k + 1, cfg.cellsW, cfg.cellsH];
    }),
  };
}

describe("port-parity fixtures — maze pass digests", () => {
  it("the constants the corpus cannot discriminate are pinned directly", () => {
    const c = constantsFixture();
    // The pool the roll indexes is MODIFIERS minus "none": a table that grew a
    // second falsy entry would change every modifier a floor rolls.
    expect(c.modifiers.ids[0]).toBe("none");
    expect(c.modifiers.ids.filter((id) => id === "none")).toHaveLength(1);
    expect(c.archetypes).toHaveLength(5);
    // The caps must actually be reached inside the exported range, or the
    // table pins a ramp and calls it a clamp.
    const last = c.levelCells[c.levelCells.length - 1];
    expect(last[1]).toBe(96);
    expect(last[2]).toBe(72);
    pinFixture("maze-constants.json", c);
  });

  it("attaching an observer does not change the floor", () => {
    // ── The claim the whole harness rests on, MEASURED ────────────────────
    //
    // Every fixture below is exported from a floor that was being watched. If
    // watching perturbed it — one stray draw, one array the probe mutated —
    // the port would be gated against a floor the game never builds, and
    // nothing else in this file could tell. So: the same seed built twice, once
    // through the seam and once by the shipping call exactly as
    // `authorFloor` makes it, compared on the finished grid.
    const watched = buildFloorTrace(3, 424242, null).floor;
    const cfg = levelConfig(3);
    const arch = archetypeFor(3);
    const { rng, draws } = countingRng(floorRng(424242, 3));
    rollModifier(3, rng);
    const windiness = windinessFor(3, arch, rng);
    const bare = buildTrackFloor(cfg.cellsW, cfg.cellsH, rng, {
      profile: arch.track,
      density: Math.max(0.35, Math.min(0.85, windiness)),
    });
    expect(bare).not.toBeNull();
    const observed = record({ pass: "done", grid: bare!.grid, mask: bare!.mask, extra: {} }, draws());
    const { extra: _watchedExtra, ...watchedTail } = watched.passes[watched.passes.length - 1];
    const { extra: _observedExtra, ...observedTail } = observed;
    expect(observedTail).toEqual(watchedTail);
    expect(draws()).toBe(watched.totalDraws);
    expect([bare!.start.i, bare!.start.j]).toEqual(watched.result.start);
    expect([bare!.stairs.i, bare!.stairs.j]).toEqual(watched.result.stairs);
  });

  it("the digest itself matches its pinned vectors", () => {
    // Pinned separately from the floors so a broken HASH and a broken
    // GENERATOR cannot present as the same failure.
    pinFixture("maze-digest-selftest.json", { algo: "fnv1a32-le", vectors: selfTestVectors() });
  });

  it("every pass of every corpus floor matches the committed digests", () => {
    const dump = dumpRequest();
    const floors = CORPUS.map(([level, runSeed]) => {
      const wantDump = dump && dump.level === level && dump.runSeed === runSeed ? dump.pass : null;
      const { floor, dumped } = buildFloorTrace(level, runSeed, wantDump);
      if (dumped) {
        mkdirSync(DUMP_DIR, { recursive: true });
        const file = join(DUMP_DIR, `maze-dump-${level}-${runSeed}-${wantDump}.json`);
        writeFileSync(file, JSON.stringify(dumped));
        console.log(`[PK_DUMP] wrote ${file}`);
      }
      return floor;
    });

    // ── The tape must actually exercise the pipeline ────────────────────────
    //
    // A fixture of twenty-three identical digests would pin perfectly and prove
    // nothing, which is the failure mode a digest harness is most prone to: it
    // is green whether or not the thing under it ran. So the shape of the trace
    // is asserted before it is pinned.
    for (const f of floors) {
      expect(f.passes.map((p) => p.pass)).toEqual(PASS_ORDER);
      // Every pass that draws must have moved the counter, and the geometry
      // must actually change across the pipeline.
      expect(f.totalDraws).toBeGreaterThan(f.drawsBeforeTrack);
      expect(new Set(f.passes.map((p) => p.t)).size).toBeGreaterThan(6);
      expect(f.passes[f.passes.length - 1].walkable).toBeGreaterThan(0);
      // The floor must be a floor: a start, an exit, and curved walls on it.
      expect(f.result.start).not.toEqual(f.result.stairs);
      expect(f.passes[f.passes.length - 1].arcTiles).toBeGreaterThan(0);
    }

    const computed = { passOrder: PASS_ORDER, floors };
    const file = join(FIXTURE_DIR, "maze-pass-digests.json");
    if (process.env.RUN_EXPORT === "1" || !existsSync(file)) {
      mkdirSync(FIXTURE_DIR, { recursive: true });
      writeFileSync(file, JSON.stringify(computed));
    }
    const expected = JSON.parse(readFileSync(file, "utf8")) as typeof computed;
    // Localise BEFORE the deep-equal, so the reader gets the first wrong pass
    // rather than every downstream one. The deep-equal stays as the backstop:
    // it is what makes "the localiser missed a field" a failure and not a pass.
    const report = expected.floors
      .map((want, k) => (floors[k] ? firstDivergence(want, floors[k]) : `L${want.level} seed ${want.runSeed}: missing from the run`))
      .filter((r): r is string => r !== null);
    if (report.length > 0) {
      throw new Error(`maze pass digests diverged from the committed fixture:\n\n${report.join("\n\n")}\n`);
    }
    expect(computed).toEqual(expected);
  });
});

/**
 * THE PASS ORDER IS THE CONTRACT — pinned here as a literal, not derived from
 * the run.
 *
 * Derived from the run it would assert nothing: a pipeline that lost a pass
 * would produce a shorter list and match its own shorter list. Written out, a
 * dropped or reordered pass fails HERE, next to the names, instead of as
 * twenty-two shifted digests.
 */
const PASS_ORDER = [
  "grow-track",
  "track-path",
  "carve-track",
  "plaza",
  "launch-chute",
  "grow-maze",
  "endpoints-early",
  "repair-1",
  "plan-doorways",
  "publish-arcs",
  "orbit-island",
  "arc-sweeps",
  "repair-2",
  "endpoints-final",
  "boss-chamber",
  "artery-banks",
  "reseal-chute",
  "carve-doorways",
  "funnels-relays",
  "compact-fixed-point",
  "stairs",
  "arc-rails",
  "done",
];
