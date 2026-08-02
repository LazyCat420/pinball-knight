import os
import numpy as np
from PIL import Image, ImageDraw

SRC_PATH = '/home/lazycat/.gemini/antigravity-ide/brain/6bf5388b-ae6b-457a-a4b3-c0018e780d1d/media__1785654440591.jpg'
OUT_ARTIFACT = '/home/lazycat/.gemini/antigravity-ide/brain/6bf5388b-ae6b-457a-a4b3-c0018e780d1d/giraffe_spritesheet_labeled.png'
INBOX_DIR = '/home/lazycat/github/projects/sun/braindeadbot-client/src/game/pinball-knight/tools/sprite-forge/inbox'

img = Image.open(SRC_PATH).convert('RGBA')
w, h = img.size
cols, rows = 5, 4
cw, ch = int(w / cols), int(h / rows) # 204, 256

frames = []
for i in range(20):
    r = i // cols
    c = i % cols
    x1, y1 = c * cw, r * ch
    x2, y2 = (c + 1) * cw, (r + 1) * ch
    cell = img.crop((x1, y1, x2, y2))
    
    # Remove original corner number
    cell_arr = np.array(cell)
    bg_sample = cell_arr[5, 190, :]
    cell_arr[0:32, 0:40] = bg_sample
    cell = Image.fromarray(cell_arr)
    frames.append(cell)

def matte(cell):
    arr = np.array(cell, dtype=np.float32)
    r, g, b, a = arr[:,:,0], arr[:,:,1], arr[:,:,2], arr[:,:,3]
    max_c = np.maximum(np.maximum(r, g), b)
    min_c = np.minimum(np.minimum(r, g), b)
    sat = max_c - min_c
    bright = (r + g + b) / 3.0
    bg_mask = (bright > 225) & (sat < 20)
    alpha = np.where(bg_mask, 0.0, 255.0)
    fringe = (~bg_mask) & (bright > 210) & (sat < 25)
    alpha[fringe] = (225.0 - bright[fringe]) / 15.0 * 255.0
    arr[:,:,3] = np.clip(alpha, 0, 255)
    return Image.fromarray(arr.astype(np.uint8))

matted_frames = [matte(f) for f in frames]

# --- 1. BUILD PRESENTATION SHEET (giraffe_spritesheet_labeled.png) ---
groups = [
    ("WALKING (Frames 1-10)", matted_frames[0:10], "#f59e0b", "Full walking stride & locomotion cycle"),
    ("ATTACK (Frames 11-15)", matted_frames[10:15], "#ef4444", "Bomb grab, neck coil, whip throw & recovery"),
    ("STUMBLE (Frames 16-17)", matted_frames[15:17], "#3b82f6", "Startled wobble & balance adjustment"),
    ("DYING (Frames 18-20)", matted_frames[17:20], "#8b5cf6", "Leg buckle, crash landing dizzy & dead sprawl")
]

header_height = 50
padding = 20
cell_w, cell_h = 160, 200
max_cols = 10

sheet_w = max_cols * (cell_w + 10) + padding * 2 + 20
total_h = padding
for label, f_list, color, subtext in groups:
    total_h += header_height + cell_h + 30

canvas = Image.new('RGBA', (sheet_w, total_h), (24, 27, 38, 255))
draw = ImageDraw.Draw(canvas)

cur_y = padding

for title, f_list, badge_color, subtext in groups:
    draw.rectangle([padding, cur_y, sheet_w - padding, cur_y + 36], fill=(35, 40, 56, 255), outline=(60, 68, 92, 255))
    draw.rectangle([padding, cur_y, padding + 120, cur_y + 36], fill=badge_color)
    
    draw.text((padding + 10, cur_y + 8), title.split()[0], fill=(255, 255, 255, 255))
    draw.text((padding + 135, cur_y + 8), title, fill=(240, 240, 240, 255))
    draw.text((padding + 380, cur_y + 8), f"— {subtext}", fill=(160, 174, 192, 255))
    
    cur_y += 46
    
    for idx, frame in enumerate(f_list):
        fx = padding + idx * (cell_w + 10)
        fy = cur_y
        
        draw.rectangle([fx, fy, fx + cell_w, fy + cell_h], fill=(18, 20, 29, 255), outline=(48, 54, 74, 255))
        resized_frame = frame.resize((cell_w - 10, cell_h - 20), Image.Resampling.LANCZOS)
        canvas.paste(resized_frame, (fx + 5, fy + 5), mask=resized_frame)
        draw.text((fx + 8, fy + cell_h - 18), f"F{idx+1}", fill=(120, 134, 160, 255))

    cur_y += cell_h + 20

canvas.save(OUT_ARTIFACT)
print(f"Saved labeled presentation sprite sheet to {OUT_ARTIFACT}")

# --- 2. BUILD SPRITE-FORGE INBOX FILES WITH CLEAR ROW GAPS ---
# Add 20px vertical transparent gap between rows so slice.ts detects 4 distinct rows
row_gap = 24
row_h = ch + row_gap
forge_cols = 10
forge_w = forge_cols * cw
forge_h = 4 * row_h

forge_img = Image.new('RGBA', (forge_w, forge_h), (0, 0, 0, 0))

row_frames = [
    matted_frames[0:10],   # Walk: 10 frames
    matted_frames[10:15],  # Attack: 5 frames
    matted_frames[15:17],  # Stumble: 2 frames
    matted_frames[17:20]   # Death: 3 frames
]

for r_idx, f_list in enumerate(row_frames):
    y_off = r_idx * row_h
    for c_idx, frame in enumerate(f_list):
        x_off = c_idx * cw
        forge_img.paste(frame, (x_off, y_off), mask=frame)

forge_png_path = os.path.join(INBOX_DIR, 'stiltneck-E.png')
forge_json_path = os.path.join(INBOX_DIR, 'stiltneck-E.json')

forge_img.save(forge_png_path)

import json
sidecar = {
    "rows": ["walk", "attack", "stumble", "death"],
    "cells": [10, 5, 2, 3]
}

with open(forge_json_path, 'w') as f:
    json.dump(sidecar, f, indent=2)

print(f"Saved sprite-forge inbox files:\n  {forge_png_path}\n  {forge_json_path}")
