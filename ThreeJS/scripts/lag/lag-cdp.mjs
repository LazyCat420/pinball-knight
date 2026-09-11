// Raw-CDP port of braindeadbot-client/scripts/lag-profile.mjs (no playwright here).
import WebSocket from 'ws';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { installLagProbe } from './lag-probe.mjs';
const A=Object.fromEntries(process.argv.slice(2).map(s=>s.replace(/^--/,'').split('=')));
const SECS=Number(A.secs??30), HITCH=Number(A['hitch-ms']??33), TOP=Number(A.top??18), INTERVAL=Number(A.interval??250), MODE=A.mode??'mixed', SEED=A.seed??'42', WARM=Number(A.warm??15);
const cdpUrl=A.cdp??'http://127.0.0.1:9353', origin=A.url??'http://localhost:5183';
const log=(...m)=>console.log(...m);
const tab=await (await fetch(`${cdpUrl}/json/new?about:blank`,{method:'PUT'})).json();
const ws=new WebSocket(tab.webSocketDebuggerUrl);await new Promise((r,j)=>{ws.on('open',r);ws.on('error',j)});
let id=0;const pending=new Map();const pageErrors=[];
ws.on('message',raw=>{const m=JSON.parse(raw);if(m.id){pending.get(m.id)?.(m);pending.delete(m.id)}else if(m.method==='Runtime.exceptionThrown')pageErrors.push(String(m.params.exceptionDetails?.exception?.description??m.params.exceptionDetails?.text).slice(0,200))});
const send=(method,params={})=>new Promise((resolve,reject)=>{const call=++id;const t=setTimeout(()=>{pending.delete(call);reject(new Error('timeout '+method))},180000);pending.set(call,m=>{clearTimeout(t);m.error?reject(new Error(JSON.stringify(m.error))):resolve(m.result)});ws.send(JSON.stringify({id:call,method,params}));});
const ev=async(expr)=>{const r=await send('Runtime.evaluate',{expression:expr,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw new Error(JSON.stringify(r.exceptionDetails).slice(0,300));return r.result.value};
const until=async(expr,ms=120000)=>{const t0=Date.now();while(Date.now()-t0<ms){if(await ev(expr).catch(()=>false))return;await new Promise(r=>setTimeout(r,500));}throw new Error('until timeout: '+expr)};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
await send('Runtime.enable');await send('Page.enable');await send('Network.setCacheDisabled',{cacheDisabled:true});
await send('Emulation.setDeviceMetricsOverride',{width:1920,height:1080,deviceScaleFactor:1,mobile:false});
await send('Page.addScriptToEvaluateOnNewDocument',{source:`(${installLagProbe.toString()})()`});
const url=`${origin}/?playtest=1&mute=1&seed=${SEED}`;
await send('Page.navigate',{url});
await until('typeof window.__dungeonFreshRun==="function"');await ev('window.__dungeonFreshRun()');
await send('Page.navigate',{url});
await until('typeof window.__dungeonBot==="function" && typeof window.__dungeonStartRun==="function"');
const glInfo=await ev(`(()=>{const c=document.createElement('canvas');const g=c.getContext('webgl2')||c.getContext('webgl');const d=g?.getExtension('WEBGL_debug_renderer_info');return d?String(g.getParameter(d.UNMASKED_RENDERER_WEBGL)):'unknown'})()`);
log('renderer:',glInfo);
await ev('window.__dungeonStartRun()');
await until('window.__dungeonPlayer?.()?.active===true');
log(`warming ${WARM}s`);await sleep(WARM*1000);
await send('Profiler.enable');await send('Profiler.setSamplingInterval',{interval:INTERVAL});await send('Profiler.start');
await ev('window.__lagSync(80)');
log(`bot: mode=${MODE} for ${SECS}s`);
await ev(`window.__dungeonBot({mode:${JSON.stringify(MODE)},seconds:${SECS},profile:true})`);
const deadline=Date.now()+SECS*1000+20000;
while(Date.now()<deadline){await sleep(2000);const still=await ev('!!window.__dungeonBotIsRunning?.()').catch(()=>false);const p=await ev('(()=>{const pl=window.__dungeonPlayer?.();return pl?{hp:pl.hp,kills:pl.kills,lvl:window.__dungeonPool?.()?.level}:null})()').catch(()=>null);if(p)log(`   floor ${p.lvl??'?'}  hp ${p.hp}  kills ${p.kills}`);if(!still)break;}
await ev('window.__lagSync(80)');
const {profile}=await send('Profiler.stop');
const botReport=await ev('(()=>{const r=window.__dungeonBotStop();return JSON.parse(JSON.stringify(r??null))})()').catch(()=>null);
const probe=await ev('window.__lagDump()');
ws.close();await fetch(`${cdpUrl}/json/close/${tab.id}`);
const a={out:A.out??''};
function alignByMarker(prof, syncs) {
  const nodeById = new Map(prof.nodes.map((n) => [n.id, n]));
  const markerIds = new Set(
    prof.nodes.filter((n) => n.callFrame.functionName === "__lagSyncMarker").map((n) => n.id),
  );
  const ts = [];
  let t = prof.startTime;
  for (let i = 0; i < prof.samples.length; i++) {
    t += prof.timeDeltas[i] ?? 0;
    ts.push(t);
  }
  if (!markerIds.size || syncs.length < 1) return { offset: null, ts, nodeById, error: null };
  // Cluster the marker samples: they arrive in one dense block per sync call.
  const hits = [];
  for (let i = 0; i < prof.samples.length; i++) if (markerIds.has(prof.samples[i])) hits.push(ts[i]);
  const clusters = [];
  for (const h of hits) {
    const last = clusters[clusters.length - 1];
    if (last && h - last.end < 200_000) last.end = h;
    else clusters.push({ start: h, end: h });
  }
  const offsets = [];
  for (let i = 0; i < Math.min(clusters.length, syncs.length); i++) {
    const profMid = (clusters[i].start + clusters[i].end) / 2 / 1000; // → ms
    const pageMid = (syncs[i].a + syncs[i].b) / 2;
    offsets.push(profMid - pageMid);
  }
  if (!offsets.length) return { offset: null, ts, nodeById, error: null };
  const offset = offsets.reduce((x, y) => x + y, 0) / offsets.length;
  const error = Math.max(...offsets) - Math.min(...offsets);
  return { offset, ts, nodeById, error, clusters: clusters.length };
}

const { offset, ts, nodeById, error: alignError, clusters } = alignByMarker(profile, probe.sync);
if (offset === null) {
  console.error("✗ could not align the profiler clock to the page clock (no __lagSyncMarker samples).");
  console.error("  Without alignment, per-frame attribution would be fiction. Aborting.");
  process.exit(3);
}
/** Profiler µs → page ms. */
const pageMs = (tick) => tick / 1000 - offset;

// ── Slice into hitch / healthy windows ─────────────────────────────────────
const frames = probe.frames;
// Ignore everything before the run began: the sync burn and any boot tail.
const runStart = probe.sync[0]?.b ?? frames[0];
const runEnd = probe.sync[1]?.a ?? frames[frames.length - 1];
// DESCENT FRAMES ARE NOT HITCHES. While the loading screen holds the display
// the loop renders and simulates nothing, so those frames are long by design
// and the player is watching a progress bar. They are dropped from the pacing
// numbers AND from the attribution — otherwise the tail is just the warm-up.
const heldFrames = new Set(probe.held ?? []);
const windows = [];
let heldSkipped = 0;
for (let i = 1; i < frames.length; i++) {
  if (frames[i - 1] < runStart || frames[i] > runEnd) continue;
  // Both ends: the frame AFTER a held one is the one that carries the descent's
  // last long gap.
  if (heldFrames.has(i) || heldFrames.has(i - 1)) {
    heldSkipped++;
    continue;
  }
  windows.push({ from: frames[i - 1], to: frames[i], ms: frames[i] - frames[i - 1] });
}
const hitches = windows.filter((w) => w.ms > HITCH);
const healthy = windows.filter((w) => w.ms <= HITCH);

function pct(sorted, p) {
  if (!sorted.length) return 0;
  return sorted[Math.min(sorted.length - 1, Math.round((p / 100) * (sorted.length - 1)))];
}
const sortedMs = windows.map((w) => w.ms).sort((x, y) => x - y);

// ── Attribute samples ──────────────────────────────────────────────────────
/** Parent map, so a sample can be charged to every function on its stack. */
const parent = new Map();
for (const n of profile.nodes) for (const c of n.children ?? []) parent.set(c, n.id);
const key = (n) => {
  const f = n.callFrame;
  const where = f.url ? `${f.url.split("/").pop()}:${f.lineNumber + 1}` : "";
  return `${f.functionName || "(anonymous)"}${where ? `  ${where}` : ""}`;
};

/** Function names only, root→leaf, for a stack-path report. */
const pathOf = (id) => {
  const out = [];
  for (let n = id; n !== undefined; n = parent.get(n)) {
    const node = nodeById.get(n);
    if (!node) break;
    const f = node.callFrame.functionName;
    if (f && f !== "(root)") out.push(f);
  }
  return out.reverse().join(" › ");
};

/** Total self+inclusive ms per function for samples landing inside `wins`. */
function attribute(wins) {
  // Windows are disjoint and ordered; walk both lists once.
  const self = new Map();
  const incl = new Map();
  const paths = new Map();
  let wi = 0;
  let total = 0;
  for (let i = 0; i < profile.samples.length; i++) {
    const t = pageMs(ts[i]);
    while (wi < wins.length && t > wins[wi].to) wi++;
    if (wi >= wins.length) break;
    if (t < wins[wi].from) continue;
    const dt = (profile.timeDeltas[i] ?? 0) / 1000;
    total += dt;
    const node = nodeById.get(profile.samples[i]);
    if (!node) continue;
    const k = key(node);
    self.set(k, (self.get(k) ?? 0) + dt);
    const p = pathOf(profile.samples[i]);
    paths.set(p, (paths.get(p) ?? 0) + dt);
    // Charge every ancestor once, so recursion cannot double-count.
    const seen = new Set();
    for (let id = profile.samples[i]; id !== undefined; id = parent.get(id)) {
      const n = nodeById.get(id);
      if (!n) break;
      const ak = key(n);
      if (!seen.has(ak)) {
        seen.add(ak);
        incl.set(ak, (incl.get(ak) ?? 0) + dt);
      }
    }
  }
  return { self, incl, paths, total };
}

const hot = attribute(hitches);
const cool = attribute(healthy);

function table(map, totalMs, n, contrast) {
  const rows = [...map].sort((x, y) => y[1] - x[1]).slice(0, n);
  const width = Math.max(...rows.map((r) => r[0].length), 10);
  const out = [];
  for (const [k, ms] of rows) {
    const share = totalMs ? (100 * ms) / totalMs : 0;
    const base = contrast ? (contrast.get(k) ?? 0) : null;
    const baseShare = contrast && cool.total ? (100 * base) / cool.total : null;
    out.push(
      `  ${k.padEnd(width)}  ${ms.toFixed(0).padStart(7)}ms  ${share.toFixed(1).padStart(5)}%` +
        (baseShare === null ? "" : `   (healthy frames: ${baseShare.toFixed(1)}%)`),
    );
  }
  return out.join("\n");
}

// ── GPU calls inside the hitches ───────────────────────────────────────────
function gpuIn(wins) {
  const by = new Map();
  let wi = 0;
  for (const c of probe.gpu) {
    while (wi < wins.length && c.at > wins[wi].to) wi++;
    if (wi >= wins.length) break;
    if (c.at < wins[wi].from) continue;
    const k = `${c.api}  ${c.label}`.trim();
    const e = by.get(k) ?? { n: 0, ms: 0 };
    e.n++;
    e.ms += c.ms;
    by.set(k, e);
  }
  return by;
}
const gpuHitch = gpuIn(hitches);
const gpuTotalMs = [...gpuHitch.values()].reduce((s, e) => s + e.ms, 0);

// ── Report ─────────────────────────────────────────────────────────────────
log("\n══ LAG ATTRIBUTION ═══════════════════════════════════════════════════");
log(`renderer:        ${glInfo}`);
log(`frames:          ${windows.length} over ${((runEnd - runStart) / 1000).toFixed(1)}s   (${heldSkipped} descent frames excluded${heldSkipped === 0 ? " — is __dungeonHeld present?" : ""})`);
log(`pacing:          p50 ${pct(sortedMs, 50).toFixed(1)}ms   p95 ${pct(sortedMs, 95).toFixed(1)}ms   p99 ${pct(sortedMs, 99).toFixed(1)}ms`);
log(
  `dropped >16.7ms: ${((100 * windows.filter((w) => w.ms > 16.7).length) / windows.length).toFixed(1)}%   ` +
    `hitches >${HITCH}ms: ${hitches.length}   worst: ${Math.max(0, ...sortedMs).toFixed(0)}ms`,
);
log(`clock alignment: offset ${offset.toFixed(1)}ms, drift between the two markers ${alignError.toFixed(1)}ms (${clusters} marker clusters)`);
if (alignError > 25) log(`  ⚠ drift above 25ms — treat per-frame attribution as approximate.`);
if (probe.capped) log(`  ⚠ the GPU call log hit its cap; late calls are missing.`);

log(`\n── ${hitches.length} HITCH frames, ${hot.total.toFixed(0)}ms of samples ─ SELF time ──`);
log(table(hot.self, hot.total, TOP, cool.self));
log(`\n── the same frames ─ INCLUSIVE (total) time ──`);
log(table(hot.incl, hot.total, TOP, cool.incl));
log(`\n── ${healthy.length} HEALTHY frames, ${cool.total.toFixed(0)}ms of samples ─ SELF time ──`);
log(table(cool.self, cool.total, 12, null));

// The leaderboard says WHAT is slow; only the stack says WHO ASKED FOR IT, and
// "who asked" is the thing you can actually change.
log(`\n── the hitch frames ─ heaviest CALL PATHS (self time at the leaf) ──`);
for (const [p, ms] of [...hot.paths].sort((x, y) => y[1] - x[1]).slice(0, 14)) {
  const frames_ = p.split(" › ");
  log(`  ${ms.toFixed(0).padStart(6)}ms  ${frames_.slice(-7).join(" › ")}`);
}

log(`\n── WebGPU / upload calls inside the hitch frames (${gpuTotalMs.toFixed(0)}ms total) ──`);
{
  const rows = [...gpuHitch].sort((x, y) => y[1].ms - x[1].ms).slice(0, TOP);
  if (!rows.length) log("  (none)");
  const width = Math.max(10, ...rows.map((r) => r[0].length));
  for (const [k, e] of rows) log(`  ${k.padEnd(width)}  ${e.ms.toFixed(1).padStart(8)}ms  ×${e.n}`);
}

log(`\n── the 8 worst frames ──`);
for (const w of [...hitches].sort((x, y) => y.ms - x.ms).slice(0, 8)) {
  const g = gpuIn([w]);
  const top = [...g].sort((x, y) => y[1].ms - x[1].ms).slice(0, 3);
  const at = attribute([w]);
  const worst = [...at.self].sort((x, y) => y[1] - x[1]).slice(0, 3);
  log(`  ${w.ms.toFixed(0).padStart(5)}ms at t=${((w.from - runStart) / 1000).toFixed(1)}s`);
  log(`      js:  ${worst.map(([k, ms]) => `${k} ${ms.toFixed(0)}ms`).join(" · ") || "(no samples)"}`);
  log(`      gpu: ${top.map(([k, e]) => `${k} ${e.ms.toFixed(0)}ms ×${e.n}`).join(" · ") || "(none)"}`);
}

if (botReport) log(`\nbot: ${botReport.kills} kills, ${botReport.deaths} deaths, ${botReport.stuckEvents?.length ?? 0} stuck`);
if (pageErrors.length) log(`page errors: ${pageErrors.length}\n  ${pageErrors.slice(0, 5).join("\n  ")}`);

if (a.out) {
  mkdirSync(dirname(a.out), { recursive: true });
  writeFileSync(
    a.out,
    JSON.stringify(
      {
        glInfo,
        offset,
        alignError,
        windows,
        hitchSelf: [...hot.self].sort((x, y) => y[1] - x[1]).slice(0, 200),
        hitchIncl: [...hot.incl].sort((x, y) => y[1] - x[1]).slice(0, 200),
        hitchPaths: [...hot.paths].sort((x, y) => y[1] - x[1]).slice(0, 120),
        healthySelf: [...cool.self].sort((x, y) => y[1] - x[1]).slice(0, 200),
        gpuHitch: [...gpuHitch],
        longtasks: probe.longtasks,
        botReport,
        pipelines: probe.gpu.filter(c=>/createRenderPipeline|createComputePipeline|createShaderModule/.test(c.api)).map(c=>({at:+((c.at-runStart)/1000).toFixed(2),api:c.api,label:c.label,ms:+c.ms.toFixed(2)})),
        worstFrames: [...hitches].sort((x,y)=>y.ms-x.ms).slice(0,8).map(w=>({ms:+w.ms.toFixed(0),at:+((w.from-runStart)/1000).toFixed(2),gpuBefore:probe.gpu.filter(c=>c.at>w.from-120&&c.at<=w.to).map(c=>`${c.api} ${c.label} @${((c.at-w.from)).toFixed(0)}ms`)})),
      },
      null,
      1,
    ),
  );
  log(`\n▶ wrote ${a.out}`);
}
process.exit(0);
