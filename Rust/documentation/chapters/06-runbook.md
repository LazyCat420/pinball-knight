---
part: Operations
status: reference
updated: 2026-08-10
---

# Runbook

The commands, in the order you actually need them.

## Make a character today

The forge panel is at `/forge` on the dev server.

```bash
pnpm install          # a fresh worktree needs this before anything works
npx next dev -p 5174  # or another port if 5174 is taken by another checkout
```

1. **intake** tab — drop an image. Read the QA verdict; take the free fixes
   (re-frame, drop extra pieces) before the GPU ones. `reject` means downstream
   provably breaks. Then **use as the character →**.
2. **generate** tab — "every move set (6 sheets)". Six jobs, one per move, all
   branching off the same master.
3. **sheet** tab — cut each job into cells, order the tray, set the crush knobs
   (`derive: 20` is the measured default), stage under a name.
4. Publish and verify from the **in game** card, or from the shell below.

## Publish

```bash
npm run sprites   # FORGE_PUBLISH=1 vitest run …/sprite-forge
```

The **only** sanctioned publisher. It writes `public/sprites/<name>-<dir>.{png,json}`
for every sheet in `inbox/`.

> A plain `vitest run` of that directory does **not** publish — the writes are
> behind `FORGE_PUBLISH`. This is deliberate: a green run that dirtied the tree
> once looked like someone's unfinished art, and `deploy.sh` ships the working
> tree.

To promote a committed (crushed) sheet so it publishes at `grid: N` instead of
resampled, copy the pair the report names:

```bash
cp work/<name>-<dir>/<name>-<dir>.png  inbox/<name>-<dir>.png
cp work/<name>-<dir>/<name>-<dir>.json inbox/<name>-<dir>.json
npm run sprites
```

Do this **after looking at it**. The crush evicts colours, and an eviction nobody
saw is how a creature quietly loses its costume.

## Verify in the game

The verdict is the boot line, never a screenshot — the procedural painter looks
fine, so a picture cannot tell you the import failed.

```bash
# a monster
node scripts/sprite-shot.mjs --kind croaker --shots 6

# the player
node scripts/knight-check.mjs --url http://localhost:5174/dungeon --shot /tmp/k.png
```

```
[dungeon] <kind>: imported art from N sheet(s) [S/E]
[dungeon] player: imported <name> art loaded
```

Both need **Windows-side Chrome** on the CDP port (default 9345). WSL2 headless
falls back to SwiftShader and would judge a different renderer than the one that
ships. `sprite-shot.mjs` launches one if none is listening.

Against the live container, substitute `--url http://10.0.0.16:5174/dungeon`.

## Play as a published sheet

```js
__lab.playAs("frog")   // then RELOAD — the atlas is palette-locked per sheet
__lab.playAs()         // read the current one
__lab.playAs(null)     // back to pinball_knight
```

It must be published as `public/sprites/<name>-{S,N,E}.json` **and have an idle
row**, or the painter quietly stays.

## Deploy

```bash
bash deploy.sh          # ~2 min → synology, keeps :previous for rollback
bash deploy.sh --dry-run
```

Then verify against the live container rather than the deploy's own exit code:

```bash
curl -s http://10.0.0.16:5174/sprites/<name>-E.json | python3 -m json.tool | head
```

A correct published manifest has `name, dir, image, source, rows` — and `grid`
if it was committed. If you see `rows, rects, commit`, a sidecar was copied where
a manifest belongs and the creature will not draw.

## Health

```bash
curl -s http://127.0.0.1:8188/system_stats   # ComfyUI
cat ~/comfy/guard.json                        # RAM guard heartbeat
grep MemAvailable /proc/meminfo
```

A guard heartbeat older than 15 s counts as dead. Floors: soft 1.2 GiB / hard
0.5 GiB WSL-side, host hard 60 GB.

## Tests

```bash
npx vitest run src/game/pinball-knight/tools/sprite-forge   # 145 tests, ~90 s
npx tsc --noEmit                                            # the nine kind tables
node scripts/hooks/registry-drift.mjs                       # ~50 ms
python3 documentation/build_docs.py --check                 # docs in step?
```

Run the suite from the **primary checkout**, not a worktree.
