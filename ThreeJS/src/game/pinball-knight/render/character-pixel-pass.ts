import * as THREE from 'three';
import type { WebGPURenderer } from 'three/webgpu';

/** Pixelate live characters after lighting, retaining the scene's occlusion. */
export function createCharacterPixelPass(characters: THREE.Object3D[]) {
  const target = new THREE.RenderTarget(1, 1, { minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, generateMipmaps: false });
  const quadMaterial = new THREE.MeshBasicMaterial({ map: target.texture, transparent: true, depthTest: false, depthWrite: false });
  const quadGeometry = new THREE.PlaneGeometry(2, 2);
  // Node-renderer render targets require one vertical correction per sampling hop.
  const texcoords = quadGeometry.attributes.uv;
  for (let i = 0; i < texcoords.count; i++) texcoords.setY(i, 1 - texcoords.getY(i));
  const overlay = new THREE.Scene(); overlay.add(new THREE.Mesh(quadGeometry, quadMaterial));
  const screenCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const size = new THREE.Vector2();
  const characterMeshes = new Set<THREE.Object3D>();
  characters.forEach(root => root.traverse(object => characterMeshes.add(object)));
  return {
    render(renderer: WebGPURenderer, scene: THREE.Scene, camera: THREE.Camera) {
      renderer.getDrawingBufferSize(size);
      const w = Math.max(1, Math.ceil(size.x / 4)), h = Math.max(1, Math.ceil(size.y / 4));
      if (target.width !== w || target.height !== h) target.setSize(w, h);
      const oldTarget = renderer.getRenderTarget(), oldAutoClear = renderer.autoClear;
      const clear = renderer.getClearColor(new THREE.Color()), alpha = renderer.getClearAlpha();
      const background = scene.background;
      const visible = characters.map(root => root.visible);
      const writes = new Map<THREE.Material, boolean>();
      try {
        characters.forEach(root => root.visible = false);
        renderer.setRenderTarget(oldTarget); renderer.autoClear = true; renderer.render(scene, camera);
        characters.forEach((root, i) => root.visible = visible[i]);
        scene.traverse(object => {
          if (!(object instanceof THREE.Mesh || object instanceof THREE.Line || object instanceof THREE.Points || object instanceof THREE.Sprite) || characterMeshes.has(object)) return;
          const materials = Array.isArray(object.material) ? object.material : [object.material];
          materials.forEach(material => { if (!writes.has(material)) writes.set(material, material.colorWrite); material.colorWrite = false; });
        });
        scene.background = null;
        renderer.setRenderTarget(target); renderer.setClearColor(0, 0); renderer.render(scene, camera);
        writes.forEach((write, material) => material.colorWrite = write);
        scene.background = background;
        renderer.setRenderTarget(oldTarget); renderer.autoClear = false; renderer.render(overlay, screenCamera);
      } finally {
        characters.forEach((root, i) => root.visible = visible[i]);
        writes.forEach((write, material) => material.colorWrite = write);
        scene.background = background;
        renderer.setRenderTarget(oldTarget); renderer.autoClear = oldAutoClear; renderer.setClearColor(clear, alpha);
      }
    },
    dispose() { target.dispose(); quadMaterial.dispose(); quadGeometry.dispose(); },
  };
}
