/** Open through Vite and call window.checkPixelFilter(). Uses real GPU readback,
 * including alpha cutouts, a translucent effect, shared materials and occlusion. */
import * as THREE from "three";
import { WebGPURenderer } from "three/webgpu";
import { createPixelPass } from "../src/game/pinball-knight/engine/render/pixel-pass";
import { engineConfig } from "../src/game/pinball-knight/engine/config";

async function checkPixelFilter() {
  const renderer = new WebGPURenderer({ antialias: false });
  await renderer.init();
  if (!renderer.backend.isWebGPUBackend) throw Error("WebGPU required");
  document.body.append(renderer.domElement);
  const size = 224;
  const pixels = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const i = (y * size + x) * 4;
    pixels.set([(x % 7) * 35, (y % 5) * 50, 200, 255], i);
  }
  const art = new THREE.DataTexture(pixels, size, size);
  art.needsUpdate = true;
  art.magFilter = art.minFilter = THREE.NearestFilter;
  const material = new THREE.MeshStandardMaterial({ map: art, roughness: 1 });
  const scene = new THREE.Scene();
  scene.add(new THREE.AmbientLight(0xffffff, 2));
  const backdrop = new THREE.Mesh(new THREE.PlaneGeometry(30, 20), material);
  backdrop.userData.pixelEnvironment = true;
  scene.add(backdrop);
  const actor = new THREE.Mesh(new THREE.PlaneGeometry(4, 4), material);
  actor.position.set(2, 0, 1);
  scene.add(actor); // Same material as backdrop; different protection.
  const cutPixels = pixels.slice();
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    if (x % 9 < 3 || y % 11 < 3) cutPixels[(y * size + x) * 4 + 3] = 0;
  }
  const cutArt = new THREE.DataTexture(cutPixels, size, size);
  cutArt.needsUpdate = true;
  const cutout = new THREE.Mesh(new THREE.PlaneGeometry(3, 3), new THREE.MeshStandardMaterial({ map: cutArt, alphaTest: 0.5 }));
  cutout.position.set(-2, 0, 1);
  cutout.userData.pixelEnvironment = true; // Cutouts remain protected.
  scene.add(cutout);
  const effect = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.MeshBasicMaterial({ color: 0xff3300, opacity: 0.4, transparent: true }));
  effect.position.set(0, -1, 2);
  scene.add(effect);
  const wall = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 5), new THREE.MeshStandardMaterial({ color: 0x123456 }));
  wall.position.set(2, 0, 3); // Occludes the middle of the protected actor.
  wall.userData.pixelEnvironment = true;
  scene.add(wall);

  // Equal-depth, equal-colour faces with a normal crease: only normal-based
  // ink can reveal the join. It must occupy one original pixel, not a block.
  const creaseMaterial = new THREE.MeshStandardMaterial({ color: 0, emissive: 0x999999, metalness: 1 });
  for (const side of [-1, 1]) {
    const geometry = new THREE.PlaneGeometry(2, 1);
    if (side > 0) {
      const normals = geometry.getAttribute("normal");
      for (let i = 0; i < normals.count; i++) normals.setXYZ(i, 0.8, 0, 0.6);
    }
    const face = new THREE.Mesh(geometry, creaseMaterial);
    face.position.set(side, 3, 4);
    face.userData.pixelEnvironment = true;
    scene.add(face);
  }

  const uiCanvas = document.createElement("canvas");
  uiCanvas.width = innerWidth; uiCanvas.height = innerHeight;
  const ui = uiCanvas.getContext("2d")!;
  ui.fillStyle = "white";
  for (let x = 20; x < 200; x += 2) ui.fillRect(x, 20, 1, 20);
  const uiTexture = new THREE.CanvasTexture(uiCanvas);
  uiTexture.minFilter = uiTexture.magFilter = THREE.NearestFilter;
  const pass = createPixelPass(renderer, { quantize: false, dither: false, scanline: false, outline: false, bloom: false, ao: false, cel: false, uiTexture });
  pass.setUiEnabled(true);
  const camera = new THREE.OrthographicCamera(-10, 10, 6, -6, 0.1, 100);
  camera.position.z = 10;
  const {renderW:w, renderH:h} = pass.sizing();
  // WebGPU readback retains 256-byte row padding (including odd widths).
  const stride = Math.ceil(w * 4 / 256) * 256;
  const result = new THREE.WebGLRenderTarget(w, h);
  const readFrame = async (mode: "off" | "subtle" | "chunky") => {
    pass.setPixelFilter(mode);
    pass.render(scene, camera);
    const post = pass.debugPost();
    renderer.setRenderTarget(result);
    renderer.render(post.scene, post.camera);
    renderer.setRenderTarget(null);
    return new Uint8Array(await renderer.readRenderTargetPixelsAsync(result, 0, 0, w, h));
  };
  try {
    const off = await readFrame("off");
    const mask = new Uint8Array(await renderer.readRenderTargetPixelsAsync(pass.target, 0, 0, w, h, 2));
    const stats = [];
    for (const mode of ["subtle", "chunky"] as const) {
      const frame = await readFrame(mode);
      let protectedCount = 0, protectedChanged = 0, sceneryChanged = 0, uiChanged = 0;
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const i = y * stride + x * 4;
        const changed = frame[i] !== off[i] || frame[i+1] !== off[i+1] || frame[i+2] !== off[i+2];
        if (mask[i] > 0) { protectedCount++; if (changed) protectedChanged++; }
        else if (changed) sceneryChanged++;
        // The opaque one-pixel UI stripes must survive at their own grid.
        if (x >= 20 && x < 200 && x % 2 === 0 && y >= 20 && y < 40 && changed) uiChanged++;
      }
      const at = (x: number, y: number) => mask[y * stride + x * 4];
      const actorX = Math.round(w/2 + 2 * engineConfig.camera.ppu);
      const wallMask = at(actorX, Math.floor(h/2));
      if (!protectedCount || protectedChanged || uiChanged || sceneryChanged < 1000 || wallMask !== 0) {
        throw Error(JSON.stringify({mode, protectedCount, protectedChanged, sceneryChanged, uiChanged, wallMask}));
      }
      const creaseY = Math.round(h/2 - 3 * engineConfig.camera.ppu);
      let creaseWidth = 0, creaseRows = 0;
      for (let y = creaseY - 10; y <= creaseY + 10; y++) {
        let changedColumns = 0;
        for (let x = Math.floor(w/2) - 3; x <= Math.floor(w/2) + 3; x++) {
          const i = y * stride + x * 4;
          if (frame[i] !== off[i] || frame[i+1] !== off[i+1] || frame[i+2] !== off[i+2]) changedColumns++;
        }
        creaseWidth = Math.max(creaseWidth, changedColumns);
        if (changedColumns) creaseRows++;
      }
      if (creaseWidth !== 1 || creaseRows !== 21) throw Error(JSON.stringify({mode, creaseWidth, creaseRows}));
      stats.push({mode, protectedCount, protectedChanged, sceneryChanged, uiChanged, wallMask, creaseWidth, creaseRows});
    }
    const restored = await readFrame("off");
    if (restored.some((value, i) => value !== off[i])) throw Error("Off does not restore the original frame");
    return { backend: renderer.backend.constructor.name, width: w, height: h, stats };
  } finally {
    pass.dispose(); result.dispose(); renderer.dispose(); renderer.domElement.remove();
    scene.traverse((o) => { if (o instanceof THREE.Mesh) { o.geometry.dispose(); (o.material as THREE.Material).dispose(); } });
    art.dispose(); cutArt.dispose(); uiTexture.dispose();
  }
}
Object.assign(window, { checkPixelFilter });
