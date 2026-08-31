import { createRequire } from "module";
const require = createRequire(import.meta.url);
const { createCanvas, loadImage } = require("canvas");
import { writeFileSync, readFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";


const MONSTERS = [
  {
    name: "spider",
    src: "/home/lazycat/.gemini/antigravity-ide/brain/c26503c8-1e8b-43cc-945f-1970fd471a11/spider_spritesheet_1788203751239.jpg",
    rows: ["idle", "walk", "attack", "death"],
  },
  {
    name: "demon",
    src: "/home/lazycat/.gemini/antigravity-ide/brain/c26503c8-1e8b-43cc-945f-1970fd471a11/demon_spritesheet_1788203843746.jpg",
    rows: ["idle", "walk", "attack", "death"],
  },
  {
    name: "sporeling",
    src: "/home/lazycat/.gemini/antigravity-ide/brain/c26503c8-1e8b-43cc-945f-1970fd471a11/spore_spritesheet_1788203922608.jpg",
    rows: ["idle", "walk", "attack", "death"],
  },
  {
    name: "croaker",
    src: "/home/lazycat/.gemini/antigravity-ide/brain/c26503c8-1e8b-43cc-945f-1970fd471a11/croaker_spritesheet_1788204033425.jpg",
    rows: ["idle", "walk", "attack", "death"],
  },
  {
    name: "chomper",
    src: "/home/lazycat/.gemini/antigravity-ide/brain/c26503c8-1e8b-43cc-945f-1970fd471a11/chomper_large_sheet_1788214279768.jpg",
    rows: ["idle", "walk", "attack", "death"],
  },
  {
    name: "crawler",
    src: "/home/lazycat/.gemini/antigravity-ide/brain/c26503c8-1e8b-43cc-945f-1970fd471a11/crawler_spritesheet_1788204254691.jpg",
    rows: ["idle", "walk", "attack", "death"],
  },
  {
    name: "necro",
    src: "/home/lazycat/.gemini/antigravity-ide/brain/c26503c8-1e8b-43cc-945f-1970fd471a11/necro_spritesheet_1788204275174.jpg",
    rows: ["idle", "walk", "attack", "death"],
  },
  {
    name: "warden",
    src: "/home/lazycat/.gemini/antigravity-ide/brain/c26503c8-1e8b-43cc-945f-1970fd471a11/warden_spritesheet_1788204315949.jpg",
    rows: ["idle", "walk", "attack", "death"],
    matte: { tolerance: 64 },
  },
  {
    name: "crystalback",
    src: "/home/lazycat/.gemini/antigravity-ide/brain/c26503c8-1e8b-43cc-945f-1970fd471a11/crystal_spritesheet_1788204498499.jpg",
    rows: ["idle", "walk", "attack", "death"],
  },
  {
    name: "mimic",
    src: "/home/lazycat/.gemini/antigravity-ide/brain/c26503c8-1e8b-43cc-945f-1970fd471a11/mimic_spritesheet_1788204532250.jpg",
    rows: ["idle", "walk", "attack", "death"],
  },
  {
    name: "ghost",
    src: "/home/lazycat/.gemini/antigravity-ide/brain/c26503c8-1e8b-43cc-945f-1970fd471a11/ghost_sheet_1788214294101.jpg",
    rows: ["idle", "walk", "attack", "death"],
  },
  {
    name: "bat",
    src: "/home/lazycat/.gemini/antigravity-ide/brain/c26503c8-1e8b-43cc-945f-1970fd471a11/bat_sheet_1788214348042.jpg",
    rows: ["idle", "walk", "attack", "death"],
  },
  {
    name: "golem",
    src: "/home/lazycat/.gemini/antigravity-ide/brain/c26503c8-1e8b-43cc-945f-1970fd471a11/golem_sheet_1788214597276.jpg",
    rows: ["idle", "walk", "attack", "death"],
  },
  {
    name: "magnet",
    src: "/home/lazycat/.gemini/antigravity-ide/brain/c26503c8-1e8b-43cc-945f-1970fd471a11/magnet_sheet_1788214618119.jpg",
    rows: ["idle", "walk", "attack", "death"],
  },
  {
    name: "webspinner",
    src: "/home/lazycat/.gemini/antigravity-ide/brain/c26503c8-1e8b-43cc-945f-1970fd471a11/webspinner_flat_sheet_1788215447538.jpg",
    rows: ["idle", "walk", "attack", "death"],
  },
  {
    name: "hound",
    src: "/home/lazycat/.gemini/antigravity-ide/brain/c26503c8-1e8b-43cc-945f-1970fd471a11/hound_sheet_1788214677921.jpg",
    rows: ["idle", "walk", "attack", "death"],
  },
  {
    name: "pin",
    src: "/home/lazycat/.gemini/antigravity-ide/brain/c26503c8-1e8b-43cc-945f-1970fd471a11/pin_sheet_1788214692239.jpg",
    rows: ["idle", "walk", "attack", "death"],
  },
];

const BASE = "/home/lazycat/github/projects/sun/pinball-knight/ThreeJS/src/game/pinball-knight/tools/sprite-forge";
const INBOX = join(BASE, "inbox");
const SOURCES = join(BASE, "sources");

for (const m of MONSTERS) {
  if (!existsSync(m.src)) {
    console.error("Missing src:", m.src);
    continue;
  }
  console.log(`Processing ${m.name} from ${m.src}...`);
  const buf = readFileSync(m.src);
  const img = await loadImage(buf);
  console.log(`Loaded ${m.name} image: ${img.width}x${img.height}`);
  const canvas = createCanvas(img.width, img.height);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(img, 0, 0);

  const pngBuf = canvas.toBuffer("image/png");

  // 1. Save to sources
  const srcDir = join(SOURCES, `${m.name}-2026-08-31`);
  mkdirSync(srcDir, { recursive: true });
  mkdirSync(join(srcDir, "alt-takes"), { recursive: true });
  writeFileSync(join(srcDir, `${m.name}-S.png`), pngBuf);
  console.log(`Saved source: ${join(srcDir, `${m.name}-S.png`)}`);

  // 2. Save to inbox
  mkdirSync(INBOX, { recursive: true });
  const inboxPng = join(INBOX, `${m.name}-S.png`);
  const inboxJson = join(INBOX, `${m.name}-S.json`);
  writeFileSync(inboxPng, pngBuf);
  const sidecar = { rows: m.rows };
  if (m.matte) sidecar.matte = m.matte;
  writeFileSync(inboxJson, JSON.stringify(sidecar, null, 2));
  console.log(`Saved inbox: ${inboxPng} and ${inboxJson}`);
}


console.log("All monster sheets populated into inbox!");

