import { afterEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import type { WebGPURenderer } from 'three/webgpu';
import type { ActorSprite } from '../engine/render/sprite';
const selection = vi.hoisted(() => ({ sheet: 'pinball_knight' }));
vi.mock('./knight-sheets', () => ({ DEFAULT_PLAYER_SHEET: 'pinball_knight', playerSheetName: () => selection.sheet }));
import { createPixelKnightLayer } from './pixel-knight';
import { SPRITE_UNITS } from '../constants';

afterEach(() => { selection.sheet = 'pinball_knight'; });
function fixture() {
  const map = new THREE.Texture();
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map }));
  const silhouette = new THREE.Mesh(mesh.geometry, new THREE.MeshBasicMaterial({ map, depthFunc: THREE.GreaterDepth }));
  mesh.add(silhouette);
  const originalDispose = vi.fn();
  const sprite = { mesh, dispose: originalDispose } as unknown as ActorSprite;
  const target = new THREE.RenderTarget(7, 9);
  const renderer = { autoClear: false, getRenderTarget: () => target, setRenderTarget: vi.fn(), getClearColor: (c: THREE.Color) => c.set(0x123456), getClearAlpha: () => .7, setClearColor: vi.fn(), render: vi.fn() };
  const layer = createPixelKnightLayer();
  const update = (clip = 'idle') => layer.update(renderer as unknown as WebGPURenderer, sprite, clip, 'S', .2, 'sword');
  const cleanup = () => { layer.dispose(); mesh.geometry.dispose(); mesh.material.dispose(); silhouette.material.dispose(); map.dispose(); target.dispose(); };
  return { map, mesh, silhouette, sprite, renderer, target, layer, update, originalDispose, cleanup };
}
describe('live pixel knight integration', () => {
  it('keeps the occluded silhouette registered with the live model and restores ride art', () => {
    const f = fixture();
    try {
      f.update();
      const model = f.mesh.children.find(child => child.name === 'Live pixel armour') as THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
      expect(f.mesh.material.visible).toBe(false);
      expect(model.geometry.parameters.height).toBe(SPRITE_UNITS);
      expect(f.silhouette.geometry).toBe(model.geometry);
      expect(f.silhouette.material.map).toBe(model.material.map);
      f.update('ball');
      expect(model.visible).toBe(false);
      expect(f.mesh.material.visible).toBe(true);
      expect(f.silhouette.geometry).toBe(f.mesh.geometry);
      expect(f.silhouette.material.map).toBe(f.map);
    } finally { f.cleanup(); }
  });
  it('releases the live layer on character changes and actor disposal without accumulating children', () => {
    const f = fixture();
    try {
      f.update(); f.update(); expect(f.mesh.children).toHaveLength(2);
      selection.sheet = 'mario'; f.update();
      expect(f.mesh.children).toHaveLength(1); expect(f.mesh.material.visible).toBe(true);
      selection.sheet = 'pinball_knight'; f.update(); f.sprite.dispose();
      expect(f.originalDispose).toHaveBeenCalledOnce(); expect(f.mesh.children).toHaveLength(1);
    } finally { f.cleanup(); }
  });
  it('restores the caller render target and clear state even if the character pass fails', () => {
    const f = fixture();
    try {
      f.renderer.render.mockImplementation(() => { throw new Error('GPU render failed'); });
      expect(() => f.update()).toThrow('GPU render failed');
      expect(f.renderer.setRenderTarget).toHaveBeenLastCalledWith(f.target);
      expect(f.renderer.setClearColor).toHaveBeenLastCalledWith(new THREE.Color(0x123456), .7);
      expect(f.renderer.autoClear).toBe(false);
    } finally { f.cleanup(); }
  });
});
