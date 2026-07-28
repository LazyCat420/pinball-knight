#!/usr/bin/env node
/**
 * MEASURE THE HORDE — a real-browser census of what each movement policy walks.
 *
 *   npx next dev -p 5182
 *   node scripts/measure-foes.mjs            # ~2 min, prints JSON
 *   PK_URL=… node scripts/measure-foes.mjs
 *
 * `movement.test.ts` proves each policy is different in the ABSTRACT — pure
 * handlers stepped through an open room. This proves it in the GAME: real maze,
 * real flow field, real separation, real collision, all nine cases on the SAME
 * floor in one page session so the comparison is between policies and not
 * between corridors.
 *
 * Both are needed, and the second is the one that catches the failure this
 * repo keeps meeting — a mechanic that passes every unit test and never occurs.
 * The pack-hunter's quorum was written counting only same-policy neighbours,
 * passed its unit tests, and this script measured four of them holding at 4.99
 * units and never engaging on a live floor. That is what a real-browser census
 * is for.
 *
 * Per case: clear the floor, park the knight (a pad AT REST — a walking knight
 * would make "range held" measure his legs), spawn a controlled group, then
 * sample `__dungeonFoes()` for ~6 s and reduce the paths to metrics.
 *
 * Sampling waits on the clock between reads and never spins: SwiftShader
 * starves RAF, and a busy loop reads as a frozen sim.
 */
import { chromium } from "playwright";

const URL = process.env.PK_URL ?? "http://localhost:5182/dungeon?no-intro=1&autostart=1&mute=1";
const SAMPLES = 60;      // ~6s at 10 Hz
const SAMPLE_MS = 100;

/** kind/ztype that produces each policy. Zombie sub-types where possible: same
 *  sprite, same HP, same speed table — the ONLY difference is the policy. */
const CASES = [
  // Ring 4: inside the flow field's reach and reliably in reachable floor, so
  // the comparison is between POLICIES and not between corridors. Every case
  // runs on the SAME floor in one page session.
  { policy: "chase", kind: "zombie", ztype: "shambler", count: 4, ring: 4 },
  { policy: "flanker", kind: "zombie", ztype: "runner", count: 4, ring: 4 },
  { policy: "leaper", kind: "zombie", ztype: "flailer", count: 4, ring: 4 },
  { policy: "strafer", kind: "wisp", count: 4, ring: 4 },
  { policy: "orbiter", kind: "bat", count: 4, ring: 4 },
  // Ambusher: the same actor, once beyond its trigger range and once inside it.
  { policy: "ambusher-far", kind: "zombie", ztype: "crawler", count: 4, ring: 7, expect: "ambusher" },
  { policy: "ambusher-close", kind: "zombie", ztype: "crawler", count: 4, ring: 3, expect: "ambusher" },
  // Pack-hunter: alone vs. with backup, from the same starting ring.
  { policy: "packhunter-solo", kind: "zombie", ztype: "midget", count: 1, ring: 4, expect: "packhunter" },
  { policy: "packhunter-backed", kind: "zombie", ztype: "midget", count: 1, ring: 4, extra: { kind: "zombie", ztype: "shambler", count: 3, ring: 4 }, expect: "packhunter" },
];


const run = async () => {
  const browser = await chromium.launch({
    args: ["--use-gl=swiftshader", "--enable-unsafe-swiftshader", "--mute-audio"],
  });
  const page = await browser.newPage({ viewport: { width: 900, height: 620 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => {
    if (m.type() === "error" && !/ws:\/\//.test(m.text())) errors.push(m.text());
  });

  await page.goto(URL, { waitUntil: "domcontentloaded" });
  // The game is up when the player hook answers and the sim is active.
  await page.waitForFunction(() => {
    const p = window.__dungeonPlayer?.();
    return !!p && p.active === true;
  }, null, { timeout: 90000 });
  // A pad at rest — connected, nothing pressed. The knight must not move, or
  // "range held" measures the knight's walk instead of the monster's policy.
  await page.evaluate(() => window.__dungeonPad?.connect());
  await page.waitForTimeout(1500);

  const results = {};
  for (const c of CASES) {
    // Empty the floor, then place exactly this group.
    await page.evaluate(() => window.__dungeonClear());
    await page.evaluate((c) => {
      // Belt and braces: some builds expose clear only via the debug panel.
      const zs = window.__dungeonFoes?.() ?? [];
      void zs;
      const r = window.__dungeonSpawn({ kind: c.kind, ztype: c.ztype, count: c.count, ring: c.ring, aggro: true });
      if (c.extra) window.__dungeonSpawn({ ...c.extra, aggro: true });
      return r;
    }, c);

    const want = c.expect ?? c.policy;
    const spawned = await page.evaluate((w) => (window.__dungeonFoes(w) ?? []).length, want);
    if (spawned === 0) {
      results[c.policy] = { error: `nothing spawned with policy ${want}` };
      continue;
    }

    // Sample. Each step waits for the game clock to advance, so we never spin.
    const frames = [];
    for (let i = 0; i < SAMPLES; i++) {
      await page.waitForTimeout(SAMPLE_MS);
      frames.push(
        await page.evaluate((w) => {
          const p = window.__dungeonPlayer();
          return { px: p.x, pz: p.z, foes: window.__dungeonFoes(w) };
        }, want),
      );
    }
    results[c.policy] = metrics(frames, spawned);
  }

  await browser.close();
  console.log(JSON.stringify({ results, errors: errors.slice(0, 10) }, null, 2));
};

/** Path metrics per actor, averaged over the group. */
function metrics(frames, spawned) {
  const byNid = new Map();
  for (const f of frames) {
    for (const z of f.foes) {
      if (!byNid.has(z.nid)) byNid.set(z.nid, []);
      byNid.get(z.nid).push({ x: z.x, z: z.z, px: f.px, pz: f.pz });
    }
  }
  const per = [];
  for (const [, pts] of byNid) {
    if (pts.length < 8) continue;
    let off = 0;
    let tan = 0;
    let turn = 0;
    let steps = 0;
    let prevH = null;
    const ranges = [];
    let moved = 0;
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1];
      const b = pts[i];
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      const d = Math.hypot(dx, dz);
      const rx = b.px - b.x;
      const rz = b.pz - b.z;
      const rl = Math.hypot(rx, rz) || 1;
      ranges.push(rl);
      moved += d;
      if (d < 1e-4) continue;
      const hx = dx / d;
      const hz = dz / d;
      const ux = rx / rl;
      const uz = rz / rl;
      off += Math.acos(Math.max(-1, Math.min(1, hx * ux + hz * uz)));
      tan += Math.abs(hx * -uz + hz * ux);
      if (prevH) turn += Math.acos(Math.max(-1, Math.min(1, hx * prevH.x + hz * prevH.z)));
      prevH = { x: hx, z: hz };
      steps++;
    }
    const mean = ranges.reduce((s, r) => s + r, 0) / ranges.length;
    per.push({
      offAxis: steps ? off / steps : 0,
      tangential: steps ? tan / steps : 0,
      curvature: steps ? turn / steps : 0,
      meanRange: mean,
      rangeSd: Math.sqrt(ranges.reduce((s, r) => s + (r - mean) ** 2, 0) / ranges.length),
      closest: Math.min(...ranges),
      pathLen: moved,
      movingFrac: steps / (pts.length - 1),
    });
  }
  const avg = (k) => +(per.reduce((s, r) => s + r[k], 0) / (per.length || 1)).toFixed(3);
  return {
    actors: per.length,
    spawned,
    offAxis: avg("offAxis"),
    tangential: avg("tangential"),
    curvature: avg("curvature"),
    meanRange: avg("meanRange"),
    rangeSd: avg("rangeSd"),
    closest: avg("closest"),
    pathLen: avg("pathLen"),
    movingFrac: avg("movingFrac"),
  };
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
