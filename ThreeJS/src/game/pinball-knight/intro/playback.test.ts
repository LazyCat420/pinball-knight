import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import * as THREE from 'three';
const testState = vi.hoisted(() => ({ renderer: null as any, active: true, player: null, animFrameId: null as number | null }));
vi.mock('../state', () => ({ state: testState }));
vi.mock('../sfx', () => ({ sfxRoll: vi.fn(), sfxBumper: vi.fn(), sfxLevelStart: vi.fn() }));
vi.mock('./cinematic', () => ({ createCinematic: () => film }));
let film: any, elements: any[], listeners: Map<string, (event: any) => void>, frames: Map<number, FrameRequestCallback>, next: number;
let win: any, doc: any;
function element(tag: string): any {
  const el = { tagName: tag, style: {}, children: [] as any[], append(...children: any[]) { this.children.push(...children); }, remove: vi.fn() };
  elements.push(el); return el;
}
async function settle() { for (let i = 0; i < 12; i++) await Promise.resolve(); }
function frame(t: number) { const callbacks = [...frames.values()]; frames.clear(); callbacks.forEach(cb => cb(t)); }
beforeEach(() => {
  vi.resetModules(); vi.useFakeTimers();
  elements = []; listeners = new Map(); frames = new Map(); next = 0;
  const scene = new THREE.Scene();
  const actor = () => ({ root: new THREE.Group(), head: new THREE.Group(), pose: vi.fn(), applyPose: vi.fn() });
  const hero = actor();
  film = { scene, fill: new THREE.DirectionalLight(), camera: new THREE.PerspectiveCamera(), hero, knight: hero.root, rolling: actor(), town: new THREE.Group(), arcade: new THREE.Group(), title: new THREE.Group(), shadow: new THREE.Group(), portal: new THREE.Group(), trail: [], layout: { spawn: { x: 0, z: 0 }, grid: { w: 3, h: 3, t: new Uint8Array(9).fill(1), shapes: new Uint8Array(9) } }, dispose: vi.fn() };
  scene.add(film.town, film.arcade, film.title);
  const renderer = { autoClear: true, getDrawingBufferSize: (v: THREE.Vector2) => v.set(1200, 800), getRenderTarget: () => null, getClearColor: (c: THREE.Color) => c.set(0), getClearAlpha: () => 1, setClearColor: vi.fn(), domElement: { clientWidth: 1200, clientHeight: 800 }, getPixelRatio: () => 1, setPixelRatio: vi.fn(), init: vi.fn(async () => {}), compileAsync: vi.fn(async () => {}), setRenderTarget: vi.fn(), render: vi.fn() };
  Object.assign(testState, { renderer, active: true, player: null, animFrameId: null });
  const overlay = element('overlay'); overlay.children.push(renderer.domElement);
  doc = { body: overlay, hidden: false, getElementById: () => overlay, createElement: element };
  win = { location: { search: '' }, devicePixelRatio: 1, matchMedia: () => ({ matches: false }), addEventListener: (name: string, fn: any) => listeners.set(name, fn), removeEventListener: (name: string) => listeners.delete(name) };
  vi.stubGlobal('document', doc); vi.stubGlobal('window', win);
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => { frames.set(++next, cb); return next; });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('cinematic playback', () => {
  it('waits for shader warm-up and preserves the arcade shot across stalls and hidden tabs', async () => {
    let warmed!: () => void;
    testState.renderer.compileAsync.mockImplementation(() => new Promise<void>(r => { warmed = r; }));
    const { runPinballIntro } = await import('./index');
    runPinballIntro(vi.fn()); await settle();
    expect(frames.size).toBe(0);
    warmed(); await settle();
    frame(0);
    for (let t = 100; t <= 9500; t += 100) frame(t);
    expect(win.__dungeonIntroPhase).toBe('arcade');
    frame(15500); // shader/CPU stall must not consume the entire arcade scene
    expect(win.__dungeonIntroPhase).toBe('arcade');
    doc.hidden = true; frame(20000);
    doc.hidden = false; frame(40000);
    expect(win.__dungeonIntroPhase).toBe('arcade');
    const phases = new Set<string>();
    for (let t = 40100; t <= 53000; t += 100) { frame(t); phases.add(win.__dungeonIntroPhase); }
    expect([...phases]).toEqual(expect.arrayContaining(['machine', 'sweep', 'title']));
  });

  it('does not skip from a held launch key repeating into the intro', async () => {
    const { runPinballIntro } = await import('./index');
    const done = vi.fn(); runPinballIntro(done); await settle(); frame(0);
    listeners.get('keydown')!({ key: 'Enter', repeat: true, preventDefault: vi.fn(), stopImmediatePropagation: vi.fn() });
    await vi.advanceTimersByTimeAsync(300);
    expect(done).not.toHaveBeenCalled();
    listeners.get('keydown')!({ key: 'Enter', repeat: false, preventDefault: vi.fn(), stopImmediatePropagation: vi.fn() });
    await vi.advanceTimersByTimeAsync(300);
    expect(done).toHaveBeenCalledTimes(1);
  });

  it('ignores ordinary clicks and movement keys, while the Skip button still works', async () => {
    const { runPinballIntro } = await import('./index');
    const done = vi.fn(); runPinballIntro(done); await settle(); frame(0);
    expect(listeners.has('pointerdown')).toBe(false);
    const event = { key: 'w', preventDefault: vi.fn(), stopImmediatePropagation: vi.fn() };
    listeners.get('keydown')!(event);
    await vi.advanceTimersByTimeAsync(300);
    expect(done).not.toHaveBeenCalled(); expect(event.preventDefault).not.toHaveBeenCalled();
    elements.find(e => e.tagName === 'button').onclick({ stopPropagation: vi.fn() });
    await vi.advanceTimersByTimeAsync(300);
    expect(done).toHaveBeenCalledTimes(1); expect(film.dispose).toHaveBeenCalledTimes(1);
  });
});
