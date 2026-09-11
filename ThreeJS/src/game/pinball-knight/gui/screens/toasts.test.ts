import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import type { UiFrame } from '../im';
const draw=vi.hoisted(()=>({text:vi.fn(),fill:vi.fn(),stroke:vi.fn()}));
vi.mock('../../state',()=>({state:{pixelPass:null}}));
vi.mock('./hud',()=>({PANEL_H:61}));
vi.mock('../card-face',()=>({cardFaceAt:()=>null,CARD_W:72,CARD_H:100}));
vi.mock('../im',()=>({rect:(x:number,y:number,w:number,h:number)=>({x,y,w,h}),text:draw.text,fillRect:draw.fill,strokeRect:draw.stroke}));
import { clearToasts, clearFloatingCombos, pushToast, pushFloatingCombo, toastScreen } from './toasts';
const frame=()=>({w:700,h:450,scale:1.8,g:{globalAlpha:1}} as unknown as UiFrame);
function paint(){const screen=toastScreen();screen.paint(frame(),screen);}
beforeEach(()=>{clearToasts();clearFloatingCombos();vi.clearAllMocks();vi.spyOn(performance,'now').mockReturnValue(1000);});
afterEach(()=>vi.restoreAllMocks());
describe('compact combo feedback',()=>{
  it('updates one compact style notice while retaining unrelated loot',()=>{
    pushToast('Picked up a potion');
    for(let combo=28;combo<=31;combo++)pushToast(`STYLE +149g · ×${combo}`,'style-kill');
    paint();
    expect(draw.fill).toHaveBeenCalledTimes(2);
    expect(draw.text.mock.calls.map(call=>call[1])).toEqual(['STYLE +149g · ×31','Picked up a potion']);
    expect(draw.fill.mock.calls[0][1]).toMatchObject({w:168,h:20});
  });
  it('keeps floating combo positions at their projected screen location after UI scaling',()=>{
    pushFloatingCombo(7,720,180);paint();
    expect(draw.text).toHaveBeenCalledWith(expect.anything(),'x7',400,100,expect.objectContaining({size:8}));
  });
  it('bounds rapid combo feedback to three numbers',()=>{
    for(let combo=1;combo<=30;combo++)pushFloatingCombo(combo,200,200);paint();
    expect(draw.text).toHaveBeenCalledTimes(3);
    expect(draw.text.mock.calls.map(call=>call[1])).toEqual(['x30','x29','x28']);
  });
});
