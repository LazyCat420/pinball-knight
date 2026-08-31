import { createRequire } from "module";
const require = createRequire(import.meta.url);
const { createCanvas, loadImage } = require("canvas");
import { writeFileSync, mkdirSync, existsSync } from "node:fs";
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
    src: "/home/lazycat/.gemini/antigravity-ide/brain/c26503c8-1e8b-43cc-945f-1970fd471a11/chomper_spritesheet_1788204131379.jpg",
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
];

const BASE = "/home/lazycat/github/projects/sun/pinball-knight/ThreeJS/src/game/pinball-knight/tools/sprite-forge";
const INBOX = join(BASE, "inbox");
const SOURCES = join(BASE, "sources");

for (const m of MONSTERS) {
  if (!existsSync(m.src)) {
    console.error("Missing src:", m.src);
    continue;
  }
  const img = await loadImage(m.src);
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
  writeFileSync(inboxJson, JSON.stringify({ rows: m.rows }, null, 2));
  console.log(`Saved inbox: ${inboxPng} and ${inboxJson}`);
}

console.log("All monster sheets populated into inbox!");
