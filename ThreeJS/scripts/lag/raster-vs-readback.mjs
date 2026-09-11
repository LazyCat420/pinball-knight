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
await until('typeof window.__dungeonStartRun==="function"');await new Promise(r=>setTimeout(r,3000));
console.log(String(await ev(`(async()=>{
 const sh=await import('/src/game/pinball-knight/boot/sheets.ts');const eng=await import('/src/game/pinball-knight/engine/render/sprite.ts');
 const SPX=168;const mk=hint=>{const c=document.createElement('canvas');c.width=SPX;c.height=SPX;return [c,c.getContext('2d',hint?{willReadFrequently:true}:undefined)];};
 const out=[];
 for(const key of ['warden','spider','ghost','fries','goblin','boss']){
   const paints=sh.paintsFor(key);const frames=[...(paints.S.idle||[]),...(paints.S.walk||[]),...(paints.S.attack||[]),...(paints.S.death||[])].slice(0,12);
   const row={key,frames:frames.length};
   for(const [label,hint] of [['hinted',true],['gpu',false]]){
     const [c,g]=mk(hint);let paint=0,read1=0,read2=0,worst1=0;
     for(const f of frames){g.setTransform(1,0,0,1,0,0);g.clearRect(0,0,SPX,SPX);const a=performance.now();eng.paintInArtSpace(g,f);const b=performance.now();g.getImageData(0,0,SPX,SPX);const c2=performance.now();g.getImageData(0,0,SPX,SPX);const d=performance.now();paint+=b-a;read1+=c2-b;read2+=d-c2;worst1=Math.max(worst1,c2-b);}
     row[label]={paintJs:+(paint/frames.length).toFixed(2),firstRead:+(read1/frames.length).toFixed(2),secondRead:+(read2/frames.length).toFixed(2),worstFirstRead:+worst1.toFixed(1)};
   }
   out.push(row);
 }
 return JSON.stringify(out,null,0);})()`)).replace(/\},\{/g,"},\n{"));
ws.close();await fetch(`${cdpUrl}/json/close/${tab.id}`);
