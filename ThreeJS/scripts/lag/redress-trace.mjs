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
 const log=[]; window.__rb={log,n:0,total:0};
 for(const P of [CanvasRenderingContext2D.prototype,(typeof OffscreenCanvasRenderingContext2D!=='undefined'?OffscreenCanvasRenderingContext2D.prototype:null)].filter(Boolean)){
  const orig=P.getImageData;
  P.getImageData=function(...a){const t=performance.now();const r=orig.apply(this,a);const ms=performance.now()-t;window.__rb.n++;window.__rb.total+=ms;
   if(ms>4){const c=this.canvas;const hint=!!this.getContextAttributes?.().willReadFrequently;const st=(new Error().stack||'').split('\\n').slice(2,7).map(s=>s.trim().replace(/^at /,'').replace(/https?:\\/\\/[^ ]*\\//,'')).join(' < ');
    log.push({ms:+ms.toFixed(1),w:c?.width,h:c?.height,hint,off:!(c instanceof HTMLCanvasElement),req:a.slice(0,4).join(','),st,at:+performance.now().toFixed(0)});}
   return r;};
 }
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
// frame-time probe around forced knight re-dresses
await ev(`window.__ft=[];(function tick(t){window.__ft.push(t);requestAnimationFrame(tick)})(performance.now());__rb.log.length=0`);
const weapons=(process.env.WEAPONS||'bow,hammer,sword').split(',');
for(const w of weapons){const t=await ev(`(()=>{const a=performance.now();const ok=window.__dungeonGive(${JSON.stringify(w)});return {ok,at:a}})()`);console.log('give',w,JSON.stringify(t));await sleep(2500);}
for(const g of (process.env.GEAR||'').split(',').filter(Boolean)){await ev(`(async()=>{const st=(await import('/src/game/pinball-knight/state.ts')).state;st.gear[${JSON.stringify(g)}]=(st.gear[${JSON.stringify(g)}]||0)+1;return st.gear})()`);console.log('gear',g);await sleep(2500);}
const ft=await ev('JSON.stringify(window.__ft)');const f=JSON.parse(ft);const d=[];for(let i=1;i<f.length;i++)d.push({at:f[i]-T0,ms:f[i]-f[i-1]});
const bad=d.filter(x=>x.ms>33).sort((a,b)=>b.ms-a.ms);console.log('frames >33ms during re-dresses:',bad.length,'worst:',bad.slice(0,8).map(x=>x.ms.toFixed(0)+'@'+(x.at/1000).toFixed(1)+'s').join(' '));
const log=await ev('JSON.stringify(__rb.log)');const rows=JSON.parse(log);
console.log('slow getImageData (>4ms) during the 30s run:',rows.length,'total slow ms',rows.reduce((s,r)=>s+r.ms,0).toFixed(0));
const by=new Map();for(const r of rows){const k=`${r.w}x${r.h} hint=${r.hint} off=${r.off} :: ${r.st.split(' < ').slice(0,3).join(' < ')}`;const e=by.get(k)??{n:0,ms:0,max:0};e.n++;e.ms+=r.ms;e.max=Math.max(e.max,r.ms);by.set(k,e);}
for(const [k,e] of [...by].sort((a,b)=>b[1].ms-a[1].ms).slice(0,12))console.log(` ${e.ms.toFixed(0).padStart(6)}ms ×${e.n} max ${e.max}  ${k}`);
console.log('worst 6:');for(const r of rows.sort((a,b)=>b.ms-a.ms).slice(0,6))console.log(`  ${r.ms}ms t=${((r.at-T0)/1000).toFixed(1)}s ${r.w}x${r.h} hint=${r.hint} req=${r.req} :: ${r.st}`);
ws.close();await fetch(`${cdpUrl}/json/close/${tab.id}`);
