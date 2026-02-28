import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const outDir = path.join(__dirname, '../public/textures/face-parts');

// Ensure output dir exists
if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
}

// Simple helper to write SVG files
function writeSvg(filename, width, height, content) {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  ${content}
</svg>`;
    fs.writeFileSync(path.join(outDir, filename), svg);
    console.log(`Generated ${filename}`);
}

// --- BASE HEADS ---
writeSvg('base-potato.svg', 512, 640, `
  <rect width="512" height="640" fill="#1a1520" />
  <ellipse cx="256" cy="320" rx="160" ry="200" fill="#c4956a" />
`);
writeSvg('base-alien.svg', 512, 640, `
  <rect width="512" height="640" fill="#0d1b15" />
  <path d="M 256 120 C 400 120 400 350 256 500 C 112 350 112 120 256 120" fill="#4ecb71" />
`);

// --- EYES (must be marked so we know they track the cursor) ---
// Note: We render just the socket/lid in the SVG so the 3D pupil can be drawn on top
writeSvg('eyes-normal.svg', 120, 60, `
  <ellipse cx="60" cy="30" rx="55" ry="25" fill="#f0e8d8" />
  <path d="M 5 30 Q 60 5 115 30" fill="none" stroke="#1a1210" stroke-width="4" />
`);
writeSvg('eyes-tired.svg', 120, 60, `
  <ellipse cx="60" cy="30" rx="55" ry="20" fill="#e0d8c8" />
  <path d="M 5 30 Q 60 40 115 30" fill="none" stroke="#6b3a2a" stroke-width="3" />
  <path d="M 5 30 Q 60 10 115 30" fill="none" stroke="#1a1210" stroke-width="6" />
`);
writeSvg('eyes-surprised.svg', 100, 100, `
  <circle cx="50" cy="50" r="45" fill="#ffffff" />
  <circle cx="50" cy="50" r="45" fill="none" stroke="#1a1210" stroke-width="3" />
`);

// --- NOSES ---
writeSvg('nose-button.svg', 60, 60, `
  <ellipse cx="30" cy="30" rx="25" ry="20" fill="#a07850" />
  <ellipse cx="25" cy="20" rx="8" ry="5" fill="#ffffff" opacity="0.3" />
`);
writeSvg('nose-pointy.svg', 80, 120, `
  <path d="M 40 10 L 70 90 L 40 110 L 10 90 Z" fill="#b08860" />
  <path d="M 40 10 L 40 110" fill="none" stroke="#8a6040" stroke-width="2" />
`);

// --- MOUTHS ---
writeSvg('mouth-smile.svg', 160, 80, `
  <path d="M 10 20 Q 80 80 150 20" fill="none" stroke="#5a2a1a" stroke-linecap="round" stroke-width="8" />
`);
writeSvg('mouth-sad.svg', 160, 80, `
  <path d="M 10 60 Q 80 10 150 60" fill="none" stroke="#3a1a0a" stroke-linecap="round" stroke-width="6" />
`);
writeSvg('mouth-open.svg', 120, 80, `
  <ellipse cx="60" cy="40" rx="50" ry="30" fill="#3a1a0a" />
  <path d="M 20 50 Q 60 20 100 50" fill="#cc4444" />
`);

// --- EXTRAS ---
writeSvg('extra-mustache.svg', 200, 60, `
  <path d="M 10 50 Q 50 10 100 30 Q 150 10 190 50 Q 150 40 100 50 Q 50 40 10 50" fill="#1a1210" />
`);
writeSvg('extra-glasses.svg', 240, 80, `
  <rect x="10" y="10" width="90" height="60" rx="10" fill="none" stroke="#c8a84e" stroke-width="6" />
  <rect x="140" y="10" width="90" height="60" rx="10" fill="none" stroke="#c8a84e" stroke-width="6" />
  <line x1="100" y1="40" x2="140" y2="40" stroke="#c8a84e" stroke-width="6" />
`);

console.log('All placeholder face parts generated!');
