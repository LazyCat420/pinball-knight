import { describe, it, expect, vi } from 'vitest';
import * as THREE from 'three';
import { warmIntro } from './warmup';

describe('intro shader warm-up', () => {
  it.each([false, true])('warms hidden chapters and restores visibility, failure=%s', async failure => {
    const scene = new THREE.Scene();
    const arcade = new THREE.Group(); arcade.visible = false;
    const mesh = new THREE.Mesh(); arcade.add(mesh); scene.add(arcade);
    const camera = new THREE.PerspectiveCamera();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const compileAsync = vi.fn(async () => {
      expect(arcade.visible).toBe(true);
      expect(mesh.frustumCulled).toBe(false);
      if (failure) throw Error('driver unavailable');
    });
    try {
      await warmIntro({ compileAsync } as never, scene, camera);
      expect(compileAsync).toHaveBeenCalledWith(scene, camera);
      expect(arcade.visible).toBe(false);
      expect(mesh.frustumCulled).toBe(true);
    } finally { warn.mockRestore(); }
  });
});
