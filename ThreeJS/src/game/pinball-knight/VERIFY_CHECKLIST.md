# 🎮 Pinball Knight — Verification Checklist

**Living manual-QA pass.** Much of §0-§5 is now driveable headlessly via
`window.__dungeonProbe()` (a dev hook exposing the buff timers, HUD mode, godMode
flags, enemy/part counts — added because almost everything here is a canvas or a
transient tile and a harness clicking the debug panel could not otherwise tell
whether anything happened). What a harness CANNOT judge is feel — pacing, whether
a bounce is satisfying, whether the arc reads. Those still need a human. Run it before shipping anything
that touches the HUD, power-ups or parts. **Open the debug console with the
`` ` `` (backtick) key** — it makes almost all of this testable without playing
from depth 1.

Keep it current: when a feature lands, add its check here rather than writing a
new wave doc. (Three completed wave plans were retired 2026-07-18; the current
forward-looking plan is `PINBALL_KNIGHT_PLAN.md` **beside this file**, not at the
repo root, and the architecture is in `BLUEPRINT.md` also beside this file.)

## 0. Debug console itself
- [ ] `` ` `` opens/closes the panel (top-left). A faint "` debug" hint shows when closed.
- [ ] Clicking panel buttons does NOT also swing your weapon (clicks are trapped).
- [ ] **GOD MODE** — toggle on, walk into a horde, take zero damage. Toggle off, damage resumes.
- [ ] **INF MANA** — Q/E always castable; mana globe stays full.
- [ ] **NO COOLDOWN** — Q/E fire with no cooldown sweep wait.

## 1. HUD look & layout (the main ask)
- [ ] Bottom bar reads **pixel / Wolfenstein**, not smooth — chunky Press Start 2P labels, VT323 numbers, hard square tiles (no rounded corners).
- [ ] **No white box over the knight face** — the centre face sits clean in its bronze frame.
- [ ] The console is **centred and compact** (not stretched to both screen edges); LIFE / face / MANA are dead-centre.
- [ ] **Globes show numbers** — LIFE shows current hearts, MANA shows the mana value; LIFE number turns red at low HP.
- [ ] Skill slots (Q/E) show ability icon + mana cost; dim when unaffordable; cooldown sweep animates after a cast.
- [ ] Belt (bottom-right, ⇧1-4) shows stored potions with counts.

## 2. Unified buff strip (top-right of the bar)
Use the panel's POTION row to apply each and confirm a tile appears with icon + depleting bar + seconds:
- [ ] ❤️ Health (heals, red globe splash, no timer tile) · 💰 Idol (+gold)
- [ ] 💢 Rage · ⚡ Haste · 🛡️ Shield · 🪩 **Ball Form** · ❄️ Freeze · 🔮 Multi-Ball · 🌀 **Curve Shot** · 🧲 **Magnet Boots**
- [ ] Q/E ability effects also tile up: ⏳ Time Crawl · 🌪️ Blade Storm · 🧲 Magnet Aura
- [ ] A buff's tile **blinks amber + bold seconds** in its last 3s.
- [ ] Every potion pickup: knight face grins (or relieved grin on heal) + globe splash.

## 3. Power-ups actually DO something (apply, then act)
- [ ] **Ball Form** 🪩 — momentum doesn't bleed, steering is sharp, walls kick you back faster, rams hit hard. (One potion = the old Iron Core + Turbo + Spring Legs.)
- [ ] **Curve Shot** 🌀 — with a gun/bow (give one from the panel), shots visibly bend toward your sweep direction.
- [ ] **Magnet Boots** 🧲 — spawn a 🧲 Crawler: boots REPEL it (shoved away) instead of being dragged in; over a magnet strip you launch instead of dragging.
- [ ] **Freeze** ❄️ — the whole floor (enemies + timed parts) freezes for the duration.
- [ ] **Multi-Ball** 🔮 — two ghost knights mirror your movement and ram enemies.
- [ ] **Rage/Haste/Shield** — double damage / faster / invulnerable, respectively.

## 4. Rampage HUD swap (the dual-HUD)
- [ ] Panel → Fill Rampage, press **R** → the Diablo panel slides down, the Wolfenstein rampage bar slides up, the **face carries over** (same expression/health), and the face-slot box is clean.
- [ ] Rampage ends → Diablo panel slides back up, face returns to its centre frame.

## 5. Enemies & parts (spawn from the panel)
- [ ] Each SPAWN chip drops that enemy next to you and it behaves (spitter spits, brute winds up, golem needs a speed hit, chomper gates a corridor, magnet pulls, webspinner webs you, pin knocks into pins).
- [ ] Kill All (proper death FX + score) vs Clear (instant wipe) both work.
- [ ] Next Floor / Boss Level descend correctly; Spawn Reaper summons the Death Dealer.

## 6. Score, juice & persistence (2026-07-19 wave)
- [ ] Die → the run posts to the leaderboard. Board name is editable on the death screen; it defaults to `KNIGHT`, never `???`.
- [ ] Death screen shows **BEST DEPTH**, and calls out `★ DEEPEST YET` when you beat it. Survives a reload.
- [ ] **Damage numbers** float at the point of impact — white/yellow dealt, red taken, bigger for amplified hits. Digits only (no glyph fallback).
- [ ] ~~Picking up a card shows the painted holo card briefly. It never pauses the game~~ — **SUPERSEDED 2026-07-20** by the modal card reader (§7): first-of-kind and epic+ pickups PAUSE to read; repeats keep the old non-blocking flash.
- [ ] Ramp hop: the **contact shadow stays on the floor** while the knight is in the air (same on the trapdoor ride).
- [ ] Full map (**M**) washes rooms by archetype (speedway / bumper / arena / vault) — **only where you have already been**.
- [ ] Minimap shows an **edge chevron** toward the stairs once they're outside the window — and only after you've found them.

## 7. Menu, card reader, gear looks, skill tree (2026-07-20 wave)
- [ ] **Card reader**: pick up a NEW card mid-horde → the world freezes (zombies hold, VFX still drift), the card shows big with its description and where it went; **Space/Enter/click** continues and does NOT fire a dodge roll on resume. A second copy of a common only flashes the old popup; an epic+ always opens the reader.
- [ ] Two cards grabbed together **queue** in the reader (×1 MORE chip) instead of replacing.
- [ ] **Esc opens the menu**, not exit-to-room; leaving is the two-click ABANDON RUN button. **I** opens it too. Tab/←→ cycle tabs, 1-5 jump. Sim frozen while open (reaper clock holds); run duration on the death screen excludes menu/reader time.
- [ ] **Equipment tab**: paperdoll portrait matches the in-world knight exactly (weapon + gear); ⇄ Equip swaps the hand and the held art changes on resume.
- [ ] **Cards tab**: socket a stash card into a ＋ slot anywhere; un-socket drops one rarity tier (same rule as the armory).
- [ ] **Gear looks**: run-start knight is DULL iron with NO plume; buying/picking up a helmet adds the bright helm + blood plume within a frame; armor shattering mid-fight visibly dulls the chest. Tavern knight matches the dungeon knight after an armory purchase (hoist animation plays as the counter closes; smith work plays anvil hammering + sparks).
- [ ] **Skill tree**: kills/floor clears fill the XP bar (toast on level-up); spend points in SKILLS — a damage node visibly raises floating damage numbers, Greased Greaves visibly quickens the walk. Arcana unlocks appear in the Q/E assignment rows. Tree resets on death.
- [ ] **Legacy**: buy a perk (e.g. Old Scar) with banked gold → survives death AND a full page reload; Pack Rat seeds a common card into the stash at the start of every run.
- [ ] **Settings tab**: SFX mute silences stings; pixel-FX toggles change the render pass; both survive a reload. Card-reader policy ALWAYS/SMART/NEVER behaves as labelled.
- [ ] **Merchant cart** sells only potions now (no mace/gun); buys go to the belt first, drink-immediately only when the belt is full.

## 7.5 Machine-audited (2026-07-25) — `pnpm audit:gpu`

`scripts/audit-checklist.mjs` drives the game through the real input path and
asserts the MECHANICAL half of §3/§5 — the claims that are yes/no rather than
feel. It does NOT judge fun; it catches features that silently stopped working.
Re-run it after any change to combat, buffs or enemy behaviour.

| Claim | Verdict |
|---|---|
| §3 Ball Form: momentum does not bleed | ✅ PASS — coasting decay exactly 0.00 u/s (friction zeroed); speed *rises* on bounces |
| §3 Freeze: the whole floor freezes | ✅ PASS — horde drift ~6.4u before, 0.00u during |
| §5 Golem: immune below smash speed | ✅ PASS — no chip damage while stationary |
| §5 Webspinner: webs the player | ✅ PASS — peak `webbedT` ≈ 2.6 |
| §3 Rage: double damage | ⊘ not verified — needs a scriptable damage hook (`__dungeonHit`) |
| §5 Magnet: pulls the player in | ⊘ usually skipped — see below |
| §5 Parts cleanse webs | ⊘ not verified — needs a scriptable part-trigger hook |

**The magnet is the interesting one.** Its pull is suppressed when the knight is
`grounded` (`wallContact(...) !== null` — braced against a wall resists the
field). After a plunger launch the knight is usually against a wall, so the pull
correctly does not fire and the check reports SKIP with that reason rather than a
false FAIL. Verifying it properly needs a spawn in open floor.

**Three harness traps this cost, recorded so the next person skips them:**
1. **The launch chute.** A floor opens with the knight parked in the plunger,
   where `updatePlunger` zeroes momentum every frame. Any check that reads
   position or `momSpeed` while parked returns identical before/after numbers
   that look exactly like a broken mechanic. Leave the chute first.
2. **Bounces are not decay.** Measuring Ball Form by start-minus-end speed
   reported a FAIL on a mechanic that works perfectly — the knight bounces
   during the sample and bounces ADD speed. Compare only bounce-free steps.
3. **The magnet walks.** Asserting on player↔magnet *distance* passes even when
   the pull never fires, because the magnet closes the gap itself. Assert PLAYER
   displacement.

## 8. Known-open (NOT expected to be perfect yet)
- Floors can still feel **too narrow to bounce** — that's the §2.5 OPEN PLAYFIELD roadmap work, not yet built.
- ~~Movement left/right + aim direction possibly inverted~~ — **RESOLVED 2026-07-19.** It was never an inversion: movement and aim share one code path (`screenDirToWorld`) with no sign error. `arrowleft`/`arrowright` were bound in **both** `MOVE_KEYS` and `TURN_LEFT`/`TURN_RIGHT`, so in FPS mode Left strafed *and* rotated on the same frame. Arrows are movement, q/e turn, and `input.test.ts` forbids double-binding.
