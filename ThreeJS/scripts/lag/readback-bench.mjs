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
const BENCH=`(async()=>{
 const mk=(hint,size)=>{const c=document.createElement('canvas');c.width=size;c.height=size;const g=c.getContext('2d',hint?{willReadFrequently:true}:undefined);g.fillStyle='#4a4';g.fillRect(0,0,size,size);return c;};
 const time=(c,n)=>{const g=c.getContext('2d');const t=[];for(let i=0;i<n;i++){g.fillRect(i%8,0,4,4);const a=performance.now();g.getImageData(0,0,c.width,c.height);t.push(performance.now()-a);}t.sort((x,y)=>x-y);return {p50:t[n>>1].toFixed(3),p95:t[Math.floor(n*.95)].toFixed(2),max:t[n-1].toFixed(1)};};
 const out={};
 out.hinted128=time(mk(true,128),120); out.plain128=time(mk(false,128),120);
 out.hinted128_2=time(mk(true,128),120);
 // the game's own paint canvas, if reachable through a fresh crush: paint one frame via the sheet builder is internal; approximate with a 128 canvas the same way sprite.ts makes it
 return out;})()`;
console.log('-- page idle (before the run) --');
await send('Page.navigate',{url:origin+'/?playtest=1&mute=1&seed=42'});
await until('typeof window.__dungeonStartRun==="function"');
console.log(JSON.stringify(await ev(BENCH)));
await ev('window.__dungeonStartRun()');await until('window.__dungeonPlayer?.()?.active===true');await sleep(12000);
console.log('-- dungeon running, bot idle --');
console.log(JSON.stringify(await ev(BENCH)));
await ev('window.__dungeonBot({mode:"mixed",seconds:20})');await sleep(4000);
console.log('-- dungeon running, bot playing --');
for(let i=0;i<3;i++){console.log(JSON.stringify(await ev(BENCH)));await sleep(1500);}
await ev('window.__dungeonBotStop()').catch(()=>{});
ws.close();await fetch(`${cdpUrl}/json/close/${tab.id}`);
