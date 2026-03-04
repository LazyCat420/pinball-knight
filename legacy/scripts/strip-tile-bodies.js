/**
 * Strip tile body from Wikipedia Mahjong SVGs.
 * 
 * Each SVG contains a <g id="g3062"> group with the full tile body
 * (outline, green edge, grey border, ivory face, gradient).
 * This script removes that group so only the symbol artwork remains
 * on a transparent background.
 * 
 * Also removes: empty g4146 groups, unused filter definitions,
 * unused linearGradient definitions that were inside g3062.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const tilesDir = path.join(__dirname, '..', 'public', 'mahjong-tiles');
const files = fs.readdirSync(tilesDir).filter(f => f.endsWith('.svg'));

console.log(`Processing ${files.length} SVG files in ${tilesDir}...`);

let successCount = 0;
let errorCount = 0;

for (const file of files) {
    const filePath = path.join(tilesDir, file);
    let svg = fs.readFileSync(filePath, 'utf8');

    // 1. Remove the entire <g id="g3062">...</g> block (tile body)
    //    Handles both indented and compact formats, multi-line
    const g3062re = /<g\s+id=["']g3062["'][^>]*>[\s\S]*?<\/g>\s*/;

    if (!g3062re.test(svg)) {
        console.warn(`  ⚠ No g3062 found in ${file}, skipping`);
        errorCount++;
        continue;
    }

    // Match and remove the innermost g3062 and everything inside it
    // We need a careful approach since there are nested </g> tags inside g3062
    const g3062Start = svg.indexOf('id="g3062"');
    if (g3062Start === -1) {
        console.warn(`  ⚠ No g3062 id found in ${file}`);
        errorCount++;
        continue;
    }

    // Find the opening <g that contains id="g3062"
    let openTagStart = svg.lastIndexOf('<g', g3062Start);

    // Count nested <g> tags to find the matching </g>
    let depth = 0;
    let i = openTagStart;
    let closeEnd = -1;

    while (i < svg.length) {
        if (svg[i] === '<') {
            if (svg.substr(i, 2) === '<g') {
                // Check it's actually a <g tag, not <gradient etc
                const nextChar = svg[i + 2];
                if (nextChar === ' ' || nextChar === '>' || nextChar === '\n' || nextChar === '\r' || nextChar === '\t') {
                    depth++;
                }
            } else if (svg.substr(i, 4) === '</g>') {
                depth--;
                if (depth === 0) {
                    closeEnd = i + 4;
                    break;
                }
            }
        }
        i++;
    }

    if (closeEnd === -1) {
        console.warn(`  ⚠ Could not find closing </g> for g3062 in ${file}`);
        errorCount++;
        continue;
    }

    // Remove the g3062 block
    svg = svg.substring(0, openTagStart) + svg.substring(closeEnd);

    // 2. Remove empty <g id="g4146">...</g> (empty transform group)
    svg = svg.replace(/<g\s+id=["']g4146["'][^>]*>\s*<\/g>\s*/g, '');

    // 3. Remove the filter definition (used only by tile body highlight)
    svg = svg.replace(/<filter\s+id=["']filter3970-5["'][\s\S]*?<\/filter>\s*/g, '');

    // 4. Remove unused CSS classes that referenced the tile body
    //    .st0 (enable-background), .st1 (green fill), .st2 (grey fill), 
    //    .st4 (gradient fill), .st5 (filter ref), .st6 (gradient fill)
    // Keep .st3 (white - used by some symbols), .st7+ (symbol colors)

    // 5. Clean up empty wrapper g4630 if it only contains whitespace now
    svg = svg.replace(/<g\s+id=["']g4630["'][^>]*>\s*<\/g>\s*/g, '');

    // Write back
    fs.writeFileSync(filePath, svg, 'utf8');
    successCount++;
    console.log(`  ✓ ${file} — tile body stripped`);
}

console.log(`\nDone: ${successCount} files cleaned, ${errorCount} errors`);
