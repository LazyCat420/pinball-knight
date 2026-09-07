/** Town → lift off head → bowl into arcade → enchanted cabinet → the original PINBALL / KNIGHT maze. */
import * as THREE from 'three';
import { state } from '../state';
import { introDeltas } from './clock';
import { INTRO_BALL_SPEED, stepIntroBall, type IntroBall } from './title-grid';
import { createCinematic } from './cinematic';
import { sfxRoll, sfxBumper, sfxLevelStart } from '../sfx';

let played = false;
function shouldSkipIntro(): boolean {
  const q = new URLSearchParams(window.location.search);
  return played || q.get('no-intro') === '1' || q.get('autostart') === '1'
    || Boolean((window as unknown as { __skipDungeonIntro?: boolean }).__skipDungeonIntro)
    || Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
}
const smooth = (x: number) => { const t = THREE.MathUtils.clamp(x, 0, 1); return t * t * (3 - 2 * t); };

export function runPinballIntro(onDone: () => void): void {
  const renderer = state.renderer;
  if (!renderer || shouldSkipIntro()) { onDone(); return; }
  played = true;
  const film = createCinematic();
  const { scene, camera, knight, layout } = film;
  const overlay = document.getElementById('dungeon-game-overlay') ?? document.body;
  const hidden = Array.from(overlay.children).filter(el => el !== renderer.domElement).map(el => ({ el: el as HTMLElement, visibility: (el as HTMLElement).style.visibility }));
  hidden.forEach(({ el }) => el.style.visibility = 'hidden');
  const hud = document.createElement('div');
  hud.style.cssText = 'position:absolute;inset:0;z-index:9000;pointer-events:none;color:#fff2d8;font-family:system-ui,sans-serif;background:linear-gradient(#11192b66,transparent 22%,transparent 72%,#11192bcc);';
  const chapter = document.createElement('div');
  chapter.style.cssText = 'position:absolute;left:6%;top:7%;font-size:11px;font-weight:700;letter-spacing:.25em;color:#b9efea;';
  const caption = document.createElement('div');
  caption.style.cssText = 'position:absolute;left:6%;bottom:10%;font-size:clamp(20px,3.5vw,44px);font-weight:750;letter-spacing:-.04em;max-width:75%;text-shadow:0 2px 14px #12182b;';
  const skip = document.createElement('button'); skip.textContent = 'Skip intro ↗';
  skip.style.cssText = 'position:absolute;right:5%;top:6%;pointer-events:auto;background:#19233acc;border:1px solid #b4dbdd66;border-radius:30px;color:#e9f3ed;padding:12px 19px;cursor:pointer;font:600 12px system-ui;';
  const progress = document.createElement('div'); progress.style.cssText = 'position:absolute;bottom:0;left:0;height:3px;background:#b8f1df;';
  const fade = document.createElement('div'); fade.style.cssText = 'position:absolute;inset:0;background:#e3ffff;opacity:0;pointer-events:none;';
  hud.append(chapter, caption, skip, progress, fade); overlay.append(hud);
  const ratio = renderer.getPixelRatio(); renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
  let last = -1, elapsed = 0, acc = 0, raf = 0, disposed = false, finishing = false, lastBounce = -1;
  let finishTimer: ReturnType<typeof setTimeout> | undefined;
  const ball: IntroBall = { ...layout.spawn, vx: INTRO_BALL_SPEED * .84, vz: INTRO_BALL_SPEED * .55 };
  const target = new THREE.Vector3();
  const history: Array<{ x: number; z: number }> = [];
  let trailClock = 0;
  const diagnostics = window as unknown as { __dungeonIntroPhase?: string | null };
  function cleanup() {
    if (disposed) return;
    disposed = true; cancelAnimationFrame(raf); clearTimeout(finishTimer);
    if (state.animFrameId === raf) state.animFrameId = null;
    window.removeEventListener('keydown', key, true); window.removeEventListener('pointerdown', pointer, true);
    hud.remove(); hidden.forEach(({ el, visibility }) => el.style.visibility = visibility);
    renderer!.setPixelRatio(ratio); film.dispose(); diagnostics.__dungeonIntroPhase = null;
  }
  function finish() {
    if (finishing || disposed) return;
    finishing = true; fade.style.background = '#101525'; fade.style.transition = 'opacity 250ms'; fade.style.opacity = '1';
    finishTimer = setTimeout(() => { cleanup(); if (state.active && !state.player) { sfxLevelStart(); onDone(); } }, 260);
  }
  function key(e: KeyboardEvent) {
    if (['Shift', 'Control', 'Alt', 'Meta', 'F5', 'F11', 'F12', 'Tab'].includes(e.key) || e.ctrlKey || e.metaKey || e.altKey) return;
    e.preventDefault(); e.stopImmediatePropagation(); finish();
  }
  function pointer(e: PointerEvent) { e.stopImmediatePropagation(); finish(); }
  window.addEventListener('keydown', key, true); window.addEventListener('pointerdown', pointer, true); skip.onclick = finish;
  function aim(x: number, y: number, z: number, tx: number, ty: number, tz: number) {
    camera.position.set(x, y, z); target.set(tx, ty, tz); camera.lookAt(target);
  }
  function tick(now: number) {
    if (disposed) return;
    if (!state.active || state.player) { cleanup(); return; }
    const { pdt, dt } = introDeltas(now, last); last = now;
    if (!finishing) elapsed += pdt;
    camera.aspect = Math.max(.3, renderer!.domElement.clientWidth / Math.max(1, renderer!.domElement.clientHeight));
    camera.updateProjectionMatrix();
    const t = elapsed;
    film.town.visible = t < 9; film.arcade.visible = t >= 9 && t < 15; film.title.visible = t >= 15;
    film.shadow.visible = t < 9;
    knight.visible = t < 9;
    film.rolling.root.visible = t >= 7;
    progress.style.width = `${Math.min(100, t / 23 * 100)}%`;
    if (!finishing) fade.style.opacity = String(Math.max(0, 1 - Math.abs(t - 9) / .25, 1 - Math.abs(t - 15) / .3));
    const portrait = Math.max(1, 1.1 / camera.aspect);
    if (t < 4) {
      diagnostics.__dungeonIntroPhase = 'town'; chapter.textContent = '01 / THE LANTERN QUARTER'; caption.textContent = 'A knight with a game in mind.';
      const walk = smooth(t / 4);
      knight.position.set(-6 + 8.4 * walk, 0, 3);
      knight.rotation.set(0, Math.PI / 2 + .9 * smooth((t - 3.3) / .7), 0);
      film.hero.pose('walk', t * 1.3);
      const focus = knight.position.x;
      aim(focus + 6, 6 * portrait, 13 * portrait, focus + .8, 1.6, .5);
    } else if (t < 7) {
      diagnostics.__dungeonIntroPhase = 'head-off'; chapter.textContent = '02 / USE YOUR HEAD'; caption.textContent = 'Helmet off. Game on.';
      knight.position.set(2.4, 0, 3); knight.rotation.set(0, Math.PI / 2 + .9, 0);
      film.hero.pose('remove', (t - 4) / 3);
      // A closer three-quarter camera makes both hands and the empty collar readable.
      const u = smooth((t - 4) / .7);
      aim(8.4 + u * .4, (6 - u * 2.2) * portrait, (13 - u * 8.2) * portrait, 3, 1.6, 2.5);
    } else if (t < 9) {
      diagnostics.__dungeonIntroPhase = 'head-roll'; chapter.textContent = '02 / USE YOUR HEAD'; caption.textContent = 'One very unusual bowling ball.';
      film.hero.pose('remove', 1); film.hero.head.visible = false;
      const u = smooth((t - 7) / 2), angle = Math.PI / 2 + .9;
      const sx = 2.4 + Math.sin(angle) * 1.31, sz = 3 + Math.cos(angle) * 1.31;
      film.rolling.pose('ball', (t - 7) * 1.6);
      film.rolling.root.position.set(sx + (4.8 - sx) * u, 0, sz + (-.5 - sz) * u);
      film.rolling.root.rotation.y = angle;
      if (t - pdt < 7) sfxRoll();
      aim(7.5, 3.6 * portrait, 10 * portrait, 4.4, 1.1, .9);
    } else if (t < 12) {
      diagnostics.__dungeonIntroPhase = 'arcade'; chapter.textContent = '03 / THE ARCADE'; caption.textContent = 'Follow the lights.';
      const u = smooth((t - 9) / 3);
      film.rolling.pose('ball', (t - 9) * 1.8); film.rolling.root.rotation.y = Math.PI;
      film.rolling.root.position.set(0, 0, 4.6 - 2.7 * u);
      aim(5 - u * 2, 4.5 * portrait, (8 - u) * portrait, 0, 1.2, -.6);
    } else if (t < 15) {
      diagnostics.__dungeonIntroPhase = 'machine'; chapter.textContent = '04 / PLAYER ONE'; caption.textContent = 'You are the pinball.';
      const u = smooth((t - 12) / 3);
      film.rolling.pose('ball', (t - 12) * 2); film.rolling.root.position.set(0, 1.78 * Math.min(1, u / .85), 1.9 - 3.65 * u);
      film.portal.visible = u > .75; film.portal.scale.setScalar(.7 + Math.sin(u * Math.PI) * .3); film.portal.rotation.z = t * 3;
      film.rolling.root.scale.setScalar(1 - .7 * smooth((u - .8) / .2));
      aim(3 * (1 - u * .8), 4 * portrait, (6 - u * 5) * portrait, 0, 1.8, -.8);
    } else {
      diagnostics.__dungeonIntroPhase = t < 19.5 ? 'sweep' : 'title'; chapter.textContent = 'PINBALL KNIGHT'; caption.textContent = t < 19.5 ? 'A legend on a roll.' : 'Your quest takes a different bounce.';
      film.portal.visible = false;
      acc += dt;
      let bounced = false;
      while (acc >= 1 / 120) { bounced = stepIntroBall(layout.grid, ball, 1 / 120) || bounced; acc -= 1 / 120; }
      if (bounced && t - lastBounce > .09) { sfxBumper(); lastBounce = t; }
      film.rolling.pose('ball', t * 2); film.rolling.root.scale.setScalar(.7); film.rolling.root.position.set(ball.x, .03, ball.z);
      film.rolling.root.rotation.y = Math.atan2(ball.vx, ball.vz);
      trailClock += dt;
      if (trailClock > .035) { trailClock = 0; history.unshift({ x: ball.x, z: ball.z }); history.length = Math.min(history.length, film.trail.length); }
      film.trail.forEach((m, i) => { m.visible = !!history[i]; if (history[i]) { m.position.set(history[i].x, .5, history[i].z); m.scale.setScalar(.18 * (1 - i / film.trail.length)); } });
      const u = smooth((t - 15) / 4.5);
      const distance = Math.max(36, layout.grid.w / (2 * Math.tan(THREE.MathUtils.degToRad(20)) * camera.aspect) * 1.2);
      const tx = ball.x * (1 - u), tz = ball.z * (1 - u);
      aim(tx + 2 * (1 - u), 7 + (distance - 7) * u, tz + 8 + (distance * .55 - 8) * u, tx, 0, tz);
      if (t >= 23) finish();
    }
    renderer!.setRenderTarget(null); renderer!.render(scene, camera);
    raf = requestAnimationFrame(tick); state.animFrameId = raf;
  }
  void renderer.init().then(() => {
    if (!disposed && !finishing) { raf = requestAnimationFrame(tick); state.animFrameId = raf; }
  }).catch(error => {
    console.error('[pinball-knight] Intro renderer initialization failed', error);
    cleanup();
    if (state.active && !state.player) onDone();
  });
}
