/**
 * DID THE PLAYER'S IMPORTED ART ACTUALLY LOAD?
 *
 * `sprite-shot.mjs` answers this for a MONSTER — it scrapes `imported art from
 * N sheet(s)`, which is `boot/sheets.ts`'s line. The player path prints a
 * different one, from `render/knight-sheets.ts:108`:
 *
 *     [dungeon] player: imported pinball_knight art loaded
 *
 * and prints NOTHING at all when the load fails, because `loadImportedSheet`
 * returns null on any error and `resolvePaints` silently falls back to the
 * procedural painter. A screenshot cannot tell the two apart — the painted
 * knight looks fine. The absence of that line IS the failure signal, so this
 * script asserts on presence and prints every `[dungeon]` line it saw either
 * way, so a miss is diagnosable rather than just red.
 *
 * Runs against Windows-side Chrome over CDP for the same reason the shot
 * harness does: WSL2 headless falls back to SwiftShader, which is not the
 * renderer the game ships on.
 */
import { chromium } from "playwright";
import { parseArgs } from "node:util";

const { values: a } = parseArgs({
  options: {
    url: { type: "string", default: "http://localhost:5174/dungeon" },
    "cdp-port": { type: "string", default: process.env.BDB_CDP_PORT ?? "9345" },
    settle: { type: "string", default: "20000" },
    shot: { type: "string" },
  },
});

const PORT = Number(a["cdp-port"]);
const log = (s) => console.log(s);

async function cdpAlive(port) {
  try {
    const r = await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(1500) });
    return r.ok;
  } catch { return false; }
}

const browser = await (async () => {
  if (await cdpAlive(PORT)) {
    log(`▶ reusing CDP browser on :${PORT}`);
    return chromium.connectOverCDP(`http://127.0.0.1:${PORT}`, { timeout: 120_000 });
  }
  throw new Error(
    `no CDP browser on :${PORT}. Start Windows Chrome with --remote-debugging-port=${PORT}, ` +
      `or run scripts/sprite-shot.mjs once (it launches one).`,
  );
})();

const lines = [];
try {
  const ctx = browser.contexts()[0] ?? (await browser.newContext());
  const page = await ctx.newPage();
  page.on("console", (m) => {
    const t = m.text();
    if (t.includes("[dungeon]") || /imported/i.test(t)) lines.push(t);
  });
  page.on("pageerror", (e) => lines.push(`PAGEERROR ${e.message}`));

  log(`▶ ${a.url}`);
  await page.goto(a.url, { waitUntil: "domcontentloaded", timeout: 120_000 });
  await page.waitForFunction(() => typeof window.__dungeonStartRun === "function", null, { timeout: 120_000 });
  await page.evaluate(() => window.__dungeonFreshRun?.());
  await page.evaluate(() => window.__dungeonStartRun());
  await page.waitForFunction(() => window.__dungeonPlayer?.()?.active === true, null, { timeout: 120_000 });
  // Pipelines compile lazily on WebGPU; the sheet load races them on a cold run.
  await page.waitForTimeout(Number(a.settle));

  // Ask the runtime directly as well as scraping the log — a clip table is a
  // fact about what the atlas HOLDS, where the log line only reports an intent.
  const clips = await page.evaluate(() => {
    try { return window.__dungeonClips?.("player") ?? null; } catch { return null; }
  });

  if (a.shot) {
    await page.screenshot({ path: a.shot });
    log(`▶ ${a.shot}`);
  }

  const ok = lines.some((l) => /player: imported .* art loaded/.test(l));
  log("\n── [dungeon] console ──");
  for (const l of lines) log(`   ${l}`);
  log("\n── player clip table (__dungeonClips) ──");
  log(`   ${JSON.stringify(clips)}`);
  log(`\nVERDICT: ${ok ? "IMPORTED ART LOADED ✓" : "NO IMPORT LINE — the painter is drawing the player ✗"}`);
  await page.close();
  process.exitCode = ok ? 0 : 1;
} finally {
  // Disconnect, never kill: a live CDP socket holds node's event loop open.
  await browser.close();
}
