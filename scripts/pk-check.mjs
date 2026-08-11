#!/usr/bin/env node
/**
 * pk-check — the port's browser verification gate.
 *
 * Loads the wasm build in REAL Windows host Chrome over CDP (SwiftShader
 * cannot run this app — see docs Incidents) and verifies, from outside:
 *   1. zero console errors / page errors (a wasm panic fails the run)
 *   2. the sim ticks (~60 Hz) via the window.__pk debug surface
 *   3. scripted input moves the knight (__pk.x advances under 'd')
 *   4. render FPS over a 3 s rAF sample (reported; budget-gated later)
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
  //
  // SETTLE FIRST, then a long window. Bevy's fixed timestep runs CATCH-UP steps
  // to drain accumulated lag, and building an 87×61 floor in a debug wasm build
  // is a stall worth draining — the first version of this gate measured a
  // 2 s window immediately after boot and read 76 Hz on a 60 Hz sim, which is
  // the drain, not the rate. One second of settle and three of window.
  await page.waitForTimeout(1000);
  const t0 = (await pk()).tick;
  const w0 = Date.now();
  await page.waitForTimeout(3000);
  const t1 = (await pk()).tick;
  const rate = ((t1 - t0) / (Date.now() - w0)) * 1000;
  gate(rate > 45 && rate < 75, `sim ticking on the generated floor (${rate.toFixed(1)} Hz)`);

  const hold = async (keys, ms) => {
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
      // Gate: sim ticks at ~60 Hz.
      const t0 = (await pk()).tick;
      await page.waitForTimeout(2000);
      const t1 = (await pk()).tick;
      const rate = (t1 - t0) / 2;
      gate(rate > 45 && rate < 75, `sim ticking (${rate.toFixed(0)} Hz)`);

      // Gate: input moves the knight.
      const x0 = (await pk()).x;
      await page.keyboard.down("d");
      await page.waitForTimeout(1000);
      await page.keyboard.up("d");
      const x1 = (await pk()).x;
      gate(Math.abs(x1 - x0) > 0.5, `input drives movement (Δx=${(x1 - x0).toFixed(2)})`);
    }

    // FPS over a 3 s rAF sample (report always; budget can gate later).
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
    log(true, `render FPS: ${fps.toFixed(1)}`);

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
      if (s.intro === null && seen.length) {
        handoff = s;
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
    let tav = null;
    for (let i = 0; i < 60 && !tav; i++) {
      await tavPage.waitForTimeout(500);
      tav = (await pkTav())?.tavern ?? null;
    }
    gate(!!tav, `tavern boots via ?tavern=1 ${tav ? `(spawn ${tav.x.toFixed(1)}, ${tav.z.toFixed(1)})` : "(probe never appeared)"}`);

    if (tav) {
      const hold = async (keys, ms) => {
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
      const afterWalk = (await pkTav()).tavern;
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
      const guiUp = (await pkTav())?.gui ?? null;
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
      const guiDown = (await pkTav())?.gui ?? null;
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
      const walkUntil = async (keys, done, maxSteps = 40, ms = 140) => {
        for (let i = 0; i < maxSteps; i++) {
          const p = (await pkTav()).tavern;
          if (!p || done(p)) return p;
          await hold(keys, ms);
        }
        return (await pkTav()).tavern;
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
