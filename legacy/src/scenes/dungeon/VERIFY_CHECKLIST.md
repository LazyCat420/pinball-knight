# 🎮 Pinball Knight — Verification Checklist

**Living manual-QA pass** — there is no E2E harness for the 3D game, so this is
how a change gets confirmed in the real thing. Run it before shipping anything
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

## 6. Known-open (NOT expected to be perfect yet)
- Floors can still feel **too narrow to bounce** — that's the §2.5 OPEN PLAYFIELD roadmap work, not yet built.
- Movement left/right + aim direction — flagged for empirical check (§5.1); tell me if anything feels inverted.
