#!/usr/bin/env node
/**
 * Minimal slot-pool exerciser: connect a (possibly pinned) host browser via
 * the shared launch path and hold it for N seconds. Exists so the pinning
 * battery can race real browser launches without needing a dev server.
 *
 *   scripts/with-cores.sh CPUS=2 -- node scripts/cpu-slots-smoke.mjs --seconds 30
 *
 * By default the browser is LEFT RUNNING on exit (that is what the warm-reuse
 * and reaper tests need); pass --close to exercise the slot-scoped teardown.
 */
import { parseArgs } from "node:util";
import { connectRealGpu, closeHostBrowser } from "./lib/host-chrome.mjs";

const { values: a } = parseArgs({
  options: {
    seconds: { type: "string", default: "20" },
    close: { type: "boolean", default: false },
    "cdp-port": { type: "string", default: process.env.BDB_CDP_PORT ?? "9333" },
  },
});

const port = Number(a["cdp-port"]);
const browser = await connectRealGpu({ port });
if (!browser) {
  console.error(`cpu-slots-smoke: no host browser reachable on :${port}`);
  process.exit(2);
}
console.log(`cpu-slots-smoke: connected on :${port} (slots=${process.env.BDB_SLOT_FIRST ?? "unwrapped"}+${process.env.BDB_SLOT_COUNT ?? "-"}, affinity=${process.env.BDB_WIN_AFFINITY_HEX ?? "none"}); holding ${a.seconds}s`);
await new Promise((r) => setTimeout(r, Number(a.seconds) * 1000));
await browser.close();
if (a.close) closeHostBrowser();
console.log("cpu-slots-smoke: done");
