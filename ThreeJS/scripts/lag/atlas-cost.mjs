import WebSocket from 'ws';
const cdpUrl='http://127.0.0.1:9353', origin='http://localhost:5183';
const tab=await (await fetch(`${cdpUrl}/json/new?about:blank`,{method:'PUT'})).json();
const ws=new WebSocket(tab.webSocketDebuggerUrl);await new Promise((r,j)=>{ws.on('open',r);ws.on('error',j)});
let id=0;const pending=new Map();
ws.on('message',raw=>{const m=JSON.parse(raw);if(m.id){pending.get(m.id)?.(m);pending.delete(m.id)}});
const send=(method,params={})=>new Promise((resolve,reject)=>{const call=++id;pending.set(call,m=>m.error?reject(new Error(JSON.stringify(m.error))):resolve(m.result));ws.send(JSON.stringify({id:call,method,params}));});
const ev=async(expr)=>{const r=await send('Runtime.evaluate',{expression:expr,awaitPromise:true,returnByValue:true,timeout:170000});if(r.exceptionDetails)throw new Error(JSON.stringify(r.exceptionDetails).slice(0,400));return r.result.value};
const until=async(expr,ms=120000)=>{const t0=Date.now();while(Date.now()-t0<ms){if(await ev(expr).catch(()=>false))return;await new Promise(r=>setTimeout(r,500));}throw new Error('until timeout: '+expr)};
await send('Runtime.enable');await send('Emulation.setDeviceMetricsOverride',{width:1920,height:1080,deviceScaleFactor:1,mobile:false});
await send('Page.navigate',{url:origin+'/?playtest=1&mute=1&seed=42'});
await until('typeof window.__dungeonStartRun==="function"');
await ev('window.__dungeonStartRun()');await until('window.__dungeonPlayer?.()?.active===true');await new Promise(r=>setTimeout(r,6000));
const out=await ev(`(async()=>{
 const sp=await import('/src/game/pinball-knight/render/sheet-painters.ts');const sh=await import('/src/game/pinball-knight/boot/sheets.ts');const cp=await import('/src/game/pinball-knight/render/cel-painter.ts');const eng=await import('/src/game/pinball-knight/engine/render/sprite.ts');
 const keys=Object.keys(sp.SHEET_PAINTERS);const rows=[];
 const P=CanvasRenderingContext2D.prototype, orig=P.getImageData;let cur=null;P.getImageData=function(...a){const t=performance.now();const r=orig.apply(this,a);const ms=performance.now()-t;if(cur){cur.n++;cur.read+=ms;cur.max=Math.max(cur.max,ms);}return r;};
 for(const key of keys){try{const paints=sh.paintsFor(key);cur={n:0,read:0,max:0};const t=performance.now();const s=eng.buildSpriteSheet(cp.withRecoil(paints),{lockEntries:20});const ms=performance.now()-t;rows.push({key,imported:!!sh.imported?.get?.(key),frames:cur.n,total:+ms.toFixed(0),read:+cur.read.toFixed(0),maxFrameRead:+cur.max.toFixed(1)});s.texture?.dispose?.();}catch(e){rows.push({key,err:String(e).slice(0,80)});}}
 P.getImageData=orig;return JSON.stringify(rows);})()`);
const rows=JSON.parse(out).sort((a,b)=>(b.maxFrameRead||0)-(a.maxFrameRead||0));
console.log('key                  imp frames total(ms) readback(ms) worst-frame-readback(ms)');
for(const r of rows)console.log(`${(r.key||'').padEnd(20)} ${r.imported?'Y':'n'}   ${String(r.frames??'').padStart(4)} ${String(r.total??r.err).padStart(8)} ${String(r.read??'').padStart(9)} ${String(r.maxFrameRead??'').padStart(8)}`);
ws.close();await fetch(`${cdpUrl}/json/close/${tab.id}`);
