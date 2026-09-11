/** Articulated plate-armour protagonist. Geometry, light and pose remain live. */
import * as THREE from 'three';
import type { ClockworkPose, LaunchEmote } from './clockwork-knight';
import type { WeaponId } from '../items';
import { sampleKnightPose, type KnightPose, type MotionOptions } from './knight-motion';

export function createArmoredKnight() {
  const root = new THREE.Group(); root.name = 'Plate-armoured Pinball Knight';
  const tumble = new THREE.Group(); root.add(tumble);
  const body = new THREE.Group(); tumble.add(body);
  const head = new THREE.Group(); head.name = 'Closed bascinet'; head.scale.setScalar(.82); tumble.add(head);
  function bone(name: string, parent: THREE.Object3D, x = 0, y = 0, z = 0) {
    const joint = new THREE.Bone(); joint.name = name; joint.position.set(x, y, z); parent.add(joint); return joint;
  }
  const pelvis = bone('pelvis', body, 0, 1.32);
  const spine = bone('lumbar spine', pelvis, 0, .30);
  const chest = bone('rib cage', spine, 0, .40);
  const neck = bone('neck', chest, 0, .53);
  const headAnchor = bone('helmet socket', neck, 0, .28);
  // Plate armour is rigid: bind each piece to a joint without rubber-like deformation.
  function bind(joint: THREE.Object3D, objects: THREE.Object3D[]) {
    root.updateMatrixWorld(true); for (const object of objects) joint.attach(object);
  }
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
    const m = new THREE.MeshStandardMaterial({ color, metalness: .58, roughness, side: THREE.DoubleSide, map, bumpMap: map, bumpScale: .0005 });
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
  // Forged shells have a shaped cross-section, a hollow back, and rolled rims.
  // Profiles are [height, half-width, front/back depth], independent of the rig.
  function seam(parent: THREE.Object3D, points: THREE.Vector3[], radius = .009, mat: THREE.Material = edge) {
    const path = new THREE.CatmullRomCurve3(points);
    return mesh(parent, own(new THREE.TubeGeometry(path, Math.max(12, points.length * 2), radius, 5, false)), mat, [0,0,0]);
  }
  function shell(parent: THREE.Object3D, profiles: number[][], pos: number[], mat: THREE.Material = plate, arc = Math.PI * 2, ridge = 0) {
    const group = new THREE.Group(); group.position.fromArray(pos); parent.add(group);
    const vertices: number[] = [], uv: number[] = [], indices: number[] = [], steps = 40;
    const point = (row: number[], j: number) => {
      const angle = -arc / 2 + arc * j / steps, front = Math.max(0, Math.cos(angle));
      return new THREE.Vector3(Math.sin(angle) * row[1], row[0], Math.cos(angle) * row[2] + ridge * front ** 12);
    };
    profiles.forEach((row, i) => {
      for (let j = 0; j <= steps; j++) { vertices.push(...point(row,j).toArray()); uv.push(j / steps, i / (profiles.length - 1)); }
      if (i) for (let j = 0; j < steps; j++) { const a = (i-1)*(steps+1)+j, b = a+steps+1; indices.push(a,b,a+1,a+1,b,b+1); }
    });
    const geo = own(new THREE.BufferGeometry()); geo.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3)); geo.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));if (profiles[profiles.length-1][0] > profiles[0][0]) for(let i=0;i<indices.length;i+=3) [indices[i+1],indices[i+2]]=[indices[i+2],indices[i+1]];
    geo.setIndex(indices);geo.computeVertexNormals();
    mesh(group,geo,mat,[0,0,0]);
    for (const row of [profiles[0], profiles[profiles.length-1]]) seam(group,Array.from({length:steps+1},(_,j)=>point(row,j)));
    if (arc < Math.PI * 2) for (const j of [0,steps]) seam(group, profiles.map(row=>point(row,j)));
    return group;
  }
  function dish(parent: THREE.Object3D, outline: number[][], depth: number, pos: number[], mat: THREE.Material = plate) {
    if(outline.reduce((sum,p,i)=>{const q=outline[(i+1)%outline.length];return sum+p[0]*q[1]-q[0]*p[1];},0)<0)outline=[...outline].reverse();
    const group = new THREE.Group();group.position.fromArray(pos);parent.add(group);
    const vertices: number[] = [], indices: number[] = [], uv: number[] = [], n=outline.length;
    for(let ring=0;ring<=5;ring++)for(const [x,y] of outline){const r=Math.max(.001,ring/5);vertices.push(x*r,y*r,depth*(1-r*r));uv.push(x*r+.5,y*r+.5);}
    for(let r=0;r<5;r++)for(let j=0;j<n;j++){const a=r*n+j,b=r*n+(j+1)%n;indices.push(a,a+n,b,b,a+n,b+n);}
    const geo=own(new THREE.BufferGeometry());geo.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));geo.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));geo.setIndex(indices);geo.computeVertexNormals();mesh(group,geo,mat,[0,0,0]);
    seam(group,[...outline,outline[0]].map(([x,y])=>new THREE.Vector3(x,y,0)),.011);
    return group;
  }
  const helmet = shell(head,[[-.32,.22,.22],[-.23,.30,.28],[0,.345,.33],[.18,.32,.315],[.32,.255,.27],[.43,.14,.17],[.53,.008,.018]],[0,0,0],plate,Math.PI*2,.035);
  helmet.name='Forged pointed bascinet';
  // A curved visor wraps the face; the recessed slit follows its curvature.
  shell(head,[[.038,.346,.346],[.075,.342,.345]],[0,0,0],slit,2.12,.03);
  shell(head,[[.075,.349,.35],[.13,.338,.337]],[0,0,0],edge,2.2,.03);
  shell(head,[[-.31,.205,.238],[-.24,.28,.304],[-.07,.338,.354],[.025,.347,.35]],[0,0,0],plate,2.18,.045);
  seam(head,[new THREE.Vector3(0,.525,.035),new THREE.Vector3(0,.39,.235),new THREE.Vector3(0,.18,.35)],.011);
  for (const side of [-1,1]) {
    oval(head,[side*.337,.055,.01],[.025,.048,.05],dark);
    mesh(head,rivet,edge,[side*.36,.055,.01],[.018,.023,.023]);
    for(let row=0;row<3;row++)for(let col=0;col<3;col++){
      const angle=side*(.22+col*.22), y=-.075-row*.061;
      const hole=mesh(head,rivet,slit,[Math.sin(angle)*.329,y,Math.cos(angle)*.35+.027*Math.cos(angle)**12],[.012,.012,.005]);hole.rotation.y=angle;
    }
  }
  const neckMail=oval(body,[0,2.47,0],[.26,.25,.25],chain);
  shell(body,[[2.31,.33,.27],[2.37,.32,.255],[2.43,.26,.23],[2.49,.245,.218]],[0,0,0],plate);
  bind(neck,[neckMail,...body.children.filter(o=>o instanceof THREE.Group&&!(o instanceof THREE.Bone))]);
  oval(body,[0,2.01,0],[.40,.48,.235],chain);
  const cuirass=shell(body,[[1.70,.29,.23],[1.81,.34,.28],[2.02,.435,.325],[2.20,.435,.295],[2.33,.34,.23]],[0,0,0],plate,Math.PI*2,.045);
  cuirass.name='Curved ridged breastplate and backplate';
  for(const side of [-1,1]) {
    // Breastplate straps pass over the shoulder; the rivets sit on its surface.
    const strap=mesh(body,box,leather,[side*.285,2.30,.17],[.072,.21,.028]);strap.rotation.x=-.42;
    studs(strap,.05,.023,.04,2);
    for(const y of [1.82,2.00,2.18])mesh(body,rivet,edge,[side*(y>1.9?.395:.31),y,.15],[.018,.018,.018]);
  }
  bind(chest,body.children.filter(o=>!(o instanceof THREE.Bone)));
  for(let i=0;i<4;i++)shell(body,[[1.72-i*.082,.31+i*.019,.245+i*.01],[1.62-i*.082,.33+i*.019,.258+i*.01]],[0,0,0],plate);
  shell(body,[[1.49,.398,.30],[1.415,.405,.30]],[0,0,0],leather);
  mesh(body,box,edge,[.10,1.455,.314],[.135,.09,.028]);mesh(body,box,leather,[.10,1.455,.332],[.092,.052,.012]);
  oval(body,[0,1.26,0],[.36,.28,.245],chain);
  bind(pelvis,body.children.filter(o=>!(o instanceof THREE.Bone)));
  const tassets: THREE.Group[]=[];
  for(const side of [-1,1]){
    const tasset=new THREE.Group();body.add(tasset);tasset.position.set(side*.225,1.32,.255);tasset.rotation.z=side*.06;
    for(let i=0;i<3;i++){
      const lame=dish(tasset,[[-.18,.065],[.175,.065],[.19,-.065],[.14,-.092],[-.15,-.092],[-.19,-.055]],.034,[0,.08-i*.1,i*.012]);
      studs(lame,.04,.033,.25,2);
    }
    bind(pelvis,[tasset]);tassets.push(tasset);
  }
  const legs=[-1,1].map(side=>{
    const hip=bone(side<0?'left hip':'right hip',pelvis,side*.225);
    oval(hip,[0,-.26,0],[.148,.25,.148],chain);
    shell(hip,[[-.08,.17,.18],[-.21,.18,.183],[-.40,.142,.157],[-.49,.128,.14]],[0,0,.015],plate,5.4,.018);
    const knee=bone(side<0?'left knee':'right knee',hip,0,-.58);
    oval(knee,[0,0,0],[.13,.14,.13],chain);
    dish(knee,[[-.15,.11],[0,.16],[.15,.11],[.175,-.025],[.10,-.12],[0,-.14],[-.10,-.12],[-.175,-.025]],.095,[0,0,.13]);
    const wing=dish(knee,[[-.06,.08],[.08,.16],[.18,.04],[.14,-.1],[-.04,-.085]],.025,[side*.14,0,.01]);wing.rotation.y=side*.75;wing.scale.x=side;
    shell(knee,[[-.14,.133,.132],[-.25,.155,.155],[-.43,.11,.13],[-.56,.097,.105]],[0,0,0],plate,5.7,.025);
    for(const y of [-.23,-.45])shell(knee,[[y,.145-(y<-.3?.025:0),.15],[y-.032,.14-(y<-.3?.025:0),.147]],[0,0,-.005],leather,2.1).rotation.y=Math.PI;
    const ankle=bone(side<0?'left ankle':'right ankle',knee,0,-.58);
    oval(ankle,[0,0,.035],[.115,.12,.15],leather);
    const toe=bone(side<0?'left toe':'right toe',ankle,0,-.01,.22);
    oval(toe,[0,-.025,.028],[.128,.065,.17],leather);
    for(let i=0;i<5;i++){
      const parent=i<2?ankle:toe,z=.005+i*.075-(i<2?0:.22),w=.14-i*.008;
      dish(parent,[[-w,.048],[0,.065],[w,.048],[w*.96,-.035],[0,-.054],[-w*.96,-.035]],.039,[0,.063,z]).rotation.x=-Math.PI/2;
    }
    return{hip,knee,ankle,toe};
  });
  const arms=[-1,1].map(side=>{
    const label=side<0?'left':'right';
    const clavicle=bone(`${label} clavicle`,chest,side*.49,.26),pivot=bone(`${label} shoulder`,clavicle);
    oval(pivot,[0,-.20,0],[.145,.28,.145],chain);
    const pauldron=bone(`${label} floating pauldron`,clavicle);
    shell(pauldron,[[.17,.025,.035],[.13,.16,.17],[.06,.245,.248],[-.065,.26,.265],[-.135,.235,.245]],[side*.035,0,0]);
    for(let i=0;i<3;i++){
      shell(pauldron,[[-.11-i*.078,.24-i*.021,.247-i*.018],[-.20-i*.078,.221-i*.022,.23-i*.017]],[side*(.035+i*.012),0,0],plate,5.4);
      for(const a of [-.65,.65])mesh(pauldron,rivet,edge,[Math.sin(a)*(.24-i*.02),-.18-i*.075,Math.cos(a)*(.25-i*.018)],[.017,.017,.015]);
    }
    shell(pivot,[[-.24,.14,.147],[-.38,.14,.143],[-.45,.12,.13]],[0,0,0],plate,5.5);
    const elbow=bone(`${label} elbow`,pivot,0,-.48);
    oval(elbow,[0,0,0],[.12,.12,.12],chain);
    dish(elbow,[[-.135,.08],[0,.135],[.135,.08],[.14,-.045],[0,-.12],[-.14,-.045]],.06,[0,0,.12]);
    const fan=dish(elbow,[[-.06,.075],[.11,.13],[.20,.015],[.11,-.12],[-.065,-.08]],.025,[side*.115,0,0]);fan.scale.x=side;fan.rotation.y=side*.65;
    const forearm=bone(`${label} forearm twist`,elbow);
    shell(forearm,[[-.07,.126,.135],[-.16,.148,.145],[-.29,.12,.124],[-.40,.092,.102]],[0,0,0],plate,5.8,.018);
    const wrist=bone(`${label} wrist`,forearm,0,-.44);
    oval(wrist,[0,-.015,.01],[.103,.105,.09],leather);
    shell(wrist,[[.075,.123,.105],[.008,.102,.098],[-.075,.10,.086]],[0,0,0],plate,4.8);
    for(let finger=0;finger<4;finger++)for(let segment=0;segment<3;segment++){
      const knuckle=mesh(wrist,sphere,plate,[(finger-1.5)*.047,-.066-segment*.033,.071+Math.sin(segment*.8)*.013],[.024,.025,.019]);knuckle.name='Articulated finger plate';
    }
    oval(wrist,[side*.10,-.065,.03],[.028,.055,.03],plate);
    const grip=bone(`${label} grip`,wrist,0,-.03,.035);
    return{clavicle,pivot,pauldron,elbow,forearm,wrist,grip};
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
  // Broad studio reflections make the small sphere read as polished metal,
  // rather than a flat gray orb. This is an environment, not painted highlights.
  const envW=256,envH=128,envData=new Uint8Array(envW*envH*4);
  for(let y=0;y<envH;y++)for(let x=0;x<envW;x++){
    const u=x/envW,v=y/envH;
    const panel=(cx:number,cy:number,sx:number,sy:number)=>Math.exp(-(((u-cx)/sx)**8)-(((v-cy)/sy)**8));
    const light=Math.min(1,panel(.22,.37,.055,.22)+panel(.68,.34,.12,.13)+.65*panel(.89,.55,.035,.24));
    const base=85+70*Math.max(0,1-v),i=(y*envW+x)*4;
    envData[i]=Math.min(255,base+light*205);envData[i+1]=Math.min(255,base+light*218);envData[i+2]=Math.min(255,base+5+light*226);envData[i+3]=255;
  }
  const reflection=new THREE.DataTexture(envData,envW,envH);reflection.colorSpace=THREE.SRGBColorSpace;reflection.mapping=THREE.EquirectangularReflectionMapping;reflection.needsUpdate=true;textures.push(reflection);
  const chrome = steel(0xe6ecef,.07,null); chrome.metalness=1;chrome.envMap=reflection;chrome.envMapIntensity=1.8;chrome.transparent=true;
  const ballShell = mesh(tumble,own(new THREE.SphereGeometry(.8,40,24)),chrome,[0,.8,0]);
  ballShell.name='Live chrome ball transformation'; ballShell.visible=false;
  let weaponId: WeaponId='sword';
  function setWeapon(id:WeaponId) {weaponId=id;sword.visible=id==='sword'||id==='greatsword';sword.scale.setScalar(id==='greatsword'?1.3:1);alternatives.forEach((g,key)=>g.visible=key===id);}
  // Two-bone IK: knees bend toward the knight's forward pole, soles stay on the
  // ground while the pelvis shifts. Scratch values are shared, never allocated per bone.
  const down = new THREE.Vector3(0, -1, 0);
  const origin = new THREE.Vector3(), end = new THREE.Vector3(), direction = new THREE.Vector3();
  const bend = new THREE.Vector3(), middle = new THREE.Vector3(), localDirection = new THREE.Vector3();
  const rootRotation = new THREE.Quaternion(), inverseRoot = new THREE.Quaternion();
  const parentRotation = new THREE.Quaternion(), desiredRotation = new THREE.Quaternion();
  const upperBefore = new THREE.Quaternion(), lowerBefore = new THREE.Quaternion();
  const rotation = new THREE.Euler(), scale = new THREE.Vector3();
  function aim(joint: THREE.Bone, worldDirection: THREE.Vector3) {
    localDirection.copy(worldDirection).normalize().applyQuaternion(inverseRoot);
    desiredRotation.setFromUnitVectors(down, localDirection).premultiply(rootRotation);
    joint.parent!.getWorldQuaternion(parentRotation).invert();
    joint.quaternion.copy(parentRotation).multiply(desiredRotation);
    joint.updateWorldMatrix(false, true);
  }
  function solveLimb(upper: THREE.Bone, lower: THREE.Bone, target: readonly number[], pole: readonly number[], lengthA: number, lengthB: number) {
    upper.getWorldPosition(origin);
    end.set(target[0], target[1], target[2]); root.localToWorld(end);
    const globalScale = root.getWorldScale(scale).y;
    const a = lengthA * globalScale, b = lengthB * globalScale;
    direction.subVectors(end, origin);
    const distance = THREE.MathUtils.clamp(direction.length(), Math.abs(a - b) + .0001, a + b - .0001);
    direction.normalize();
    bend.set(pole[0], pole[1], pole[2]).applyQuaternion(rootRotation);
    bend.addScaledVector(direction, -bend.dot(direction)).normalize();
    const along = (a * a - b * b + distance * distance) / (2 * distance);
    const height = Math.sqrt(Math.max(0, a * a - along * along));
    middle.copy(origin).addScaledVector(direction, along).addScaledVector(bend, height);
    end.copy(origin).addScaledVector(direction, distance);
    aim(upper, localDirection.subVectors(middle, origin));
    aim(lower, localDirection.subVectors(end, middle));
  }
  function applyPose(p: KnightPose) {
    tumble.position.set(0,0,0); tumble.rotation.set(0,0,0);
    body.visible = p.bodyVisible && p.shellWeight < .995; head.visible = p.shellWeight < .995;
    ballShell.visible = p.shellWeight > .001; chrome.opacity = p.shellWeight;
    ballShell.scale.setScalar(.72 + .28 * p.shellWeight);
    pelvis.position.fromArray(p.pelvisPosition); pelvis.rotation.set(...p.pelvisRotation);
    spine.rotation.set(...p.spine); chest.rotation.set(...p.chest); neck.rotation.set(...p.neck);
    root.updateMatrixWorld(true); root.getWorldQuaternion(rootRotation); inverseRoot.copy(rootRotation).invert();
    legs.forEach((leg, i) => {
      const foot = p.feet[i];
      solveLimb(leg.hip, leg.knee, foot.position, [0, 0, 1], .58, .58);
      leg.ankle.parent!.getWorldQuaternion(parentRotation).invert();
      desiredRotation.setFromEuler(rotation.set(foot.pitch, 0, 0)).premultiply(rootRotation);
      leg.ankle.quaternion.copy(parentRotation).multiply(desiredRotation);
      leg.toe.rotation.x = foot.toe;
      tassets[i].rotation.x = p.tassets[i];
    });
    arms.forEach((arm, i) => {
      const a = p.arms[i];
      arm.clavicle.rotation.z = (i === 0 ? -1 : 1) * Math.max(0, -a.shoulder[0] - .7) * .065;
      arm.pivot.rotation.set(...a.shoulder); arm.elbow.rotation.set(a.elbow, 0, 0);
      arm.forearm.rotation.set(0, a.twist, 0); arm.wrist.rotation.set(...a.wrist);
      arm.pauldron.rotation.set(a.shoulder[0] * .32, a.shoulder[1] * .15, a.shoulder[2] * .35);
      if (p.handTargets && p.handIKWeight > 0) {
        upperBefore.copy(arm.pivot.quaternion); lowerBefore.copy(arm.elbow.quaternion);
        root.updateMatrixWorld(true);
        solveLimb(arm.pivot, arm.elbow, p.handTargets[i], [i === 0 ? -1 : 1, -.2, .2], .48, .44);
        arm.pivot.quaternion.copy(upperBefore.slerp(arm.pivot.quaternion, p.handIKWeight));
        arm.elbow.quaternion.copy(lowerBefore.slerp(arm.elbow.quaternion, p.handIKWeight));
      }
    });
    weapon.rotation.set(...p.weaponRotation); weapon.visible = p.weaponVisible && weaponId !== 'fists';
    root.updateMatrixWorld(true);
    if (p.detachedHead) {
      head.position.fromArray(p.headPosition); head.rotation.set(...p.headRotation);
    } else {
      headAnchor.getWorldPosition(head.position); root.worldToLocal(head.position); head.position.add(localDirection.fromArray(p.headPosition));
      headAnchor.getWorldQuaternion(desiredRotation); head.quaternion.copy(inverseRoot).multiply(desiredRotation);
      head.quaternion.multiply(desiredRotation.setFromEuler(rotation.set(...p.headRotation)));
    }
    // Rotate the already articulated body around the ball centre, not its feet.
    tumble.rotation.x = p.tumbleAngle;
    tumble.position.set(0, p.tumbleHeight * (1 - Math.cos(p.tumbleAngle)), -p.tumbleHeight * Math.sin(p.tumbleAngle));
    root.updateMatrixWorld(true);
  }
  function pose(clip: ClockworkPose, t: number, _emote: LaunchEmote = 'bowling', options: MotionOptions = {}) {
    applyPose(sampleKnightPose(clip, t, { ...options, weapon: weaponId }));
  }
  function dispose(){geometries.forEach(g=>g.dispose());materials.forEach(m=>m.dispose());textures.forEach(t=>t.dispose());root.removeFromParent();}
  pose('idle',0);
  return { root, body, head, tumble, pose, applyPose, setWeapon, dispose, joints: { pelvis, spine, chest, neck, headAnchor, legs, arms } };
}
