/** Procedural, shared-geometry toon sets for the opening cinematic. */
import * as THREE from 'three';
import { buildTitleGrid } from './title-grid';
import { T_WALL } from '../maze/generator';
import { createArmoredKnight } from '../render/armored-knight';

export function createCinematic() {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#202540');
  const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 180);
  const gradient = new THREE.DataTexture(new Uint8Array([65, 145, 225, 255]), 4, 1, THREE.RedFormat);
  gradient.minFilter = gradient.magFilter = THREE.NearestFilter;
  gradient.needsUpdate = true;
  const materials = new Map<string, THREE.Material>();
  const geometries = new Set<THREE.BufferGeometry>();
  const textures: THREE.Texture[] = [gradient];
  const boxGeo = new THREE.BoxGeometry(1, 1, 1);
  const sphereGeo = new THREE.SphereGeometry(1, 12, 8);
  geometries.add(boxGeo); geometries.add(sphereGeo);
  function mat(color: string, glow = false) {
    const key = color + glow;
    if (!materials.has(key)) materials.set(key, glow
      ? new THREE.MeshBasicMaterial({ color })
      : new THREE.MeshToonMaterial({ color, gradientMap: gradient }));
    return materials.get(key)!;
  }
  function box(parent: THREE.Object3D, x: number, y: number, z: number, w: number, h: number, d: number, color: string, glow = false) {
    const mesh = new THREE.Mesh(boxGeo, mat(color, glow));
    mesh.position.set(x, y, z); mesh.scale.set(w, h, d); parent.add(mesh); return mesh;
  }
  function orb(parent: THREE.Object3D, x: number, y: number, z: number, r: number, color: string) {
    const mesh = new THREE.Mesh(sphereGeo, mat(color)); mesh.position.set(x, y, z); mesh.scale.setScalar(r); parent.add(mesh); return mesh;
  }
  function sign(parent: THREE.Object3D, label: string, x: number, y: number, z: number, width: number, color = '#ffe1a0') {
    const canvas = document.createElement('canvas'); canvas.width = 1024; canvas.height = 192;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#171c32'; ctx.fillRect(0, 0, 1024, 192);
    ctx.strokeStyle = color; ctx.lineWidth = 8; ctx.strokeRect(10, 10, 1004, 172);
    ctx.font = '800 88px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillStyle = color; ctx.fillText(label, 512, 103, 960);
    const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace; textures.push(texture);
    const material = new THREE.MeshBasicMaterial({ map: texture }); materials.set(`${label}-${materials.size}`, material);
    const geo = new THREE.PlaneGeometry(width, width * 192 / 1024); geometries.add(geo);
    const mesh = new THREE.Mesh(geo, material); mesh.position.set(x, y, z); parent.add(mesh);
  }
  scene.add(new THREE.HemisphereLight('#bce3ff', '#67517b', 2.2));
  // A camera-side softbox keeps turned-away steel readable at every shot angle.
  const fill = new THREE.DirectionalLight('#dce8ff', 4.5);
  scene.add(fill, fill.target);
  const sun = new THREE.DirectionalLight('#ffe0ab', 3.2); sun.position.set(-10, 18, 12); scene.add(sun);
  const rim = new THREE.DirectionalLight('#86f8ff', .65); rim.position.set(10, 7, -8); scene.add(rim);
  const town = new THREE.Group(); scene.add(town);
  box(town, 0, -.3, 0, 40, .5, 19, '#46485e');
  box(town, 0, -.02, 3, 38, .12, 4, '#b6a68d');
  // Cobblestone courses share one draw call.
  const stones = new THREE.InstancedMesh(boxGeo, mat('#938c91'), 240);
  const dummy = new THREE.Object3D();
  for (let i = 0; i < 240; i++) {
    dummy.position.set((i % 60) * .63 - 19 + Math.floor(i / 60) % 2 * .3, .065, 1.5 + Math.floor(i / 60) * .92);
    dummy.scale.set(.57, .07, .8); dummy.updateMatrix(); stones.setMatrixAt(i, dummy.matrix);
  }
  town.add(stones);
  for (let i = 0; i < 7; i++) {
    const x = i * 5.2 - 16;
    if (i === 4) continue;
    const h = 4.5 + (i % 3) * .65;
    box(town, x, h / 2, -1.8, 4.6, h, 4, ['#cb967e', '#849faf', '#d7b78c'][i % 3]);
    const roofGeo = new THREE.CylinderGeometry(0, 3.45, 2.3, 4); geometries.add(roofGeo);
    const roof = new THREE.Mesh(roofGeo, mat(i % 2 ? '#4b687c' : '#a85162'));
    roof.position.set(x, h + 1.05, -1.8); roof.rotation.y = Math.PI / 4; town.add(roof);
    for (const dx of [-1.45, 0, 1.45]) box(town, x + dx, h / 2, .24, .13, h, .14, '#483e4c');
    for (const wy of [1.4, 3.3]) for (const dx of [-.8, .8]) {
      box(town, x + dx, wy, .3, .82, 1.05, .16, '#333747');
      box(town, x + dx, wy, .4, .61, .83, .05, '#ffd897', true);
      box(town, x + dx, wy, .44, .07, .86, .05, '#483e4c');
    }
  }
  // Arcade facade and open, luminous doorway.
  box(town, 4.8, 2.6, -1.8, 5, 5.2, 4, '#687b94');
  box(town, 4.8, 2, .3, 2.25, 3.7, .15, '#15172e');
  for (const x of [3.6, 6]) box(town, x, 2, .45, .13, 3.8, .15, '#90ffff', true);
  box(town, 4.8, 3.9, .45, 2.5, .13, .15, '#90ffff', true);
  sign(town, 'PINBALL ARCADE', 4.8, 4.65, .55, 4.7, '#92ffff');
  box(town, 4.8, .08, 1, 2.8, .15, 1.4, '#797c9d');
  for (const x of [-12, -3, 10]) {
    box(town, x, 1.7, 5.4, .12, 3.4, .12, '#2e344b');
    box(town, x, 3.4, 5.4, .48, .7, .48, '#ffda87', true);
    box(town, x, 3.85, 5.4, .7, .15, .7, '#32374c');
    box(town, x + 1.3, .3, .8, 1, .6, .8, '#725165');
    orb(town, x + 1.3, .9, .8, .7, '#628a80');
  }
  sign(town, 'THE LANTERN QUARTER', -7, 5.8, 1, 6);

  const arcade = new THREE.Group(); arcade.visible = false; scene.add(arcade);
  box(arcade, 0, -.2, 0, 16, .4, 15, '#25263d');
  const tiles = new THREE.InstancedMesh(boxGeo, mat('#3c3f57'), 98);
  let tileIndex = 0;
  for (let x = -7; x <= 7; x++) for (let z = -6; z <= 6; z++) if ((x + z) % 2 === 0) {
    dummy.position.set(x, .01, z); dummy.scale.set(.98, .025, .98); dummy.updateMatrix(); tiles.setMatrixAt(tileIndex++, dummy.matrix);
  }
  tiles.count = tileIndex; arcade.add(tiles);
  box(arcade, 0, 3.3, -5, 16, 6.6, .3, '#403854');
  box(arcade, -8, 3.3, 0, .3, 6.6, 10, '#34364e');
  box(arcade, 0, 5.8, -4.8, 15, .07, .05, '#f58abb', true);
  sign(arcade, 'ONE MORE GAME', 0, 4.7, -4.7, 7, '#f7a4d8');
  function cabinet(x: number, z: number, color: string, hero = false) {
    box(arcade, x, 1.05, z, 1.8, 1.7, 2.7, '#222840');
    box(arcade, x, 1.93, z, 1.9, .15, 2.8, color);
    const table = box(arcade, x, 2.06, z, 1.57, .07, 2.3, '#7bbdbb', true); table.rotation.x = -.12;
    box(arcade, x, 2.65, z - 1.15, 1.9, 1.4, .35, '#191d33');
    sign(arcade, hero ? 'PINBALL KNIGHT' : 'HIGH SCORE', x, 2.9, z - .94, 1.72, color);
    for (const dx of [-.48, .42]) for (const dz of [-.55, .25]) orb(arcade, x + dx, 2.17, z + dz, .16, '#ffe4a0');
    for (const dx of [-.46, .46]) { const flipper = box(arcade, x + dx, 2.18, z + .7, .6, .08, .16, '#f584a3'); flipper.rotation.y = dx; }
    for (const dx of [-.72, .72]) box(arcade, x + dx, .25, z + .85, .12, .5, .12, '#b0b7ca');
  }
  cabinet(0, -1.9, '#98ffff', true); cabinet(-3.4, -2.8, '#e78bc7'); cabinet(3.4, -2.8, '#e9ba78');
  cabinet(-6, -.8, '#97a1ff'); cabinet(6, -.8, '#8cd0b3');
  const portalGeo = new THREE.TorusGeometry(.8, .065, 8, 48); geometries.add(portalGeo);
  const portal = new THREE.Mesh(portalGeo, mat('#bcffff', true)); portal.position.set(0, 2.6, -1.5); portal.visible = false; arcade.add(portal);

  // The cinematic and playable knight share the same articulated armour.
  const hero = createArmoredKnight(); const knight = hero.root; scene.add(knight);
  const rolling = createArmoredKnight(); rolling.pose('ball', 0); rolling.root.visible = false; scene.add(rolling.root);
  // An illuminated return chute carries the detached head up onto the playfield.
  const ramp = box(arcade, 0, .96, .55, .88, .10, 3.2, '#586e88');
  ramp.rotation.x = .57;
  for (const x of [-.47, .47]) {
    const rail = box(arcade, x, 1.07, .55, .06, .09, 3.2, '#8cf1ed', true); rail.rotation.x = .57;
  }
  const shadow = new THREE.Mesh(new THREE.CircleGeometry(.65, 24), new THREE.MeshBasicMaterial({ color: '#11172c', transparent: true, opacity: .3, depthWrite: false }));
  geometries.add(shadow.geometry); materials.set('shadow', shadow.material); shadow.rotation.x = -Math.PI / 2; shadow.position.y = .08; scene.add(shadow);

  const layout = buildTitleGrid();
  const title = new THREE.Group(); title.visible = false; scene.add(title);
  box(title, 0, -.35, 0, layout.grid.w + 1, .65, layout.grid.h + 1, '#182e48');
  const count = layout.grid.t.filter(t => t === T_WALL).length;
  const walls = new THREE.InstancedMesh(boxGeo, mat('#7ce0da'), count);
  const caps = new THREE.InstancedMesh(boxGeo, mat('#bdf6df'), count);
  let n = 0;
  for (let j = 0; j < layout.grid.h; j++) for (let i = 0; i < layout.grid.w; i++) {
    if (layout.grid.t[j * layout.grid.w + i] !== T_WALL) continue;
    dummy.position.set(i + .5 - layout.grid.w / 2, .48, j + .5 - layout.grid.h / 2);
    dummy.scale.set(.97, .96, .97); dummy.updateMatrix(); walls.setMatrixAt(n, dummy.matrix);
    dummy.position.y = .98; dummy.scale.set(.87, .08, .87); dummy.updateMatrix(); caps.setMatrixAt(n++, dummy.matrix);
  }
  title.add(walls, caps);
  const trail = Array.from({ length: 12 }, () => { const m = orb(title, 0, .5, 0, .15, '#efbc78'); m.visible = false; return m; });
  function dispose() {
    hero.dispose(); rolling.dispose();
    geometries.forEach(g => g.dispose()); materials.forEach(m => m.dispose()); textures.forEach(t => t.dispose());
    walls.dispose(); caps.dispose(); stones.dispose(); tiles.dispose(); scene.clear();
  }
  return { scene, camera, fill, town, arcade, knight, shadow, portal, title, trail, layout, hero, rolling, dispose };
}
