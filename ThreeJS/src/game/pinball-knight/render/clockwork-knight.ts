/** Shared toon rig: cinematic hero and the source of the published sprite sheets. */
import * as THREE from 'three';
import { ballisticArcHeight } from '../ballistic-arc';
import { CATAPULT_HOP_HEIGHT } from '../constants/pinball';

export const CLOCKWORK_SHEET = 'clockwork_knight';
export const HEAD_REST_Y = 2.08;
export const HEAD_RADIUS = .53;
export const BASEBALL_CONTACT = .5;
export type LaunchEmote = 'bowling' | 'football' | 'baseball';
export type ClockworkPose = 'idle' | 'walk' | 'run' | 'attack' | 'death' | 'remove' | 'return' | 'roll' | 'ball';
const ease = (v: number) => { const t = THREE.MathUtils.clamp(v, 0, 1); return t * t * (3 - 2 * t); };

export function createClockworkKnight() {
  const root = new THREE.Group(); root.name = 'Clockwork Knight';
  const body = new THREE.Group(); body.name = 'Enchanted suit'; root.add(body);
  const head = new THREE.Group(); head.name = 'Detachable pinball head'; root.add(head);
  const materials = new Set<THREE.Material>();
  const geometries = new Set<THREE.BufferGeometry>();
  const ramp = new THREE.DataTexture(new Uint8Array([85, 155, 220, 255]), 4, 1, THREE.RedFormat);
  ramp.minFilter = ramp.magFilter = THREE.NearestFilter; ramp.needsUpdate = true;
  function toon(color: string) {
    const m = new THREE.MeshToonMaterial({ color, gradientMap: ramp }); materials.add(m); return m;
  }
  const steel = toon('#7896af'), lightSteel = toon('#b2c9d8'), darkSteel = toon('#405971');
  const gold = toon('#c69b52'), red = toon('#a93653'), clothLight = toon('#d25565'), black = toon('#182d43');
  const glow = new THREE.MeshBasicMaterial({ color: '#78edff' }); materials.add(glow);
  const outline = new THREE.MeshBasicMaterial({ color: '#132337', side: THREE.BackSide }); materials.add(outline);
  const sphere = new THREE.SphereGeometry(1, 24, 16); geometries.add(sphere);
  const cube = new THREE.BoxGeometry(1, 1, 1); geometries.add(cube);
  function mesh(parent: THREE.Object3D, geo: THREE.BufferGeometry, material: THREE.Material, position: number[], scale = [1, 1, 1], ink = false) {
    const m = new THREE.Mesh(geo, material); m.position.set(position[0], position[1], position[2]); m.scale.set(scale[0], scale[1], scale[2]); parent.add(m);
    if (ink) { const edge = new THREE.Mesh(geo, outline); edge.scale.setScalar(1.035); m.add(edge); }
    return m;
  }
  function ellipsoid(parent: THREE.Object3D, position: number[], scale: number[], material: THREE.Material = steel, ink = true) { return mesh(parent, sphere, material, position, scale, ink); }
  function band(parent: THREE.Object3D, y: number, radius: number, tube: number, material = gold) {
    const g = new THREE.TorusGeometry(radius, tube, 6, 32); geometries.add(g);
    const m = mesh(parent, g, material, [0, y, 0]); m.rotation.x = Math.PI / 2; return m;
  }
  function plate(parent: THREE.Object3D, points: number[][], depth: number, material: THREE.Material, position: number[]) {
    const shape = new THREE.Shape(); points.forEach(([x, y], i) => i ? shape.lineTo(x, y) : shape.moveTo(x, y)); shape.closePath();
    const geo = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: true, bevelSize: .025, bevelThickness: .025, bevelSegments: 1, steps: 1 }); geometries.add(geo);
    return mesh(parent, geo, material, position, [1, 1, 1], true);
  }
  // The helmet is a single spherical assembly: eyes, visor, rim and plume all roll with it.
  ellipsoid(head, [0, 0, 0], [.53, .53, .51], lightSteel);
  const visorGeo = new THREE.SphereGeometry(.543, 32, 8, Math.PI * .22, Math.PI * .56, Math.PI * .40, Math.PI * .19); geometries.add(visorGeo);
  mesh(head, visorGeo, black, [0, 0, 0]);
  for (const side of [-1, 1]) {
    ellipsoid(head, [side * .18, .015, .515], [.066, .078, .027], glow, false);
    ellipsoid(head, [side * .515, -.025, 0], [.07, .13, .13], darkSteel);
    ellipsoid(head, [side * .559, -.025, 0], [.02, .055, .055], gold, false);
  }
  band(head, -.35, .393, .043); band(head, .35, .397, .034);
  for (let i = 0; i < 10; i++) {
    const a = i / 10 * Math.PI * 2;
    ellipsoid(head, [Math.sin(a) * .412, -.345, Math.cos(a) * .412], [.025, .025, .025], gold, false);
  }
  band(head, .52, .1, .027);
  const plume = new THREE.Group(); head.add(plume);
  for (let i = 0; i < 4; i++) {
    const p = ellipsoid(plume, [0, .61 + i * .035, -.04 - i * .07], [.115 - i * .015, .19 - i * .017, .19], i % 2 ? red : clothLight);
    p.rotation.x = -.35 - i * .16;
  }
  // Overlapping breastplate, articulated waist and a visibly hollow magic collar.
  ellipsoid(body, [0, 1.27, 0], [.42, .54, .28], darkSteel);
  plate(body, [[-.36,.36],[.36,.36],[.4,.06],[.25,-.36],[0,-.43],[-.25,-.36],[-.4,.06]], .12, steel, [0,1.3,.18]);
  plate(body, [[-.34,.32],[0,.13],[.34,.32],[.28,.42],[-.28,.42]], .055, lightSteel, [0,1.3,.27]);
  plate(body, [[0,.13],[.09,0],[0,-.13],[-.09,0]], .045, gold, [0,1.35,.35]);
  band(body, 1.73, .19, .046, lightSteel);
  const neckGeo = new THREE.CircleGeometry(.16, 24); geometries.add(neckGeo);
  const neck = mesh(body, neckGeo, glow, [0,1.723,0]); neck.rotation.x = -Math.PI/2;
  band(body, .95, .34, .036, gold);
  for (const side of [-1, 0, 1]) {
    plate(body, [[-.14,.12],[.14,.12],[.17,-.12],[-.17,-.12]], .07, lightSteel, [side*.27,.82,.16 + (side === 0 ? .14 : 0)]);
  }
  const cape = plate(body, [[-.28,.0],[.28,0],[.49,-1.17],[.27,-1.23],[0,-1.17],[-.27,-1.23],[-.49,-1.17]], .035, red, [0,1.63,-.32]);
  cape.rotation.x = .18;
  const legs = [-1, 1].map(side => {
    const pivot = new THREE.Group(); pivot.position.set(side*.23,.82,0); body.add(pivot);
    ellipsoid(pivot,[0,-.16,0],[.16,.25,.16],darkSteel);
    ellipsoid(pivot,[0,-.35,.075],[.185,.16,.18],lightSteel);
    ellipsoid(pivot,[0,-.52,0],[.14,.23,.15],steel);
    ellipsoid(pivot,[0,-.71,.115],[.19,.115,.3],darkSteel);
    for (let i=0;i<3;i++) ellipsoid(pivot,[0,-.68,.09+i*.085],[.185-i*.015,.065,.09],lightSteel,false);
    return pivot;
  });
  const arms = [-1, 1].map(side => {
    const pivot = new THREE.Group(); pivot.name=side<0?'Left shoulder':'Right shoulder'; pivot.position.set(side*.48,1.51,0); body.add(pivot);
    ellipsoid(pivot,[side*.025,0,0],[.28,.21,.28],lightSteel);
    ellipsoid(pivot,[side*.045,-.13,.015],[.245,.12,.25],steel);
    ellipsoid(pivot,[0,-.29,0],[.125,.21,.13],darkSteel);
    const forearm = new THREE.Group(); forearm.position.y = -.4; pivot.add(forearm);
    ellipsoid(forearm,[0,-.13,.015],[.16,.23,.16],lightSteel);
    ellipsoid(forearm,[0,-.31,.03],[.14,.13,.12],darkSteel);
    for(let i=0;i<3;i++) ellipsoid(forearm,[(i-1)*.07,-.38,.07],[.035,.095,.053],steel,false);
    const wrist = new THREE.Group(); wrist.name=side<0?'Left grip':'Right grip'; wrist.position.y=-.36;forearm.add(wrist);
    return { pivot, forearm, wrist };
  });
  // A real sword for the attack clip; sports launches stow it on the back.
  const sword = new THREE.Group(); sword.name = 'Clockwork sword';
  plate(sword, [[-.075,0],[.075,0],[.075,.78],[0,.98],[-.075,.78]], .035, lightSteel, [0,.17,0]);
  mesh(sword,cube,gold,[0,.15,.02],[.4,.07,.1]);
  mesh(sword,cube,red,[0,0,.02],[.085,.25,.085]);
  ellipsoid(sword,[0,-.14,.02],[.07,.06,.06],gold);
  // Separate chest from pelvis: the hips lead and the shoulders unwind afterward.
  const torso = new THREE.Group(); torso.name='Chest and shoulders';
  for(const child of [...body.children]) if(child.position.y>1) torso.add(child);
  body.add(torso);
  const down = new THREE.Vector3(0,-1,0);
  function reachHand(index: number, target: THREE.Vector3, pole: THREE.Vector3) {
    const arm=arms[index], start=arm.pivot.position, delta=target.clone().sub(start);
    const upper=.4, lower=.36, distance=Math.min(upper+lower-.001,Math.max(.05,delta.length()));
    const direction=delta.normalize();
    const bend=pole.clone().sub(start);bend.addScaledVector(direction,-bend.dot(direction)).normalize();
    const along=(upper*upper-lower*lower+distance*distance)/(2*distance);
    const elbow=start.clone().addScaledVector(direction,along).addScaledVector(bend,Math.sqrt(Math.max(0,upper*upper-along*along)));
    const end=start.clone().addScaledVector(direction,distance);
    arm.pivot.quaternion.setFromUnitVectors(down,elbow.clone().sub(start).normalize());
    arm.forearm.position.set(0,-upper,0);
    arm.forearm.quaternion.copy(arm.pivot.quaternion).invert().multiply(new THREE.Quaternion().setFromUnitVectors(down,end.sub(elbow).normalize()));
  }
  function inTorso(point: THREE.Vector3) {
    torso.updateWorldMatrix(true,false);
    return torso.worldToLocal(root.localToWorld(point.clone()));
  }
  const streaks = new THREE.Group(); streaks.name = 'Launch speed streaks'; root.add(streaks);
  for(let i=0;i<3;i++) mesh(streaks,cube,glow,[(i-1)*.15,.32+i*.12,.45],[.025,.025,.6]);
  const motes = new THREE.Group(); root.add(motes);
  for(let i=0;i<12;i++) mesh(motes,cube,glow,[0,0,0],[.045,.045,.045]);

  function reset(time = 0) {
    body.visible = true; body.scale.setScalar(1); body.position.set(0,0,0); body.rotation.set(0,0,0);
    head.visible = true; head.position.set(0,HEAD_REST_Y,0); head.rotation.set(0,0,0); head.scale.setScalar(1);
    torso.rotation.set(0,0,0);
    legs.forEach((l,i)=>{l.rotation.set(0,0,0);l.position.set(i===0?-.23:.23,.82,0);});
    arms.forEach(({pivot,forearm},i)=>{pivot.rotation.set(0,0,(i===0?-.10:.10));forearm.rotation.set(-.14,0,0);forearm.position.set(0,-.4,0);});
    cape.rotation.x=.18+Math.sin(time*3)*.025;
    plume.scale.setScalar(1);
    motes.visible = false;
    body.add(sword); sword.position.set(.34,1.08,-.43); sword.rotation.set(0,0,-.55);
    streaks.visible=false; streaks.position.set(0,0,0);
  }
  /** Lift the one helmet, wind up, release, and follow through. */
  function removeHead(u: number, emote: LaunchEmote = 'bowling') {
    const reach=ease(u/.2), lift=ease((u-.15)/.22);
    arms.forEach(({pivot,forearm})=>{pivot.rotation.x=-2.5*reach;forearm.rotation.x=-.4*reach;});
    head.position.set(0, HEAD_REST_Y+.62*lift, .05*lift);
    if(u<.37 && emote==='bowling') return;
    const wind=ease((u-.37)/.28), release=ease((u-.65)/.35);
    if(emote==='bowling') {
      // Right arm carries the head behind the hip, then sweeps past the ankle.
      head.position.set(.56*wind*(1-release),2.7-2.17*wind,.05- .65*wind+1.9*release**3);
      head.rotation.x=release*14;
      streaks.visible=release>.6;
      arms[1].pivot.rotation.x=-2.5+3.3*wind-2.15*release;
      arms[1].forearm.rotation.x=-.4*(1-wind);
      arms[0].pivot.rotation.set(-2.5*(1-wind),0,-.7*wind);
      body.rotation.x=.28*wind; body.position.y=-.1*wind;
      legs[0].rotation.x=-.5*wind; legs[1].rotation.x=.45*wind;
    } else if(emote==='football') {
      // One-handed quarterback throw: cock behind the ear, step, release, cross-body finish.
      const cock=ease(u/.32), step=ease((u-.28)/.2), release=ease((u-.42)/.18);
      const flight=THREE.MathUtils.clamp((u-.6)/.4,0,1);
      body.rotation.y=-.55*cock+.8*release;
      torso.rotation.y=-.2*cock+.35*release;
      body.position.z=.12*step;
      legs[0].position.z=.25*step;legs[0].rotation.x=-.15*step;
      legs[1].rotation.y=.4*release;
      const cocked=new THREE.Vector3(.65,2.13,-.3);
      head.position.copy(new THREE.Vector3(0,HEAD_REST_Y,0).lerp(cocked,cock));
      head.position.lerp(new THREE.Vector3(.45,2.32,.55),release);
      if(u>=.6) {
        head.position.set(.45*(1-flight),THREE.MathUtils.lerp(2.32,HEAD_RADIUS,flight)+ballisticArcHeight(flight,.85),.55+1.2*flight);
        head.rotation.z=flight*22; // Football spiral, along the forward flight axis.
        plume.scale.setScalar(.3);
      }
      const palm=head.position.clone().add(new THREE.Vector3(0,-.36,-.08));
      if(u>.6) palm.lerp(new THREE.Vector3(-.05,1.25,.45),ease(flight/.5));
      reachHand(1,inTorso(palm),new THREE.Vector3(1.1,1.7,-.3));
      // The free arm points downfield then tucks in; it never joins the throwing hand.
      arms[0].pivot.rotation.set(-.85*step,0,-.35);arms[0].forearm.rotation.x=-.55;
      streaks.visible=flight>0 && flight<.6;
      streaks.position.set(head.position.x,head.position.y-.5,head.position.z-.4);

    } else {
      // Reference: USA Baseball hitting stages (sources and phase map in docs/art).
      // Load → short stride → hips → shoulders/hands → level contact → wraparound finish.
      const lift=ease(u/.12), load=ease((u-.1)/.14), stride=ease((u-.24)/.1);
      const hips=ease((u-.32)/.16), turn=ease((u-.36)/.14), swing=ease((u-.37)/.13);
      const follow=ease((u-BASEBALL_CONTACT)/.17);
      const flight=THREE.MathUtils.clamp((u-BASEBALL_CONTACT)/(1-BASEBALL_CONTACT),0,1);
      body.position.set(0,-.06*load,-.10*load+.18*stride);
      body.rotation.y=-.75*load+.75*hips;
      torso.rotation.y=-.2*load+.2*turn+.45*follow;
      // Small lead-foot stride; rear heel turns as the hip drive starts.
      legs[0].position.z=.12*load+.24*stride;
      legs[0].rotation.x=-.18*load;
      legs[1].position.z=-.12*load;
      legs[1].rotation.set(.13*load,.6*hips,.1*hips);
      torso.add(sword);
      sword.position.set(.12*load-.12*follow,1.08+.4*lift-.06*swing+.25*follow,.1+.18*load+.12*swing-.12*follow);
      // Rotate the blade around the hitter on a shallow plane, rather than chopping down.
      const yaw=2.2*load*(1-swing)-2.4*follow, tilt=.78*(1-swing)+.08*swing+.55*follow;
      sword.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),new THREE.Vector3(Math.sin(yaw)*Math.cos(tilt),Math.sin(tilt),Math.cos(yaw)*Math.cos(tilt)));
      const gripLeft=new THREE.Vector3(0,-.09,0).applyQuaternion(sword.quaternion).add(sword.position);
      const gripRight=new THREE.Vector3(0,.025,0).applyQuaternion(sword.quaternion).add(sword.position);
      reachHand(1,gripRight,new THREE.Vector3(.9,1.1,-.15));
      // Lift/toss with the left hand, then put both hands together on the hilt before striding.
      head.position.set(0,HEAD_REST_Y+.35*Math.sin(lift*Math.PI)-.48*lift,.05+1.05*lift);
      if(u>=BASEBALL_CONTACT) {
        head.position.set(0,THREE.MathUtils.lerp(HEAD_REST_Y-.48,HEAD_RADIUS,flight)+ballisticArcHeight(flight,CATAPULT_HOP_HEIGHT*.35),1.1+.7*flight);
        plume.scale.setScalar(.3);head.rotation.set(flight*15,flight*3,-flight*5);
      }
      const liftGrip=inTorso(head.position.clone().add(new THREE.Vector3(-.18,-.37,-.1)));
      reachHand(0,liftGrip.lerp(gripLeft,ease((u-.12)/.1)),new THREE.Vector3(-.8,1.1,.35));
      streaks.visible=flight>0 && flight<.5;
      streaks.position.set(head.position.x,head.position.y-.5,head.position.z-.45);
      motes.visible=u>=BASEBALL_CONTACT && u<BASEBALL_CONTACT+.08;
      motes.children.forEach((m,i)=>m.position.set(Math.sin(i*2.4)*.38,1.6+Math.cos(i*2.4)*.38,1.1));

    }
  }
  function headOnly(spin=0) {
    plume.scale.setScalar(.3);
    body.visible=false; head.position.set(0,HEAD_RADIUS,0); head.rotation.set(spin,0,0);
  }
  function returnHead(u: number) {
    body.visible = u>.15;
    const reform=ease((u-.15)/.5); body.scale.setScalar(Math.max(.001,reform));
    head.position.set(0, HEAD_RADIUS+(HEAD_REST_Y-HEAD_RADIUS)*ease(u), .2*Math.sin(u*Math.PI));
    arms.forEach(({pivot,forearm})=>{pivot.rotation.x=-2.2*Math.sin(u*Math.PI);forearm.rotation.x=-.4;});
    motes.visible=u<.8;
    motes.children.forEach((m,i)=>m.position.set(Math.sin(i*2.4+u*7)*.5*(1-u),.2+i*.15,Math.cos(i*2.4+u*7)*.4*(1-u)));
  }
  function pose(clip: ClockworkPose, t: number, emote: LaunchEmote = 'bowling') {
    reset(t);
    if(clip==='remove') removeHead(t, emote);
    else if(clip==='return') returnHead(t);
    else if(clip==='ball') headOnly(t*Math.PI*2);
    else if(clip==='roll') {
      if(t<2/3) removeHead(t/(2/3), emote);
      else if(t<5/6) headOnly((t-2/3)*40);
      else returnHead((t-5/6)*6);
    } else if(clip==='walk'||clip==='run') {
      const phase=t*Math.PI*2, running=clip==='run';
      const stride=running?1.05:.58;
      legs.forEach((l,i)=>l.rotation.x=Math.sin(phase+i*Math.PI)*stride);
      arms.forEach(({pivot,forearm},i)=>{
        pivot.rotation.x=-Math.sin(phase+i*Math.PI)*(running?.9:.55);
        pivot.rotation.z=running?(i===0?-.28:.28):0;
        forearm.rotation.x=running?-1.05:0;
      });
      // A sprint has a crouched forward lean, pumping elbows and a flight
      // phase. Its silhouette stays distinct even when viewed from behind.
      body.rotation.x=running?.22:0;
      body.position.y=running?-.12+Math.abs(Math.sin(phase))*.19:Math.abs(Math.sin(phase))*.045;
      head.position.y+=body.position.y;
      head.position.z=running?.28:0;
      head.rotation.x=running?-.10:0;
      cape.rotation.x=(running?.58:.22)+Math.sin(phase)*(running?.22:.12);
    } else if(clip==='attack') {
      arms[1].forearm.add(sword); sword.position.set(0,-.32,.1); sword.rotation.set(Math.PI,0,0);
      const swing=Math.sin(t*Math.PI); arms[1].pivot.rotation.x=-swing*2.5; arms[1].forearm.rotation.x=-.4;
      body.rotation.y=-.3+swing*.7; head.rotation.y=swing*.2;
    } else if(clip==='death') {
      const fall=ease(t); body.rotation.x=-fall*Math.PI/2; body.position.y=-fall*.55;
      head.position.set(fall*.55,HEAD_REST_Y*(1-fall)+HEAD_RADIUS*fall,fall*.5); head.rotation.x=fall*4;
    } else {
      const breathe=Math.sin(t*Math.PI*2)*.025; body.position.y=breathe; head.position.y+=breathe;
    }
  }
  function dispose() { geometries.forEach(g=>g.dispose());materials.forEach(m=>m.dispose());ramp.dispose();root.removeFromParent(); }
  pose('idle',0);
  return { root, body, torso, head, pose, removeHead, headOnly, reset, dispose };
}
