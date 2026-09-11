/** Articulated plate-armour protagonist. Geometry, light and pose remain live. */
import * as THREE from 'three';
import type { ClockworkPose, LaunchEmote } from './clockwork-knight';
import type { WeaponId } from '../items';

export function createArmoredKnight() {
  const root = new THREE.Group(); root.name = 'Plate-armoured Pinball Knight';
  const body = new THREE.Group(); root.add(body);
  const head = new THREE.Group(); head.name = 'Closed bascinet'; root.add(head);
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  const textures: THREE.Texture[] = [];
  const own = <T extends THREE.BufferGeometry>(g: T) => (geometries.add(g), g);
  function metalTexture(mail = false) {
    const size = 128, data = new Uint8Array(size * size * 4);
    let rng = 7919;
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      rng = (Math.imul(rng, 1664525) + 1013904223) | 0;
      const noise = (rng >>> 24) / 255;
      let v = 200 + noise * 12;
      if (mail) {
        const row = Math.floor(y / 12), dx = ((x + (row % 2) * 6) % 12 - 6) / 5;
        const dy = (y % 12 - 6) / 4.5, d = Math.hypot(dx, dy);
        v = d > .68 && d < 1.1 ? 145 + (1 - dy) * 40 : 35 + noise * 20;
      } else {
        if ((x * 7 + y * 31) % 173 < 2) v += 15;
        if ((x * 13 - y * 3 + 512) % 227 < 3) v -= 25;
        v -= Math.max(0, Math.sin(x * .17) * Math.cos(y * .11)) * 12;
      }
      const i = (y * size + x) * 4;
      data[i] = v; data[i + 1] = v * .99; data[i + 2] = v * .95; data[i + 3] = 255;
    }
    const tex = new THREE.DataTexture(data, size, size);
    tex.colorSpace = THREE.SRGBColorSpace; tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(mail ? 2 : 1, mail ? 2 : 1); tex.needsUpdate = true;
    textures.push(tex); return tex;
  }
  const worn = metalTexture(), links = metalTexture(true);
  function steel(color: number, roughness = .38, map: THREE.Texture | null = worn) {
    const m = new THREE.MeshStandardMaterial({ color, metalness: .25, roughness, map, bumpMap: map, bumpScale: .0005 });
    materials.add(m); return m;
  }
  const plate = steel(0xb8c2c3), edge = steel(0xe1e2d7, .29), dark = steel(0x4f595b, .48);
  const chain = steel(0x7e8586, .65, links);
  const leather = new THREE.MeshStandardMaterial({ color: 0x30251d, roughness: .95 }); materials.add(leather);
  const slit = new THREE.MeshBasicMaterial({ color: 0x090d0e }); materials.add(slit);
  const sphere = own(new THREE.SphereGeometry(1, 24, 16)), box = own(new THREE.BoxGeometry(1, 1, 1));
  const rivet = own(new THREE.SphereGeometry(1, 8, 6));
  function mesh(parent: THREE.Object3D, geo: THREE.BufferGeometry, mat: THREE.Material, p: number[], scale = [1, 1, 1]) {
    const m = new THREE.Mesh(geo, mat); m.position.set(p[0], p[1], p[2]); m.scale.set(scale[0], scale[1], scale[2]); parent.add(m); return m;
  }
  const oval = (parent: THREE.Object3D, p: number[], scale: number[], mat: THREE.Material = plate) => mesh(parent, sphere, mat, p, scale);
  function panel(parent: THREE.Object3D, points: number[][], depth: number, mat: THREE.Material, p: number[]) {
    const shape = new THREE.Shape(); points.forEach(([x, y], i) => i ? shape.lineTo(x, y) : shape.moveTo(x, y)); shape.closePath();
    return mesh(parent, own(new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: true, bevelSize: .018, bevelThickness: .018, bevelSegments: 2, steps: 1 })), mat, p);
  }
  function studs(parent: THREE.Object3D, y: number, z: number, width: number, count: number) {
    for (let i = 0; i < count; i++) mesh(parent, rivet, edge, [-width / 2 + width * i / (count - 1), y, z], [.022, .022, .015]);
  }
  // Pointed helmet shell, separate brow, enclosed vented visor and pivot bolts.
  const helmet = own(new THREE.LatheGeometry([new THREE.Vector2(0, -.35), new THREE.Vector2(.23, -.30), new THREE.Vector2(.33, -.13), new THREE.Vector2(.35, .13), new THREE.Vector2(.30, .32), new THREE.Vector2(.18, .44), new THREE.Vector2(0, .49)], 32));
  mesh(head, helmet, plate, [0, 0, 0], [1, 1, 1.07]);
  panel(head, [[-.28,.13],[0,.17],[.28,.13],[.27,.045],[0,.075],[-.27,.045]], .024, edge, [0, .005, .315]);
  for (const side of [-1, 1]) {
    const eye = mesh(head, box, slit, [side * .147, .013, .353], [.23, .037, .025]); eye.rotation.z = -side * .09;
    oval(head, [side * .335, .07, 0], [.035, .05, .05], dark);
    mesh(head, rivet, edge, [side * .362, .07, 0], [.022, .027, .027]);
  }
  panel(head, [[-.27,0],[.27,0],[.23,-.19],[0,-.35],[-.23,-.19]], .04, plate, [0,-.045,.27]);
  panel(head, [[-.012,.40],[.012,.40],[.023,.06],[0,-.02],[-.023,.06]], .018, edge, [0,.04,.24]);
  for (let row = 0; row < 3; row++) for (let col = -2; col <= 2; col++) {
    if (row === 2 && Math.abs(col) === 2) continue;
    mesh(head, rivet, slit, [col * .071, -.11 - row * .055, .322], [.014, .009, .007]);
  }
  // Mail fills the neck and gaps; plates overlap rather than forming a robot shell.
  oval(body, [0, 2.47, 0], [.29, .25, .27], chain);
  oval(body, [0, 2.02, 0], [.46, .52, .25], chain);
  oval(body, [0, 2.04, .02], [.43, .49, .285]);
  panel(body, [[-.37,.32],[-.15,.20],[.15,.20],[.37,.32],[.40,-.17],[.26,-.40],[0,-.44],[-.26,-.40],[-.40,-.17]], .065, plate, [0,2.12,.18]);
  panel(body, [[-.024,.20],[0,.28],[.024,.20],[.03,-.35],[0,-.40],[-.03,-.35]], .025, edge, [0,2.12,.259]);
  for (let i = 0; i < 3; i++) {
    oval(body, [0, 1.70 - i * .105, .01], [.39 + i * .015, .12, .285], i % 2 ? plate : dark);
    studs(body, 1.7 - i * .105, .282, .5, 4);
  }
  const belt = mesh(body, box, leather, [0,1.48,.015], [.86,.105,.57]);
  mesh(body, box, edge, [.10,1.48,.317], [.15,.115,.025]);
  mesh(body, box, leather, [.10,1.48,.334], [.095,.07,.012]);
  oval(body, [0,1.28,0], [.39,.29,.24], chain);
  for (const side of [-1,1]) {
    const tasset = panel(body, [[-.19,.17],[.18,.17],[.23,-.21],[-.19,-.23]], .04, plate, [side*.24,1.32,.23]); tasset.rotation.z=side*.08;
    studs(tasset, .10, .057, .23, 3);
  }
  const legs = [-1,1].map(side => {
    const leg=new THREE.Group(); leg.position.set(side*.225,1.32,0);body.add(leg);
    oval(leg,[0,-.25,0],[.18,.36,.18],chain);
    oval(leg,[0,-.27,.035],[.18,.31,.16]);
    oval(leg,[0,-.58,.065],[.205,.16,.20],edge);
    oval(leg,[side*.14,-.58,0],[.13,.13,.06]);
    oval(leg,[0,-.86,.005],[.145,.28,.14]);
    oval(leg,[0,-1.16,.10],[.17,.13,.29],dark);
    for(let i=0;i<4;i++) oval(leg,[0,-1.12,.02+i*.085],[.175-i*.012,.07,.085],plate);
    return leg;
  });
  const arms = [-1,1].map(side => {
    const pivot=new THREE.Group();pivot.position.set(side*.49,2.28,0);body.add(pivot);
    oval(pivot,[side*.04,-.19,0],[.17,.30,.17],chain);
    for(let i=0;i<3;i++) {
      oval(pivot,[side*(.025+i*.015),.01-i*.11,0],[.30-i*.02,.105,.29-i*.013],i%2?plate:edge);
      studs(pivot,-.01-i*.105,.245,.32,3);
    }
    oval(pivot,[0,-.37,.01],[.17,.20,.16]);
    const elbow=new THREE.Group();elbow.position.y=-.48;pivot.add(elbow);
    oval(elbow,[0,0,0],[.19,.17,.17],edge);
    oval(elbow,[side*.16,0,-.015],[.15,.12,.065]);
    oval(elbow,[0,-.22,0],[.15,.24,.15]);
    oval(elbow,[0,-.44,.015],[.14,.14,.12],dark);
    for(let i=0;i<4;i++) mesh(elbow,box,plate,[(i-1.5)*.055,-.48,.12],[.05,.12,.045]);
    const grip=new THREE.Group();grip.position.set(0,-.47,.035);elbow.add(grip);
    return {pivot,elbow,grip};
  });
  const weapon=new THREE.Group();arms[1].grip.add(weapon);
  const sword=new THREE.Group();weapon.add(sword);
  panel(sword,[[-.06,0],[.06,0],[.06,1.05],[0,1.28],[-.06,1.05]],.023,edge,[0,.20,0]);
  panel(sword,[[-.009,0],[.009,0],[.009,1.05],[0,1.13],[-.009,1.05]],.025,dark,[0,.20,.014]);
  mesh(sword,box,dark,[0,.18,0],[.44,.06,.095]);
  mesh(sword,box,leather,[0,.035,0],[.085,.25,.085]);
  oval(sword,[0,-.11,0],[.075,.06,.06],edge);
  const alternatives=new Map<string,THREE.Group>();
  function alternate(id:string) {const g=new THREE.Group();g.visible=false;weapon.add(g);alternatives.set(id,g);return g;}
  for(const id of ['stick','mace','warhammer','wreckingball']) {
    const g=alternate(id);mesh(g,box,leather,[0,.26,0],[.08,.75,.08]);
    if(id==='mace'||id==='wreckingball') oval(g,[0,.68,0],[.18,.20,.18],dark);
    if(id==='warhammer') mesh(g,box,plate,[0,.66,0],[.52,.22,.22]);
  }
  for(const id of ['gun','flamethrower']) {const g=alternate(id);mesh(g,box,dark,[0,.12,.18],[.14,.16,.6]);mesh(g,box,leather,[0,-.04,0],[.1,.3,.14]);}
  const bow=alternate('bow');const bowGeo=own(new THREE.TorusGeometry(.5,.035,6,32,Math.PI));const bm=mesh(bow,bowGeo,leather,[0,.22,0]);bm.rotation.z=-Math.PI/2;mesh(bow,box,chain,[0,.22,0],[.015,1,.015]);
  const chair=alternate('chair');mesh(chair,box,leather,[0,.28,0],[.5,.08,.45]);mesh(chair,box,leather,[0,.58,-.20],[.5,.65,.06]);for(const x of [-.2,.2])for(const z of [-.17,.17])mesh(chair,box,leather,[x,.05,z],[.06,.45,.06]);
  let weaponId: WeaponId='sword';
  function setWeapon(id:WeaponId) {weaponId=id;sword.visible=id==='sword'||id==='greatsword';sword.scale.setScalar(id==='greatsword'?1.3:1);alternatives.forEach((g,key)=>g.visible=key===id);}
  function pose(clip:ClockworkPose,t:number,emote:LaunchEmote='bowling') {
    body.visible=true;body.position.set(0,0,0);body.rotation.set(0,0,0);body.scale.setScalar(1);
    head.visible=true;head.position.set(0,2.83,0);head.rotation.set(0,0,0);head.scale.setScalar(1);
    legs.forEach(l=>l.rotation.set(0,0,0));
    arms.forEach(({pivot,elbow},i)=>{pivot.rotation.set(-.12,0,i===0?.10:-.10);elbow.rotation.set(-.20,0,0);});
    weapon.rotation.set(1.15,0,-.15);weapon.visible=weaponId!=='fists';
    if(clip==='walk'||clip==='run') {
      const phase=t*Math.PI*2, stride=clip==='run'?.72:.45;
      legs.forEach((l,i)=>l.rotation.x=Math.sin(phase+i*Math.PI)*stride);
      arms.forEach(({pivot},i)=>pivot.rotation.x=-Math.sin(phase+i*Math.PI)*stride*.6);
      body.position.y=Math.abs(Math.sin(phase))*.035;head.position.y+=body.position.y;
    } else if(clip==='attack') {
      const swing=Math.sin(Math.min(1,t)*Math.PI);
      arms[1].pivot.rotation.x=-.5-swing*1.9;arms[1].elbow.rotation.x=-.3;
      arms[0].pivot.rotation.x=-.65-swing*.55;body.rotation.y=-.2+swing*.65;
    } else if(clip==='death') {
      const f=THREE.MathUtils.smoothstep(t,0,1);body.rotation.x=-f*Math.PI/2;body.position.y=-f*.9;head.position.set(f*.35,2.83*(1-f)+.4*f,f*.5);head.rotation.x=f*3;
    } else if(clip==='ball') {
      body.visible=false;head.position.set(0,.4,0);head.rotation.x=t*Math.PI*2;
    } else if(clip==='remove'||clip==='roll') {
      const u=Math.min(1,t),reach=THREE.MathUtils.smoothstep(u,0,.35),release=THREE.MathUtils.smoothstep(u,.55,1);
      arms.forEach(({pivot,elbow})=>{pivot.rotation.x=-2.6*reach+release*2;elbow.rotation.x=-.4;});
      head.position.set(release*.4,2.83+.45*reach-release*2.8,release*1.6);head.rotation.x=release*8;
      weapon.visible=false;
    } else if(clip==='return') {
      head.position.y=.4+2.43*THREE.MathUtils.smoothstep(t,0,1);
    } else {
      const breathe=Math.sin(t*Math.PI*2)*.015;body.position.y=breathe;head.position.y+=breathe;
      // Guard stance reads as a knight carrying a sword, even in a tiny pixel render.
      arms[1].pivot.rotation.x=-.40;arms[1].elbow.rotation.x=-.55;
      arms[0].pivot.rotation.x=-.25;
    }
  }
  function dispose(){geometries.forEach(g=>g.dispose());materials.forEach(m=>m.dispose());textures.forEach(t=>t.dispose());root.removeFromParent();}
  pose('idle',0);
  return {root,body,head,pose,setWeapon,dispose};
}
