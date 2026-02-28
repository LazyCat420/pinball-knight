import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createCanvas, loadImage } from 'canvas';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const spritePath = path.join(__dirname, '../public/textures/raw-assets/spritesheet.jpg');
const outDir = path.join(__dirname, '../public/textures/face-parts');

if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
}

// Grid: 17 cols (1 label + 16 items), 11 rows (1 title + 10 items)
const TOTAL_COLS = 17;
const TOTAL_ROWS = 11;
const ITEM_COLS = 16;
const ITEM_ROWS = 10;

const ROW_CATEGORIES = [
    'eyes', 'eyes',
    'noses', 'noses',
    'mouths', 'mouths', 'mouths',
    'ears',
    'extras', 'extras',
];

async function sliceSpriteSheet() {
    console.log('Loading spritesheet...');
    const img = await loadImage(spritePath);
    console.log(`Loaded image: ${img.width}x${img.height}`);

    const cellW = img.width / TOTAL_COLS;
    const cellH = img.height / TOTAL_ROWS;
    console.log(`Cell size: ${cellW.toFixed(1)} x ${cellH.toFixed(1)}`);

    const offsetX = cellW;
    const offsetY = cellH;

    // 3px inset on each edge to crop grid lines
    const PAD = 3;

    const canvas = createCanvas(img.width, img.height);
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0);

    let count = 0;

    for (let r = 0; r < ITEM_ROWS; r++) {
        const category = ROW_CATEGORIES[r];
        for (let c = 0; c < ITEM_COLS; c++) {
            const srcX = Math.round(offsetX + c * cellW) + PAD;
            const srcY = Math.round(offsetY + r * cellH) + PAD;
            const w = Math.round(cellW) - PAD * 2;
            const h = Math.round(cellH) - PAD * 2;

            const outCanv = createCanvas(w, h);
            const outCtx = outCanv.getContext('2d');
            outCtx.drawImage(img, srcX, srcY, w, h, 0, 0, w, h);

            // Remove background (light beige/cream/white) -> transparent
            const outData = outCtx.getImageData(0, 0, w, h);
            const px = outData.data;
            for (let i = 0; i < px.length; i += 4) {
                const rVal = px[i];
                const gVal = px[i + 1];
                const bVal = px[i + 2];
                if (rVal > 215 && gVal > 215 && bVal > 200) {
                    px[i + 3] = 0;
                }
            }
            outCtx.putImageData(outData, 0, 0);

            const filename = `${category}-${r}-${c}.png`;
            fs.writeFileSync(path.join(outDir, filename), outCanv.toBuffer('image/png'));
            count++;
        }
    }

    console.log(`Done! Generated ${count} clean slices.`);
}

sliceSpriteSheet().catch(console.error);
