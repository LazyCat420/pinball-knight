# Game research — Pinball Knight reference set

Twelve deep-dive reports on games whose loops, systems, or math are directly
relevant to Pinball Knight. Written 2026-07-27 from web research (developer
postmortems, wikis, decompiles, reverse-engineering write-ups); every report
cites its sources inline and flags community-derived approximations. Each ends
with a **"Lessons for Pinball Knight"** section tuned to what is already
shipped (cards/sockets, rarity + upgrade gamble, surfaces, skill tree, corpse
runs) — read that section first if you're short on time.

These are reference documents, not plans. When a lesson gets adopted, it goes
through a plan doc next to the game (`src/game/pinball-knight/*_PLAN.md`) and
the durable outcome lands in the rules docs one level up.

## The reports

| Report | Read it for |
| --- | --- |
| [hotline-miami.md](hotline-miami.md) | Surgical-but-fast pacing: quadratic combo math (decompiled), the knockdown/stun state machine, doors and thrown weapons as interactive-map tools, 3-state enemy AI, instant-restart design. |
| [diablo-2.md](diablo-2.md) | Drop math (Treasure Classes, NoDrop exponentiation, MF hyperbolic caps), preset-tile map generation ("fixed topology, random geometry"), frame breakpoints from a fixed-tick engine, affix-level gating. |
| [path-of-exile.md](path-of-exile.md) | The additive-"increased" vs multiplicative-"more" two-bucket stat system, hit-size-dependent armour formula, keystone design (rule change + structural drawback), crafting-currency gamble ladder, map-mod risk/reward math. |
| [doom.md](doom.md) | Momentum as the core verb, Romero's level-design rules, pain-chance as the crowd-control stat, infighting from 3 cheap AI rules, and 1993 performance engineering (precompute + budgets + zero overdraw) mapped to WebGPU. |
| [ragnarok-online.md](ragnarok-online.md) | The original card system (0.01% drops, permanent compounding, standardized magnitudes per category), the refine table and break-chance cliff, convex stat-point costs that force two-stat builds. **The reference for our card/refine systems.** |
| [enter-the-gungeon.md](enter-the-gungeon.md) | Loop-first floor-flow generation, the Magnificence anti-streak formula + dry-room pity ramp, per-floor boss DPS caps, blanks as double-duty panic tools, transform-not-add synergies with hidden drop bias. |
| [halls-of-torment.md](halls-of-torment.md) | One shared stat pool + per-hero coefficient tables (build diversity from data), over-100% stats converting to stacks, soft-cap defense curves, quest-based unlocks, and the Well (bank one item per run at a cost). |
| [asteroids-and-performance.md](asteroids-and-performance.md) | "Draw only what exists" and design-enforced entity budgets (1979), translated into a prioritized WebGPU checklist: pipeline warm-up via `compileAsync`, material/pipeline budgets, instancing, pooling, honest GPU measurement. |
| [peglin.md](peglin.md) | Pinball physics as combat math: pegs_hit × per-peg damage, retroactive order-independent crit flags, containing exponential relic stacking, trajectory preview as the fairness valve, DPS-check boss pacing. |
| [yokus-island-express.md](yokus-island-express.md) | Pinball as world traversal: flippers embedded in terrain with input-color coding, drain-free failure (currency, not death), one-way flows and rail roads, and freezing physics constants because they ARE the level format. |
| [vampire-survivors.md](vampire-survivors.md) | Three-layer damage architecture (base × global × per-weapon mask), entity caps as game rules (300/500 + offscreen recycle), gem-merge pickup consolidation, curse as opt-in throughput, refundable meta-economy curve. |
| [binding-of-isaac.md](binding-of-isaac.md) | Sqrt-aggregated stat stacking with linear penalties, the 3-phase floor generator (topology → roles → templates, dead-end scoring for special rooms), devil-deal health-as-currency economy, transformation sets, quality tiers. |

## Cross-cutting themes that emerged

Independent games converged on the same answers often enough that these read
as genre laws rather than single-game tricks:

1. **Two-bucket stat math.** Farmable/common bonuses accumulate additively (or
   under a sqrt/soft-cap curve); multiplicative power lives only in
   slot-limited, rare, or drawback-carrying structures. PoE ("increased" vs
   "more"), Isaac (sqrt curve + rare multipliers), VS (additive Might ×
   per-weapon coefficients), HoT (flat+% shared pool × per-hero coefficients),
   Peglin (channel-isolated bombs, live-nerfed multiplicative crit). Violating
   this is how card systems explode.
2. **Anti-streak/pity math beats flat drop rates.** Gungeon's Magnificence and
   pity ramp, Isaac's devil-chance streak-breaker, HoT's pity tables — flat
   0.01% RO-style rates only worked inside a persistent MMO economy.
3. **Performance is a design rule, not a renderer trick.** Asteroids' 26-rock
   cap, Doom's visplane limit, VS's 500-enemy cap + gem merging. Entity caps
   belong in game rules; the renderer then needs few pipelines, warmed at
   load, instanced heavily.
4. **Fixed-tick engines quantize speed stats into breakpoints.** D2's 25fps
   FCR tables are the cautionary tale; at 60Hz, publish named tiers instead of
   raw percentages.
5. **Failure cost must match how much the physics can betray the player.**
   Yoku (no death at all), Peglin (redirect stalls, don't confiscate), HM
   (instant restart), Isaac/D2 (health/corpse as currency). The more momentum
   decides outcomes, the softer the failure ledger.
