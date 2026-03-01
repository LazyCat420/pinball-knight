import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createCanvas } from 'canvas';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function createCursor(name, pixels) {
    const canvas = createCanvas(32, 32);
    const ctx = canvas.getContext('2d');

    // Clear to transparent
    ctx.clearRect(0, 0, 32, 32);

    for (let y = 0; y < pixels.length; y++) {
        const row = pixels[y];
        for (let x = 0; x < row.length; x++) {
            const char = row[x];
            if (char === '#') {
                ctx.fillStyle = 'rgba(0, 0, 0, 1)';
                ctx.fillRect(x, y, 1, 1);
            } else if (char === '.') {
                ctx.fillStyle = 'rgba(255, 255, 255, 1)';
                ctx.fillRect(x, y, 1, 1);
            }
        }
    }

    const outPath = path.join(__dirname, '..', 'public', `pixel-cursor-${name}.png`);
    const buffer = canvas.toBuffer('image/png');
    fs.writeFileSync(outPath, buffer);
    console.log(`Generated ${outPath}`);
}

const CURSOR_DEFAULT = [
    "##                              ",
    "#.#                             ",
    "#.##                            ",
    "#...#                           ",
    "#....#                          ",
    "#.....#                         ",
    "#......#                        ",
    "#.......#                       ",
    "#........#                      ",
    "#.........#                     ",
    "#..........#                    ",
    "#......#####                    ",
    "#...#..#                        ",
    "#.##.#..#                       ",
    "##   #..#                       ",
    "      #..#                      ",
    "      #..#                      ",
    "       ##                       ",
    "                                ",
    "                                ",
    "                                ",
    "                                ",
    "                                ",
    "                                ",
    "                                ",
    "                                ",
    "                                ",
    "                                ",
    "                                ",
    "                                ",
    "                                ",
    "                                "
];

const CURSOR_POINTER = [
    "      ##                        ",
    "     #..#                       ",
    "     #..#                       ",
    "     #..#                       ",
    "     #..#                       ",
    "   ###..#                       ",
    "  #..#..#                       ",
    "  #.....###                     ",
    "###.......#                     ",
    "#.........#                     ",
    "#.........#                     ",
    "#.........#                     ",
    "#..........#                    ",
    " #.........#                    ",
    "  #........#                    ",
    "  #........#                    ",
    "   #......#                     ",
    "    #.....#                     ",
    "     #####                      ",
    "                                ",
    "                                ",
    "                                ",
    "                                ",
    "                                ",
    "                                ",
    "                                ",
    "                                ",
    "                                ",
    "                                ",
    "                                ",
    "                                ",
    "                                "
];

const CURSOR_GRAB = [
    "     ##                         ",
    "    #..#   ##                   ",
    "   #....# #..#   ##             ",
    "   #....##....# #..#   ##       ",
    "    #.........##....# #..#      ",
    "    #...............##....#     ",
    "  ###.....................#     ",
    " #..#.....................#     ",
    " #........................#     ",
    " #........................#     ",
    " #........................#     ",
    "  #.......................#     ",
    "  #......................#      ",
    "   #.....................#      ",
    "   #.....................#      ",
    "    #...................#       ",
    "     #.................#        ",
    "      #...............#         ",
    "       ###############          ",
    "                                ",
    "                                ",
    "                                ",
    "                                ",
    "                                ",
    "                                ",
    "                                ",
    "                                ",
    "                                ",
    "                                ",
    "                                ",
    "                                ",
    "                                "
];

const CURSOR_GRABBING = [
    "                                ",
    "                                ",
    "                                ",
    "                                ",
    "                                ",
    "    ####   ##   ##  ##          ",
    "   #....# #..# #..##..#         ",
    "   #.....#....#........#        ",
    "  ##...................#        ",
    " #..#..................#        ",
    " #.....................#        ",
    " #.....................#        ",
    " #.....................#        ",
    "  #....................#        ",
    "  #...................#         ",
    "   #..................#         ",
    "   #..................#         ",
    "    #................#          ",
    "     #..............#           ",
    "      #............#            ",
    "       ############             ",
    "                                ",
    "                                ",
    "                                ",
    "                                ",
    "                                ",
    "                                ",
    "                                ",
    "                                ",
    "                                ",
    "                                ",
    "                                "
];

createCursor("default", CURSOR_DEFAULT);
createCursor("pointer", CURSOR_POINTER);
createCursor("grab", CURSOR_GRAB);
createCursor("grabbing", CURSOR_GRABBING);
