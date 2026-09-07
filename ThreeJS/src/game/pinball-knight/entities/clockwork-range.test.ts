/// <reference types="node" />
import { describe, it, expect } from 'vitest';
import { Object3D } from 'three';
import { state, freshPlayerFields } from '../state';
import { updatePlayer, resetPlayerMotion } from './player';
import { CLOCKWORK_LAUNCHES, type ClockworkLaunchStyle } from '../clockwork-launches';
import { T_FLOOR } from '../maze/generator';
import { emptyPad } from '../engine/virtual-pad';
import type { InputHandle } from '../engine/input';
const INPUT = new Proxy({}, { get: (_t,k) => {
  if(k==='axis'||k==='move'||k==='aim'||k==='mouseAim') return () => ({x:0,z:0});
  if(k==='pad') return () => emptyPad();
  return () => false;
}}) as InputHandle;
function trial(style: ClockworkLaunchStyle) {
  const profile=CLOCKWORK_LAUNCHES[style];
  state.grid={w:1000,h:24,t:new Uint8Array(24000).fill(T_FLOOR),shapes:new Uint8Array(24000)};
  state.maze=null;state.vfx=null;state.zombies=[];state.pinballParts=[];state.groundItems=[];
  state.stairs=null;state.plungerArmed=false;state.fpsActive=false;state.partComboHits=0;state.frenzyPaid=false;
  const mesh=new Object3D();
  state.player={...freshPlayerFields(),x:-400,z:0,hp:6,flashT:0,cooldown:0,iframes:0,facing:'E',
    sprite:{mesh,setTint:()=>{},setElevation:()=>{},setBlobVisible:()=>{},sheet:{rideTransition:{
      enterFrames:profile.enterFrames,exitFrames:4,fps:profile.fps,
      ...(profile.speedMultiplier>1?{launch:{frame:Math.ceil((profile.enterFrames-1)*profile.release),speedMultiplier:profile.speedMultiplier,
        coastSeconds:profile.coastSeconds,frictionMultiplier:profile.frictionMultiplier,label:profile.label}}:{}),
    }}},
    anim:{play:()=>{},setRate:()=>{},setFacing:()=>{},getRate:()=>1,getClip:()=> 'ball'},
  } as unknown as NonNullable<typeof state.player>;
  resetPlayerMotion();const p=state.player!;p.momSpeed=8;p.momX=1;p.momZ=0;
  let distance=0,peakSpeed=8;
  for(let frame=0;frame<240;frame++) {
    const beforeX=p.x,beforeZ=p.z;
    updatePlayer(1/60,INPUT);
    distance+=Math.hypot(p.x-beforeX,p.z-beforeZ);peakSpeed=Math.max(peakSpeed,p.momSpeed);
  }
  return {style,distance,peakSpeed};
}
describe('Clockwork range through the real player update',()=>{
  it('carries football farther than bowling and baseball farther than football on identical open floor',()=>{
    const rows=(['bowling','football','baseball'] as const).map(trial);
    process.stdout.write('Clockwork 4-second range at 8 units/s: '+JSON.stringify(rows)+'\n');
    for(const row of rows){expect(Number.isFinite(row.distance)).toBe(true);expect(row.distance).toBeGreaterThan(0);}
    expect(rows[1].distance).toBeGreaterThan(rows[0].distance*1.1);
    expect(rows[2].distance).toBeGreaterThan(rows[1].distance*1.05);
  });
});
