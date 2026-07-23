# Content Expansion Plan — Cards · Monsters · Movesets

Grounded brainstorm for expanding the dungeon's combat content, anchored to the
real systems (cards.ts / zombie.ts / combat.ts / marble.ts). Each idea is tagged
**[cheap]** (rides an existing hook, ~one-file add) or **[new-machinery]** (needs
a new field/mode/handler). Ordered so the cheap wins ship first.

Cross-cutting principles:
- **Telegraph everything.** New attacks reuse the windup tint ramp (`lerpTint`,
  `TELL_MELEE`/`TELL_RANGED`) so they're dodgeable, not cheap.
- **Keep the core rule.** "Hit it at pinball speed" — momentum gates (golem,
  goblin, chomper) are the identity; new mobs should respect/riff on it.
- **Roles over stat-sticks.** Every new mob fills a *role* (swarmer/tank/zoner/
  disruptor/summoner/exploder/…), not just bigger numbers.
- **The marble system is a fresh synergy surface** for both cards and monsters —
  the newest, most on-theme design space.

---

## PART A — CARDS

Today: 19 cards, 5 rarities, built from 7 `CardModifier` fields (`damageFlat`,
`damageMult`, `cooldownMult`, `durabilityMult`, `onHit:chill|burn`, `pinballMult`,
`bolt`). Slots capped at 3/weapon. `applyCardOnHit` (combat.ts:84) is the shared
on-hit hook; `playerDamage` (combat.ts:64) the shared damage choke.

### A1 — Gap-fill cards [cheap] (combos of existing 7 fields; one-line table adds)
The stat-combo space is well covered, but identity gaps remain:
- **Ranged-only / melee-only identity** — only `momentumstrike` is kind-locked.
  Add ranged-only (`multishot`-feel via cooldown) and melee-only bruisers so the
  two weapon families draw different cards.
- **More `pinballMult` cards** at lower rarities — reward the momentum playstyle
  earlier (currently only rare+).
- **Pure durability/economy commons** for early smoothing.

### A2 — New on-hit statuses [new-machinery]
Pattern per status: `onHit` union += value → `CardAggregate` flag → branch in
`applyCardOnHit` → `Zombie` timer field → per-frame tick in zombie.ts → constant
→ update cards.test aggregate shape. (The stun reuses the storm-marble trick:
`slipT` with zero drift = frozen-in-place — no new tick needed.)
- **⚡ Shock (stun)** — brief freeze on hit. *Reuses `slipT`.* Strong; gate behind
  a cooldown so it's not a permastun.
- **☠ Poison (ramping DoT)** — unlike burn's flat tick, stacks/ramps with hits.
  (Venom Coat brew already proves the on-hit poison path.)
- **🩸 Bleed** — DoT that scales with the target's *missing* HP (executioner feel).
- **🎯 Mark/Curse** — marked foes take +X% from ALL sources (party-play upside too).

### A3 — New damage/economy mechanics [new-machinery]
Each: new `CardModifier` field + `CardAggregate` field + consumption in
`playerDamage`/projectiles + tests.
- **Crit** (`critChance`,`critMult`) — %chance ×N. Classic, high build value.
- **Lifesteal** (`lifestealFrac`) — heal on hit. Biggest survivability lever.
- **Execute** (`executeThreshold`) — instakill foes under X% HP.
- **Cleave/Overkill** — excess damage splashes to neighbours (reuses a radial loop).

### A4 — Ranged projectile cards [new-machinery] (projectiles.ts)
- **Pierce** (`pierce:N`) — pass through N foes (today projectiles die on first hit).
- **Multishot** (`extraPellets`) — +N pellets (pellet infra exists in fireWeapon).
- **Ricochet** — bounce to the next foe (shard-ricochet code is the template).
- **Homing** — bend toward nearest foe (Curve Shot `curveX/Z` infra exists).

### A5 — Marble-synergy cards [cheap-ish] ← the freshest angle
Cards that read `state.player.material` (already exists) — ties the card system to
the six materials just shipped. Mostly a check in `playerDamage`/`applyCardOnHit`.
- **Elementalist** — +X% damage while ANY material is active.
- **Prospector** — materials last +50% (`materialT` on pickup).
- **Fusioneer** — fusion window +2s (bigger synergy overlaps).
- **Conductor** — while Storm, your bolts chain +2 targets.
- **Magma Core** — while Lava, your *weapon* hits also drop a fire puddle.
- **Overflow** — while a material is active, on-hit also triggers its bounce emitter.

### A6 — Structural card upgrades [new-machinery]
- **Set bonuses** — 2–3 cards of a family grant an extra effect (fold in `aggregateCards`).
- **Cursed cards (mythic design space)** — huge upside + a real drawback
  (+100% dmg / −50% durability; +crit / take +1 dmg). Adds decisions to socketing.
- **Evolving cards** — a card that levels with kills (needs per-card run state).

---

## PART B — NEW MONSTERS

Cost of a new kind (compile-guarded by 3 exhaustive Records — `HP_BY_KIND`,
`STATS`, `ENEMY_DROPS`): union + constants + those 3 tables + sprite sheet +
`spawnKind`/`spawnHordeMember`/theme weight + AI branch + optional death handler +
`debug SPAWNABLE`. Current roles: swarmer(bat,spider) · tank(brute,golem) ·
zoner(spitter,webspinner) · disruptor(magnet,goblin,chomper) · special(ghost,
reaper,pin,slime). **Gaps: summoner, shielder/support, charger, exploder,
reflector, ambusher, anti-material.**

### B1 — Reuse-heavy new mobs [cheap-ish] (existing modes/floor-fx)
- **🤢 Bloater** (exploder) — slow, chunky; on death OR on reaching you, bursts
  into a fire/poison puddle. *Reuses killZombie death-handler + floor-fx `fire`.*
  Bloodworks. Teaches "don't let it touch you / don't melee-kill it point-blank."
- **🕷 Weaver variant / Spider web-drop** — leaves a slowing web patch as it moves
  (*floor-fx slick reskin*). Warren.
- **🔮 Wisp** (evasive zoner) — floats, short-teleports away when hit (nudge
  position on damage, like a mini shadow-blink). Hard to pin; rewards AoE. Arcane.

### B2 — New-mode mobs [new-machinery] (one new `ZombieMode`, reused across mobs)
Build the mode ONCE, reuse for several mobs + the Brute upgrade (Part C).
- **🐕 Hound** (charger) — telegraphs a locked-line CHARGE (new mode `"charge"`:
  windup → dash in a straight line → slam wall if it whiffs, self-stun). Dodgeable.
  Warren. *This same `"charge"` mode powers Brute's slam and Bat's swoop.*
- **💀 Necromancer** (summoner) — hangs back; periodically raises a dead corpse or
  spits a weak add. *Reuses the `setSlimeSplitHandler` injected-handler pattern
  (`setSummonHandler`).* Crypt/Arcane. The first "kill the caster first" priority.
- **🛡 Warden** (shielder) — grants a damage-absorb shield to nearby foes
  (`shieldT` on Zombie + a gate in `damageZombie`, exactly where reaper/golem gates
  live). Makes hordes stickier; rewards killing it first. Arcane.

### B3 — Deeper / anti-player-system mobs [new-machinery]
- **💎 Crystalback** (reflector) — armored INVERSE golem: ramming it at speed
  shatters it into shards that hurt **YOU**. Rewards NOT ramming — a momentum
  trap. Reuses `golemShards` aimed at the player.
- **⚡ Sapper** (anti-material) — on hit, drains/disables your active marble
  material (`materialT → 0`). A hard counter to the new system; makes materials a
  resource to protect. Late floors.
- **🪞 Mimic** (ambusher) — disguised as a ground-item/chest until you approach,
  then strikes. Ties into the loot system; punishes greedy pickups.
- **🐝 Hive / Shrieker** (spawner/alarm) — emits bats on a timer, or enrages
  nearby foes on sight (*reuses reaper speed-ramp on neighbours*).

---

## PART C — EXPANDED MOVESETS (existing monsters)

The mode machine (`idle/chase/windup/dead`) is **untested** → low friction. Each
mob gets 1–2 additions that fit its identity, via windup / a new mode / a status
field. Build the shared `"charge"` and `"slam"` modes once; many mobs reuse them.

- **Zombie** — pack-surge: when many are aggro'd near you, a brief group speed
  ramp (reaper-ramp on a cluster). Baseline stays plain; the 5 cosmetic variants
  can diverge (one variant lobs like a spitter-lite).
- **Spider** — trailing web (floor-fx slow) or a ceiling-drop ambush.
- **Brute** — **GROUND SLAM** (new `"slam"` mode: telegraphed radial AoE when
  close — reuse the pounce-slam radial) + **enrage at low HP** (speed/damage ramp).
  When it can't path to you, hurls debris (ranged fallback).
- **Spitter** — acid **puddle** on impact (floor-fx) + a triple-spread panic burst
  when cornered.
- **Ghost** — **phase-blink** (teleport through a wall to flank) + a slow-wail on
  materialize.
- **Bat** — **swoop-dive** (reuse `"charge"`) + screech that clusters more bats.
- **Slime** — acid **trail** (floor-fx) + a hop toward you; minis **merge** back
  into a big slime if ignored.
- **Reaper** — an adjacent **scythe sweep** (bigger hit) + periodic short blink to
  keep pressure. (Keep it unkillable.)
- **Goblin** — **rock throw** (ranged variant so you can't just kite the bumper) +
  **gold-steal-and-flee** (economy pressure).
- **Golem** — **rock throw** when you're out of ram range (can't safely kite it) +
  a ground-pound telegraph; optionally **reassembles** if not killed fast.
- **Chomper** — **vine-grab** (reuse magnet pull to yank you into bite range) +
  spits seeds that grow into new chompers (summoner flavour).
- **Magnet** — **overcharge** pull-then-violent-release (hostile shadow-implosion)
  + links to nearby magnets for a stronger field.
- **Webspinner** — spins a **web wall** across a corridor (terrain) + rushes to
  melee once you're webbed.
- **Pin** — knocked-but-not-killed pins slowly **stand back up** (soft timer).

---

## IMPLEMENTATION PHASES

**Phase 1 — cheap wins (ship in a day):**
- A1 gap-fill cards + A5 marble-synergy cards (read `p.material`).
- The shared `"charge"` mode → **Hound** monster + **Brute ground-slam/enrage**.
- Floor-fx reskins: spider web, slime acid trail, spitter puddle, **Bloater**.

**Phase 2 — high-value card mechanics:**
- Crit + Lifesteal + Pierce (new fields; touch `playerDamage`/projectiles + the
  two card tests). Biggest felt-power upgrades.

**Phase 3 — new-system monsters:**
- **Necromancer** (summon handler) · **Warden** (`shieldT` + damage gate) ·
  **Wisp** (blink-on-hit).

**Phase 4 — anti-system / depth:**
- **Sapper** (drains materials) · **Crystalback** (reflect) · **Mimic** (ambush).
- Cursed cards + set bonuses.

Each phase is independently shippable and unit-testable (the new mode machine and
card mechanics are pure logic; VFX is optional-chained). Reagent-drop and debug-
spawn entries are the easy-to-forget seams — the exhaustive Records catch the
first, `SPAWNABLE` is opt-in.
