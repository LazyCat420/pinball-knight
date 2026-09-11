import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { attackPhase, gaitParameters, sampleGaitFoot, sampleKnightPose } from './knight-motion';
import { KnightAnimation } from './knight-animation';
import { createArmoredKnight } from './armored-knight';

describe('authored knight rig and motion', () => {
  it('plants the stance foot while the root advances, without stretching either leg bone', () => {
    const rig = createArmoredKnight(), point = new THREE.Vector3(), hip = new THREE.Vector3(), knee = new THREE.Vector3();
    const speed = 1.1, gait = gaitParameters(speed), contacts: number[] = [];
    try {
      for (let i = 0; i < 12; i++) {
        const phase = i / 12 * gait.stance * .65;
        rig.root.position.z = phase * gait.travel;
        rig.pose('walk', phase, 'bowling', { speed });
        const leg = rig.joints.legs[0];
        leg.hip.getWorldPosition(hip); leg.knee.getWorldPosition(knee); leg.ankle.getWorldPosition(point);
        expect(hip.distanceTo(knee)).toBeCloseTo(.58, 5); expect(knee.distanceTo(point)).toBeCloseTo(.58, 5);
        expect(point.y).toBeCloseTo(.16, 4); contacts.push(point.z);
      }
      expect(Math.max(...contacts) - Math.min(...contacts)).toBeLessThan(.001);
    } finally { rig.dispose(); }
  });
  it('bends the knees and preserves a continuous heel/toe cycle in walking and sprinting', () => {
    for (const speed of [1.1, 4.2, 6.9]) {
      const stance = gaitParameters(speed).stance;
      for (const seam of [stance, 1]) {
        const before = sampleGaitFoot(seam - 1e-6, -1, speed), after = sampleGaitFoot(seam + 1e-6, -1, speed);
        expect(new THREE.Vector3(...before.position).distanceTo(new THREE.Vector3(...after.position))).toBeLessThan(.0001);
        expect(Math.abs(before.pitch - after.pitch)).toBeLessThan(.0001);
      }
    }
    const rig = createArmoredKnight();
    try {
      const bends = [];
      for (let i = 0; i < 40; i++) { rig.pose('run', i / 40, 'bowling', { speed: 4.2 }); bends.push(rig.joints.legs[0].knee.quaternion.angleTo(new THREE.Quaternion())); }
      expect(Math.max(...bends) - Math.min(...bends)).toBeGreaterThan(.4);
    } finally { rig.dispose(); }
  });
  it('maps every weapon timing to the authored contact and recovery beats', () => {
    for (const timing of [{ windup: .08, active: .1, recovery: .12 }, { windup: .55, active: .24, recovery: .7 }]) {
      expect(attackPhase(timing.windup, timing)).toBeCloseTo(.34);
      expect(attackPhase(timing.windup + timing.active, timing)).toBeCloseTo(.62);
      expect(attackPhase(timing.windup + timing.active + timing.recovery, timing)).toBeCloseTo(1, 12);
    }
    const left = sampleKnightPose('attack', .45, { variant: 0 }), right = sampleKnightPose('attack', .45, { variant: 1 });
    expect(left.chest[1] * right.chest[1]).toBeLessThan(0);
  });
  it('does not walk against a wall or advance a paused attack', () => {
    const animation = new KnightAnimation();
    const frame = { dt: 1 / 60, clip: 'walk' as const, heading: 0, speed: 0, distance: 0, worldScale: .375, weapon: 'sword' as const };
    for (let i = 0; i < 120; i++) animation.update(frame);
    expect(animation.inspect().phase).toBe(0);
    const attack = { ...frame, clip: 'attack' as const, attackTime: .2 };
    for (let i = 0; i < 20; i++) animation.update(attack);
    const before = animation.update({ ...attack, dt: 0 });
    for (let i = 0; i < 60; i++) expect(animation.update({ ...attack, dt: 0 })).toEqual(before);
  });
  it('turns through the short arc and keeps walk/run changes on the same gait clock', () => {
    const animation = new KnightAnimation();
    const frame = { dt: 1 / 60, clip: 'walk' as const, heading: Math.PI - .05, speed: 2, distance: 2 / 60, worldScale: .375, weapon: 'sword' as const };
    for (let i = 0; i < 60; i++) animation.update(frame);
    const phase = animation.inspect().phase, heading = animation.heading;
    animation.update({ ...frame, clip: 'run', heading: -Math.PI + .05 });
    expect(animation.inspect().phase).toBeGreaterThan(phase);
    expect(Math.abs(animation.heading - heading)).toBeLessThan(.05);
  });
});

describe('rigged rolling and ball transitions', () => {
  it('keeps the knight assembled throughout a full tumble with rigid limb lengths', () => {
    const rig=createArmoredKnight(),hip=new THREE.Vector3(),knee=new THREE.Vector3(),ankle=new THREE.Vector3();
    try {
      for(let i=0;i<=24;i++) {
        rig.applyPose(sampleKnightPose('armored-ball',i/24*Math.PI*2));
        expect(rig.body.visible).toBe(true); expect(rig.head.visible).toBe(true);
        for(const leg of rig.joints.legs){leg.hip.getWorldPosition(hip);leg.knee.getWorldPosition(knee);leg.ankle.getWorldPosition(ankle);expect(hip.distanceTo(knee)).toBeCloseTo(.58,5);expect(knee.distanceTo(ankle)).toBeCloseTo(.58,5);}
        const bounds=new THREE.Box3().setFromObject(rig.body);
        expect(Number.isFinite(bounds.min.y)).toBe(true);
      }
    } finally {rig.dispose();}
  });
  it('spins from achieved travel, freezes during hitstop, and recovers without unwinding earlier turns', () => {
    const animation=new KnightAnimation();
    const frame={dt:1/60,clip:'armored-ball' as const,heading:0,speed:6,distance:.1,worldScale:.375,weapon:'sword' as const};
    for(let i=0;i<180;i++)animation.update(frame);
    const angle=animation.inspect().pose.tumbleAngle;
    for(let i=0;i<20;i++)expect(animation.update({...frame,dt:0}).tumbleAngle).toBe(angle);
    for(let i=0;i<20;i++)expect(animation.update({...frame,distance:0,speed:0}).tumbleAngle).toBe(angle);
    let previous=angle;
    for(let i=0;i<30;i++){
      const p=animation.update({...frame,clip:'idle',distance:0,speed:0});
      expect(Math.abs(p.tumbleAngle-previous)).toBeLessThan(.5); previous=p.tumbleAngle;
    }
    expect(Math.abs(previous-angle)).toBeLessThanOrEqual(Math.PI);
    expect(Math.sin(previous)).toBeCloseTo(0,8);
    expect(animation.inspect().pose.pelvisPosition[1]).toBeGreaterThan(1.2);
    expect(animation.inspect().pose.weaponVisible).toBe(true);
  });
  it('keeps orientation when a new roll interrupts getting back up', () => {
    const animation=new KnightAnimation();
    const frame={dt:1/60,clip:'tumble' as const,heading:0,speed:4,distance:4/60,worldScale:.375,weapon:'sword' as const};
    for(let i=0;i<45;i++)animation.update(frame);
    for(let i=0;i<5;i++)animation.update({...frame,clip:'idle',speed:0,distance:0});
    const before=animation.inspect().pose.tumbleAngle;
    const after=animation.update(frame).tumbleAngle;
    expect(after).toBeGreaterThanOrEqual(before);
    expect(after-before).toBeLessThan(.1);
  });
  it('blends the chrome potion shell and restores the articulated knight afterward', () => {
    const animation=new KnightAnimation();
    const frame={dt:1/60,clip:'steel-ball' as const,heading:0,speed:0,distance:0,worldScale:.375,weapon:'sword' as const};
    const early=animation.update(frame);expect(early.shellWeight).toBeGreaterThan(0);expect(early.shellWeight).toBeLessThan(1);
    for(let i=0;i<30;i++)animation.update(frame);
    expect(animation.inspect().pose.shellWeight).toBe(1);
    for(let i=0;i<30;i++)animation.update({...frame,clip:'idle'});
    expect(animation.inspect().pose.shellWeight).toBe(0);
  });
});
