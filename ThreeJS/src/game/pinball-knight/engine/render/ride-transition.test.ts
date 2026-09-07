import { describe, expect, it } from 'vitest';
import { Animator } from './animator';
import type { ActorSprite, SpriteSheet } from './sprite';
function actor(enabled = true) {
  let frame=-1, flipped=false;
  const clips=new Map<string,number[]>();
  for(const [dir,base] of [['S',0],['N',100],['E',200]] as const) {
    clips.set(`${dir}:idle`,[base,base+1]); clips.set(`${dir}:ball`,[base+10,base+11]);
    clips.set(`${dir}:roll`,Array.from({length:16},(_,i)=>base+20+i));
    clips.set(`${dir}:death`,[base+50,base+51]);
    clips.set(`${dir}:walk`,[base+60,base+61]);
  }
  const sheet={clips, ...(enabled ? {rideTransition:{enterFrames:8,exitFrames:4,fps:28}} : {})} as SpriteSheet;
  const sprite={sheet,setFrame:(n:number)=>frame=n,setFlipped:(v:boolean)=>flipped=v} as unknown as ActorSprite;
  const anim=new Animator(sprite);
  return {anim,get frame(){return frame},get flipped(){return flipped}};
}
describe('optional head-detachment ride transitions',()=>{
  it('shows removal once, keeps the gameplay clip, then spins the head',()=>{
    const a=actor();a.anim.play('ball');expect(a.anim.getClip()).toBe('ball');expect(a.frame).toBe(20);
    a.anim.update(3/28);expect(a.frame).toBe(23);
    a.anim.play('ball');a.anim.update(6/28);expect([10,11]).toContain(a.frame);
    a.anim.update(.2);expect([10,11]).toContain(a.frame);
  });
  it('uses the current direction and mirrors the entire west removal',()=>{
    const a=actor();a.anim.setFacing('W');a.anim.play('ball');expect(a.frame).toBe(220);expect(a.flipped).toBe(true);
    a.anim.setFacing('N');expect(a.frame).toBe(120);expect(a.flipped).toBe(false);
  });
  it('reattaches after leaving the ride, then resumes locomotion',()=>{
    const a=actor();a.anim.play('ball');a.anim.update(.4);a.anim.play('walk');expect(a.frame).toBe(32);
    a.anim.update(.18);expect([60,61]).toContain(a.frame);
  });
  it('death interrupts a lift immediately and stays terminal',()=>{
    const a=actor();a.anim.play('ball');a.anim.update(.05);a.anim.play('death');expect(a.frame).toBe(50);
    a.anim.play('walk');expect(a.anim.getClip()).toBe('death');
  });
  it('finishes the same launch when a slow roll accelerates into a ball',()=>{
    const a=actor();a.anim.play('roll');a.anim.update(3/28);expect(a.frame).toBe(23);
    a.anim.play('ball');expect(a.frame).toBe(23);
    a.anim.update(2.1/28);expect(a.frame).toBe(25);
    a.anim.play('roll');expect(a.frame).toBe(25);
    a.anim.update(4/28);expect(a.frame).toBeGreaterThanOrEqual(28);
    a.anim.play('ball');expect([10,11]).toContain(a.frame);
    a.anim.play('roll');expect(a.frame).toBe(28);
  });
  it('keeps only the head rolling during a long momentum ride and restores the suit on exit',()=>{
    const a=actor();a.anim.play('roll');a.anim.update(2);
    expect(a.frame).toBeGreaterThanOrEqual(28);expect(a.frame).toBeLessThanOrEqual(31);
    a.anim.play('idle');expect(a.frame).toBe(32);a.anim.update(.2);expect([0,1]).toContain(a.frame);
  });
  it('leaves existing characters on their original animation path',()=>{
    const a=actor(false);a.anim.play('ball');expect(a.frame).toBe(10);a.anim.play('idle');expect(a.frame).toBe(0);
  });
});
