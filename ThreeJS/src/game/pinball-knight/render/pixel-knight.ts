/** Live 3D armour rendered to a character-only, nearest-neighbour pixel layer. */
import * as THREE from 'three';
import type { WebGPURenderer } from 'three/webgpu';
import type { ActorSprite } from '../engine/render/sprite';
import type { Facing } from '../engine/render/animator';
import { SPRITE_UNITS } from '../constants';
import type { WeaponId } from '../items';
import { playerSheetName, DEFAULT_PLAYER_SHEET } from './knight-sheets';
import { createArmoredKnight } from './armored-knight';
import type { ClockworkPose } from './clockwork-knight';
import { KnightAnimation } from './knight-animation';
import { worldDirToScreen } from '../engine/camera';

export interface KnightPresentation {
  dt: number; x: number; z: number; attackTime?: number;
  timing?: { windup: number; active: number; recovery: number } | null;
  variant?: number; hp?: number; charge?: number;
}

export function createPixelKnightLayer() {
  let actor: ActorSprite | null = null;
  let release: (() => void) | null = null;
  let draw: ((renderer: WebGPURenderer, clip: string, facing: Facing, t: number, weapon: WeaponId, motion?: KnightPresentation) => void) | null = null;
  function dispose() { release?.(); release = null; draw = null; actor = null; }
  function update(renderer: WebGPURenderer, sprite: ActorSprite, clip: string, facing: Facing, t: number, weapon: WeaponId, motion?: KnightPresentation) {
    if (playerSheetName() !== DEFAULT_PLAYER_SHEET) { dispose(); return; }
    if (actor !== sprite) {
      dispose(); actor = sprite;
      const rig = createArmoredKnight();
      const scene = new THREE.Scene(); scene.add(rig.root);
      scene.add(new THREE.HemisphereLight(0xd8ecff, 0x473728, 3));
      const key = new THREE.DirectionalLight(0xffedcf, 5); key.position.set(-3, 5, 6); scene.add(key);
      const rim = new THREE.DirectionalLight(0x9bcfff, 3); rim.position.set(4, 3, -2); scene.add(rim);
      const camera = new THREE.OrthographicCamera(-1.8, 1.8, 2, -2, .1, 30);
      camera.position.set(0, 3.5, 10); camera.lookAt(0, 1.8, 0);
      const target = new THREE.RenderTarget(72, 80, { minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, generateMipmaps: false });
      const material = new THREE.MeshBasicMaterial({ map: target.texture, transparent: true, alphaTest: .5, side: THREE.DoubleSide });
      const geometry = new THREE.PlaneGeometry(SPRITE_UNITS * .9, SPRITE_UNITS); geometry.translate(0, SPRITE_UNITS / 2, .001);
      const texcoords = geometry.attributes.uv;
      for (let i = 0; i < texcoords.count; i++) texcoords.setY(i, 1 - texcoords.getY(i));
      const plane = new THREE.Mesh(geometry, material); plane.renderOrder = sprite.mesh.renderOrder;
      plane.name = 'Live pixel armour';
      const silhouette = sprite.mesh.children.find(child => child instanceof THREE.Mesh && (child.material as THREE.Material).depthFunc === THREE.GreaterDepth) as THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial> | undefined;
      const silhouetteGeometry = silhouette?.geometry;
      function syncSilhouette(live: boolean) {
        if (!silhouette) return;
        silhouette.geometry = live ? geometry : silhouetteGeometry!;
        const map = live ? target.texture : (sprite.mesh.material as THREE.MeshBasicMaterial).map;
        if (silhouette.material.map !== map) { silhouette.material.map = map; silhouette.material.needsUpdate = true; }
      }
      sprite.mesh.add(plane);
      const source = sprite.mesh.material as THREE.Material;
      const originalVisible = source.visible;
      const originalDispose = sprite.dispose;
      let released = false;
      release = () => {
        if (released) return; released = true;
        syncSilhouette(false); source.visible = originalVisible; plane.removeFromParent(); geometry.dispose(); material.dispose(); target.dispose(); rig.dispose();
        sprite.dispose = originalDispose;
      };
      const cleanup = release;
      sprite.dispose = () => { cleanup(); originalDispose(); };
      const animation = new KnightAnimation();
      let lastTime = NaN, lastX = NaN, lastZ = NaN, lastHp = NaN, lastHeading = NaN;
      draw = (r, name, direction, time, held, motion) => {
        if (released) return;
        const supported = ['idle', 'walk', 'run', 'attack', 'death'].includes(name);
        syncSilhouette(supported);
        plane.visible = supported; source.visible = supported ? false : originalVisible;
        const dt = motion?.dt ?? (Number.isFinite(lastTime) ? Math.max(0, Math.min(.1, time - lastTime)) : 0);
        let distance = motion && Number.isFinite(lastX) ? Math.hypot(motion.x - lastX, motion.z - lastZ) : 0;
        const dx = motion ? motion.x - lastX : 0, dz = motion ? motion.z - lastZ : 0;
        // Warps and scene changes are not steps.
        if (distance > Math.max(.8, dt * 20)) distance = 0;
        const velocity = distance > .00001 ? worldDirToScreen(dx, dz) : null;
        const hurt = !!motion && Number.isFinite(lastHp) && motion.hp != null && motion.hp < lastHp;
        lastTime = time;
        if (motion) { lastX = motion.x; lastZ = motion.z; lastHp = motion.hp ?? NaN; }
        if (!supported) return;
        material.color.copy((sprite.mesh.material as THREE.MeshBasicMaterial).color);
        const moving = name === 'walk' || name === 'run';
        const heading = moving && velocity ? Math.atan2(velocity.x, velocity.z)
          : name === 'idle' && Number.isFinite(lastHeading) ? lastHeading
          : { S: 0, N: Math.PI, E: Math.PI / 2, W: -Math.PI / 2 }[direction];
        lastHeading = heading;
        rig.setWeapon(held);
        const pose = animation.update({ dt, clip: name as ClockworkPose, heading, distance,
          speed: dt > 0 ? distance / dt : 0, worldScale: SPRITE_UNITS / 4, weapon: held,
          attackTime: motion?.attackTime ?? (name === 'attack' ? time * .48 : 0), timing: motion?.timing,
          variant: motion?.variant, charge: motion?.charge, hurt });
        rig.root.rotation.y = animation.heading; rig.applyPose(pose);
        if (!sprite.mesh.visible) return;
        const oldTarget = r.getRenderTarget(), oldColor = r.getClearColor(new THREE.Color()), oldAlpha = r.getClearAlpha();
        const oldAutoClear = r.autoClear;
        try {
          r.autoClear = true; r.setRenderTarget(target); r.setClearColor(0, 0); r.render(scene, camera);
        } finally {
          r.setRenderTarget(oldTarget); r.setClearColor(oldColor, oldAlpha); r.autoClear = oldAutoClear;
        }
      };
    }
    draw?.(renderer, clip, facing, t, weapon, motion);
  }
  return { update, dispose };
}
