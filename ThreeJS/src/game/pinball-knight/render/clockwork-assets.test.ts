/// <reference types="node" />
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createClockworkKnight, HEAD_REST_Y, HEAD_RADIUS } from './clockwork-knight';
import { IMPORTED_FACINGS } from '../boot/manifest-inventory';

describe('published Clockwork Knight',()=>{
  for(const name of ['clockwork_knight','clockwork_knight_football','clockwork_knight_baseball']) for(const dir of ['S','N','E']) it(`${name} ${dir} has a matching PNG and all registered frames`,()=>{
    const base=new URL(`../../../../public/sprites/${name}-${dir}`,import.meta.url);
    const manifest=JSON.parse(readFileSync(new URL(base+'.json'),'utf8'));
    const png=readFileSync(new URL(base+'.png'));
    expect(manifest.source).toEqual([png.readUInt32BE(16),png.readUInt32BE(20)]);
    expect(manifest.hash).toBe(createHash('sha256').update(png).digest('hex').slice(0,12));
    expect(manifest.name).toBe(name);expect(manifest.dir).toBe(dir);
    expect(manifest.rows.map((r:{clip:string})=>r.clip)).toEqual(['idle','walk','run','attack','death','roll','ball']);
    const cells:number[][]=manifest.rows.flatMap((r:{cells:number[][]})=>r.cells);
    expect(cells).toHaveLength(name.endsWith("baseball") ? 88 : 72);
    for(const [x0,y0,x1,y1] of cells){expect(x0).toBeGreaterThanOrEqual(0);expect(y0).toBeGreaterThanOrEqual(0);expect(x1).toBeLessThan(manifest.source[0]);expect(y1).toBeLessThan(manifest.source[1]);expect(x1).toBeGreaterThan(x0);expect(y1).toBeGreaterThan(y0);}
    expect(new Set(cells.map(([x0,y0,x1,y1])=>`${x1-x0},${y1-y0}`)).size).toBe(1);
  });
  it('uses distinct launch trajectories and stows the sword for bowling',()=>{
    const rig=createClockworkKnight();
    try {
      const positions=['bowling','football','baseball'].map(emote=>{
        rig.pose('remove',.88,emote as 'bowling'|'football'|'baseball');
        return rig.head.position.toArray().join(',');
      });
      expect(new Set(positions).size).toBe(3);
      rig.pose('attack',.5);
      const sword=rig.root.getObjectByName('Clockwork sword')!;
      expect(sword.parent).not.toBe(rig.body);
      rig.pose('roll',.2,'bowling'); expect(sword.parent).toBe(rig.body);
      rig.pose('ball',.2); expect(rig.body.visible).toBe(false);
    } finally { rig.dispose(); }
  });
  it('cocks the helmet behind the throwing shoulder and releases it with one hand',()=>{
    const rig=createClockworkKnight();
    try {
      rig.pose('remove',.32,'football'); rig.root.updateMatrixWorld(true);
      const cocked=rig.head.position.clone();
      expect(cocked.x).toBeGreaterThan(.5);expect(cocked.z).toBeLessThan(0);
      const right=rig.root.getObjectByName('Right grip')!.getWorldPosition(new THREE.Vector3());
      const left=rig.root.getObjectByName('Left grip')!.getWorldPosition(new THREE.Vector3());
      expect(right.distanceTo(cocked)).toBeLessThan(left.distanceTo(cocked));
      rig.pose('remove',.8,'football');expect(rig.head.position.z).toBeGreaterThan(1);
      expect(rig.head.rotation.z).toBeGreaterThan(5);
      expect(rig.root.getObjectByName('Basketball practice wall')).toBeUndefined();
    } finally { rig.dispose(); }
  });
  it('keeps both batting hands on the hilt while hips lead the shoulders',()=>{
    const rig=createClockworkKnight();
    try {
      rig.pose('remove',.3,'baseball');const hipLoad=rig.body.rotation.y, shoulderLoad=rig.torso.rotation.y;
      rig.pose('remove',.35,'baseball');expect(rig.body.rotation.y).toBeGreaterThan(hipLoad);
      expect(rig.torso.rotation.y).toBeCloseTo(shoulderLoad);
      for(const u of [.26,.45,.5,.62]) {
        rig.pose('remove',u,'baseball');rig.root.updateMatrixWorld(true);
        const sword=rig.root.getObjectByName('Clockwork sword')!;
        for(const [name,y] of [['Left grip',-.09],['Right grip',.025]] as const) {
          const target=sword.localToWorld(new THREE.Vector3(0,y,0));
          const wrist=rig.root.getObjectByName(name)!.getWorldPosition(new THREE.Vector3());
          expect(wrist.distanceTo(target)).toBeLessThan(.015);
        }
      }
    } finally { rig.dispose(); }
  });
  it('uses the sword for baseball and accelerates the bowling release',()=>{
    const rig=createClockworkKnight();
    try {
      rig.pose('remove',.8,'baseball');
      expect(rig.root.getObjectByName('Clockwork sword')?.position.z).toBeGreaterThan(0);
      expect(rig.root.getObjectByName('Baseball bat')).toBeUndefined();
      rig.pose('remove',.8,'bowling'); const early=rig.head.position.z;
      rig.pose('remove',.9,'bowling'); const mid=rig.head.position.z;
      rig.pose('remove',1,'bowling'); const end=rig.head.position.z;
      expect(end-mid).toBeGreaterThan(mid-early);
      expect(rig.head.position.y).toBeCloseTo(HEAD_RADIUS);
    } finally { rig.dispose(); }
  });
  it('strikes before a catapult arc, then lands the head at rolling height',()=>{
    const rig=createClockworkKnight();
    try {
      rig.pose('remove',.5,'baseball'); const impact=rig.head.position.clone();
      rig.pose('remove',.75,'baseball'); const apex=rig.head.position.clone();
      expect(apex.y).toBeGreaterThan(impact.y+1);
      expect(apex.z).toBeGreaterThan(impact.z);
      rig.pose('remove',1,'baseball');
      expect(rig.head.position.y).toBeCloseTo(HEAD_RADIUS);
      expect(rig.head.position.z).toBeGreaterThan(apex.z);
      expect(rig.body.visible).toBe(true);
      rig.pose('ball',0); expect(rig.body.visible).toBe(false);
    } finally { rig.dispose(); }
  });
  it('registers three authored facings instead of falling back to a front view',()=>{
    expect(IMPORTED_FACINGS.clockwork_knight).toEqual(['E','N','S']);
  });
  it('removes one head from a standing suit and restores the same rig',()=>{
    const rig=createClockworkKnight();
    try{
      rig.pose('remove',.37);expect(rig.head.position.y).toBeGreaterThan(HEAD_REST_Y+.4);expect(rig.body.visible).toBe(true);
      rig.pose('ball',.3);expect(rig.body.visible).toBe(false);expect(rig.head.position.y).toBe(HEAD_RADIUS);
      rig.pose('return',1);expect(rig.body.visible).toBe(true);expect(rig.head.position.y).toBeCloseTo(HEAD_REST_Y);
      rig.pose('idle',0);expect(rig.head.rotation.x).toBe(0);expect(rig.body.scale.x).toBe(1);
    }finally{rig.dispose();}
  });
});
