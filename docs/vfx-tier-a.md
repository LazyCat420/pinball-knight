# VFX Tier A — the ten invisible events (2026-08-30)

A full coverage audit of every item, move, powerup and brew found the game's
juice concentrated in the places that were already loud (abilities, melee,
traversal, marble materials) while a specific set of *game-state changes had no
visual output at all*. This session closed the cheap ones — each is a handful
of `state.vfx` calls at an existing seam, no new pools, no new materials, so
`boot/warmup.ts` is untouched.

What remains lives where backlog belongs: the two new headline items
(gold-as-dust coins, the vault-open loot fountain) were filed into
`src/game/pinball-knight/OPEN_WORK.md` Tier 5 with the seams named; the
monster-moveset and on-hit-status FX were already there.

## What was invisible, and what it looks like now

| Event | Before | Now | Seam |
| --- | --- | --- | --- |
| Weapon/gear/potion/card grab | toast + sfx only | rarity/flask-tinted burst at the glint height | `economy/pickups.ts` shared tail |
| Ranged fire | projectile appears mid-air | per-kind muzzle flash, once per trigger pull | `entities/projectiles.ts fireWeapon` |
| ❄️ Freeze potion | **zero output anywhere** | table-sized frost ring + sigil on drink; frost glints over halted parts for the duration | `economy/shop.ts` + `render/pinball-parts.ts` |
| ☠️ Venom Coat hit | silent DoT stamp | green smear on the struck foe | `entities/combat.ts applyCardOnHit` tail |
| 💰 Greed Draught kill | payout doubled invisibly | flask-gold flare at every inflated kill | `entities/combat.ts killZombie` |
| 🪨 Stoneskin save | halving looked like a low roll | grit burst + dust at the moment it halves (both damage paths) | `hitPlayer` / `hitPlayerRanged` |
| 🪨/🧲 body brews idle | nothing | stone / dark-iron ghost tells | `entities/player.ts updateBuffTells` |
| 🪩 Ball Form | sprite clip + groove, only while rolling | flask-orange ghost tell + idle chrome glint | `updateBuffTells` |
| Weapon break / gear destroyed | sfx + toast | shared `breakFx` grey shatter + dust at the owner | `entities/combat.ts` (3 call sites) |
| Chill / burn card procs | statuses landed silently | frost / ignition stamp on application; chill also sheds sparse frost while it slows | `applyCardOnHit`, `entities/zombie.ts` |
| Plunger charge | HUD meter only | gather-sparks streaming in (rate scales with pull), full-charge pop, release blast scaled to power | `entities/player.ts updatePlunger` |
| Rampage enter/exit | HUD swap only | rage-orange detonation ring on entry, thin settle ring on exit | `fps.ts` |

Conventions respected: every tint is the potion's flask colour (`TELL_TINT_*`
in `constants/pinball.ts` — freeze/stone/magboots/ballform are new), materials
stay excluded from the grab flash because `applyMaterial` fires its own
transformation, and burn's per-tick spark was already there so only the
*application* stamp was added.

## Also: the fx capture scripts are back

`fx/index.ts` has referenced `scripts/fx-motion.mjs`, `fx-shot.mjs`,
`heat-ab.mjs` and `fx-probe.mjs` since the fx lab shipped, but the repo split
(`8bc34180`) deleted them with `legacy/` instead of moving them. Restored under
`ThreeJS/scripts/` with the default `--url` corrected to the standalone app
(`http://localhost:5174/`, no `/dungeon` route). `scripts/README.md` records
the playwright/sharp + host-CDP requirements that used to be ambient.

## Player test list (UNVERIFIED — needs a human run)

1. **Grab flash** — drop into floor 1, walk over any weapon/potion/card.
   *Right:* a small tinted pop where it lay (weapon: grey/blue/purple/gold by
   rarity; potion: its flask colour). *Bug:* item vanishes with only the toast.
2. **Muzzle flash** — take a gun (`__lab` can't drop weapons; find one or use
   the bow), fire. *Right:* sparks + a hot pop at the barrel each shot.
   *Bug:* projectiles still appear from nothing.
3. **Freeze** — drink ❄️. *Right:* a frost ring washes out from you, then pale
   glints wink over the halted bumpers/flippers until it thaws; the glints
   stopping = the thaw. *Bug:* the table just stops dead with no cue.
4. **Venom Coat** — brew ☠️, hit anything. *Right:* green smear per hit and the
   existing DoT ticks after. *Bug:* poison only visible as damage numbers.
5. **Greed Draught** — brew 💰, kill two zombies, once with the brew expired.
   *Right:* gold flare on the brewed kill only.
6. **Stoneskin** — brew 🪨, get bitten. *Right:* grey grit puffs off you on the
   bite and you wear a faint stone ghost the whole duration.
7. **Ball Form** — drink 🪩, stand still. *Right:* orange ghost + occasional
   chrome glint while parked; pick up a marble material and the material's
   trail replaces it. *Bug:* two auras stacked while a material runs.
8. **Break** — wear a weapon down to nothing (the stick is quickest).
   *Right:* grey shatter + dust at your feet the moment it breaks; same when a
   gear piece dies soaking a hit.
9. **Chill** — socket a chill card (crawlergrip), hit a zombie. *Right:* frost
   stamp on the hit, sparse frost clinging while it crawls slow.
10. **Plunger** — hold the pull in the chute. *Right:* sparks stream into you,
    faster as the meter fills; a white pop at full pull; a bigger blast on a
    full-power release than a tap.
11. **Rampage** — fill the ult, trigger it. *Right:* orange detonation as the
    view drops to first person, a quieter ring where you land back in iso.
12. **Regression sweep** — coins, reagents and materials still pick up exactly
    as before (`__dungeonItems()` shows no `parented:false` leftovers).
