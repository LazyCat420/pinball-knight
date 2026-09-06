import { createRequire } from "module";
const require = createRequire(import.meta.url);
const { createCanvas } = require("canvas");
import { writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const OUT_DIR = join(__dirname, "..", "public", "cards", "art");
mkdirSync(OUT_DIR, { recursive: true });

const W = 904; // 2x supersampled for 452x320 art window
const H = 640;

function createArtCanvas() {
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext("2d");
  return { canvas, ctx };
}

// ══════════════════════════════════════════════════════════════════
// 1. 1950S RUBBERHOSE / FLEISCHER CARTOON STYLE
// ══════════════════════════════════════════════════════════════════

function drawMidgetClaw(ctx) {
  // Vintage sepia paper backdrop
  const bg = ctx.createRadialGradient(W / 2, H / 2, 50, W / 2, H / 2, 450);
  bg.addColorStop(0, "#edd6b1");
  bg.addColorStop(0.7, "#d2b287");
  bg.addColorStop(1, "#8e6d46");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  // Vignette film grain lines
  ctx.strokeStyle = "rgba(60, 40, 20, 0.15)";
  ctx.lineWidth = 2;
  for (let i = 0; i < 40; i++) {
    const x = Math.random() * W;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x + (Math.random() - 0.5) * 40, H);
    ctx.stroke();
  }

  // Comical bouncy midget zombie
  ctx.save();
  ctx.translate(W / 2, H * 0.55);

  // Curved bouncy legs (black rubberhose)
  ctx.strokeStyle = "#1a1612";
  ctx.lineWidth = 24;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.arc(-70, 70, 60, Math.PI * 0.2, Math.PI * 0.9);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(70, 70, 60, Math.PI * 0.1, Math.PI * 0.8);
  ctx.stroke();

  // Big clownish shoes
  ctx.fillStyle = "#2d241e";
  ctx.beginPath();
  ctx.ellipse(-120, 120, 45, 25, -0.2, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.beginPath();
  ctx.ellipse(120, 120, 45, 25, 0.2, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  // Overalls body
  ctx.fillStyle = "#4a6b82";
  ctx.beginPath();
  ctx.ellipse(0, 30, 85, 95, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  // Patch on overalls
  ctx.fillStyle = "#a85232";
  ctx.fillRect(-35, 30, 35, 35);
  ctx.strokeRect(-35, 30, 35, 35);

  // Big pie-cut eyes head
  ctx.fillStyle = "#8aab84"; // vintage muted zombie skin
  ctx.beginPath();
  ctx.ellipse(0, -90, 110, 100, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  // Pie-cut eyes
  for (const ex of [-45, 45]) {
    ctx.fillStyle = "#f4ebd9";
    ctx.beginPath();
    ctx.ellipse(ex, -105, 32, 42, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // Black pupil with pie-cut notch
    ctx.fillStyle = "#1a1612";
    ctx.beginPath();
    ctx.arc(ex + (ex < 0 ? 6 : -6), -102, 20, 0, Math.PI * 2);
    ctx.fill();
    // Pie cut wedge
    ctx.fillStyle = "#f4ebd9";
    ctx.beginPath();
    ctx.moveTo(ex + (ex < 0 ? 6 : -6), -102);
    ctx.lineTo(ex + (ex < 0 ? 26 : -26), -115);
    ctx.lineTo(ex + (ex < 0 ? 26 : -26), -90);
    ctx.closePath();
    ctx.fill();
  }

  // Wide manic cheerful toothy grin
  ctx.fillStyle = "#1a1612";
  ctx.beginPath();
  ctx.arc(0, -65, 65, 0.15 * Math.PI, 0.85 * Math.PI);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  // Square teeth
  ctx.fillStyle = "#f4ebd9";
  for (let t = -45; t <= 45; t += 22) {
    ctx.fillRect(t - 8, -60, 16, 18);
    ctx.strokeRect(t - 8, -60, 16, 18);
  }

  // Bendy rubber arms with white cartoon gloves and sharp claws
  ctx.strokeStyle = "#1a1612";
  ctx.lineWidth = 22;
  ctx.beginPath();
  ctx.arc(-110, -20, 70, Math.PI * 0.7, Math.PI * 1.6);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(110, -20, 70, Math.PI * 1.4, Math.PI * 2.3);
  ctx.stroke();

  // White gloves with claws
  for (const gx of [-170, 170]) {
    ctx.fillStyle = "#f4ebd9";
    ctx.beginPath();
    ctx.arc(gx, -45, 32, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    // 3 sharp claw pips
    ctx.fillStyle = "#1a1612";
    for (let c = -1; c <= 1; c++) {
      ctx.beginPath();
      ctx.moveTo(gx + c * 14, -75);
      ctx.lineTo(gx + c * 18 + 4, -92);
      ctx.lineTo(gx + c * 18 - 4, -92);
      ctx.closePath();
      ctx.fill();
    }
  }

  ctx.restore();
}

function drawBatWingChip(ctx) {
  // 1950s rubberhose bat
  const bg = ctx.createRadialGradient(W / 2, H / 2, 50, W / 2, H / 2, 450);
  bg.addColorStop(0, "#4a3b5c");
  bg.addColorStop(1, "#181224");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  ctx.save();
  ctx.translate(W / 2, H / 2);

  // Big scalloped cartoon bat wings
  ctx.fillStyle = "#2a1e38";
  ctx.strokeStyle = "#110b1a";
  ctx.lineWidth = 14;

  // Left wing
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.quadraticCurveTo(-180, -200, -380, -80);
  ctx.quadraticCurveTo(-300, 40, -260, 120);
  ctx.quadraticCurveTo(-180, 80, -140, 130);
  ctx.quadraticCurveTo(-70, 70, 0, 80);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  // Right wing
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.quadraticCurveTo(180, -200, 380, -80);
  ctx.quadraticCurveTo(300, 40, 260, 120);
  ctx.quadraticCurveTo(180, 80, 140, 130);
  ctx.quadraticCurveTo(70, 70, 0, 80);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  // Furry round body
  ctx.fillStyle = "#3d2c52";
  ctx.beginPath();
  ctx.arc(0, 40, 85, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  // Big cartoon ears
  for (const sx of [-50, 50]) {
    ctx.beginPath();
    ctx.moveTo(sx, -30);
    ctx.lineTo(sx * 1.8, -190);
    ctx.lineTo(sx * 0.4, -90);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    // Inner ear pink
    ctx.fillStyle = "#b86b8b";
    ctx.beginPath();
    ctx.moveTo(sx * 1.1, -40);
    ctx.lineTo(sx * 1.6, -165);
    ctx.lineTo(sx * 0.6, -85);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = "#3d2c52";
  }

  // Pie-cut bat eyes
  for (const ex of [-32, 32]) {
    ctx.fillStyle = "#fff4d4";
    ctx.beginPath();
    ctx.ellipse(ex, 10, 28, 36, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = "#110b1a";
    ctx.beginPath();
    ctx.arc(ex + (ex < 0 ? 5 : -5), 12, 16, 0, Math.PI * 2);
    ctx.fill();
  }

  // Goofy grinning mouth with 2 sharp fangs
  ctx.fillStyle = "#110b1a";
  ctx.beginPath();
  ctx.arc(0, 55, 42, 0.1 * Math.PI, 0.9 * Math.PI);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  // Fangs
  ctx.fillStyle = "#ffffff";
  for (const fx of [-20, 20]) {
    ctx.beginPath();
    ctx.moveTo(fx - 7, 56);
    ctx.lineTo(fx + 7, 56);
    ctx.lineTo(fx, 82);
    ctx.closePath();
    ctx.fill();
  }

  ctx.restore();
}

function drawVenomGland(ctx) {
  // 1950s goofy frog-like spitter monster
  const bg = ctx.createRadialGradient(W / 2, H / 2, 50, W / 2, H / 2, 450);
  bg.addColorStop(0, "#4d6b38");
  bg.addColorStop(1, "#14240f");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  ctx.save();
  ctx.translate(W / 2, H * 0.52);

  // Big bulbous round belly
  ctx.fillStyle = "#7ca854";
  ctx.strokeStyle = "#1a2e10";
  ctx.lineWidth = 14;
  ctx.beginPath();
  ctx.ellipse(0, 40, 160, 140, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  // Swollen translucent acid venom sac on throat
  const sacGrad = ctx.createRadialGradient(0, -10, 10, 0, -10, 90);
  sacGrad.addColorStop(0, "#b8ff47");
  sacGrad.addColorStop(0.7, "#69b81f");
  sacGrad.addColorStop(1, "#36630c");
  ctx.fillStyle = sacGrad;
  ctx.beginPath();
  ctx.ellipse(0, -10, 95, 80, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  // Eyeballs on top of head
  for (const ex of [-65, 65]) {
    ctx.fillStyle = "#7ca854";
    ctx.beginPath();
    ctx.arc(ex, -120, 45, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = "#fff";
    ctx.beginPath();
    ctx.arc(ex, -120, 32, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // Spiral pie-cut pupils (dizzy acid trip)
    ctx.strokeStyle = "#1a2e10";
    ctx.lineWidth = 8;
    ctx.beginPath();
    ctx.arc(ex, -120, 16, 0, Math.PI * 1.8);
    ctx.stroke();
  }

  // Open mouth spitting bubbling acid drops
  ctx.fillStyle = "#1a2e10";
  ctx.beginPath();
  ctx.ellipse(0, 50, 75, 45, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  // Bubbling bright acid droplets flying out
  for (const d of [{ x: -120, y: -70, r: 24 }, { x: 140, y: -50, r: 30 }, { x: -80, y: 110, r: 18 }, { x: 100, y: 120, r: 22 }]) {
    ctx.fillStyle = "#a8ff24";
    ctx.beginPath();
    ctx.arc(d.x, d.y, d.r, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    // highlight
    ctx.fillStyle = "#fff";
    ctx.beginPath();
    ctx.arc(d.x - d.r * 0.3, d.y - d.r * 0.3, d.r * 0.3, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.restore();
}

function drawEctoplasmCore(ctx) {
  // 1950s rubberhose spooky sheet ghost
  const bg = ctx.createRadialGradient(W / 2, H / 2, 50, W / 2, H / 2, 450);
  bg.addColorStop(0, "#3a4a6b");
  bg.addColorStop(1, "#0d1421");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  ctx.save();
  ctx.translate(W / 2, H * 0.48);

  // Wavy floating sheet ghost body
  ctx.fillStyle = "#e6f4f8";
  ctx.strokeStyle = "#182233";
  ctx.lineWidth = 14;

  ctx.beginPath();
  ctx.moveTo(-110, -110);
  ctx.quadraticCurveTo(0, -190, 110, -110);
  ctx.quadraticCurveTo(140, 20, 130, 140);
  // Ruffled bottom hem
  ctx.quadraticCurveTo(90, 110, 60, 145);
  ctx.quadraticCurveTo(30, 110, 0, 150);
  ctx.quadraticCurveTo(-30, 110, -60, 145);
  ctx.quadraticCurveTo(-90, 110, -130, 140);
  ctx.quadraticCurveTo(-140, 20, -110, -110);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  // Floating wavy hands
  for (const hx of [-140, 140]) {
    ctx.beginPath();
    ctx.ellipse(hx, -10, 36, 26, hx < 0 ? -0.4 : 0.4, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }

  // Big black oval eyes + hollow mouth ("Ooooo!")
  ctx.fillStyle = "#182233";
  ctx.beginPath();
  ctx.ellipse(-38, -65, 22, 34, -0.1, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(38, -65, 22, 34, 0.1, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(0, -10, 26, 42, 0, 0, Math.PI * 2);
  ctx.fill();

  // Glowing cyan ectoplasm core visible inside ghost
  const coreGrad = ctx.createRadialGradient(0, 50, 5, 0, 50, 45);
  coreGrad.addColorStop(0, "rgba(80, 255, 255, 0.95)");
  coreGrad.addColorStop(0.6, "rgba(0, 180, 255, 0.6)");
  coreGrad.addColorStop(1, "rgba(0, 100, 255, 0)");
  ctx.fillStyle = coreGrad;
  ctx.beginPath();
  ctx.arc(0, 50, 45, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
}

function drawBruteCleaver(ctx) {
  // 1950s heavyweight cartoon iron brute
  const bg = ctx.createRadialGradient(W / 2, H / 2, 50, W / 2, H / 2, 450);
  bg.addColorStop(0, "#663b36");
  bg.addColorStop(1, "#211210");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  ctx.save();
  ctx.translate(W / 2, H * 0.52);

  // Massive hulking shoulders
  ctx.fillStyle = "#8f574d";
  ctx.strokeStyle = "#24110e";
  ctx.lineWidth = 14;
  ctx.beginPath();
  ctx.ellipse(0, -20, 210, 140, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  // Little tiny legs under huge torso
  ctx.lineWidth = 20;
  ctx.beginPath();
  ctx.moveTo(-50, 100);
  ctx.lineTo(-60, 150);
  ctx.moveTo(50, 100);
  ctx.lineTo(60, 150);
  ctx.stroke();

  // Huge iron cleaver in hands
  ctx.fillStyle = "#b8c5d1";
  ctx.lineWidth = 12;
  ctx.beginPath();
  ctx.moveTo(80, -150);
  ctx.lineTo(240, -180);
  ctx.lineTo(270, 70);
  ctx.lineTo(110, 50);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  // Wooden handle
  ctx.fillStyle = "#5e3820";
  ctx.fillRect(40, -60, 70, 24);
  ctx.strokeRect(40, -60, 70, 24);

  // Stern furrowed brow & tiny pie-cut eyes
  ctx.fillStyle = "#ffffff";
  ctx.beginPath();
  ctx.arc(-40, -80, 22, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(40, -80, 22, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = "#24110e";
  ctx.beginPath();
  ctx.arc(-36, -78, 12, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(36, -78, 12, 0, Math.PI * 2);
  ctx.fill();

  // Steam puffing from ears
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.arc(-130, -90, 18, 0, Math.PI * 1.5);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(130, -90, 18, 0, Math.PI * 1.5);
  ctx.stroke();

  ctx.restore();
}

// ══════════════════════════════════════════════════════════════════
// 2. RETRO 80S SYNTHWAVE / DARK ARCADE STYLE
// ══════════════════════════════════════════════════════════════════

function drawSynthwaveGrid(ctx) {
  // Deep synthwave sky & neon horizon
  const sky = ctx.createLinearGradient(0, 0, 0, H);
  sky.addColorStop(0, "#080214");
  sky.addColorStop(0.55, "#28073b");
  sky.addColorStop(0.56, "#d40078");
  sky.addColorStop(0.65, "#18032b");
  sky.addColorStop(1, "#030008");
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, W, H);

  // Sun on horizon
  const sun = ctx.createLinearGradient(0, H * 0.25, 0, H * 0.58);
  sun.addColorStop(0, "#ffe600");
  sun.addColorStop(0.5, "#ff007f");
  sun.addColorStop(1, "#7300ff");
  ctx.fillStyle = sun;
  ctx.beginPath();
  ctx.arc(W / 2, H * 0.52, 130, Math.PI, 0);
  ctx.fill();

  // Perspective neon floor grid
  ctx.strokeStyle = "#00ffff";
  ctx.lineWidth = 2;
  const horizonY = H * 0.55;

  // Horizontal scanlines
  for (let y = horizonY + 12; y < H; y += (y - horizonY) * 0.45 + 8) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(W, y);
    ctx.stroke();
  }

  // Radiating lines
  for (let x = -W * 0.5; x <= W * 1.5; x += 110) {
    ctx.beginPath();
    ctx.moveTo(W / 2, horizonY);
    ctx.lineTo(x, H);
    ctx.stroke();
  }
}

function drawShamblerHide(ctx) {
  drawSynthwaveGrid(ctx);

  // Cyber-undead Shambler with glowing neon wiring
  ctx.save();
  ctx.translate(W / 2, H * 0.55);

  // Silhouette body with neon wireframe
  ctx.fillStyle = "#12081f";
  ctx.beginPath();
  ctx.ellipse(0, 20, 110, 150, 0, 0, Math.PI * 2);
  ctx.fill();

  // Neon cyan and magenta cyber-circuits
  ctx.strokeStyle = "#00ffff";
  ctx.lineWidth = 4;
  ctx.shadowColor = "#00ffff";
  ctx.shadowBlur = 15;

  ctx.beginPath();
  ctx.moveTo(0, -60);
  ctx.lineTo(0, 80);
  ctx.moveTo(-50, -20);
  ctx.lineTo(50, -20);
  ctx.moveTo(-70, 30);
  ctx.lineTo(70, 30);
  ctx.stroke();

  // Glowing skull visor
  ctx.fillStyle = "#ff007f";
  ctx.shadowColor = "#ff007f";
  ctx.shadowBlur = 25;
  ctx.beginPath();
  ctx.roundRect(-55, -110, 110, 70, 12);
  ctx.fill();

  // Visor CRT scanline eye
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(-40, -82, 80, 14);

  ctx.restore();
}

function drawWispSpark(ctx) {
  drawSynthwaveGrid(ctx);

  ctx.save();
  ctx.translate(W / 2, H * 0.45);

  // Glowing plasma orb
  const orb = ctx.createRadialGradient(0, 0, 10, 0, 0, 140);
  orb.addColorStop(0, "#ffffff");
  orb.addColorStop(0.2, "#00ffff");
  orb.addColorStop(0.6, "#ff00aa");
  orb.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = orb;
  ctx.beginPath();
  ctx.arc(0, 0, 140, 0, Math.PI * 2);
  ctx.fill();

  // Electric arc tendrils
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = 4;
  ctx.shadowColor = "#00ffff";
  ctx.shadowBlur = 20;

  for (let a = 0; a < Math.PI * 2; a += 0.5) {
    ctx.beginPath();
    ctx.moveTo(0, 0);
    const r1 = 60 + Math.random() * 40;
    const r2 = 120 + Math.random() * 60;
    ctx.lineTo(Math.cos(a) * r1 + (Math.random() - 0.5) * 30, Math.sin(a) * r1);
    ctx.lineTo(Math.cos(a) * r2, Math.sin(a) * r2);
    ctx.stroke();
  }

  ctx.restore();
}

function drawCrystalShard(ctx) {
  drawSynthwaveGrid(ctx);

  ctx.save();
  ctx.translate(W / 2, H * 0.50);

  // Prismatic low-poly crystal scorpion cluster
  const facets = [
    { p: [[0, -160], [-70, -40], [0, 20]], c: "#00ffff" },
    { p: [[0, -160], [70, -40], [0, 20]], c: "#ff00c8" },
    { p: [[-70, -40], [-130, 40], [0, 20]], c: "#7b00ff" },
    { p: [[70, -40], [130, 40], [0, 20]], c: "#0088ff" },
    { p: [[-130, 40], [0, 140], [0, 20]], c: "#ff0077" },
    { p: [[130, 40], [0, 140], [0, 20]], c: "#00ffaa" },
  ];

  ctx.lineWidth = 3;
  ctx.strokeStyle = "#ffffff";
  ctx.shadowColor = "#00ffff";
  ctx.shadowBlur = 18;

  for (const f of facets) {
    ctx.fillStyle = f.c;
    ctx.beginPath();
    ctx.moveTo(f.p[0][0], f.p[0][1]);
    ctx.lineTo(f.p[1][0], f.p[1][1]);
    ctx.lineTo(f.p[2][0], f.p[2][1]);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }

  ctx.restore();
}

function drawNecroSigil(ctx) {
  drawSynthwaveGrid(ctx);

  ctx.save();
  ctx.translate(W / 2, H * 0.48);

  // Neon glowing occult pentagram / sigil
  ctx.strokeStyle = "#ff0077";
  ctx.lineWidth = 6;
  ctx.shadowColor = "#ff0077";
  ctx.shadowBlur = 24;

  ctx.beginPath();
  ctx.arc(0, 0, 160, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(0, 0, 120, 0, Math.PI * 2);
  ctx.stroke();

  // 7-point star rune
  ctx.beginPath();
  for (let i = 0; i <= 14; i++) {
    const a = (i * 4 * Math.PI) / 7 - Math.PI / 2;
    const r = i % 2 === 0 ? 120 : 50;
    const x = Math.cos(a) * r;
    const y = Math.sin(a) * r;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();

  // Iridescent cyber skull in center
  ctx.fillStyle = "#00ffff";
  ctx.shadowColor = "#00ffff";
  ctx.shadowBlur = 30;
  ctx.beginPath();
  ctx.ellipse(0, -10, 45, 55, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = "#080214";
  ctx.beginPath();
  ctx.arc(-16, -10, 12, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(16, -10, 12, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
}

function drawGladeath(ctx) {
  // Glass Cannon — Prismatic Laser Demon
  drawSynthwaveGrid(ctx);

  ctx.save();
  ctx.translate(W / 2, H * 0.48);

  // Refracting geometric prism demon
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = 4;
  ctx.shadowColor = "#ffffff";
  ctx.shadowBlur = 25;

  const rays = [
    { a: -0.8, c: "#ff0055" },
    { a: -0.4, c: "#ffaa00" },
    { a: 0.0, c: "#00ff88" },
    { a: 0.4, c: "#00ccff" },
    { a: 0.8, c: "#aa00ff" },
  ];

  for (const ray of rays) {
    ctx.strokeStyle = ray.c;
    ctx.shadowColor = ray.c;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(Math.cos(ray.a - Math.PI / 2) * 280, Math.sin(ray.a - Math.PI / 2) * 280);
    ctx.stroke();
  }

  // Central crystal demon core
  ctx.fillStyle = "rgba(255, 255, 255, 0.9)";
  ctx.beginPath();
  ctx.moveTo(0, -90);
  ctx.lineTo(75, 40);
  ctx.lineTo(0, 90);
  ctx.lineTo(-75, 40);
  ctx.closePath();
  ctx.fill();

  ctx.restore();
}

// ══════════════════════════════════════════════════════════════════
// 3. 60S/70S PSYCHEDELIC HIPPIE / ART NOUVEAU STYLE
// ══════════════════════════════════════════════════════════════════

function drawPsychedelicBackdrop(ctx) {
  // Swirling kaleidoscopic sunburst
  ctx.fillStyle = "#2d1607";
  ctx.fillRect(0, 0, W, H);

  ctx.save();
  ctx.translate(W / 2, H / 2);

  const colours = ["#e65c00", "#f9d423", "#78ab46", "#00838f", "#8e24aa", "#e91e63"];
  const count = 36;
  for (let i = 0; i < count; i++) {
    const a0 = (i / count) * Math.PI * 2;
    const a1 = ((i + 1) / count) * Math.PI * 2;
    ctx.fillStyle = colours[i % colours.length];
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.arc(0, 0, 500, a0, a1);
    ctx.closePath();
    ctx.fill();
  }

  // Concentric ripple rings
  ctx.strokeStyle = "#fff2a1";
  ctx.lineWidth = 6;
  for (let r = 60; r < 400; r += 50) {
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.stroke();
  }

  ctx.restore();
}

function drawHobblerBrace(ctx) {
  drawPsychedelicBackdrop(ctx);

  ctx.save();
  ctx.translate(W / 2, H * 0.52);

  // Swirling floral Art Nouveau hobbler zombie
  ctx.fillStyle = "#3e5c38";
  ctx.strokeStyle = "#1b2918";
  ctx.lineWidth = 8;

  // Curving vine leg brace & body
  ctx.beginPath();
  ctx.ellipse(0, 20, 100, 140, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  // Swirling ornamental paisley floral vines
  ctx.strokeStyle = "#f7b731";
  ctx.lineWidth = 10;
  ctx.beginPath();
  ctx.arc(-40, 10, 60, 0, Math.PI * 1.5);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(40, -20, 50, Math.PI * 0.5, Math.PI * 2);
  ctx.stroke();

  // Big psychedelic daisy flower eye
  for (const fx of [-35, 35]) {
    ctx.fillStyle = "#ff5e57";
    for (let p = 0; p < 8; p++) {
      const a = (p / 8) * Math.PI * 2;
      ctx.beginPath();
      ctx.ellipse(fx + Math.cos(a) * 25, -60 + Math.sin(a) * 25, 14, 8, a, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = "#ffdd59";
    ctx.beginPath();
    ctx.arc(fx, -60, 16, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.restore();
}

function drawSpiderSilk(ctx) {
  drawPsychedelicBackdrop(ctx);

  ctx.save();
  ctx.translate(W / 2, H * 0.50);

  // Mandalic dreamcatcher psychedelic spiderweb
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = 4;
  for (let r = 30; r < 240; r += 35) {
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.stroke();
  }
  for (let a = 0; a < Math.PI * 2; a += Math.PI / 8) {
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(Math.cos(a) * 240, Math.sin(a) * 240);
    ctx.stroke();
  }

  // Intricate psychedelic jeweled spider
  ctx.fillStyle = "#9c27b0";
  ctx.beginPath();
  ctx.ellipse(0, 15, 60, 80, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = "#00bcd4";
  ctx.beginPath();
  ctx.arc(0, -60, 45, 0, Math.PI * 2);
  ctx.fill();

  // 8 curly Art Nouveau legs
  ctx.strokeStyle = "#ffeb3b";
  ctx.lineWidth = 8;
  for (let side = -1; side <= 1; side += 2) {
    for (let i = 0; i < 4; i++) {
      ctx.beginPath();
      ctx.moveTo(side * 30, -30 + i * 25);
      ctx.quadraticCurveTo(side * (120 + i * 20), -60 + i * 40, side * (90 + i * 35), 90 + i * 25);
      ctx.stroke();
    }
  }

  ctx.restore();
}

function drawCrawlerGrip(ctx) {
  drawPsychedelicBackdrop(ctx);

  ctx.save();
  ctx.translate(W / 2, H * 0.50);

  // Creeping psychedelic vine hand monster
  ctx.fillStyle = "#4caf50";
  ctx.strokeStyle = "#1b5e20";
  ctx.lineWidth = 10;

  // Palm
  ctx.beginPath();
  ctx.ellipse(0, 30, 90, 80, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  // 5 curling floral finger tendrils
  const angles = [-1.3, -0.7, 0, 0.7, 1.3];
  for (const a of angles) {
    ctx.beginPath();
    ctx.moveTo(Math.sin(a) * 40, 0);
    ctx.quadraticCurveTo(Math.sin(a) * 130, -110, Math.sin(a) * 90 + Math.cos(a) * 40, -170);
    ctx.stroke();
  }

  // Glowing psychedelic eye on the palm
  ctx.fillStyle = "#ffeb3b";
  ctx.beginPath();
  ctx.ellipse(0, 30, 45, 26, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#e91e63";
  ctx.beginPath();
  ctx.arc(0, 30, 18, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
}

function drawGolemCore(ctx) {
  drawPsychedelicBackdrop(ctx);

  ctx.save();
  ctx.translate(W / 2, H * 0.50);

  // Ancient mossy stone golem covered with mushrooms and flower-power spirals
  ctx.fillStyle = "#6d7967";
  ctx.strokeStyle = "#273024";
  ctx.lineWidth = 12;

  // Big stone head/body
  ctx.beginPath();
  ctx.roundRect(-130, -120, 260, 240, 40);
  ctx.fill();
  ctx.stroke();

  // Swirling glowing psychedelic heart core
  const heart = ctx.createRadialGradient(0, 20, 10, 0, 20, 80);
  heart.addColorStop(0, "#ffff00");
  heart.addColorStop(0.5, "#ff0077");
  heart.addColorStop(1, "#7b00ff");
  ctx.fillStyle = heart;
  ctx.beginPath();
  ctx.arc(0, 20, 70, 0, Math.PI * 2);
  ctx.fill();

  // Colorful flower mushrooms sprouting on top
  for (const mx of [-70, 0, 70]) {
    ctx.fillStyle = "#ff5722";
    ctx.beginPath();
    ctx.arc(mx, -145, 30, Math.PI, 0);
    ctx.fill();
    ctx.fillStyle = "#fff";
    ctx.beginPath();
    ctx.arc(mx - 10, -155, 6, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.restore();
}

function drawWorldBreaker(ctx) {
  drawPsychedelicBackdrop(ctx);

  ctx.save();
  ctx.translate(W / 2, H * 0.52);

  // Volcanic mountain titan with paisley swirling magma
  ctx.fillStyle = "#3e1c12";
  ctx.beginPath();
  ctx.moveTo(0, -170);
  ctx.lineTo(210, 160);
  ctx.lineTo(-210, 160);
  ctx.closePath();
  ctx.fill();

  // Swirling paisley lava fountains
  ctx.strokeStyle = "#ff3d00";
  ctx.lineWidth = 16;
  ctx.shadowColor = "#ffeb3b";
  ctx.shadowBlur = 25;

  ctx.beginPath();
  ctx.moveTo(0, -170);
  ctx.quadraticCurveTo(-120, -250, -80, -320);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(0, -170);
  ctx.quadraticCurveTo(120, -250, 80, -320);
  ctx.stroke();

  // Glowing psychedelic magma face
  ctx.fillStyle = "#ffeb3b";
  ctx.beginPath();
  ctx.arc(-55, -20, 25, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(55, -20, 25, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(0, 60, 60, 30, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
}

// ══════════════════════════════════════════════════════════════════
// 4. GOTHIC DARK FANTASY CHIAROSCURO OIL PAINTING
// ══════════════════════════════════════════════════════════════════

function drawGothicBackdrop(ctx) {
  const bg = ctx.createRadialGradient(W * 0.4, H * 0.35, 40, W / 2, H / 2, 500);
  bg.addColorStop(0, "#2c2621");
  bg.addColorStop(0.4, "#161310");
  bg.addColorStop(1, "#080605");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);
}

function drawLurcherSpine(ctx) {
  drawGothicBackdrop(ctx);

  ctx.save();
  ctx.translate(W / 2, H * 0.48);

  // Skeletal spine monster emerging from dark shadow
  ctx.strokeStyle = "#d4c8b8";
  ctx.lineWidth = 26;
  ctx.shadowColor = "#000000";
  ctx.shadowBlur = 30;

  // Curving twisted spinal column
  ctx.beginPath();
  ctx.moveTo(-40, -150);
  ctx.quadraticCurveTo(80, -20, -20, 150);
  ctx.stroke();

  // Rib cage arches
  ctx.lineWidth = 14;
  for (let y = -100; y <= 90; y += 38) {
    ctx.beginPath();
    ctx.arc(0, y, 80, -0.3, Math.PI + 0.3);
    ctx.stroke();
  }

  // Chiaroscuro candlelight glow from side
  const light = ctx.createRadialGradient(-180, -100, 20, -180, -100, 300);
  light.addColorStop(0, "rgba(255, 170, 60, 0.45)");
  light.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = light;
  ctx.fillRect(-W / 2, -H / 2, W, H);

  ctx.restore();
}

function drawHulkKnuckle(ctx) {
  drawGothicBackdrop(ctx);

  ctx.save();
  ctx.translate(W / 2, H * 0.48);

  // Grotesque hulking mountainous zombie fist
  ctx.fillStyle = "#4a463a";
  ctx.strokeStyle = "#171512";
  ctx.lineWidth = 16;

  // Massive knuckles
  for (let i = 0; i < 4; i++) {
    const kx = -135 + i * 90;
    const ky = Math.abs(i - 1.5) * 20 - 40;
    ctx.beginPath();
    ctx.ellipse(kx, ky, 42, 65, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }

  // Fist base
  ctx.beginPath();
  ctx.roundRect(-160, 10, 320, 140, 30);
  ctx.fill();
  ctx.stroke();

  // Dramatic golden Rembrandt light
  const light = ctx.createRadialGradient(-200, -150, 30, 0, 0, 400);
  light.addColorStop(0, "rgba(255, 190, 100, 0.5)");
  light.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = light;
  ctx.fillRect(-W / 2, -H / 2, W, H);

  ctx.restore();
}

function drawWebspinnerSilk(ctx) {
  drawGothicBackdrop(ctx);

  ctx.save();
  ctx.translate(W / 2, H * 0.48);

  // Dark gothic dungeon rafters with moonlight
  ctx.strokeStyle = "rgba(220, 230, 255, 0.4)";
  ctx.lineWidth = 3;
  for (let i = 0; i < 18; i++) {
    const a = (i / 18) * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(Math.cos(a) * 350, Math.sin(a) * 350);
    ctx.stroke();
  }

  // Dark brooding webspinner spider
  ctx.fillStyle = "#1e1a17";
  ctx.beginPath();
  ctx.ellipse(0, 10, 75, 95, 0, 0, Math.PI * 2);
  ctx.fill();

  // Glowing eerie red multiple eyes
  ctx.fillStyle = "#ff1e00";
  ctx.shadowColor = "#ff1e00";
  ctx.shadowBlur = 15;
  for (let i = -3; i <= 3; i++) {
    ctx.beginPath();
    ctx.arc(i * 16, -60 - Math.abs(i) * 5, 5, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.restore();
}

function drawTempestCrown(ctx) {
  // Tempest Crown — Mythic Regalia Storm
  const bg = ctx.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, "#080c14");
  bg.addColorStop(0.6, "#141c2e");
  bg.addColorStop(1, "#05080f");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  ctx.save();
  ctx.translate(W / 2, H * 0.46);

  // Forked lightning bolts in background
  ctx.strokeStyle = "#e8f4ff";
  ctx.lineWidth = 5;
  ctx.shadowColor = "#66b3ff";
  ctx.shadowBlur = 30;

  ctx.beginPath();
  ctx.moveTo(-180, -250);
  ctx.lineTo(-120, -120);
  ctx.lineTo(-150, -40);
  ctx.lineTo(-80, 80);
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(190, -250);
  ctx.lineTo(130, -100);
  ctx.lineTo(170, -20);
  ctx.lineTo(110, 90);
  ctx.stroke();

  // Majestic ancient floating crown
  ctx.fillStyle = "#f5b041";
  ctx.strokeStyle = "#784212";
  ctx.lineWidth = 8;
  ctx.shadowColor = "#f5b041";
  ctx.shadowBlur = 20;

  ctx.beginPath();
  ctx.moveTo(-130, 40);
  ctx.lineTo(130, 40);
  ctx.lineTo(140, -60);
  ctx.lineTo(90, -20);
  ctx.lineTo(50, -90);
  ctx.lineTo(0, -30);
  ctx.lineTo(-50, -90);
  ctx.lineTo(-90, -20);
  ctx.lineTo(-140, -60);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  // Sapphire gemstones
  ctx.fillStyle = "#3498db";
  for (const gx of [-80, 0, 80]) {
    ctx.beginPath();
    ctx.arc(gx, 15, 14, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.restore();
}

function drawBloodPact(ctx) {
  // Blood Pact — Mythic Bargain Eldritch Vampire
  const bg = ctx.createRadialGradient(W / 2, H * 0.45, 30, W / 2, H / 2, 450);
  bg.addColorStop(0, "#4a0b0b");
  bg.addColorStop(0.6, "#1f0404");
  bg.addColorStop(1, "#080101");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  ctx.save();
  ctx.translate(W / 2, H * 0.48);

  // Eldritch bleeding chalice
  ctx.fillStyle = "#1c1815";
  ctx.strokeStyle = "#f39c12"; // gold trim
  ctx.lineWidth = 10;

  ctx.beginPath();
  ctx.ellipse(0, 100, 80, 20, 0, 0, Math.PI * 2); // base
  ctx.fill();
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(-10, 100);
  ctx.lineTo(-8, 20);
  ctx.lineTo(8, 20);
  ctx.lineTo(10, 100);
  ctx.fill();
  ctx.stroke();

  // Goblet bowl
  ctx.beginPath();
  ctx.arc(0, -30, 95, 0, Math.PI);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  // Overflowing glowing crimson blood
  const blood = ctx.createLinearGradient(0, -80, 0, 80);
  blood.addColorStop(0, "#ff1a1a");
  blood.addColorStop(1, "#660000");
  ctx.fillStyle = blood;
  ctx.beginPath();
  ctx.ellipse(0, -30, 90, 25, 0, 0, Math.PI * 2);
  ctx.fill();

  // Drips
  for (const dx of [-50, -10, 35, 70]) {
    ctx.beginPath();
    ctx.moveTo(dx, -20);
    ctx.lineTo(dx + 6, 40);
    ctx.lineTo(dx - 6, 40);
    ctx.closePath();
    ctx.fill();
  }

  ctx.restore();
}

// ══════════════════════════════════════════════════════════════════
// 5. ANIME / MANGA ACTION STYLE (FLAILER, REAPER, TIME RIPPER)
// ══════════════════════════════════════════════════════════════════

function drawFlailerJaw(ctx) {
  // Dark dynamic anime cavern
  const bg = ctx.createLinearGradient(0, 0, W, H);
  bg.addColorStop(0, "#120a1c");
  bg.addColorStop(1, "#050308");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  // Anime speed slashes
  ctx.strokeStyle = "#ff0055";
  ctx.lineWidth = 6;
  ctx.shadowColor = "#ff0055";
  ctx.shadowBlur = 20;

  for (let i = 0; i < 12; i++) {
    const y = Math.random() * H;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(W, y - 80);
    ctx.stroke();
  }

  ctx.save();
  ctx.translate(W / 2, H * 0.48);

  // Mutated zombie with giant gaping multi-hinged jaw
  ctx.fillStyle = "#5c6b54";
  ctx.strokeStyle = "#1b2118";
  ctx.lineWidth = 12;

  // Head
  ctx.beginPath();
  ctx.arc(0, -70, 75, Math.PI * 0.8, Math.PI * 2.2);
  ctx.fill();
  ctx.stroke();

  // Enormous extended lower jaw snapping open
  ctx.fillStyle = "#8a243a";
  ctx.beginPath();
  ctx.moveTo(-65, -40);
  ctx.quadraticCurveTo(-110, 70, 0, 130);
  ctx.quadraticCurveTo(110, 70, 65, -40);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  // Row of serrated teeth
  ctx.fillStyle = "#f4ebd9";
  for (let t = -50; t <= 50; t += 18) {
    ctx.beginPath();
    ctx.moveTo(t - 8, -40);
    ctx.lineTo(t + 8, -40);
    ctx.lineTo(t, -15);
    ctx.closePath();
    ctx.fill();
  }

  // Glowing red berserker eyes
  ctx.fillStyle = "#ff0044";
  ctx.shadowColor = "#ff0044";
  ctx.shadowBlur = 25;
  ctx.beginPath();
  ctx.arc(-28, -75, 12, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(28, -75, 12, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
}

function drawGrimScythe(ctx) {
  // Dark gothic cathedral anime background
  const bg = ctx.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, "#0a0714");
  bg.addColorStop(0.7, "#1a122e");
  bg.addColorStop(1, "#07040d");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  ctx.save();
  ctx.translate(W / 2, H * 0.48);

  // Ethereal ghostly purple flame crescent scythe
  ctx.strokeStyle = "#bb86fc";
  ctx.lineWidth = 18;
  ctx.shadowColor = "#9c27b0";
  ctx.shadowBlur = 35;

  ctx.beginPath();
  ctx.arc(50, -40, 190, Math.PI * 0.9, Math.PI * 1.8);
  ctx.stroke();

  // Giant curved silver blade
  ctx.fillStyle = "#e0e0e0";
  ctx.beginPath();
  ctx.moveTo(70, -230);
  ctx.quadraticCurveTo(-180, -180, -220, 20);
  ctx.quadraticCurveTo(-130, -80, 70, -230);
  ctx.closePath();
  ctx.fill();

  // Cloaked Shinigami Reaper figure
  ctx.fillStyle = "#120d1c";
  ctx.beginPath();
  ctx.moveTo(0, -130);
  ctx.lineTo(90, 160);
  ctx.lineTo(-90, 160);
  ctx.closePath();
  ctx.fill();

  // Skull face peering from cowl
  ctx.fillStyle = "#ffffff";
  ctx.beginPath();
  ctx.arc(0, -70, 32, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#120d1c";
  ctx.beginPath();
  ctx.arc(-10, -70, 9, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(10, -70, 9, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
}

function drawTimeRipper(ctx) {
  // Time Ripper — Chronomancer Void Entity
  const bg = ctx.createRadialGradient(W / 2, H / 2, 40, W / 2, H / 2, 450);
  bg.addColorStop(0, "#002b47");
  bg.addColorStop(0.5, "#0b1226");
  bg.addColorStop(1, "#03060f");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  ctx.save();
  ctx.translate(W / 2, H * 0.48);

  // Floating shattered clock dial fragments
  ctx.strokeStyle = "#00e5ff";
  ctx.lineWidth = 5;
  ctx.shadowColor = "#00e5ff";
  ctx.shadowBlur = 25;

  ctx.beginPath();
  ctx.arc(0, 0, 170, 0.2, Math.PI * 1.6);
  ctx.stroke();

  // Roman numerals on floating ring
  ctx.fillStyle = "#ffffff";
  ctx.font = "bold 20px sans-serif";
  for (let i = 1; i <= 12; i++) {
    const a = (i / 12) * Math.PI * 2 - Math.PI / 2;
    ctx.fillText(`${i}`, Math.cos(a) * 140 - 8, Math.sin(a) * 140 + 8);
  }

  // Temporal rift tear splitting reality
  ctx.fillStyle = "#ffffff";
  ctx.shadowColor = "#00ffff";
  ctx.shadowBlur = 35;
  ctx.beginPath();
  ctx.moveTo(-15, -160);
  ctx.lineTo(40, -40);
  ctx.lineTo(-30, 40);
  ctx.lineTo(20, 160);
  ctx.lineTo(0, 160);
  ctx.lineTo(-45, 40);
  ctx.lineTo(25, -40);
  ctx.closePath();
  ctx.fill();

  ctx.restore();
}

// ══════════════════════════════════════════════════════════════════
// RUNNER: GENERATE MISSING ART AND SAVE
// ══════════════════════════════════════════════════════════════════

const GENERATORS = {
  // 1950s Rubberhose
  midgetclaw: drawMidgetClaw,
  batwingchip: drawBatWingChip,
  venomgland: drawVenomGland,
  ectoplasmcore: drawEctoplasmCore,
  brutecleaver: drawBruteCleaver,

  // Retro 80s Synthwave
  shamblerhide: drawShamblerHide,
  wispspark: drawWispSpark,
  crystalshard: drawCrystalShard,
  necrosigil: drawNecroSigil,
  gladeath: drawGladeath,

  // 60s/70s Psychedelic Hippie
  hobblerbrace: drawHobblerBrace,
  spidersilk: drawSpiderSilk,
  crawlergrip: drawCrawlerGrip,
  golemcore: drawGolemCore,
  worldbreaker: drawWorldBreaker,

  // Gothic Dark Fantasy Oil
  lurcherspine: drawLurcherSpine,
  hulkknuckle: drawHulkKnuckle,
  webspinnersilk: drawWebspinnerSilk,
  tempestcrown: drawTempestCrown,
  bloodpact: drawBloodPact,

  // Anime / Action Manga
  flailerjaw: drawFlailerJaw,
  grimscythe: drawGrimScythe,
  timeripper: drawTimeRipper,
};

async function main() {
  console.log("🎨 Generating high-fidelity card art assets across 5 distinct art styles...");

  for (const [id, painter] of Object.entries(GENERATORS)) {
    const dest = join(OUT_DIR, `${id}.png`);
    if (existsSync(dest)) {
      console.log(`- ${id}.png already exists, keeping.`);
      continue;
    }

    const { canvas, ctx } = createArtCanvas();
    painter(ctx);
    const buf = canvas.toBuffer("image/png");
    writeFileSync(dest, buf);
    console.log(`✔ Generated ${id}.png`);
  }

  console.log("✨ All card art assets generated and verified!");
}

main().catch(console.error);
