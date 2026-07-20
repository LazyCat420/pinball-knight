/**
 * ROULETTE ART — an isometric wheel rasterised by hand.
 *
 * ── Why none of this uses `arc()` ───────────────────────────────────────────
 * Same rule as `slots-game.ts`: Canvas 2D anti-aliases every path it draws and
 * offers no way to switch that off, so `arc`, `ellipse`, `bezierCurveTo`,
 * gradients, `shadowBlur` and alpha shading all produce soft fringed edges that
 * read as a blurry PNG pasted into pixel art. `fillRect` on integer coordinates
 * is the only reliably crisp primitive available.
 *
 * A roulette wheel is nothing BUT circles, so they are rasterised here instead.
 * `paintDisc` walks the scanlines of an ellipse, and for each scanline walks x,
 * asks a `pick` callback for the colour of that pixel, and emits ONE `fillRect`
 * per run of identical colour. A wheel scanline crosses at most a few dozen
 * pocket boundaries, so a full wheel is a few thousand rects rather than the
 * ~19,000 single-pixel rects a naive loop would emit.
 *
 * ── The isometric projection ────────────────────────────────────────────────
 * Straight axonometric squash. A point at wheel-space angle `a` and normalised
 * radius `r` lands at
 *
 *     x = cx + R*r*cos(a)
 *     y = cy + R*r*sin(a)*FLAT - lift
 *
 * with FLAT ~= 0.46 the vertical foreshortening, and `lift` the height of that
 * part of the wheel above the pocket floor in screen pixels. Inverting it (
 * `dyw = (sy - (cy - lift)) / FLAT`) is what lets the rasteriser go the other
 * way and ask "which part of the wheel is this pixel?".
 *
 * ── Depth ───────────────────────────────────────────────────────────────────
 * Painter's algorithm, outside in. The wheel is drawn as NESTED FILLED DISCS
 * from the rim inward, each with a smaller radius and a lower lift, so each one
 * paints over the interior of the last exactly the way a bowl's terraces
 * occlude each other. Then the ball is drawn, and THEN the far half of the rim
 * and lip are repainted as annuli on top — which is what makes the ball
 * genuinely disappear behind the far rim as it comes round, rather than sliding
 * over it like a sticker.
 *
 * ── Colour ──────────────────────────────────────────────────────────────────
 * Every ramp is hue-rotated, not lightness-ramped: shadows shift toward blue,
 * highlights toward yellow. A ramp built by dragging a lightness slider makes
 * every material read as grey wearing a colour, which is the note `slots-game`
 * records too.
 */
import { colorOf } from "./roulette";
import { DEFLECTORS, POCKET_PITCH, R_POCKET, type BallFrame } from "./roulette-physics";

/** Wheel centre and size, in canvas pixels. */
export const CX = 124;
export const CY = 102;
export const R = 94;
/** Vertical foreshortening. Lower = more of a "looking along the table" view. */
export const FLAT = 0.46;

/** Radius and screen lift of each terrace, outside in. Painted in this order. */
const RIM_R = 1.0;
const RIM_LIFT = 11;
const LIP_R = 0.945;
const LIP_LIFT = 8;
const TRACK_R = 0.925;
const TRACK_LIFT = 5;
const APRON_R = 0.855;
const APRON_LIFT = 2;
const RING_R = 0.745;
const RING_LIFT = 0;
const CONE_R = 0.5;
const CONE_LIFT = 4;
const CONE2_R = 0.37;
const CONE2_LIFT = 9;
const TURRET_R = 0.21;
const TURRET_LIFT = 15;

/** Where the ball rides when it is up on the track, in art radius. */
const BALL_TRACK_R = 0.9;
/** Depth of the bowl's outer wall below the rim, in pixels. */
const SKIRT = 13;

/** Deflector ring radius in art space, and half-size of a diamond in pixels. */
const DEFL_R = 0.8;

/** ── Ramps ── ink, shade, base, lite, hi. Cool shadows, warm highlights. */
const MAHOGANY = ["#2a1218", "#46201c", "#6b3624", "#94552f", "#c08a4e"];
/** The bowl's outer wall. Deliberately a TIGHT ramp — see the skirt loop. */
const WALL = ["#25121a", "#331821", "#442026", "#572b2c"];
const BRASS = ["#3d2f12", "#6e551d", "#a8842c", "#d9b551", "#ffe9a0"];
const STEEL = ["#191d2a", "#2c3242", "#4a5266", "#78829a", "#b6c0d4"];
const GROOVE = ["#080a10", "#0e121c", "#151a26", "#1f2634", "#2c3446"];
const FELT = ["#0b1a16", "#123027", "#1b4736", "#286047", "#3a7d5c"];

const RED = ["#3a0c14", "#66161f", "#a8323c", "#c4535c", "#dc7a80"];
const BLACK = ["#06080d", "#0e1118", "#1e222c", "#333a4a", "#4c5568"];
const GREEN = ["#08211a", "#0f3a28", "#2e7d4f", "#46a166", "#67c184"];
const POCKET_RAMP: Record<string, string[]> = { red: RED, black: BLACK, green: GREEN };

const C_BG = "#05070b";
const C_BALL = "#dbe3f0";
const C_BALL_HI = "#ffffff";
const C_BALL_LO = "#7c8699";
const C_BALL_TRAIL = "#5c6479";
const C_WIN = "#f0c040";
const C_WIN_HI = "#fff0b0";
const C_TEXT = "#c9c1ad";
const C_DIM = "#6f6a5c";
const C_PANEL = "#141824";
const C_PANEL_HI = "#2a3142";

/**
 * Light direction, as a unit vector in wheel space. Upper-left, which is where
 * every other light in the tavern comes from.
 */
const LX = -0.66;
const LY = -0.75;

/**
 * Pick a ramp entry for a pixel.
 *
 * Two inputs are combined: how far across its band the pixel sits (`edge`, 0 at
 * the inner edge and 1 at the outer), and how much the surface faces the light.
 * On a wheel the second term is what makes the rim read as round rather than as
 * a flat washer, because it varies with angle all the way around.
 */
function tone(ramp: string[], nx: number, ny: number, edge: number, bias: number): string {
  const lit = nx * LX + ny * LY;
  const i = Math.round(1.6 + lit * 1.5 + edge * 0.9 + bias);
  return ramp[i < 0 ? 0 : i > 4 ? 4 : i];
}

/** Colour for a pixel, or null to leave it alone. */
type Pick = (rr: number, ang: number, nx: number, ny: number) => string | null;

/**
 * Rasterise an ellipse (or annulus) of the wheel, run-length encoded.
 *
 * `outer`/`inner` are normalised wheel radii; `lift` raises the whole terrace up
 * the screen. `farOnly` restricts painting to the half of the wheel behind the
 * centre, which is how the rim is put back on top of the ball.
 */
function paintDisc(
  ctx: CanvasRenderingContext2D,
  outer: number,
  inner: number,
  lift: number,
  pick: Pick,
  farOnly = false,
): void {
  const ry = R * outer * FLAT;
  const baseY = CY - lift;
  const y0 = Math.floor(baseY - ry);
  const y1 = Math.ceil(baseY + ry);
  const outerR = R * outer;

  for (let sy = y0; sy <= y1; sy++) {
    // Un-project this scanline back into (squashed-free) wheel space.
    const dyw = (sy + 0.5 - baseY) / FLAT;
    if (farOnly && dyw >= 0) break;
    const inside = outerR * outerR - dyw * dyw;
    if (inside <= 0) continue;
    const halfW = Math.sqrt(inside);
    const x0 = Math.floor(CX - halfW);
    const x1 = Math.ceil(CX + halfW);

    let runColor: string | null = null;
    let runStart = 0;
    for (let sx = x0; sx <= x1; sx++) {
      const dxw = sx + 0.5 - CX;
      const d = Math.sqrt(dxw * dxw + dyw * dyw);
      const rr = d / R;
      let col: string | null = null;
      if (rr <= outer && rr >= inner) {
        const inv = d > 0.0001 ? 1 / d : 0;
        col = pick(rr, Math.atan2(dyw, dxw), dxw * inv, dyw * inv);
      }
      if (col !== runColor) {
        if (runColor !== null) ctx.fillRect(runStart, sy, sx - runStart, 1);
        runColor = col;
        runStart = sx;
        if (col !== null) ctx.fillStyle = col;
      }
    }
    if (runColor !== null) ctx.fillRect(runStart, sy, x1 - runStart + 1, 1);
  }
}

/** Normalised-band position, 0 at `lo` and 1 at `hi`, clamped. */
function edgeOf(rr: number, lo: number, hi: number): number {
  const u = (rr - lo) / (hi - lo);
  return u < 0 ? 0 : u > 1 ? 1 : u;
}

/** 3x5 digits, one bit per pixel, MSB left. Only 0-9 — that is all a wheel needs. */
const DIGITS: number[][] = [
  [0b111, 0b101, 0b101, 0b101, 0b111],
  [0b010, 0b110, 0b010, 0b010, 0b111],
  [0b111, 0b001, 0b111, 0b100, 0b111],
  [0b111, 0b001, 0b111, 0b001, 0b111],
  [0b101, 0b101, 0b111, 0b001, 0b001],
  [0b111, 0b100, 0b111, 0b001, 0b111],
  [0b111, 0b100, 0b111, 0b101, 0b111],
  [0b111, 0b001, 0b010, 0b010, 0b010],
  [0b111, 0b101, 0b111, 0b101, 0b111],
  [0b111, 0b101, 0b111, 0b001, 0b111],
];

/** Draw a small integer in the 3x5 font, centred on `x`. */
function tinyNumber(ctx: CanvasRenderingContext2D, n: number, x: number, y: number, color: string): void {
  const s = String(n);
  const w = s.length * 4 - 1;
  let px = Math.round(x - w / 2);
  ctx.fillStyle = color;
  for (const ch of s) {
    const glyph = DIGITS[ch.charCodeAt(0) - 48];
    for (let row = 0; row < 5; row++) {
      const bits = glyph[row];
      for (let c = 0; c < 3; c++) if (bits & (1 << (2 - c))) ctx.fillRect(px + c, y + row, 1, 1);
    }
    px += 4;
  }
}

/** Project a wheel-space polar point to screen. */
export function project(ang: number, rr: number, lift: number): { x: number; y: number } {
  return {
    x: Math.round(CX + R * rr * Math.cos(ang)),
    y: Math.round(CY + R * rr * FLAT * Math.sin(ang) - lift),
  };
}

/** A 5x5 pixel ball: round-ish mask, one highlight pixel, one shadow row. */
function drawBall(ctx: CanvasRenderingContext2D, x: number, y: number, big: boolean): void {
  if (big) {
    // Ink halo first. The ball crosses brass, steel, dark groove and red/black
    // pockets in one orbit, and without an outline it vanishes against at least
    // two of them — it was genuinely hard to find on the brass cone.
    ctx.fillStyle = "#07090e";
    ctx.fillRect(x - 3, y - 2, 7, 4);
    ctx.fillRect(x - 2, y - 3, 5, 6);
    ctx.fillStyle = C_BALL_LO;
    ctx.fillRect(x - 2, y - 1, 5, 3);
    ctx.fillRect(x - 1, y - 2, 3, 5);
    ctx.fillStyle = C_BALL;
    ctx.fillRect(x - 1, y - 1, 3, 3);
    ctx.fillRect(x - 2, y, 4, 1);
    ctx.fillStyle = C_BALL_HI;
    ctx.fillRect(x - 1, y - 1, 1, 1);
  } else {
    ctx.fillStyle = C_BALL_LO;
    ctx.fillRect(x - 1, y - 1, 3, 3);
    ctx.fillStyle = C_BALL;
    ctx.fillRect(x - 1, y - 1, 2, 2);
    ctx.fillStyle = C_BALL_HI;
    ctx.fillRect(x - 1, y - 1, 1, 1);
  }
}

/**
 * Screen lift of the ball.
 *
 * It has to follow the TERRACE the ball is currently over, not just its own
 * hop height: the track sits 5px above the pocket ring, so a fixed lift left a
 * seated ball floating four pixels clear of its pocket and reading as if it had
 * come to rest on the apron. Interpolating the terrace lift by radius, then
 * adding the hop, seats it properly and still arcs it correctly on the way down.
 */
function ballLift(f: BallFrame): number {
  const onTrack = (f.radius - R_POCKET) / (1 - R_POCKET);
  return RING_LIFT + 1 + onTrack * (TRACK_LIFT - RING_LIFT) + f.height * 7;
}

export interface WheelView {
  /** Live ball + rotor state. */
  frame: BallFrame;
  /** Pocket to flash gold, or -1. */
  highlight: number;
  /** 0..1 flash phase for the highlight, so it can pulse. */
  flash: number;
  /** Draw the ball at all — false while idle. */
  showBall: boolean;
}

/**
 * Draw the whole wheel.
 *
 * The terrace order below IS the depth sort; changing it changes what occludes
 * what. Read it top to bottom as "outside in, then the ball, then the far rim
 * back on top".
 */
export function drawWheel(ctx: CanvasRenderingContext2D, v: WheelView): void {
  const { frame } = v;
  const rotor = frame.rotor;

  // ── Bowl skirt ── the outer wall below the rim. One rect per column, so the
  // silhouette is the same rasterised ellipse the rim uses and they line up.
  const ryRim = R * FLAT;
  for (let sx = Math.floor(CX - R); sx <= Math.ceil(CX + R); sx++) {
    const dxw = sx + 0.5 - CX;
    const inside = R * R - dxw * dxw;
    if (inside <= 0) continue;
    const yb = Math.round(CY - RIM_LIFT + (ryRim * Math.sqrt(inside)) / R);
    // Shade the wall by how far round the cylinder this column is, on its OWN
    // narrow ramp. Two earlier attempts (a left/right split, then the mahogany
    // ramp) both put a hard vertical seam down the middle of the bowl that read
    // as a rendering fault — the tones were simply too far apart to quantise.
    // The row-by-row darkening toward the table is what finally broke the
    // remaining edge up, as well as seating the wheel on the felt.
    const t = dxw / R;
    const lit = Math.round(1.5 + t * LX * 2 - Math.abs(t) * 1.2);
    const base = lit < 0 ? 0 : lit > 3 ? 3 : lit;
    for (let k = 0; k < SKIRT; k++) {
      const j = base - (k > SKIRT - 4 ? 1 : 0);
      ctx.fillStyle = WALL[j < 0 ? 0 : j];
      ctx.fillRect(sx, yb + k, 1, 1);
    }
    ctx.fillStyle = "#0c1a15";
    ctx.fillRect(sx, yb + SKIRT, 1, 2);
  }

  // ── Rim ── mahogany, lit from the upper left.
  paintDisc(ctx, RIM_R, 0, RIM_LIFT, (rr, _a, nx, ny) => tone(MAHOGANY, nx, ny, edgeOf(rr, LIP_R, RIM_R), 0.4));

  // ── Brass lip ── the bright ring that catches the light at the track's edge.
  paintDisc(ctx, LIP_R, 0, LIP_LIFT, (rr, _a, nx, ny) => tone(BRASS, nx, ny, edgeOf(rr, TRACK_R, LIP_R), 0.6));

  // ── Ball track ── a dark polished groove. Darker at its inner edge, which is
  // what makes it read as a channel rather than a flat band.
  paintDisc(ctx, TRACK_R, 0, TRACK_LIFT, (rr, _a, nx, ny) => tone(GROOVE, nx, ny, edgeOf(rr, APRON_R, TRACK_R), 1.1));

  // ── Apron ── the stator's slope, where the deflectors live.
  paintDisc(ctx, APRON_R, 0, APRON_LIFT, (rr, _a, nx, ny) => tone(STEEL, nx, ny, edgeOf(rr, RING_R, APRON_R), 0));

  // ── Pocket ring ── the only band whose colour depends on ANGLE, and the only
  // one indexed in the rotor's frame. This is where counter-rotation becomes
  // visible: these colours turn one way, the ball goes the other.
  const fretHalf = POCKET_PITCH * 0.11;
  paintDisc(ctx, RING_R, 0, RING_LIFT, (rr, ang, nx, ny) => {
    const rel = ang - rotor;
    const k = rel / POCKET_PITCH;
    const idx = ((Math.round(k) % 19) + 19) % 19;
    // Distance to the nearest fret, in radians.
    const off = Math.abs((k - Math.round(k)) * POCKET_PITCH);
    const edge = edgeOf(rr, CONE_R, RING_R);
    if (Math.abs(off - POCKET_PITCH / 2) < fretHalf) return tone(BRASS, nx, ny, edge, 0.5);
    if (idx === v.highlight && v.flash > 0) return v.flash > 0.5 ? C_WIN_HI : C_WIN;
    return tone(POCKET_RAMP[colorOf(idx)], nx, ny, edge, -0.2);
  });

  // ── Cone ── the brass terraces climbing to the turret.
  //
  // These get RADIAL banding with only a weak light term, unlike every other
  // surface. The first pass shaded them the same way as the rim and the result
  // was a smeared gold blob across the middle of the wheel — a lit sphere, not
  // a turned cone. Concentric steps are what say "machined metal", and the
  // light is left in only strongly enough to keep the near side warmer.
  // Blending the light smoothly into the step index put a dead straight
  // quantisation edge down the middle of the cone, which read as a seam in the
  // metal. So the terraces are now PURELY radial, and the light contributes
  // only as a specular: one ramp step brighter where the surface faces it.
  // A hard specular patch is a highlight; a soft ramp across the whole cone is
  // a smudge.
  const coneTone = (ramp: string[], rr: number, lo: number, hi: number, nx: number, ny: number): string => {
    const step = Math.floor(edgeOf(rr, lo, hi) * 3.99);
    const lit = nx * LX + ny * LY;
    const i = step + (lit > 0.5 ? 2 : lit > 0.05 ? 1 : 0);
    return ramp[i < 0 ? 0 : i > 4 ? 4 : i];
  };
  paintDisc(ctx, CONE_R, 0, CONE_LIFT, (rr, _a, nx, ny) => coneTone(BRASS, rr, CONE2_R, CONE_R, nx, ny));
  paintDisc(ctx, CONE2_R, 0, CONE2_LIFT, (rr, _a, nx, ny) => coneTone(BRASS, rr, TURRET_R, CONE2_R, nx, ny));
  paintDisc(ctx, TURRET_R, 0, TURRET_LIFT, (rr, _a, nx, ny) => coneTone(MAHOGANY, rr, 0, TURRET_R, nx, ny));

  // ── Pocket numbers ── near half only. On the far half the terraces above
  // them are in the way and the foreshortening leaves under two pixels of
  // height, so they are simply not drawn — the same reason a real wheel's far
  // numbers are unreadable from a seat at the table.
  for (let n = 0; n < 19; n++) {
    const a = rotor + n * POCKET_PITCH;
    const s = Math.sin(a);
    if (s < 0.22) continue;
    const p = project(a, (RING_R + CONE_R) / 2, RING_LIFT - 1);
    tinyNumber(ctx, n, p.x, p.y - 2, n === v.highlight && v.flash > 0 ? "#3a2a06" : "#b9c4d6");
  }

  // ── Deflectors ── diamonds on the STATIONARY bowl, so no rotor term here.
  // Four of the eight sit lower on screen than the ball's track, and the raised
  // pixel above each one is what sells them as metal standing proud.
  for (let i = 0; i < DEFLECTORS; i++) {
    const a = (i / DEFLECTORS) * Math.PI * 2 + 0.21;
    const p = project(a, DEFL_R, APRON_LIFT + 2);
    const lit = Math.cos(a) * LX + Math.sin(a) * LY > 0;
    ctx.fillStyle = BRASS[1];
    ctx.fillRect(p.x - 3, p.y, 7, 1);
    ctx.fillRect(p.x - 2, p.y - 1, 5, 1);
    ctx.fillRect(p.x - 2, p.y + 1, 5, 1);
    ctx.fillStyle = lit ? BRASS[4] : BRASS[2];
    ctx.fillRect(p.x - 1, p.y - 1, 3, 2);
    ctx.fillStyle = BRASS[0];
    ctx.fillRect(p.x - 1, p.y + 2, 3, 1);
  }

  // ── Turret ── the four-armed brass handle riding the rotor. It is the
  // clearest read on which way the WHEEL is turning, as opposed to the ball.
  //
  // The arms are sorted by depth and drawn back to front, and each is a flat
  // 2px bar at a CONSTANT lift. The first version lifted each step of each arm
  // and drew 4px blocks, which merged the four arms into one jagged gold X that
  // read as a corrupted sprite rather than a spinner.
  const arms = [0, 1, 2, 3]
    .map((k) => rotor + (k * Math.PI) / 2)
    .sort((p, q) => Math.sin(p) - Math.sin(q));
  const ARM_LIFT = TURRET_LIFT + 5;
  for (const a of arms) {
    const near = Math.sin(a) > 0;
    const tip = project(a, TURRET_R * 1.85, ARM_LIFT);
    const root = project(a, 0, ARM_LIFT);
    const steps = Math.max(Math.abs(tip.x - root.x), Math.abs(tip.y - root.y));
    for (let s = 0; s <= steps; s++) {
      const u = steps === 0 ? 0 : s / steps;
      const x = Math.round(root.x + (tip.x - root.x) * u);
      const y = Math.round(root.y + (tip.y - root.y) * u);
      ctx.fillStyle = "#16110a";
      ctx.fillRect(x - 1, y + 1, 3, 1);
      ctx.fillStyle = near ? BRASS[4] : BRASS[2];
      ctx.fillRect(x - 1, y - 1, 3, 2);
    }
    ctx.fillStyle = BRASS[near ? 3 : 1];
    ctx.fillRect(tip.x - 1, tip.y - 2, 3, 4);
  }
  const hub = project(0, 0, ARM_LIFT + 2);
  ctx.fillStyle = "#16110a";
  ctx.fillRect(hub.x - 3, hub.y - 3, 7, 8);
  ctx.fillStyle = BRASS[3];
  ctx.fillRect(hub.x - 2, hub.y - 2, 5, 5);
  ctx.fillStyle = BRASS[4];
  ctx.fillRect(hub.x - 2, hub.y - 2, 2, 2);

  // ── Ball ──
  if (v.showBall) {
    // Physics radius 1.0 (track) maps to the groove; R_POCKET maps to itself.
    const span = (BALL_TRACK_R - R_POCKET) / (1 - R_POCKET);
    const artR = R_POCKET + (frame.radius - R_POCKET) * span;
    const lift = ballLift(frame);

    // ── Smear ── a fast ball is a hard bar of dimmer pixels behind it, never a
    // blur and never a lowered alpha. Both of those fringe on this canvas.
    const speed = Math.abs(frame.omega);
    if (speed > 7) {
      const tail = Math.min(4, Math.round((speed - 7) / 3.2));
      for (let i = 1; i <= tail; i++) {
        const p = project(frame.theta - Math.sign(frame.omega) * i * 0.055, artR, lift);
        ctx.fillStyle = C_BALL_TRAIL;
        ctx.fillRect(p.x - 1, p.y - 1, 2, 2);
      }
    }

    // A drop shadow on the ring below, so the height reads while it is airborne.
    if (frame.height > 0.05 && frame.phase !== "track") {
      const sp = project(frame.theta, artR, 0);
      ctx.fillStyle = "#0a0c12";
      ctx.fillRect(sp.x - 1, sp.y, 3, 1);
    }

    const p = project(frame.theta, artR, lift);
    drawBall(ctx, p.x, p.y, true);
  }

  // ── Far rim back on top ── the depth sort's payoff. Repainting these two
  // annuli over the far half is what makes the ball vanish behind the rim on
  // the far side of the orbit instead of sliding across it.
  paintDisc(
    ctx,
    RIM_R,
    LIP_R,
    RIM_LIFT,
    (rr, _a, nx, ny) => tone(MAHOGANY, nx, ny, edgeOf(rr, LIP_R, RIM_R), 0.4),
    true,
  );
  paintDisc(ctx, LIP_R, TRACK_R, LIP_LIFT, (rr, _a, nx, ny) => tone(BRASS, nx, ny, edgeOf(rr, TRACK_R, LIP_R), 0.6), true);

  // ── Winner callout ── drawn dead last, so nothing can occlude it.
  //
  // The rotor keeps turning after the ball seats, so roughly half of all wins
  // come to rest on the FAR side of the wheel, where the pocket ring is three
  // pixels tall and its number is not drawn at all. Without this the player
  // watched a four-second spin and then could not see what they had won on the
  // object they had been staring at. A marker pinned to the ball fixes it
  // wherever the ball happens to stop.
  if (v.showBall && v.highlight >= 0 && v.flash > 0) {
    const span = (BALL_TRACK_R - R_POCKET) / (1 - R_POCKET);
    const artR = R_POCKET + (frame.radius - R_POCKET) * span;
    const p = project(frame.theta, artR, ballLift(frame));
    const bob = v.flash > 0.5 ? 0 : 1;
    const ty = p.y - 17 + bob;
    const label = String(v.highlight);
    const w = label.length * 4 + 5;
    ctx.fillStyle = "#0a0c12";
    ctx.fillRect(p.x - w / 2 - 1, ty - 1, w + 2, 9);
    ctx.fillStyle = v.flash > 0.5 ? C_WIN_HI : C_WIN;
    ctx.fillRect(p.x - w / 2, ty, w, 7);
    // The tail, so it points AT the ball rather than floating near it.
    ctx.fillRect(p.x - 1, ty + 7, 3, 2);
    ctx.fillRect(p.x, ty + 9, 1, 2);
    tinyNumber(ctx, v.highlight, p.x + 1, ty + 1, "#2a1f04");
  }
}

/** ── Panel ── */

const PANEL_X = 236;

/** A flat panel box with a lit top-left edge and an inked bottom-right. */
function box(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, fill: string, hi: string, lo: string): void {
  ctx.fillStyle = fill;
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = hi;
  ctx.fillRect(x, y, w, 1);
  ctx.fillRect(x, y, 1, h);
  ctx.fillStyle = lo;
  ctx.fillRect(x, y + h - 1, w, 1);
  ctx.fillRect(x + w - 1, y, 1, h);
}

export interface PanelView {
  bets: Array<{ id: string; label: string; selected: boolean }>;
  pays: number;
  stake: number;
  /** Last few pockets, newest first. */
  history: number[];
  /** Result line, or null while idle/spinning. */
  result: { pocket: number; won: boolean; text: string } | null;
  spinning: boolean;
}

const CHIP_FILL: Record<string, string[]> = {
  red: RED,
  black: BLACK,
  odd: STEEL,
  even: STEEL,
  low: FELT,
  high: FELT,
  t1: MAHOGANY,
  t2: MAHOGANY,
  t3: MAHOGANY,
};

/**
 * The bet grid.
 *
 * Three columns of three, laid out the way the bets group: the two colours and
 * the two parities and the two halves read as pairs, and the thirds fill the
 * bottom row. The selected chip gets a gold frame rather than a brightness
 * change, because at this size brightness alone is not a strong enough read.
 */
export function drawPanel(ctx: CanvasRenderingContext2D, v: PanelView): void {
  ctx.font = "8px 'Press Start 2P', monospace";
  ctx.textAlign = "left";
  ctx.textBaseline = "top";

  ctx.fillStyle = C_DIM;
  ctx.fillText("PLACE YOUR BET", PANEL_X, 12);

  const CW = 88;
  const CH = 26;
  const GX = 4;
  const GY = 4;
  for (let i = 0; i < v.bets.length; i++) {
    const b = v.bets[i];
    const col = i % 3;
    const row = Math.floor(i / 3);
    const x = PANEL_X + col * (CW + GX);
    const y = 28 + row * (CH + GY);
    const ramp = CHIP_FILL[b.id] ?? STEEL;
    box(ctx, x, y, CW, CH, ramp[1], ramp[3], ramp[0]);
    if (b.selected) {
      ctx.fillStyle = C_WIN;
      ctx.fillRect(x - 1, y - 1, CW + 2, 1);
      ctx.fillRect(x - 1, y + CH, CW + 2, 1);
      ctx.fillRect(x - 1, y - 1, 1, CH + 2);
      ctx.fillRect(x + CW, y - 1, 1, CH + 2);
    }
    ctx.font = "8px 'Press Start 2P', monospace";
    ctx.textAlign = "center";
    ctx.fillStyle = b.selected ? C_WIN_HI : C_TEXT;
    ctx.fillText(b.label, x + CW / 2, y + 6);
    ctx.fillStyle = b.selected ? C_WIN : C_DIM;
    ctx.fillText(`${b.id === "t1" || b.id === "t2" || b.id === "t3" ? 3 : 2}x`, x + CW / 2, y + 16);
  }

  // ── History ── the last few pockets, as coloured chips. Every roulette table
  // has this board and players read it religiously, so leaving it out would be
  // the one missing thing they notice.
  const hy = 124;
  ctx.textAlign = "left";
  ctx.fillStyle = C_DIM;
  ctx.fillText("LAST", PANEL_X, hy + 4);
  for (let i = 0; i < Math.min(8, v.history.length); i++) {
    const n = v.history[i];
    const ramp = POCKET_RAMP[colorOf(n)];
    const x = PANEL_X + 44 + i * 18;
    box(ctx, x, hy, 15, 15, ramp[2], ramp[3], ramp[0]);
    tinyNumber(ctx, n, x + 8, hy + 5, "#f2f6ff");
  }

  // ── Result / prompt ──
  const ry = 152;
  box(ctx, PANEL_X, ry, 272, 34, C_PANEL, C_PANEL_HI, "#080a10");
  ctx.textAlign = "left";
  if (v.result) {
    const ramp = POCKET_RAMP[colorOf(v.result.pocket)];
    box(ctx, PANEL_X + 6, ry + 6, 22, 22, ramp[2], ramp[3], ramp[0]);
    ctx.font = "12px 'Press Start 2P', monospace";
    ctx.fillStyle = "#f2f6ff";
    ctx.textAlign = "center";
    ctx.fillText(String(v.result.pocket), PANEL_X + 17, ry + 11);
    ctx.textAlign = "left";
    ctx.font = "8px 'Press Start 2P', monospace";
    ctx.fillStyle = v.result.won ? C_WIN_HI : C_DIM;
    ctx.fillText(v.result.text, PANEL_X + 36, ry + 14);
  } else {
    ctx.font = "8px 'Press Start 2P', monospace";
    ctx.fillStyle = C_DIM;
    ctx.fillText(v.spinning ? "NO MORE BETS" : "PAYS " + v.pays + "x  ·  STAKE " + v.stake, PANEL_X + 8, ry + 14);
  }
}

/** Clear to the table's ground colour. */
export function clearTable(ctx: CanvasRenderingContext2D, w: number, h: number): void {
  // Felt, not black: the wheel has to be standing on a table rather than
  // floating in space. The 2px scanline is the weave.
  ctx.fillStyle = FELT[1];
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = FELT[0];
  for (let y = 0; y < h; y += 2) ctx.fillRect(0, y, w, 1);
  ctx.fillStyle = C_BG;
  ctx.fillRect(0, h - 3, w, 3);
}
