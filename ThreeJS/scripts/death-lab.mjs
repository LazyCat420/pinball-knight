#!/usr/bin/env node
/**
 * DEATH LAB — watch a monster die, on a real GPU, and prove what the screen
 * actually showed.
 *
 * ── WHY THIS EXISTS ─────────────────────────────────────────────────────────
 *
 * "The death animation doesn't play" is a claim about PIXELS, and every cheap
 * way to check it answers a different question:
 *
 *   - a unit test on `Animator` proves the INDEX advances (0,1,2,3) — it can
 *     say nothing about which cel those indices point at, or whether the atlas
 *     even holds four distinct ones;
 *   - a single screenshot proves one instant, and a 4-frame clip at 6 fps is
 *     over in 0.67 s, so a still lands between the frames it was meant to catch;
 *   - the node/canvas harnesses build their OWN atlas, so they cannot see a
 *     disagreement between what the browser packed and what the animator plays.
 *
 * So this drives the REAL game in a REAL browser on the HOST GPU: spawn one
 * monster, kill it through the ordinary damage path, then sample — every
 * ~60 ms — the animator's clip/frame, the frame the TEXTURE is actually
 * sampling (decoded back out of the live UV offset), and a cropped screenshot
 * of the actor. The contact sheet at the end is the artefact a human reads.
 *
 *   node scripts/death-lab.mjs                     # goblin
 *   node scripts/death-lab.mjs --kind hound
 *   node scripts/death-lab.mjs --all               # every kind, PASS/FAIL table
 *   node scripts/death-lab.mjs --kill ram          # kill by pinball ram
 *   node scripts/death-lab.mjs --url https://pinballknight.braindeadbot.com/
 *
 * Requirements, exactly as scripts/README.md describes for the fx captures:
 * `playwright` and `canvas` (playwright is capture-only and deliberately not in
 * package.json), a server at --url, and a HOST browser reachable over CDP. The
 * game is WebGPU-only and WSL's llvmpipe is not a GPU, so the host browser is
 * not optional here.
 *
 * PASS, per kind: the atlas holds more than one distinct death cel, the
 * TEXTURE reached the last of them, and it stayed there (a death that loops is
 * a resurrection).
 */
import { chromium } from "playwright";
import { parseArgs } from "node:util";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createCanvas, loadImage } from "canvas";

const { values: a } = parseArgs({
  options: {
    url: { type: "string", default: "http://localhost:5174/" },
    "cdp-port": { type: "string", default: process.env.BDB_CDP_PORT ?? "9345" },
    kind: { type: "string", default: "goblin" },
    /** Every kind in the roster, one after another. */
    all: { type: "boolean", default: false },
    /** `force` = the ordinary damage path via __dungeonKill; `ram` = pinball it. */
    kill: { type: "string", default: "force" },
    /** Samples taken after the killing blow. 24 × ~60 ms ≈ 1.4 s of death. */
    frames: { type: "string", default: "24" },
    /** Crop half-width around the actor, in screen px. */
    crop: { type: "string", default: "70" },
    /**
     * Serve this PNG in place of the kind's published sheet — the stale
     * browser cache, reproduced. `/sprites/*.png` ships `immutable, max-age=1y`
     * (nginx.conf) and most manifests carry no `hash`, so a returning player
     * pairs a FRESH sidecar with a YEAR-OLD image and the game cuts the new
     * rects out of the old art. See versioned() in render/imported-paints.ts.
     */
    "stale-image": { type: "string" },
    out: { type: "string", default: ".death-lab" },
    headed: { type: "boolean", default: false },
  },
});

const PORT = Number(a["cdp-port"]);
const FRAMES = Number(a.frames);
const CROP = Number(a.crop);
const WIN_CHROME = [
  "/mnt/c/Program Files/Google/Chrome/Application/chrome.exe",
  "/mnt/c/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  "/mnt/c/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
];
const log = (...m) => console.log(...m);

async function cdpAlive(port) {
  try {
    const r = await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(1500) });
    return r.ok;
  } catch {
    return false;
  }
}

/** The host GPU browser. Same contract as scripts/fx-shot.mjs. */
async function connectHostGpu() {
  if (await cdpAlive(PORT)) {
    log(`▶ reusing CDP browser on :${PORT}`);
    return chromium.connectOverCDP(`http://127.0.0.1:${PORT}`, { timeout: 120_000 });
  }
  const exe = WIN_CHROME.find((p) => existsSync(p));
  if (!exe) return null;
  const p = spawn(
    exe,
    [
      a.headed ? "--new-window" : "--headless=new",
      "--mute-audio",
      `--remote-debugging-port=${PORT}`,
      "--remote-allow-origins=*",
      "--user-data-dir=C:\\Temp\\pk-death-lab",
      "--no-first-run",
      "--no-default-browser-check",
      "--enable-unsafe-webgpu",
      "--enable-features=Vulkan",
      "about:blank",
    ],
    { detached: true, stdio: "ignore" },
  );
  p.unref();
  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 500));
    if (await cdpAlive(PORT)) return chromium.connectOverCDP(`http://127.0.0.1:${PORT}`, { timeout: 120_000 });
  }
  return null;
}

const browser = await connectHostGpu();
if (!browser) {
  console.error("✖ No host browser found — WebGPU is not reachable from WSL2 without one.");
  process.exit(2);
}
const ctx = browser.contexts()[0] || (await browser.newContext());
const page = await ctx.newPage();
await page.setViewportSize({ width: 1280, height: 720 });
// The dev server does not define `process`; a bare module-scope read of it kills
// the whole bundle before main.ts runs. Harmless against a built bundle.
await page.addInitScript(() => {
  if (typeof window.process === "undefined") window.process = { env: {} };
});
page.on("pageerror", (e) => console.log("[pageerror]", String(e.message).slice(0, 160)));
if (a["stale-image"]) {
  const body = readFileSync(a["stale-image"]);
  await page.route(`**/sprites/${a.kind}-*.png*`, (route) =>
    route.fulfill({ status: 200, contentType: "image/png", body }),
  );
  log(`▶ serving ${a["stale-image"]} as the ${a.kind} sheet (stale-cache simulation)`);
}

const url = new URL(a.url);
url.searchParams.set("gpu", "webgpu");
url.searchParams.set("no-intro", "1");
url.searchParams.set("seed", "777");
log(`▶ ${url}`);
await page.goto(url.toString(), { waitUntil: "domcontentloaded" });
await page.waitForFunction(() => typeof window.__dungeonStartRun === "function", null, { timeout: 60_000 });
await page.evaluate(() => window.__dungeonStartRun());
await page.waitForFunction(() => window.__dungeonPlayer?.()?.active === true, null, { timeout: 90_000 });
// The character-select modal opens over the running floor and hides the whole
// stage. The sim keeps ticking behind it, so a trace still reads correctly —
// and every screenshot is a photograph of the menu. Dismiss it.
await page.evaluate(() => {
  for (let i = 0; i < 4; i++) window.__gui?.close?.();
});
// Imported art lands AFTER the first playable frame (boot/sheets.ts explains
// why) and every atlas here is one of its rebuilds. Sampling before it resolves
// measures the PAINTER, which is a different creature.
await page.waitForTimeout(20_000);

// ⚠️ rAF is what steps the animator, and a page whose rAF is throttled reports
// a frozen animation that is really a frozen PAGE. This harness has already
// been fooled by it once. Prove the clock runs before trusting anything below.
const ticked = await page.evaluate(async () => {
  const t0 = await new Promise((r) => requestAnimationFrame(r));
  const t1 = await new Promise((r) => requestAnimationFrame(r));
  return t1 - t0;
});
if (!(ticked > 0)) {
  console.error("✖ rAF is not running on this page — every animation would read as frozen.");
  process.exit(3);
}
log(`▶ rAF alive (${ticked.toFixed(1)} ms between frames)`);

mkdirSync(a.out, { recursive: true });

const kinds = a.all ? await page.evaluate(() => window.__lab.kinds()) : [a.kind];
const results = [];
for (const kind of kinds) {
  try {
    results.push(await runKind(kind));
  } catch (e) {
    log(`✖ ${kind}: threw ${String(e.message).slice(0, 120)}`);
    results.push({ kind, pass: false, why: `threw: ${String(e.message).slice(0, 80)}` });
  }
}

log("\n── DEATH ANIMATION ────────────────────────────────────────────");
for (const r of results) log(`${r.pass ? "✔" : r.unkilled ? "⚠" : "✖"} ${r.kind.padEnd(13)} ${r.why}`);
const unkilled = results.filter((r) => r.unkilled);
const bad = results.filter((r) => !r.pass && !r.unkilled);
const judged = results.length - unkilled.length;
log(`\n${judged - bad.length}/${judged} kinds that ACTUALLY DIED play a death animation. Sheets in ${a.out}/`);
if (unkilled.length) {
  log(`⚠ ${unkilled.length} kind(s) never died under --kill ${a.kill}, so their art was not judged: ${unkilled.map((r) => r.kind).join(", ")}`);
}
await page.close();
await browser.close();
process.exit(bad.length ? 1 : 0);

/** Spawn one, kill it, sample the death, write the contact sheet. */
async function runKind(kind) {
  await page.evaluate(({ k }) => {
    window.__dungeonDebug({ god: true });
    window.__lab.only(k, 1);
  }, { k: kind });
  await page.waitForTimeout(1200);

  // The ATLAS first: an animation that steps four indices pointing at four
  // copies of one cel is exactly the failure this exists to catch, and no
  // amount of index tracing can see it.
  const cels = await page.evaluate((k) => window.__dungeonClipCels(k), kind);
  const atlas = cels ? await loadImage(cels.atlas) : null;

  if (a.kill === "ram") {
    // A pinball kill is the way this game is actually played, and one launch
    // is not a kill: the knight has to CONNECT, and a goblin is a bumper that
    // shrugs off a slow poke. Re-aim and re-launch until the actor is dead or
    // the attempts run out — then sample from the blow that landed.
    //
    // ⚠️ THIS TRIGGER IS UNRELIABLE PAST THE FIRST KIND, and the `--all` table
    // is what exposed it: kind 1 dies, kinds 2..28 walk through the whole
    // sample window alive, and the old verdict printed that as a
    // death-animation failure — 26 false reds, on a build whose deaths were
    // verified working by every other measurement. The `NEVER DIED` verdict
    // below now separates the two claims, so a trigger that misses can no
    // longer be read as art that does not play. (A ram kill DOES work; drive
    // one kind at a time, or use `--kill force`.)
    for (let i = 0; i < 30; i++) {
      const dead = await page.evaluate(() => {
        const z = window.__dungeonAnim()[0];
        const p = window.__dungeonPlayer();
        if (!z || !p) return true;
        if (z.mode === "dead") return true;
        window.__dungeonLaunch(z.x - p.x, z.z - p.z, 16);
        return false;
      });
      if (dead) break;
      await page.waitForTimeout(100);
    }
  } else {
    await page.evaluate((k) => window.__dungeonKill(k, 1), kind);
  }

  // ── THE ACTOR'S OWN DEATH ROW, NOT THE KIND'S ──
  //
  // `S:death` off the kind's atlas is the wrong list for anything wearing a
  // BORROWED sheet: the reaper is a brute under the hood on the boss atlas, so
  // its death cels are 50-53 while this kind's `S:death` reads 12-15. That
  // mismatch printed the roster's only ✖ — a probe defect wearing a monster's
  // name. The dying actor knows which indices it plays; ask it, and keep the
  // kind's row as the fallback for a spawn that never reached the death clip.
  const dying = (await page.evaluate(() => window.__dungeonAnim()))[0] ?? null;
  if (!dying || (dying.mode !== "dead" && dying.animState === "alive")) {
    // The trigger did not land. Saying anything about the death animation from
    // here would be measuring an IDLE cycle and calling it a corpse.
    const why = `NEVER DIED — the ${a.kill} trigger did not land (hp ${dying?.hp ?? "?"}, clip ${dying?.clip ?? "?"}); says NOTHING about the death animation`;
    log(`⚠ ${kind}: ${why}`);
    await page.evaluate(() => window.__dungeonClear());
    return { kind, pass: false, unkilled: true, why };
  }
  const deathIdx =
    dying?.clip === "death" && dying.indices?.length ? dying.indices : cels?.clips["S:death"] ?? [];
  const distinct = atlas ? countDistinct(atlas, cels, deathIdx) : 0;

  const shots = [];
  const trace = [];
  for (let i = 0; i < FRAMES; i++) {
    const row = (await page.evaluate(() => window.__dungeonAnim()))[0] ?? null;
    trace.push(row);
    if (row?.screen) {
      shots.push(
        await page.screenshot({
          clip: {
            x: Math.max(0, Math.round(row.screen.x - CROP)),
            y: Math.max(0, Math.round(row.screen.y - CROP * 1.4)),
            width: CROP * 2,
            height: CROP * 2,
          },
        }),
      );
    }
    await page.waitForTimeout(60);
  }

  const seen = [...new Set(trace.filter(Boolean).map((r) => r.texFrame))];
  const last = deathIdx[deathIdx.length - 1];
  const held = trace.slice(-4).every((r) => r && r.texFrame === last);
  const reached = seen.includes(last);
  const pass = distinct > 1 && reached && held;
  const why =
    `${distinct} distinct cels · texture played [${seen.join(",")}] of [${deathIdx.join(",")}]` +
    `${reached ? "" : ` · NEVER reached ${last}`}${held ? "" : " · did NOT hold the last frame"}`;

  await sheet(shots, `${a.out}/${kind}-death.png`);
  await stripFor(atlas, cels, deathIdx, `${a.out}/${kind}-cels.png`);
  log(`${pass ? "✔" : "✖"} ${kind}: ${why}`);
  await page.evaluate(() => window.__dungeonClear());
  return { kind, pass, why };
}

/** How many of a clip's cels differ from one another, by raw pixels. */
function countDistinct(img, cels, idxs) {
  const keys = new Set();
  for (const fi of idxs) {
    const c = createCanvas(cels.cellW, cels.cellH);
    const g = c.getContext("2d");
    g.drawImage(img, (fi % cels.cols) * cels.cellW, Math.floor(fi / cels.cols) * cels.cellH, cels.cellW, cels.cellH, 0, 0, cels.cellW, cels.cellH);
    keys.add(c.toBuffer("image/png").toString("base64"));
  }
  return keys.size;
}

/** The clip's cels side by side, straight out of the SHIPPED atlas. */
async function stripFor(img, cels, idxs, path) {
  if (!img || !idxs.length) return;
  const c = createCanvas(cels.cellW * idxs.length, cels.cellH);
  const g = c.getContext("2d");
  g.fillStyle = "#202430";
  g.fillRect(0, 0, c.width, c.height);
  idxs.forEach((fi, i) => {
    g.drawImage(img, (fi % cels.cols) * cels.cellW, Math.floor(fi / cels.cols) * cels.cellH, cels.cellW, cels.cellH, i * cels.cellW, 0, cels.cellW, cels.cellH);
  });
  writeFileSync(path, c.toBuffer("image/png"));
}

/** The sampled frames as one contact sheet — the artefact a human reads. */
async function sheet(pngs, path) {
  if (!pngs.length) return;
  const imgs = await Promise.all(pngs.map((b) => loadImage(b)));
  const cols = Math.min(8, imgs.length);
  const rows = Math.ceil(imgs.length / cols);
  const w = imgs[0].width;
  const h = imgs[0].height;
  const c = createCanvas(cols * w, rows * h);
  const g = c.getContext("2d");
  g.fillStyle = "#101218";
  g.fillRect(0, 0, c.width, c.height);
  imgs.forEach((im, i) => g.drawImage(im, (i % cols) * w, Math.floor(i / cols) * h));
  writeFileSync(path, c.toBuffer("image/png"));
}
