#!/usr/bin/env node
/**
 * pk-check — the port's browser verification gate.
 *
 * Loads the wasm build in REAL Windows host Chrome over CDP (SwiftShader
 * cannot run this app — see docs Incidents) and verifies, from outside:
 *   1. zero console errors / page errors (a wasm panic fails the run)
 *   2. the sim ticks (~60 Hz) via the window.__pk debug surface
 *   3. scripted input moves the knight (__pk.x advances under 'd')
 *   4. frame cost from `__pk.perf` (B2's per-frame accumulator) AND the
 *      presented rate from a 3 s rAF sample — reported separately and never
 *      conflated: rAF is vsync-quantised and cannot see work (see the note at
 *      the measurement itself)
 *   5. the title intro plays through its phases on a plain load, hands off
 *      to the TAVERN hub, and a click skips it (__pk.intro mirrors the legacy
 *      __dungeonIntroPhase probe)
 * and saves screenshots to .checks/.
 *
 * Boot is hub-first, so `?autostart=1` now lands in the tavern. The sim and
 * input gates need a floor to measure, so they ask for one explicitly with
 * `?dungeon=1` — the dev hatch. Every page carries `mute=1`: the harness
 * drives the real host machine and must not make noise.
 *
 * Usage, from the repo root:
 *   node scripts/pk-check.mjs             # trunk build + full check
 *   node scripts/pk-check.mjs --no-build  # reuse web/dist
 *
 * Exit code 0 = every gate passed. Non-zero = the port regressed.
 */
import { createServer } from "node:http";
import { readFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { execSync } from "node:child_process";
import { dirname, join, extname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DIST = join(ROOT, "web/dist");
const PORT = 8791;
const noBuild = process.argv.includes("--no-build");

/**
 * `--real-floor [--level N] [--seed N]` runs the GENERATED-FLOOR gates and
 * nothing else.
 *
 * Not folded into the default run, deliberately. The default run walks the
 * intro, the hub and the DESCEND hand-off and takes minutes; the real-floor
 * gates answer one question — does the ported generator's floor boot, paint,
 * spawn the knight where pk-core said, and collide where pk-core said — and the
 * loop that question belongs to is an edit-build-check loop, not a release
 * sweep. Bolted onto the end of the long run it would be checked hourly instead
 * of per change.
 */
const realFloor = process.argv.includes("--real-floor");
const flagNum = (name, dflt) => {
  const k = process.argv.indexOf(name);
  if (k < 0) return dflt;
  const v = Number(process.argv[k + 1]);
  if (!Number.isInteger(v)) throw new Error(`${name} wants an integer, got ${process.argv[k + 1]}`);
  return v;
};

/**
 * The shell's key basis is SCREEN-relative on the 45° camera yaw, so no single
 * key produces a world-cardinal move: W is (-1,-1), D is (+1,-1). The sums of
 * PAIRS are the cardinals, and `pk_core`'s `WallProbe.input` is written in world
 * space — so this table is the seam between them, and it is the only place the
 * two vocabularies meet.
 *
 * Verified by construction against `gather_input` in `crates/pk-game/src/main.rs`:
 *   W = (-1,-1)   S = (+1,+1)   A = (-1,+1)   D = (+1,-1)
 */
/// How long to pin the loading screen open so it can be photographed. Long
/// enough to survive a poll, a round trip and a capture on a 14 fps debug build.
/// 6 s, not 2.5: the poll that waits for a live renderer costs up to ~1.5 s of
/// wall clock on a debug build, the capture another ~0.3 s, and a hold that only
/// just covers them is a gate that fails on a slow afternoon. It is spent once
/// per real-floor run.
const LOADING_HOLD_MS = 6000;

/// The cheapest floor to walk end to end, for whoever finishes the driven
/// descend gate: `cargo run -p pk-core --example floor_ascii -- --level 1
/// --scan 300` ranks L1 seed 163 at 30 tiles and three turns, the shortest
/// route in the first 300 seeds. Measured, so the next attempt starts from a
/// number rather than a guess.
///   node scripts/pk-check.mjs --real-floor --level 1 --seed 163

const WORLD_TO_KEYS = {
  "0,-1": ["w", "d"], // north — up-right on screen
  "0,1": ["s", "a"], // south
  "-1,0": ["w", "a"], // west
  "1,0": ["s", "d"], // east
};

const MIME = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".wasm": "application/wasm",
  ".png": "image/png",
  ".json": "application/json",
};

function log(ok, msg) {
  console.log(`${ok ? "  ok " : "FAIL "} ${msg}`);
}

/**
 * The failure count lives at module scope so `main` can RETURN early — the
 * real-floor run does — without the summary and the exit code being skipped.
 * They used to sit after the `try/finally` inside `main`, where an early return
 * would have run the cleanup, printed nothing and exited 0: a gate that fails
 * silently and reports success is worse than no gate.
 */
let failed = 0;
const gate = (ok, msg) => {
  log(ok, msg);
  if (!ok) failed++;
};

/**
 * THE SIM'S TICK RATE — settle, then a long window. **One function, two gates.**
 *
 * Bevy's fixed timestep runs CATCH-UP steps to drain accumulated lag, so a
 * window opened immediately after a boot or a floor build measures the DRAIN
 * and reports it as a frequency. Building an 87×61 floor is exactly that kind
 * of stall.
 *
 * ⚠️ **THIS EXISTS BECAUSE THE LESSON WAS LEARNED ONCE AND APPLIED ONCE.** The
 * generated-floor gate carried a comment saying, in as many words, *"the first
 * version of this gate measured a 2 s window immediately after boot and read
 * 76 Hz on a 60 Hz sim, which is the drain, not the rate"* — and forty lines
 * below it the boot gate went on measuring a 2 s window immediately after boot.
 * On a debug build the drain finished early enough to stay under the 75 Hz
 * ceiling; **the first release build ever put through this harness read
 * 77 Hz and failed**, and it was recorded as one of the release build's own
 * defects. It was the harness.
 *
 * That is the third time in one day this codebase has fixed a defect in one of
 * two twins: the dungeon camera's frustum left the intro's pinned, and
 * `drive_scene_camera`'s `_ => None` arm is the same shape. **A repair written
 * inline is a repair applied to one call site.** Both gates now call this.
 *
 * The settle is 1 s and the window 3 s, measured against a wall clock rather
 * than assumed from `waitForTimeout` — a loaded box overshoots the timeout and
 * a rate divided by the REQUESTED duration reads low.
 */
async function simRate(page, pk) {
  await page.waitForTimeout(1000);
  const t0 = (await pk()).tick;
  const w0 = Date.now();
  await page.waitForTimeout(3000);
  const t1 = (await pk()).tick;
  return ((t1 - t0) / (Date.now() - w0)) * 1000;
}

/**
 * THE GENERATED FLOOR, FROM OUTSIDE THE APP.
 *
 * ⚠️ Asks for the generator with `?rust-floor=1`. The default source is the
 * AUTHORED floor; this gate is about the ported generator and its fixture.
 *
 * What this can prove that no Rust test can: that the WASM build boots a
 * generated floor at all, that it spawns the knight where `pk_core` said, that
 * the banner naming the floor is on screen, and that a wall the collider reports
 * is a wall the INPUT PATH runs into. Everything here is compared against
 * `assets/fixtures/real-floor-l3s1-p9.json` — the same file the Rust suite pins
 * — so the browser and the harness cannot each be right about a different floor.
 *
 * What it deliberately does NOT do is walk the maze looking for the exit. Whole-
 * floor reachability is a 4-neighbour BFS and belongs in
 * `crates/pk-core/tests/real_floor_integration.rs`, where it costs microseconds
 * and cannot flake on a key-hold.
 */
async function realFloorGates(page, gate, errors) {
  const level = flagNum("--level", 3);
  const seed = flagNum("--seed", 1);
  const url =
    `http://localhost:${PORT}/index.html` +
    // `rust-floor=1` ASKS FOR THE GENERATOR BY NAME. A descend loads an
    // AUTHORED floor by default now (the oracle's exported floor — see
    // `crates/pk-game/src/authored_floor.rs`), and everything below is pinned
    // against `real-floor-l3s1-p9.json`, which is the GENERATOR's digest at
    // nine passes. Without this flag the gate photographs one floor and grades
    // it against another's fixture — which is exactly what it did for one run,
    // and the failure it reported was "no floor was installed".
    `?real-floor=1&rust-floor=1&level=${level}&seed=${seed}&autostart=1&mute=1` +
    // HOLD THE LOADING SCREEN. Without it the state lives about three frames at
    // the debug build's frame rate and no externally-timed screenshot can land
    // inside it — the first version of this gate went green on `__pk.loading`
    // while its own screenshot showed the dungeon. The hold is a floor on the
    // dwell, so everything downstream is the same run, just later.
    `&loading-hold-ms=${LOADING_HOLD_MS}`;
  console.log(`real-floor gate: L${level} seed ${seed}`);

  // The fixture, when the run is on the floor it pins. Other levels still run
  // every gate that does not need a pinned value — and SAY so, rather than
  // quietly checking less.
  let want = null;
  if (level === 3 && seed === 1) {
    want = JSON.parse(await readFile(join(ROOT, "assets/fixtures/real-floor-l3s1-p9.json"), "utf8"));
  } else {
    console.log(
      `  note  no fixture for L${level} seed ${seed} — the spawn/probe/digest gates below ` +
        `check SHAPE only, not the pinned values`,
    );
  }

  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60_000 });
  const pk = () => page.evaluate(() => (window.__pk ? JSON.parse(window.__pk) : null));

  // ── THE LOADING SCREEN, CAUGHT IN THE ACT ──
  //
  // Polled FAST and before anything else, because the thing being proved is
  // that the screen EXISTED, and it exists for a few hundred milliseconds. A
  // 500 ms poll would step straight over it and every gate below would still be
  // green — which is precisely the bug: a loading state that is entered and left
  // within one frame is indistinguishable, downstream, from one that worked.
  //
  // `__pk.loading` is null in every other state, so seeing it non-null at all is
  // the claim. Its `label` says WHICH floor the screen named, so a card reading
  // "DESCENDING" over a generated Great Hall would fail here rather than look
  // fine in a screenshot.
  let loading = null;
  for (let i = 0; i < 400 && !loading; i++) {
    await page.waitForTimeout(50);
    const s = await pk();
    if (s?.loading) {
      loading = s.loading;
      await mkdir(join(ROOT, ".checks"), { recursive: true });
    }
    if (s?.floor || s?.floorError) break;
  }
  gate(!!loading, `the loading screen was on screen ${loading ? `("${loading.label}")` : "(never seen)"}`);
  if (loading) {
    console.log(
      `  note  loading beat: prepare ${loading.prepareMs?.toFixed?.(1)} ms, dwell ${loading.dwellMs} ms ` +
        `(this run holds it artificially so the card can be photographed)`,
    );
  }
  if (loading && want) {
    gate(
      loading.label.includes(`FLOOR ${level}`),
      `the loading card named the floor it was building (${loading.label})`,
    );
  }
  if (loading) {
    // WHILE THE CARD IS UP, THERE IS NO DUNGEON BEHIND IT. This is the claim the
    // screenshot alone cannot make and the one that matters: a loading screen
    // drawn over an already-built floor is not a loading screen, it is a
    // curtain. `floor` stays null until `setup_dungeon` installs one.
    // WAIT FOR THE RENDERER TO BE AWAKE BEFORE BELIEVING A PICTURE.
    //
    // On a cold wasm boot the first `Update`s run ~2.5 s apart while shaders
    // compile, and Bevy has presented NOTHING in that window — so a screenshot
    // taken at `painted: 2` captured a frame the page had not yet drawn. The
    // probe's own frame counter is the readiness signal: once it is climbing,
    // the renderer is producing frames and a capture means something.
    //
    // ⚠️ FOREGROUND FIRST, and this is not a tidy-up. Chrome throttles rAF in a
    // BACKGROUND tab, so a page waiting to be photographed advances `painted` at
    // a few frames a second while the dwell — which is `performance.now()`, wall
    // clock — runs at full speed. The poll below then spends more than the whole
    // hold reaching `painted >= 10`, the state ends, and the capture lands on the
    // dungeon. Measured: the identical run passed on one seed and failed on the
    // next, because the host Chrome had a different tab in front. `bringToFront`
    // used to sit between the poll and the screenshot, which is exactly one step
    // too late.
    await page.bringToFront();
    let live = null;
    for (let i = 0; i < 40; i++) {
      const p2 = await pk();
      if (!p2?.loading) break;
      if (p2.loading.painted >= 10) {
        live = p2;
        break;
      }
      await page.waitForTimeout(100);
    }
    gate(
      !!live,
      `the card survived to a live renderer (painted=${live?.loading?.painted ?? "state ended first"})`,
    );

    // WHILE THE CARD IS UP, THERE IS NO DUNGEON BEHIND IT. The claim a
    // screenshot cannot make and the one that matters: a loading screen drawn
    // over an already-built floor is not a loading screen, it is a curtain.
    gate(
      live !== null && live.floor === null,
      `no floor is installed behind the card (floor=${JSON.stringify(live?.floor)?.slice(0, 20)})`,
    );

    if (live) {
      const lshot = join(ROOT, ".checks", "floor-loading.png");
      const lpng = await page.screenshot({ path: lshot });
      // READ THE STATE AFTER THE CAPTURE, not only before it. The byte gate
      // below can tell a card from a maze, but it cannot say WHY — and the
      // failure it catches has exactly one interesting cause: the hold ran out
      // between the poll and the shutter. Asserting the state at capture time
      // makes the run report the cause instead of a number to squint at.
      const after = await pk();
      gate(
        !!after?.loading,
        `the card was still up when the shutter fired (${
          after?.loading
            ? `painted ${after.loading.painted}, ${Math.round(after.loading.elapsedMs)} ms in state`
            : "the hold expired first — raise LOADING_HOLD_MS"
        })`,
      );
      console.log("screenshot:", lshot, `(${lpng.length} bytes)`);
      // A flat dark field with two lines of text encodes MUCH smaller than the
      // maze frame (~32 kB, measured). Both bounds: too big means the maze is
      // showing through, too small means nothing was drawn at all.
      gate(
        lpng.length > 1500 && lpng.length < 20000,
        `the card is a card and not the maze (${lpng.length} bytes; the maze frame is ~32000)`,
      );
    }
    console.log(
      `  note  MANUAL: floor-loading.png must show "DESCENDING - FLOOR ${level} - <archetype>" ` +
        `on a dark field, with NO maze visible behind it.`,
    );
  }

  let stats = null;
  for (let i = 0; i < 60 && !stats?.floor; i++) {
    await page.waitForTimeout(500);
    stats = await pk();
    // A refusal is a RESULT, not a timeout to sit through: the shell paints a
    // red card and publishes the reason rather than falling back to the demo
    // floor, so surface it immediately instead of after 30 s of polling.
    if (stats?.floorError) break;
  }
  if (stats?.floorError) {
    gate(false, `the shell refused the floor: ${stats.floorError}`);
    return;
  }
  gate(!!stats?.floor, `wasm booted a generated floor ${stats?.floor ? "" : "(__pk.floor never appeared)"}`);
  const f = stats?.floor;
  if (!f) return;

  // ── It is the GENERATED floor, not the demo one ──
  gate(f.source === "track-floor", `floor source is ${f.source}`);
  gate(f.debugBanner === true, "the debug banner is up");
  gate(f.level === level && f.runSeed === seed, `telemetry names L${f.level} seed ${f.runSeed}`);
  // The demo floor is 25×25. Any generated floor is bigger on both axes, so this
  // separates "the flag worked" from "the flag was ignored" without a fixture.
  gate(f.w > 25 && f.h > 25, `grid is ${f.w}×${f.h} (the demo arena is 25×25)`);

  if (want) {
    gate(f.w === want.w && f.h === want.h, `grid matches the fixture (${want.w}×${want.h})`);
    gate(
      f.tileDigest === want.tileDigest,
      `tile digest matches the oracle corpus (${f.tileDigest} vs ${want.tileDigest})`,
    );
    gate(
      f.floorSeed === want.floorSeed,
      `floor seed matches (${f.floorSeed} vs ${want.floorSeed})`,
    );
    gate(
      f.startTile[0] === want.start[0] && f.startTile[1] === want.start[1],
      `start tile matches (${f.startTile} vs ${want.start})`,
    );
    gate(
      f.exitTile[0] === want.provisionalExit[0] && f.exitTile[1] === want.provisionalExit[1],
      `provisional exit tile matches (${f.exitTile} vs ${want.provisionalExit})`,
    );
    gate(f.pass === want.generatorVersion, `pass count matches (P${f.pass})`);
  }

  // ── WHAT THE DESCEND ACTUALLY COST, on the target that renders ──
  //
  // Reported, not gated. The native release numbers are 3-18 ms of generation
  // (table in `crates/pk-game/src/floor_loading.rs`), and the open question that
  // table cannot answer is what the MESH BUILD and the GPU upload cost in a
  // browser. A budget is not asserted here because there is no measured budget
  // to assert yet — printing the number is how one gets established, and
  // inventing a threshold now would be a gate that means nothing.
  console.log(
    `  note  descend cost: prepare ${f.prepareMs?.toFixed?.(1) ?? "?"} ms, ` +
      `install ${f.installMs?.toFixed?.(1) ?? "?"} ms ` +
      `(the loading screen's minimum dwell is 300 ms)`,
  );
  gate(
    typeof f.prepareMs === "number" && f.prepareMs >= 0,
    `the descend reported its own cost (prepareMs=${f.prepareMs})`,
  );

  // ── The knight is standing where pk-core said it would ──
  //
  // The one claim that ties the SIM to the FLOOR. `__pk.x/z` is the player's
  // live position and `floor.startWorld` is where validation said the floor
  // opens; a shell that built the generated floor but spawned the knight at the
  // demo floor's origin would satisfy every gate above.
  const dx = stats.x - f.startWorld[0];
  const dz = stats.z - f.startWorld[1];
  gate(
    Math.abs(dx) < 0.01 && Math.abs(dz) < 0.01,
    `knight spawned at the floor's start (${stats.x.toFixed(2)}, ${stats.z.toFixed(2)}) vs ` +
      `(${f.startWorld[0]}, ${f.startWorld[1]})`,
  );

  // ── The sim ticks ──
  const rate = await simRate(page, pk);
  gate(rate > 45 && rate < 75, `sim ticking on the generated floor (${rate.toFixed(1)} Hz)`);

  const hold = async (keys, ms) => {
    await page.locator("canvas").click().catch(() => {});
    for (const k of keys) await page.keyboard.down(k);
    await page.waitForTimeout(ms);
    // Release EVERY movement key, not only the ones held: a dropped keyup under
    // CDP leaves a phantom key down and every later leg walks diagonally.
    for (const k of ["w", "a", "s", "d"]) await page.keyboard.up(k);
    await page.waitForTimeout(80);
  };

  // ── THE WALL PROBE ──
  //
  // Walk the direction pk-core derived, for longer than it needs, and assert two
  // things at once: the body REACHED the wall (so a frozen sim fails) and did
  // not PASS it (so a broken collider fails). The bound is
  // `maxAllowedTravel`, derived in Rust from the tile face plus the body radius
  // — arithmetic the sim never performed, which is what makes it an oracle
  // rather than the sim agreeing with itself.
  const probe = f.wallProbe;
  if (!probe) {
    // NOT a silent skip. A floor with no probe is a floor whose collision this
    // gate cannot check, and the run must say so out loud.
    gate(false, `L${level} seed ${seed} produced no wall probe — collision is UNCHECKED here`);
  } else {
    const keys = WORLD_TO_KEYS[`${probe.input[0]},${probe.input[1]}`];
    gate(!!keys, `probe direction [${probe.input}] maps to keys ${keys ?? "NONE"}`);
    if (keys) {
      const axis = probe.expectedBlockedAxis;
      const before = axis === "z" ? (await pk()).z : (await pk()).x;
      // Ticks are a fixed-step count; a browser holds wall-clock. Hold for well
      // over the equivalent — the clamp is a BOUND, so overshooting the hold
      // only strengthens the claim (asserted in Rust by re-running the probe for
      // ten times its tick count).
      await hold(keys, Math.max(600, Math.ceil((probe.ticks / 60) * 1000) + 400));
      const after = axis === "z" ? (await pk()).z : (await pk()).x;

      const sign = Math.sign(probe.input[axis === "z" ? 1 : 0]);
      const gap = Math.abs(probe.from[axis === "z" ? 1 : 0] - probe.maxAllowedTravel);
      const travelled = (after - before) * sign;
      const overshoot = (after - probe.maxAllowedTravel) * sign;
      gate(
        travelled >= gap / 2,
        `probe travelled ${travelled.toFixed(3)} of a ${gap.toFixed(3)} gap toward the wall ` +
          `at ${axis}=${probe.maxAllowedTravel}`,
      );
      gate(
        overshoot <= 0,
        `the body stopped at ${axis}=${after.toFixed(4)}, ` +
          `${overshoot > 0 ? `${overshoot.toFixed(4)} PAST` : "short of"} the wall face at ` +
          `${probe.maxAllowedTravel} (tile ${probe.wallTile})`,
      );
    }
  }

  // ── The screenshot, and a proof the frame is not blank ──
  //
  // ⚠️ THE OBVIOUS PROBE DOES NOT WORK, and it fails GREEN-ADJACENT: reading the
  // canvas back with `drawImage` + `getImageData` returns a blank buffer for a
  // WebGPU surface, so the first version of this gate reported "1 distinct
  // colour" over a screenshot that plainly shows a maze. It was the SCREENSHOT
  // that settled it, which is the lesson: render the thing and look.
  //
  // What replaces it is a property of the PNG Playwright actually composited.
  // A solid-colour frame at these dimensions encodes to ~1.8 kB (measured, by
  // building one); this floor's frame is ~32 kB. The floor at 8 kB sits an order
  // of magnitude clear of blank and well under the real figure, and it needs no
  // image-decoding dependency.
  await mkdir(join(ROOT, ".checks"), { recursive: true });
  const shot = join(ROOT, ".checks", "real-floor.png");
  const png = await page.screenshot({ path: shot });
  console.log("screenshot:", shot, `(${png.length} bytes)`);
  gate(
    png.length > 8000,
    `the composited frame carries detail (${png.length} bytes; a flat frame this size is ~1800)`,
  );

  console.log(
    `  note  MANUAL: the screenshot must legibly read "REAL FLOOR  L${level} seed=${seed} …` +
      ` provisional  P${f.pass}" below the frame-time readout. This gate proves the banner FLAG ` +
      `is set and that the frame has detail — neither is legibility, and the last two defects ` +
      `this found (the banner drawn over the frame-time text; a tofu box where the default ` +
      `font had no U+00D7) were invisible to both.`,
  );

  // ── THE DESCEND ──
  //
  // The rule the flag exists for is "stand on the exit and the run goes a floor
  // deeper". It is pinned by `ActiveFloor::stands_on_exit` and `FloorPlan`'s
  // advance/restart unit tests, and pk-core publishes the whole shortest path
  // (`routeToExit`) so a harness can drive it.
  //
  // ⚠️ THE DRIVEN VERSION IS NOT A GATE YET, DELIBERATELY. A CDP walker that
  // holds keys along the route arrived on L1 seed 163 (runLevel 2, a different
  // `floorSeed`, the same `runSeed`) and then failed the next run on the same
  // seed: the knight carries momentum, a leg that overshoots leaves the next leg
  // one row off its corridor, and it walks into a wall. A gate that passes on
  // alternate afternoons is worse than no gate — it teaches you to re-run.
  // Fixing it needs per-tile cross-axis correction, which is its own change.
  gate(
    Array.isArray(f.routeToExit) && f.routeToExit.length === f.pathDistance,
    `the exit has a published route to drive (${f.routeToExit?.length ?? "none"} steps)`,
  );

  // ── THE REFUSAL PATH, DRIVEN ──
  //
  // "No silent fallback" is the load-bearing claim of the whole flag, and until
  // it is driven it is a comment. A junk level is the cheapest way to reach it:
  // the request layer refuses, the shell paints a red card, and NO floor is
  // built. A build that quietly showed the demo floor would fail on `floor`
  // being non-null — which is the exact regression this gate exists for.
  const badPage = await page.context().newPage();
  const badErrors = [];
  badPage.on("pageerror", (e) => badErrors.push("PAGEERROR: " + e.message));
  await badPage.goto(
    `http://localhost:${PORT}/index.html?real-floor=1&level=banana&autostart=1&mute=1`,
    { waitUntil: "domcontentloaded", timeout: 60_000 },
  );
  const pkBad = () => badPage.evaluate(() => (window.__pk ? JSON.parse(window.__pk) : null));
  let refused = null;
  for (let i = 0; i < 60 && !refused; i++) {
    await badPage.waitForTimeout(500);
    const s = await pkBad();
    if (s?.floorError) refused = s;
  }
  gate(!!refused, `a junk level is refused (${refused?.floorError ?? "no floorError appeared"})`);
  gate(
    refused ? refused.floor === null : false,
    "the refusal built NO floor — no silent fallback to the demo arena",
  );
  gate(
    refused ? refused.x === undefined : false,
    "the refusal installed no sim, so nothing is walkable behind the card",
  );
  const badShot = join(ROOT, ".checks", "real-floor-refused.png");
  const badPng = await badPage.screenshot({ path: badShot });
  console.log("screenshot:", badShot, `(${badPng.length} bytes)`);
  gate(badPng.length > 3000, `the failure card is painted (${badPng.length} bytes)`);
  gate(badErrors.length === 0, `the refusal did not panic (${badErrors.length} page errors)`);
  for (const e of badErrors.slice(0, 3)) console.log("   ", e.slice(0, 200));
  await badPage.close();
  console.log(
    `  note  MANUAL: real-floor-refused.png must show a RED card reading ` +
      `"REAL FLOOR FAILED / ?level=banana is not a number".`,
  );
}

async function main() {
  if (!noBuild) {
    console.log("building (trunk)...");
    execSync("trunk build", { cwd: ROOT, stdio: "inherit" });
  }
  if (!existsSync(join(DIST, "index.html"))) {
    throw new Error("web/dist/index.html missing — run trunk build");
  }

  const server = createServer(async (req, res) => {
    const path = join(DIST, req.url === "/" ? "index.html" : req.url.split("?")[0]);
    try {
      const body = await readFile(path);
      res.writeHead(200, { "content-type": MIME[extname(path)] ?? "application/octet-stream" });
      res.end(body);
    } catch {
      res.writeHead(404).end();
    }
  }).listen(PORT);

  const { connectRealGpu, closeHostBrowser } = await import(
    "../legacy/scripts/lib/host-chrome.mjs"
  );
  const browser = await connectRealGpu({ log: () => {} });
  const ctx = browser.contexts()[0] ?? (await browser.newContext());
  const page = await ctx.newPage();
  const errors = [];
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  page.on("pageerror", (e) => errors.push("PAGEERROR: " + e.message));

  try {
    if (realFloor) {
      await realFloorGates(page, gate, errors);
      gate(errors.length === 0, `console clean (${errors.length} errors)`);
      for (const e of errors.slice(0, 5)) console.log("   ", e.slice(0, 200));
      return;
    }
    // `autostart=1` alone now lands in the tavern hub (the boot flow is
    // hub-first), so the sim/input gates below ask for a floor explicitly.
    // `mute=1` keeps the harness silent on the host box.
    await page.goto(`http://localhost:${PORT}/index.html?autostart=1&dungeon=1&mute=1`, {
      waitUntil: "domcontentloaded",
      timeout: 60_000,
    });

    // Gate 2 precondition: __pk appears (wasm booted, sim resource live).
    const pk = () => page.evaluate(() => (window.__pk ? JSON.parse(window.__pk) : null));
    let stats = null;
    for (let i = 0; i < 60 && !stats; i++) {
      await page.waitForTimeout(500);
      stats = await pk();
    }
    gate(!!stats, `wasm booted, __pk live ${stats ? `(tick ${stats.tick})` : "(never appeared)"}`);

    if (stats) {
      // WAIT FOR A SIM BEFORE MEASURING ONE. `?dungeon=1` now lands in
      // `FloorLoading`, where the probe's `tick` is a per-publish pulse and not
      // a 60 Hz sim — so a rate sampled across that boundary is measuring two
      // different clocks and reporting the difference as a frequency.
      for (let i = 0; i < 60; i++) {
        if ((await pk())?.x !== undefined) break;
        await page.waitForTimeout(250);
      }
      // Gate: sim ticks at ~60 Hz. Same measurement as the generated-floor
      // gate, and the SAME FUNCTION — see `simRate` for why that matters.
      // ⚠️ I-9 (found 2026-08-12, NOT yet fixed) — THIS GATE IS LOAD-COUPLED.
      //
      // Measured on one unchanged release `web/dist`, minutes apart:
      //   `pk-run.sh --class webgpu --cpus 2`  →  31.1 Hz   RED
      //   `pk-run.sh --class webgpu --cpus 4`  →  68.5 / 65.6 / 68.4 Hz   green
      //
      // 31.1 is not a broken sim, and it is not noise: it is almost exactly half
      // of 60, which is the vsync plateau B2 identified — a frame that overruns
      // the ~15.6 ms present interval is charged a whole extra one, so the app
      // renders at ~32 fps, and the sim tick tracks the FRAME rather than a
      // fixed 60 Hz clock. Starve the box and the tick rate halves with it.
      //
      // So `45 < Hz < 75` conflates "the sim is broken" with "this machine could
      // not render fast enough to keep the sim fed" — the same conflation
      // `pk-baseline.mjs` exists to prevent everywhere else, sitting inside
      // pk-check itself. **Do not widen the band to make it green**; that would
      // hide a genuine stall just as effectively. The repair is the one the
      // comparator already implements: record the grant the run held and report
      // INCONCLUSIVE, not RED, when the box could not supply it.
      //
      // Until then: run this gate at `--cpus 4` or better, and read a red here
      // as "re-run with a real grant" rather than as a defect in the port.
      const rate = await simRate(page, pk);
      gate(rate > 45 && rate < 75, `sim ticking (${rate.toFixed(1)} Hz)`);

      // Gate: input moves the knight (fire plunger first if armed in chute).
      await page.locator("canvas").click().catch(() => {});
      const st0 = await pk();
      if (st0?.plungerArmed) {
        await page.keyboard.down("Space");
        await page.waitForTimeout(400);
        await page.keyboard.up("Space");
        await page.waitForTimeout(800);
      }
      const x0 = (await pk()).x;
      await page.keyboard.down("d");
      await page.waitForTimeout(1000);
      await page.keyboard.up("d");
      const x1 = (await pk()).x;
      gate(Math.abs(x1 - x0) > 0.5, `input drives movement (Δx=${(x1 - x0).toFixed(2)})`);
    }

    // ── Frame cost, and the difference between two numbers that look alike ──
    //
    // ⚠️ THE rAF COUNT BELOW IS A PRESENTED RATE, NOT A COST, AND READING IT AS
    // A COST MISLED THIS PROJECT FOR WEEKS.
    //
    // rAF is driven by the compositor's vsync, so this loop can never report
    // faster than the display refreshes — and everything whose work lands
    // anywhere inside one refresh interval reports the SAME number. Measured on
    // the release Windows exe (2026-08-12): p50 31.23 ms with vsync on against
    // **17.04 ms with `--no-vsync`**. The frame's real work is 17 ms; it
    // overruns a ~15.6 ms present interval by ~1.4 ms and is charged a whole
    // extra one.
    //
    // That is why debug wasm (31.3), release wasm (32.1) and the native exe
    // (31.2) all agreed across two backends, two GPUs and three build profiles.
    // It looked like strong evidence of a shared cost. It was three readings of
    // the same quantiser, and the conclusion drawn from it — "the frame rate is
    // not build-bound" — has been retracted on the status board.
    //
    // So BOTH are printed, labelled, and never conflated: `presented` is what
    // the player's eye gets and is worth watching for stutter; `frame cost` is
    // `__pk.perf`, B2's per-frame accumulator, and is the only number here that
    // can move when the renderer gets faster. The p95 is printed beside the p50
    // because the SPREAD is what named the mechanism in the first place — 0.6 ms
    // between them on a 3090 Ti is a present wait, not work.
    const fps = await page.evaluate(
      () =>
        new Promise((resolve) => {
          let frames = 0;
          const start = performance.now();
          const loop = () => {
            frames++;
            if (performance.now() - start < 3000) requestAnimationFrame(loop);
            else resolve(frames / ((performance.now() - start) / 1000));
          };
          requestAnimationFrame(loop);
        }),
    );
    log(true, `presented: ${fps.toFixed(1)} fps (vsync-quantised — NOT a cost)`);

    const perf = (await pk())?.perf ?? null;
    if (perf && perf.n > 0) {
      // `n` rides along because a percentile over a handful of frames is not a
      // percentile, and a reader who cannot see the count cannot tell a quiet
      // measurement from an empty one.
      log(
        true,
        `frame cost: p50 ${perf.p50?.toFixed(2)} ms · p95 ${perf.p95?.toFixed(2)} ` +
          `· max ${perf.max?.toFixed(2)} (n=${perf.n}, ${perf.build}/${perf.target})`,
      );
      log(
        true,
        `scene: ${perf.entities} entities · ${perf.meshes} meshes · ` +
          `${perf.lights} lights · ${perf.materials} materials · ${perf.uiNodes} ui`,
      );
    } else {
      // Not a gate failure — B2 may predate this build — but it must be VISIBLE,
      // because the alternative is silently falling back to the presented rate
      // and calling it a frame cost, which is the exact confusion above.
      log(true, "frame cost: UNAVAILABLE (__pk.perf absent — B2 not in this build)");
    }

    await mkdir(join(ROOT, ".checks"), { recursive: true });
    const shot = join(ROOT, ".checks", `pk-check-${Date.now()}.png`);
    await page.screenshot({ path: shot });
    console.log("screenshot:", shot);

    // ── Intro gates: a PLAIN load plays the title sequence once ──
    const introPage = await ctx.newPage();
    introPage.on("console", (m) => m.type() === "error" && errors.push(m.text()));
    introPage.on("pageerror", (e) => errors.push("PAGEERROR: " + e.message));
    await introPage.goto(`http://localhost:${PORT}/index.html?mute=1`, {
      waitUntil: "domcontentloaded",
      timeout: 60_000,
    });
    const pkIntro = () =>
      introPage.evaluate(() => (window.__pk ? JSON.parse(window.__pk) : null));
    const seen = [];
    let titleShot = false;
    let handoff = null;
    for (let i = 0; i < 140; i++) {
      await introPage.waitForTimeout(250);
      const s = await pkIntro();
      if (!s) continue;
      if (s.intro && seen[seen.length - 1] !== s.intro) seen.push(s.intro);
      if (s.intro === "title" && !titleShot) {
        titleShot = true;
        const tshot = join(ROOT, ".checks", `pk-intro-title-${Date.now()}.png`);
        await introPage.screenshot({ path: tshot });
        console.log("screenshot:", tshot);
      }
      // Finished: the intro handed off and the hub is live.
      //
      // ⚠️ **TWO EVENTS, NOT ONE — and taking one sample at the first of them
      // is a race the release build loses.** `intro === null` means the intro
      // STATE has ended; `TavernRes` is created by a lazy `Update` setup system
      // (OnEnter outruns Startup — see `intro.rs`), so the room exists a frame
      // or two later. On a debug build the 250 ms poll was slow enough that
      // both had happened by the time it looked, and the gate passed by luck.
      // The first release build ever put through this harness failed BOTH
      // `intro hands off to the tavern hub` and `tavern probe carries a pose
      // (no probe)` — one race, reported as two defects in the shipped
      // artefact.
      //
      // So: wait for the room, do not sample for it. Bounded, so a hub that
      // genuinely never builds still FAILS — and `handoff` keeps the last
      // sample either way, so the failure names what it actually saw instead
      // of "no probe".
      if (s.intro === null && seen.length) {
        handoff = s;
        if (s.tavern !== null) break;
        for (let j = 0; j < 40 && handoff.tavern === null; j++) {
          await introPage.waitForTimeout(250);
          handoff = (await pkIntro()) ?? handoff;
        }
        break;
      }
    }
    gate(seen.length >= 3, `intro plays through phases (${seen.join(" → ") || "never seen"})`);
    gate(titleShot, "intro reached the title card");
    // Hub-first: the title sequence hands you the TAVERN, not a floor. `tick`
    // keeps advancing without a sim (publish_stats synthesises it), so
    // liveness alone would pass over a black screen — the probe shape is what
    // proves a room actually built.
    gate(
      !!handoff && handoff.tavern !== null && handoff.tick > 0,
      "intro hands off to the tavern hub",
    );
    gate(
      typeof handoff?.tavern?.x === "number",
      `tavern probe carries a pose (${handoff?.tavern ? `x ${handoff.tavern.x.toFixed(2)}` : "no probe"})`,
    );
    await introPage.close();

    // ── Skip gate: a click ends the intro immediately ──
    const skipPage = await ctx.newPage();
    skipPage.on("console", (m) => m.type() === "error" && errors.push(m.text()));
    skipPage.on("pageerror", (e) => errors.push("PAGEERROR: " + e.message));
    await skipPage.goto(`http://localhost:${PORT}/index.html?mute=1`, {
      waitUntil: "domcontentloaded",
      timeout: 60_000,
    });
    const pkSkip = () =>
      skipPage.evaluate(() => (window.__pk ? JSON.parse(window.__pk) : null));
    let sawIntro = false;
    for (let i = 0; i < 120 && !sawIntro; i++) {
      await skipPage.waitForTimeout(250);
      sawIntro = !!(await pkSkip())?.intro;
    }
    await skipPage.mouse.click(400, 300);
    let skipped = null;
    for (let i = 0; i < 16 && !skipped; i++) {
      await skipPage.waitForTimeout(250);
      const s = await pkSkip();
      if (s && s.intro === null && s.tavern !== null) skipped = s;
    }
    gate(sawIntro && !!skipped, "a click skips the intro into the tavern");
    await skipPage.close();

    // ── Tavern gates: ?tavern=1 boots the walkable hub (P6) ──
    // Drives the room from outside via __pk.tavern (the legacy __tavernProbe
    // surface): movement, station focus, the summary panel, and the DESCEND
    // hand-off into a fresh dungeon floor.
    const tavPage = await ctx.newPage();
    tavPage.on("console", (m) => m.type() === "error" && errors.push(m.text()));
    tavPage.on("pageerror", (e) => errors.push("PAGEERROR: " + e.message));
    await tavPage.goto(`http://localhost:${PORT}/index.html?tavern=1&mute=1`, {
      waitUntil: "domcontentloaded",
      timeout: 60_000,
    });
    const pkTav = () => tavPage.evaluate(() => (window.__pk ? JSON.parse(window.__pk) : null));
    /* ── I-8: POLL FOR A, THEN SAMPLE B ONCE — THE FOURTH INSTANCE ────────
     *
     * `pollTav` waits for the TAVERN's opinion (`panel === false`) and then
     * the next line took ONE reading of the GUI layer's (`gui.open`). Those
     * are published by different systems on different frames, so the read can
     * land before the layer has caught up. Measured 2026-08-12 on the release
     * build: *the prompt comes back when the sheet closes* failed 1 run in 3,
     * reading `open=0` where two other runs read 1.
     *
     * It is the FOURTH time this exact shape has been repaired here, and the
     * previous three were each fixed at ONE call site — which is why there was
     * a fourth. So this is a helper, and every poll-then-read pair in the
     * tavern block goes through it.
     *
     * The rule: never assert on a sample that could pre-date the thing it is
     * meant to observe. `untilFresh` only ever inspects states published
     * strictly AFTER it was called (`tick` advances once per publish, and in
     * the tavern there is no Sim so a tick IS a publish), and it keeps looking
     * until the predicate holds or the deadline passes.
     *
     * It stays FALSIFIABLE: on timeout it returns the last state it actually
     * saw, so a genuinely broken app fails the gate on its real value rather
     * than hanging or silently passing. A helper that waited forever, or that
     * synthesised a passing value, would be the opposite of this repair.
     */
    const freshState = async (timeoutMs = 1500) => {
      const before = (await pkTav())?.tick;
      const deadline = Date.now() + timeoutMs;
      let last = null;
      while (Date.now() < deadline) {
        last = await pkTav();
        if (last && last.tick !== before) return last;
        await tavPage.waitForTimeout(16);
      }
      return last ?? (await pkTav());
    };
    const untilFresh = async (done, ms = 2500) => {
      const deadline = Date.now() + ms;
      let last = null;
      while (Date.now() < deadline) {
        last = await freshState(Math.max(200, deadline - Date.now()));
        if (last && done(last)) return last;
      }
      return last;
    };

    let tav = null;
    for (let i = 0; i < 60 && !tav; i++) {
      await tavPage.waitForTimeout(500);
      tav = (await pkTav())?.tavern ?? null;
    }
    gate(!!tav, `tavern boots via ?tavern=1 ${tav ? `(spawn ${tav.x.toFixed(1)}, ${tav.z.toFixed(1)})` : "(probe never appeared)"}`);

    if (tav) {
      const hold = async (keys, ms) => {
        await tavPage.locator("canvas").click().catch(() => {});
        for (const k of keys) await tavPage.keyboard.down(k);
        await tavPage.waitForTimeout(ms);
        // Release EVERY movement key, not just the ones this hold pressed: a
        // dropped keyup under CDP leaves a phantom key held and every later
        // leg walks diagonally — observed as the closed-loop walk sailing
        // back into the table's radius.
        for (const k of ["w", "a", "s", "d"]) await tavPage.keyboard.up(k);
        await tavPage.waitForTimeout(60);
      };
      // Walk due north (screen up-right) from the spawn: crosses the room's
      // spine and stops against the central table — movement + collision.
      const z0 = tav.z;
      await hold(["w", "d"], 1100);
      // I-8, third site. The distance gate would survive a stale pose — 1100 ms
      // of walking clears a 2-unit threshold either way — but `focus` is derived
      // from the position, so a sample from before the knight arrived reports
      // the station it was walking AWAY from. Wait for the arrival to be
      // published rather than reading whatever was last put out.
      const afterWalk = (await untilFresh((s) => s?.tavern?.z < z0 - 2))?.tavern ?? (await pkTav()).tavern;
      gate(afterWalk.z < z0 - 2, `tavern input drives movement (Δz=${(afterWalk.z - z0).toFixed(2)})`);
      gate(afterWalk.focus === "table", `station focus fires at the central table (focus=${afterWalk.focus})`);

      // The run summary: E opens it (movement freezes), Escape closes it.
      // Poll rather than single-read: the probe publishes on a frame cadence.
      const pollTav = async (done, ms = 2500) => {
        const t0 = Date.now();
        let p = null;
        while (Date.now() - t0 < ms) {
          p = (await pkTav())?.tavern ?? null;
          if (p && done(p)) return p;
          await tavPage.waitForTimeout(150);
        }
        return p;
      };

      await tavPage.keyboard.press("e");
      const withPanel = await pollTav((p) => p.panel === true);
      gate(withPanel?.panel === true, "E opens the run summary panel");

      // ── The GUI layer, while a sheet is up ──
      //
      // `panel === true` is the TAVERN's opinion. These are the layer's: it ran,
      // it painted, and it owns the keyboard. A menu that never ran and a menu
      // that ran and was composited away are the same black screen, so both
      // counters are asserted rather than either one.
      // I-8: wait for the LAYER to agree the sheet is up, rather than reading it
      // once because the TAVERN already said so.
      const guiUp = (await untilFresh((s) => s?.gui?.open === 1 && s?.gui?.pauses === true))?.gui ?? null;
      gate(!!guiUp, "the GUI layer is live");
      gate(guiUp?.painted > 0, `the GUI painted frames (${guiUp?.painted})`);
      // THE SKIP, AS A NUMBER. Immediate mode rebuilds the widgets every pass;
      // it must not repaint the PIXELS every pass. Repainting unconditionally
      // took the tavern from 36 fps to 14, and the way that surfaced was the
      // walk below missing its lane — the probe publishes every 5 frames, so at
      // 14 fps it hands back a position 357 ms old and every leg overshoots.
      // A ratio near 1.0 means the skip is dead again.
      console.log(
        `  note  GUI repainted ${guiUp?.painted} of ${guiUp?.frames} driven frames ` +
          `(${((100 * guiUp?.painted) / Math.max(1, guiUp?.frames)).toFixed(0)}%)`,
      );
      gate(
        guiUp?.frames > 0 && guiUp.painted / guiUp.frames < 0.5,
        `the layer skips quiet frames (${guiUp?.painted}/${guiUp?.frames})`,
      );
      // EXACTLY one. The prompt is not stacked under the sheet — legacy hides
      // the contextual line while a panel is up (`frozen` kills the focus), and
      // the port keeps that: a "[E] TABLE" prompt behind an open summary is an
      // offer you cannot take.
      gate(
        guiUp?.open === 1,
        `the sheet replaced the prompt rather than stacking on it (open=${guiUp?.open})`,
      );
      gate(guiUp?.pauses === true, "an open sheet takes the keyboard");
      // The painter is the pixel LATTICE, never the window: a menu on its own
      // grid would upscale fractionally and read as "the game is blurry".
      const lattice = await tavPage.evaluate(
        () => window.innerWidth + "x" + window.innerHeight,
      );
      console.log(`  note  GUI painter ${guiUp?.w}x${guiUp?.h}, window ${lattice}`);
      const sheetShot = join(ROOT, ".checks", "tavern-run-summary.png");
      await tavPage.screenshot({ path: sheetShot });
      console.log("screenshot:", sheetShot);
      console.log(
        "  note  MANUAL: tavern-run-summary.png must show the RUN SUMMARY sheet — " +
          "scrim, riveted panel, 16px arcane heading, six labelled rows with rules " +
          "under them, and a CLOSE button — NOT a paragraph of plain text on a " +
          "flat rectangle.",
      );

      await tavPage.keyboard.press("Escape");
      const noPanel = await pollTav((p) => p.panel === false);
      gate(noPanel?.panel === false, "Escape closes the panel");
      // ⚠️ I-8 ITSELF. This pair is the gate that failed 1 run in 3: `pollTav`
      // returned the moment the TAVERN said `panel === false`, and the GUI
      // layer re-registers the contextual prompt on a LATER frame. Waiting for
      // the layer's own state to settle is the whole fix.
      const guiDown =
        (await untilFresh((s) => s?.gui?.pauses === false && s?.gui?.open === 1))?.gui ?? null;
      gate(
        guiDown?.pauses === false,
        "closing the sheet hands the keyboard back",
      );
      gate(
        guiDown?.open === 1,
        `the prompt comes back when the sheet closes (open=${guiDown?.open})`,
      );

      // Route to the DESCEND board: west along the table's flank, north up
      // the west lane, then east into the corridor between the board and the
      // table. CLOSED-LOOP on the probe's pose — key-hold timing under CDP is
      // not tick-exact and the post-release slide drifts, so each leg walks
      // until the coordinate says it arrived. (Key mapping: due north = W+D,
      // east = S+D, west = W+A on the 45° screen basis.)
      //
      // ⚠️ THE HOLD LENGTH IS A TOLERANCE, NOT A SPEED. The probe publishes every
      // five frames, so each check reads a pose up to that far in the past and
      // the leg overshoots by whatever the knight covered meanwhile. At 260 ms
      // the north leg ran 1.4 units past its lane and every later leg was inside
      // the wall behind the DESCEND board — which reads as "the room changed",
      // not as "the harness steps too coarsely". 140 ms halves the overshoot and
      // the correction below absorbs the rest.
      // ⚠️ **AND SHORTENING THE LEG WAS A MITIGATION, NOT A FIX.** The comment
      // above is right about the cause and stops one step short of it: the
      // probe publishes every FIVE frames, which at the release build's ~32 fps
      // is **156 ms**, against a **140 ms** leg. The feedback sample is older
      // than the control step, so the loop is marginal by construction and
      // whether it converges is a matter of phase luck. Measured on five
      // release runs of this gate: **four green, one red** — the north leg
      // overshooting into the wall behind the board, reported as three failed
      // gates and reading like "the room changed".
      //
      // The repair is the same one B2 is built around and the same one the
      // intro-handoff gate just took: **do not sample, wait for a fresh
      // sample.** `freshPose` returns a pose published strictly AFTER the
      // moment it is called, so a reading can never pre-date the leg that
      // produced it. In the tavern there is no `Sim`, so `publish_stats`
      // advances `tick` once per PUBLISH — which makes `tick` changing the
      // exact "a new sample exists" signal this needs.
      //
      // Bounded, and it falls back to whatever it has rather than hanging: a
      // stalled probe must fail the gate it feeds, not the whole run.
      // Now one line, because `freshState` above IS this — the walk gate and the
      // GUI gates were solving the same problem twice, which is how the second
      // one came to be missing.
      const freshPose = async (timeoutMs = 800) => (await freshState(timeoutMs))?.tavern;
      const walkUntil = async (keys, done, maxSteps = 40, ms = 140) => {
        let p = await freshPose();
        for (let i = 0; i < maxSteps; i++) {
          if (!p || done(p)) return p;
          await hold(keys, ms);
          p = await freshPose();
        }
        return p;
      };
      const leg = (name, p) =>
        console.log(`  note  leg ${name}: x=${p?.x?.toFixed(2)} z=${p?.z?.toFixed(2)} focus=${p?.focus}`);
      leg("start", (await pkTav()).tavern);
      leg("west", await walkUntil(["w", "a"], (p) => p.x <= -4.4)); // west, clear of the table
      leg("north", await walkUntil(["w", "d"], (p) => p.z <= -4.4)); // north up the west lane
      // The corridor east is a BAND, not a line: the board sits at z -4.9 with a
      // 1.6 radius, and the wall behind it starts just past that. An overshot
      // north leg puts the east leg inside it, so come back south first.
      leg("correct", await walkUntil(["s", "a"], (p) => p.z >= -5.0, 12));
      let atBoard = await walkUntil(["s", "d"], (p) => p.focus === "board" || p.x > 1.4); // east into the corridor
      leg("east", atBoard);
      if (atBoard?.focus !== "board") {
        // Overshot east past the radius — walk back west until it catches.
        atBoard = await walkUntil(["w", "a"], (p) => p.focus === "board", 10);
      }
      gate(atBoard?.focus === "board", `reached the DESCEND board on foot (focus=${atBoard?.focus})`);

      const tavShot = join(ROOT, ".checks", `pk-tavern-${Date.now()}.png`);
      await tavPage.screenshot({ path: tavShot });
      console.log("screenshot:", tavShot);

      // The plunger: E on the board tears the tavern down and builds a
      // fresh dungeon floor — the real hand-off.
      await tavPage.keyboard.press("e");
      let descended = null;
      for (let i = 0; i < 20 && !descended; i++) {
        await tavPage.waitForTimeout(250);
        const s = await pkTav();
        if (s && s.tavern === null && s.x !== undefined) descended = s;
      }
      gate(!!descended, "DESCEND hands off to a live dungeon sim");
      // ⚠️ THE GUI STACK IS GLOBAL AND THE SCENES ARE NOT. The prompt and the
      // panels used to be `Text` nodes tagged with the tavern's scene marker, so
      // despawning the room took them; as screens they outlive it, and the first
      // build after the port put "[E] DESCEND" over the dungeon floor. Caught by
      // LOOKING at a screenshot — every gate above was green through it.
      gate(
        descended?.gui?.open === 0,
        `the tavern's screens do not follow you down the stairs (open=${descended?.gui?.open})`,
      );
    }
    await tavPage.close();

    // Gate 1: no console/page errors across everything above.
    gate(errors.length === 0, `console clean (${errors.length} errors)`);
    for (const e of errors.slice(0, 5)) console.log("   ", e.slice(0, 200));
  } finally {
    closeHostBrowser();
    server.close();
  }
}

/* ── --repeat N: THE STREAK, AS A COMMAND RATHER THAN A DISCIPLINE ──────────
 *
 * The standing rule in docs/src/status/one-to-one-route.md §7 is:
 *
 *   "Until pk-check runs green three times consecutively on one unchanged
 *    web/dist, a red run is not evidence about the port."
 *
 * That rule was written down and then had to be REMEMBERED, which is the same
 * failure mode as a number that lives only in prose. `--repeat 3` makes it
 * something you can run and something CI could own.
 *
 * Two things it must do that a shell `for` loop would not:
 *
 *  1. PIN THE BUILD. The whole claim is "on one unchanged web/dist". The digest
 *     is taken before the first run and again after the last, and a change
 *     between them voids the streak — otherwise a rebuild in another terminal
 *     turns three runs of two different binaries into one green streak.
 *  2. SPAWN, not loop in-process. `failed` is module state, the static server
 *     binds a fixed port and the host browser is reused; re-entering `main()`
 *     would carry all three between runs, so run 2 would inherit run 1's
 *     failures and the streak would be meaningless in the flattering direction.
 */
async function repeatDriver(n) {
  const { createHash } = await import("node:crypto");
  const { readdirSync, statSync, readFileSync, writeFileSync, mkdirSync } = await import("node:fs");
  const { spawnSync } = await import("node:child_process");

  const distDigest = () => {
    const root = join(ROOT, "web/dist");
    const h = createHash("sha256");
    const walk = (d) => {
      for (const e of readdirSync(d).sort()) {
        const p = join(d, e);
        if (statSync(p).isDirectory()) walk(p);
        else h.update(e).update(readFileSync(p));
      }
    };
    walk(root);
    return h.digest("hex");
  };

  const before = distDigest();
  console.log(`pk-check --repeat ${n} over web/dist ${before.slice(0, 12)}\n`);
  const args = process.argv.slice(2).filter((x) => x !== "--repeat" && x !== String(n));
  // --no-build is forced: a rebuild between runs is the exact thing the digest
  // exists to detect, so the driver must not cause one itself.
  if (!args.includes("--no-build")) args.push("--no-build");

  const runs = [];
  for (let i = 1; i <= n; i++) {
    console.log(`\n════════ run ${i}/${n} ════════`);
    const r = spawnSync(process.execPath, [process.argv[1], ...args], { stdio: "inherit" });
    runs.push({ run: i, status: r.status ?? 2, at: new Date().toISOString() });
  }

  const after = distDigest();
  const green = runs.filter((r) => r.status === 0).length;
  const stable = before === after;
  const out = {
    schema: 1,
    instrument: "pk-check",
    distSha256Before: before,
    distSha256After: after,
    unchanged: stable,
    wanted: n,
    green,
    runs,
  };
  mkdirSync(join(ROOT, ".checks"), { recursive: true });
  writeFileSync(join(ROOT, ".checks/pk-check-streak.json"), JSON.stringify(out, null, 2) + "\n");

  console.log(`\n════════ streak ════════`);
  console.log(`  ${green}/${n} green on web/dist ${before.slice(0, 12)}`);
  if (!stable) {
    // NOT a pass and NOT a fail: the premise of the measurement was broken.
    console.log(`  VOID — web/dist changed mid-streak (${after.slice(0, 12)}). Not evidence.`);
    process.exit(3);
  }
  if (green === n) {
    console.log(`  THE STREAK HOLDS. A red run is now evidence about the port.`);
    process.exit(0);
  }
  console.log(`  ${n - green} run(s) failed — the gate is not yet trustworthy (I-8).`);
  process.exit(1);
}

const repeatIdx = process.argv.indexOf("--repeat");
if (repeatIdx !== -1) {
  const n = Number(process.argv[repeatIdx + 1] ?? 3);
  if (!Number.isInteger(n) || n < 1) {
    console.error("--repeat wants an integer >= 1");
    process.exit(2);
  }
  repeatDriver(n);
} else {
  main()
    .then(() => {
      console.log(
        failed === 0 ? "\npk-check: ALL GATES PASSED" : `\npk-check: ${failed} GATE(S) FAILED`,
      );
      process.exit(failed === 0 ? 0 : 1);
    })
    .catch((e) => {
      console.error("pk-check harness error:", e.message);
      process.exit(2);
    });
}
