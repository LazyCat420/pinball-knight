#!/usr/bin/env node
/**
 * JUNGLE ROOM STEADY-STATE BENCH — the measurement rig for the shader rewrite.
 *
 * The complaint under test: the landing room burns ~100% of a core at idle.
 * Every conversion stage (custom toon shader, frozen shadow map, instanced
 * window diorama, …) must move a number here before it merges.
 *
 * What it measures, per trial, over a --secs window that starts only after the
 * `room:mounted` performance mark (the room mounts staggered — page load is
 * not room complete) plus a settle delay:
 *
 *   busy%      main-thread utilisation: delta CDP Performance.TaskDuration
 *              over wall time. THE number for the "100% CPU" complaint —
 *              rAF gaps can't see busy-but-keeping-up, this can.
 *   script%    same, ScriptDuration only (JS vs style/layout/GC split).
 *   p50/p95/p99/worst   rAF gap percentiles in ms (jank tail).
 *   stall33/50 count of gaps ≥ 33ms / ≥ 50ms.
 *   draws      renderer.info.render.drawCalls sampled once/sec (median).
 *   tris       renderer.info.render.triangles, same sampling.
 *   meshes/lights   scene census at window start.
 *
 * A/B: --a / --b are query-string fragments appended to the URL (e.g.
 * --a "" --b "mat=legacy"). Trials run INTERLEAVED with order flipped each
 * pair, because this box's load drifts minute to minute. Single-arm mode:
 * just --a (or neither).
 *
 * CONTROL: --control injects a spin loop of ~10ms into every rAF. A bench
 * that does not report busy% and p95 clearly worse under --control is broken
 * — run this once before trusting any A/B from a new setup.
 *
 * REAL GPU ONLY: refuses to run without the host browser, and refuses any
 * trial whose page did not resolve the webgpu backend — a WebGL2 fallback
 * builds different pipelines and measures a different site.
 *
 *   node scripts/room-bench.mjs --url http://localhost:5231/ --secs 20 --pairs 3
 *   node scripts/room-bench.mjs --control          # validate the rig
 */
import { parseArgs } from "node:util";
import { connectRealGpu, closeHostBrowser, rewriteForHostBrowser } from "./lib/host-chrome.mjs";

const { values: a } = parseArgs({
  options: {
    url: { type: "string", default: "http://localhost:5231/" },
    secs: { type: "string", default: "20" },
    // 20s: measured — pipeline warm + staggered mount still stall the page
    // 5-15s after room:mounted; a 5s settle put an 8.8s warm-up stall inside
    // the measurement window.
    "settle-secs": { type: "string", default: "20" },
    pairs: { type: "string", default: "3" },
    a: { type: "string", default: "" },
    b: { type: "string" }, // absent = single-arm
    control: { type: "boolean", default: false },
    "cdp-port": { type: "string", default: process.env.BDB_CDP_PORT ?? "9333" },
  },
});

const SECS = Number(a.secs);
const SETTLE_MS = Number(a["settle-secs"]) * 1000;
const PAIRS = Number(a.pairs);

/** Injected at document start: rAF-gap recorder (+ optional control load). */
const probe = (control) => `(() => {
  const gaps = [];
  let prev = performance.now();
  function tick(now) {
    const gap = now - prev;
    prev = now;
    gaps.push(gap);
    if (gaps.length > 100000) gaps.shift();
    ${control ? "const t0 = performance.now(); while (performance.now() - t0 < 10) {}" : ""}
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
  window.__benchGaps = gaps;
})();`;

const pct = (sorted, p) => sorted[Math.min(sorted.length - 1, Math.floor((sorted.length * p) / 100))];
const med = (xs) => [...xs].sort((p, q) => p - q)[Math.floor(xs.length / 2)];

async function trial(browser, baseUrl, flags, label) {
  const url = new URL(baseUrl);
  url.searchParams.set("no-intro", "1");
  url.searchParams.set("gpu", "webgpu");
  for (const kv of (flags ?? "").split("&").filter(Boolean)) {
    const [k, v = "1"] = kv.split("=");
    url.searchParams.set(k, v);
  }
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await ctx.newPage();
  await page.addInitScript(probe(a.control));
  const cdp = await ctx.newCDPSession(page);
  await cdp.send("Performance.enable");
  try {
    await page.goto(url.toString(), { waitUntil: "domcontentloaded", timeout: 60_000 });
    await page.waitForFunction(() => performance.getEntriesByName("room:mounted").length > 0, null, {
      timeout: 60_000,
    });
    await page.waitForTimeout(SETTLE_MS);

    // Backend truth — never quote a number off the WebGL2 fallback.
    const backend = await page.evaluate(() => window.__renderBackendResolved ?? window.__renderBackend);
    if (backend !== "webgpu") throw new Error(`backend resolved to '${backend}', not webgpu — refusing`);

    const census = await page.evaluate(() => {
      let meshes = 0, lights = 0;
      window.__scene?.traverse((o) => {
        if (o.isMesh) meshes++;
        if (o.isLight) lights++;
      });
      return { meshes, lights };
    });

    const metric = async (name) =>
      (await cdp.send("Performance.getMetrics")).metrics.find((m) => m.name === name)?.value ?? 0;

    const t0 = performance.now();
    const task0 = await metric("TaskDuration");
    const script0 = await metric("ScriptDuration");
    // WebGPU backend resets info at frame END, so between-frame sampling sees
    // zeros. Freeze autoReset and read the cumulative delta over the window
    // instead; delta / frames = per-frame averages.
    const info0 = await page.evaluate(() => {
      const info = window.__renderer?.info;
      if (!info) return null;
      info.autoReset = false;
      return { d: info.render.drawCalls, t: info.render.triangles };
    });
    await page.evaluate(() => (window.__benchGaps.length = 0));

    await page.waitForTimeout(SECS * 1000);

    const wall = (performance.now() - t0) / 1000;
    const busy = ((await metric("TaskDuration")) - task0) / wall;
    const script = ((await metric("ScriptDuration")) - script0) / wall;
    const gaps = (await page.evaluate(() => window.__benchGaps.slice())).sort((p, q) => p - q);
    if (gaps.length < 30) throw new Error(`only ${gaps.length} frames in ${SECS}s — page is not animating`);
    const info1 = await page.evaluate(() => {
      const info = window.__renderer?.info;
      if (!info) return null;
      const r = { d: info.render.drawCalls, t: info.render.triangles };
      info.autoReset = true;
      return r;
    });
    const perFrame = (k) => (info0 && info1 ? Math.round((info1[k] - info0[k]) / gaps.length) : -1);
    const draws = [perFrame("d")], tris = [perFrame("t")];

    const r = {
      label,
      busy: busy * 100,
      script: script * 100,
      p50: pct(gaps, 50),
      p95: pct(gaps, 95),
      p99: pct(gaps, 99),
      worst: gaps[gaps.length - 1],
      stall33: gaps.filter((g) => g >= 33).length,
      stall50: gaps.filter((g) => g >= 50).length,
      fps: gaps.length / wall,
      draws: draws.length ? med(draws) : -1,
      tris: tris.length ? med(tris) : -1,
      ...census,
    };
    console.log(
      `${label.padEnd(8)} busy=${r.busy.toFixed(0)}%  script=${r.script.toFixed(0)}%  ` +
        `p50=${r.p50.toFixed(1)}  p95=${r.p95.toFixed(1)}  p99=${r.p99.toFixed(1)}  worst=${r.worst.toFixed(0)}  ` +
        `stall33=${r.stall33}  fps=${r.fps.toFixed(0)}  draws=${r.draws}  tris=${(r.tris / 1000).toFixed(0)}k  ` +
        `meshes=${r.meshes}  lights=${r.lights}`,
    );
    return r;
  } finally {
    await ctx.close();
  }
}

const browser = await connectRealGpu({ port: Number(a["cdp-port"]) });
if (!browser) {
  console.error("✗ no real-GPU browser — refusing to measure under SwiftShader/WebGL2");
  process.exit(2);
}
const base = rewriteForHostBrowser(a.url);

const arms = a.b === undefined ? [["A", a.a]] : [["A", a.a], ["B", a.b]];
const results = Object.fromEntries(arms.map(([l]) => [l, []]));
try {
  const rounds = a.b === undefined ? 1 : PAIRS;
  for (let i = 0; i < rounds; i++) {
    const order = i % 2 === 0 ? arms : [...arms].reverse();
    for (const [label, flags] of order) {
      results[label].push(await trial(browser, base, flags, label));
    }
  }
} finally {
  closeHostBrowser();
}

console.log("\n── medians ──");
for (const [label, flags] of arms) {
  const rs = results[label];
  if (!rs.length) continue;
  console.log(
    `${label} (${flags || "default"}): busy=${med(rs.map((r) => r.busy)).toFixed(0)}%  ` +
      `p50=${med(rs.map((r) => r.p50)).toFixed(1)}ms  p95=${med(rs.map((r) => r.p95)).toFixed(1)}ms  ` +
      `stall33=${med(rs.map((r) => r.stall33))}  draws=${med(rs.map((r) => r.draws))}  ` +
      `lights=${rs[0].lights}  over ${rs.length} trial(s)`,
  );
}
