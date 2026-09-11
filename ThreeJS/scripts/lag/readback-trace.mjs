import WebSocket from 'ws';
const cdpUrl='http://127.0.0.1:9353', origin='http://localhost:5183';
const tab=await (await fetch(`${cdpUrl}/json/new?about:blank`,{method:'PUT'})).json();
const ws=new WebSocket(tab.webSocketDebuggerUrl);await new Promise((r,j)=>{ws.on('open',r);ws.on('error',j)});
let id=0;const pending=new Map();
ws.on('message',raw=>{const m=JSON.parse(raw);if(m.id){pending.get(m.id)?.(m);pending.delete(m.id)}});
const send=(method,params={})=>new Promise((resolve,reject)=>{const call=++id;pending.set(call,m=>m.error?reject(new Error(JSON.stringify(m.error))):resolve(m.result));ws.send(JSON.stringify({id:call,method,params}));});
const ev=async(expr)=>{const r=await send('Runtime.evaluate',{expression:expr,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw new Error(JSON.stringify(r.exceptionDetails).slice(0,300));return r.result.value};
const until=async(expr,ms=120000)=>{const t0=Date.now();while(Date.now()-t0<ms){if(await ev(expr).catch(()=>false))return;await new Promise(r=>setTimeout(r,500));}throw new Error('until timeout: '+expr)};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
await send('Runtime.enable');await send('Page.enable');await send('Emulation.setDeviceMetricsOverride',{width:1920,height:1080,deviceScaleFactor:1,mobile:false});
await send('Page.addScriptToEvaluateOnNewDocument',{source:`(()=>{
 const log=[]; window.__rb={log,n:0,total:0}; for(const P of [CanvasRenderingContext2D.prototype, (typeof OffscreenCanvasRenderingContext2D!=="undefined"?OffscreenCanvasRenderingContext2D.prototype:null)].filter(Boolean)){ const orig=P.getImageData;
 const od=P.drawImage; P.drawImage=function(src,...a){const t=performance.now();const r=od.call(this,src,...a);const s=(this.__src??={n:0,ms:0,kinds:{}});s.n++;s.ms+=performance.now()-t;const k=(src?.constructor?.name||'?')+':'+(src.naturalWidth||src.width)+'x'+(src.naturalHeight||src.height);s.kinds[k]=(s.kinds[k]||0)+1;return r;};
 P.getImageData=function(...a){const t=performance.now();const r=orig.apply(this,a);const ms=performance.now()-t;window.__rb.n++;window.__rb.total+=ms;
  if(ms>4){const c=this.canvas;const hint=!!this.getContextAttributes?.().willReadFrequently;const st=(new Error().stack||'').split('\\n').slice(2,7).map(s=>s.trim().replace(/^at /,'').replace(/https?:\\/\\/[^ ]*\\//,'')).join(' < ');
   const src=this.__src?JSON.stringify(this.__src.kinds):'';if(this.__src){this.__src.n=0;this.__src.kinds={};}log.push({ms:+ms.toFixed(1),w:c?.width,h:c?.height,hint,src,req:a.slice(0,4).join(','),st,at:+performance.now().toFixed(0)});}else if(this.__src){this.__src.n=0;this.__src.kinds={};}
  return r;};
})()`});
await send('Page.navigate',{url:origin+'/?playtest=1&mute=1&seed=42'});
await until('typeof window.__dungeonFreshRun==="function"');await ev('window.__dungeonFreshRun()');
await send('Page.navigate',{url:origin+'/?playtest=1&mute=1&seed=42'});
await until('typeof window.__dungeonStartRun==="function"');
await ev('window.__dungeonStartRun()');await until('window.__dungeonPlayer?.()?.active===true');
const boot=await ev('JSON.stringify({n:__rb.n,total:+__rb.total.toFixed(0),slow:__rb.log.length})');console.log('boot:',boot);
await ev('__rb.log.length=0');
await sleep(12000);
console.log('warm (12s idle after boot):',await ev('JSON.stringify({n:__rb.n,total:+__rb.total.toFixed(0),slow:__rb.log.length})'));
const T0=await ev('performance.now()');
await ev('__rb.log.length=0;window.__dungeonBot({mode:"mixed",seconds:30})');await sleep(33000);
await ev('window.__dungeonBotStop()').catch(()=>{});
const log=await ev('JSON.stringify(__rb.log)');const rows=JSON.parse(log);
console.log('slow getImageData (>4ms) during the 30s run:',rows.length,'total slow ms',rows.reduce((s,r)=>s+r.ms,0).toFixed(0));
const by=new Map();for(const r of rows){const k=`${r.w}x${r.h} drew=${r.src} :: ${r.st.split(' < ').slice(3,5).join(' < ')}`;const e=by.get(k)??{n:0,ms:0,max:0};e.n++;e.ms+=r.ms;e.max=Math.max(e.max,r.ms);by.set(k,e);}
for(const [k,e] of [...by].sort((a,b)=>b[1].ms-a[1].ms).slice(0,12))console.log(` ${e.ms.toFixed(0).padStart(6)}ms ×${e.n} max ${e.max}  ${k}`);
console.log('worst 6:');for(const r of rows.sort((a,b)=>b.ms-a.ms).slice(0,6))console.log(`  ${r.ms}ms t=${((r.at-T0)/1000).toFixed(1)}s ${r.w}x${r.h} hint=${r.hint} drew=${r.src} :: ${r.st.split(' < ').slice(0,2).join(' < ')}`);
ws.close();await fetch(`${cdpUrl}/json/close/${tab.id}`);
