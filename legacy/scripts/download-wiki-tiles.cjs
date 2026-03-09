/**
 * Download Mahjong tile SVGs from Wikimedia Commons.
 *
 * Usage: node scripts/download-wiki-tiles.js
 *
 * Downloads 42 core tiles into public/mahjong-tiles/
 * License: CC-BY-SA / Public Domain (Wikimedia Commons)
 */

const https = require("https");
const fs = require("fs");
const path = require("path");

const OUT_DIR = path.join(__dirname, "..", "public", "mahjong-tiles");

// Mapping: { localFilename: wikimediaPath }
// wikimediaPath extracted from thumbnail URLs: /wikipedia/commons/thumb/HASH/FILENAME/...
// Actual SVG at: https://upload.wikimedia.org/wikipedia/commons/HASH/FILENAME
const TILES = {
  // Circles (Pin/Tong) 1-9
  "MJt1-.svg": "b/b3/MJt1-.svg",
  "MJt2-.svg": "a/a4/MJt2-.svg",
  "MJt3-.svg": "4/44/MJt3-.svg",
  "MJt4-.svg": "6/66/MJt4-.svg",
  "MJt5-.svg": "7/72/MJt5-.svg",
  "MJt6-.svg": "8/86/MJt6-.svg",
  "MJt7-.svg": "6/6c/MJt7-.svg",
  "MJt8-.svg": "6/66/MJt8-.svg",
  "MJt9-.svg": "f/f5/MJt9-.svg",

  // Bamboo (Sou/Tiao) 1-9
  "MJs1-.svg": "e/e8/MJs1-.svg",
  "MJs2-.svg": "9/97/MJs2-.svg",
  "MJs3-.svg": "1/1f/MJs3-.svg",
  "MJs4-.svg": "b/b1/MJs4-.svg",
  "MJs5-.svg": "6/61/MJs5-.svg",
  "MJs6-.svg": "6/63/MJs6-.svg",
  "MJs7-.svg": "8/8a/MJs7-.svg",
  "MJs8-.svg": "b/be/MJs8-.svg",
  "MJs9-.svg": "f/f3/MJs9-.svg",

  // Characters (Man/Wan) 1-9
  "MJw1-.svg": "3/32/MJw1-.svg",
  "MJw2-.svg": "7/70/MJw2-.svg",
  "MJw3-.svg": "d/d0/MJw3-.svg",
  "MJw4-.svg": "6/6b/MJw4-.svg",
  "MJw5-.svg": "4/4b/MJw5-.svg",
  "MJw6-.svg": "4/4c/MJw6-.svg",
  "MJw7-.svg": "c/c0/MJw7-.svg",
  "MJw8-.svg": "d/d3/MJw8-.svg",
  "MJw9-.svg": "a/a9/MJw9-.svg",

  // Winds (East, South, West, North)
  "MJf1-.svg": "9/90/MJf1-.svg",
  "MJf2-.svg": "b/bb/MJf2-.svg",
  "MJf3-.svg": "5/54/MJf3-.svg",
  "MJf4-.svg": "d/df/MJf4-.svg",

  // Dragons (Red, Green, White)
  "MJd1-.svg": "2/20/MJd1-.svg",
  "MJd2-.svg": "8/8c/MJd2-.svg",
  "MJd3-.svg": "5/52/MJd3-.svg",

  // Flowers 1-4
  "MJh1-.svg": "1/14/MJh1-.svg",
  "MJh2-.svg": "e/e0/MJh2-.svg",
  "MJh3-.svg": "2/25/MJh3-.svg",
  "MJh4-.svg": "b/b7/MJh4-.svg",

  // Seasons 1-4 (= MJh5-8)
  "MJh5-.svg": "8/8b/MJh5-.svg",
  "MJh6-.svg": "b/b3/MJh6-.svg",
  "MJh7-.svg": "b/b6/MJh7-.svg",
  "MJh8-.svg": "9/9c/MJh8-.svg",
};

function download(url, dest) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    https
      .get(url, { headers: { "User-Agent": "MahjongTileDownloader/1.0" } }, (res) => {
        if (res.statusCode === 301 || res.statusCode === 302) {
          // Follow redirect
          file.close();
          fs.unlinkSync(dest);
          download(res.headers.location, dest).then(resolve).catch(reject);
          return;
        }
        if (res.statusCode !== 200) {
          file.close();
          fs.unlinkSync(dest);
          reject(new Error(`HTTP ${res.statusCode} for ${url}`));
          return;
        }
        res.pipe(file);
        file.on("finish", () => {
          file.close();
          resolve();
        });
      })
      .on("error", (err) => {
        file.close();
        if (fs.existsSync(dest)) fs.unlinkSync(dest);
        reject(err);
      });
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

  const entries = Object.entries(TILES);
  let ok = 0,
    fail = 0,
    skip = 0;

  for (const [filename, wikiPath] of entries) {
    const dest = path.join(OUT_DIR, filename);
    // Skip if already downloaded
    if (fs.existsSync(dest) && fs.statSync(dest).size > 100) {
      console.log(`⏭️  ${filename} (already exists)`);
      skip++;
      ok++;
      continue;
    }
    const url = `https://upload.wikimedia.org/wikipedia/commons/${wikiPath}`;
    try {
      await download(url, dest);
      const size = fs.statSync(dest).size;
      console.log(`✅ ${filename} (${(size / 1024).toFixed(1)} KB)`);
      ok++;
    } catch (err) {
      console.error(`❌ ${filename}: ${err.message}`);
      fail++;
    }
    // Rate limit: 1.5s between requests
    await sleep(1500);
  }

  console.log(
    `\nDone: ${ok} downloaded (${skip} skipped), ${fail} failed out of ${entries.length} total.`,
  );
}

main();
