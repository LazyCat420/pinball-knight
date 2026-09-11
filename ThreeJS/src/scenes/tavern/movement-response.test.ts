import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import type { InputHandle } from '../../game/pinball-knight/engine/input';
import { worldDirToScreen } from '../../game/pinball-knight/engine/camera';
import { tavern } from './state';
import { createTavernPlayer, disposeTavernPlayer, updateTavernPlayer } from './player';
import { moveInRoom } from './layout';
vi.mock('../../game/pinball-knight/render/knight-sheets',()=>({
  getKnightSheet:()=>({clips:new Map([['S:idle',[0,1]],['N:idle',[0,1]],['E:idle',[0,1]],['S:walk',[2,3]],['N:walk',[2,3]],['E:walk',[2,3]]])}),
  playerArtKey:()=> 'test',
}));
vi.mock('../../game/pinball-knight/engine/render/sprite',()=>({createActorSprite:(sheet:unknown)=>({sheet,mesh:new THREE.Object3D(),setFrame:()=>{},setFlipped:()=>{}})}));
function input(x:number,z=0):InputHandle{return {axis:()=>({x,z}),sprintHeld:()=>false} as InputHandle;}
beforeEach(()=>{disposeTavernPlayer();tavern.player=createTavernPlayer(new THREE.Scene());tavern.player.x=0;tavern.player.z=3;});
describe('tavern directional response',()=>{
  for(const [x,z,face] of [[-1,0,'W'],[1,0,'E'],[0,-1,'N'],[0,1,'S']] as const) it(`faces ${face} when walking that screen direction`,()=>{
    for(let i=0;i<12;i++)updateTavernPlayer(1/60,input(x,z),false);
    expect(tavern.player!.facing).toBe(face);
  });
  it('responds to a left/right reversal on the next movement frame',()=>{
    for(let i=0;i<15;i++)updateTavernPlayer(1/60,input(1),false);
    const {x,z}=tavern.player!;updateTavernPlayer(1/60,input(-1),false);
    const delta=worldDirToScreen(tavern.player!.x-x,tavern.player!.z-z);
    expect(delta.x).toBeLessThan(0);
  });
  it('stops immediately when a panel opens and accepts the next direction on close',()=>{
    for(let i=0;i<15;i++)updateTavernPlayer(1/60,input(1),false);
    const {x,z}=tavern.player!;
    updateTavernPlayer(1/60,input(1),true);
    expect(tavern.player!.x).toBe(x); expect(tavern.player!.z).toBe(z);
    expect(tavern.player!.speed).toBe(0);
    updateTavernPlayer(1/60,input(-1),false);
    expect(worldDirToScreen(tavern.player!.x-x,tavern.player!.z-z).x).toBeLessThan(0);
  });
  it('does not block open floor beside the round player at a table corner',()=>{
    // Table corner is (1.15,0). Target is sqrt(.25²+.25²) away,
    // outside the player's .32 radius, though inside its old square padding.
    const moved=moveInRoom(1.50,.25,1.40,.25);
    expect(moved.x).toBeCloseTo(1.40,5);expect(moved.z).toBeCloseTo(.25,5);
  });
});
