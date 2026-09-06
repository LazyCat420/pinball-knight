/**
 * The table: momentum, combo curve, parts, boosters, rails and marble materials.
 *
 * Split out of the 2522-line constants.ts so parallel tracks stop colliding on
 * one file. Consumers still import from `../constants` — that barrel re-exports
 * every module here, so no call site changed.
 */
import { SECRET_BREAK_SPEED, WALL_BREAK_SPEED, WALL_BREAK_SPEED_COST } from "./maze";
import { PLAYER_R } from "./player";
import { VIGNETTE } from "./render";

// ── PINBALL / SONIC momentum (keep sprinting past full spool) ───
/**
 * Holding a FULL sprint spool keeps winding: an OVERCHARGE meter builds over
 * OVERCHARGE_TIME. Any overcharge arms PINBALL PHYSICS — the knight carries real
 * momentum and wall hits BOUNCE.
 *
 * SONIC RULE (2026-07-16, "make it like Sonic … we want crazy combos"): a
 * bounce ADDS speed (restitution > 1) up to PINBALL_MAX_SPEED, so chaining wall
 * hits in a tight corridor ACCELERATES you instead of bleeding out. Momentum
 * only decays (very gently) when you're NOT bouncing, and a bounce COMBO counter
 * climbs per hit for score/damage. At full overcharge he tucks into a BALL:
 * faster, and he RAMS zombies on contact. Dodge (Space) bails out instantly.
 */
export const OVERCHARGE_TIME = 1.4; // seconds of full-spool / bouncing to fill
export const OVERCHARGE_DECAY = 1.0; // seconds to bleed overcharge once fully stopped
/**
 * SKILL-GATED ACCELERATION (2026-07-16, "it can't just infinite loop at max
 * speed … it has to hit certain movements like the corners/physics to speed
 * up"): a FLAT wall bounce PRESERVES speed (restitution just under 1 — you keep
 * your line but never gain by ping-ponging two parallel walls), while a CORNER
 * hit (both axes blocked in the same impact — a genuinely aimed diagonal slam)
 * ACCELERATES you. The other accelerators are the pinball PARTS (bumpers,
 * springs, ramps) — see the PART physics below.
 */
export const PINBALL_WALL_RESTITUTION = 0.94; // flat wall: keep most speed, gain nothing (real pinball walls are 0.1-0.5; this is already generous)
// Playtest 2026-07-23: corners pumped speed faster than pockets could bleed it
// — softened so the ramp is earned over a run, not two ricochets.
export const PINBALL_CORNER_RESTITUTION = 1.08; // corner pocket: multiply up
export const PINBALL_CORNER_ADD = 1.0; // + a flat kick per corner hit
/** Hard ceiling on pinball momentum — chained corners/parts climb to here, then hold. */
export const PINBALL_MAX_SPEED = 22; // u/s (≈5× walk) — genuinely fast, still steerable
/** Momentum bleed while NOT bouncing — very gentle so a good line stays fast. */
export const PINBALL_FRICTION = 0.9; // u/s² (was 2.0; Sonic keeps its speed)
// Slice 4 — per-surface friction: PINBALL_FRICTION is multiplied by the openness
// of the tile you're on, so OPEN bounce-arenas are a fast highway that holds
// your speed and TIGHT corridors/pockets bleed it for control (speed pacing).
export const FRICTION_OPEN = 0.35; // 3-4 open neighbours (room / junction) — fast
export const FRICTION_CORRIDOR = 1.0; // 2 open (a straight run) — normal
export const FRICTION_TIGHT = 2.1; // ≤1 open (dead-end pocket) — bleeds you down
export const PINBALL_STEER = 5.5; // baseline angular turn rate when aiming forward/side, rad/sec (~315 deg/sec)
// ── Turn-radius baseline controls (angular slew, opposition boost & directional counter-braking) ──
/** Maximum angular steering rate when aiming behind/opposite movement (rad/sec, ~544 deg/sec). */
export const PINBALL_TURN_BOOST_MAX = 9.5;
/** Heading vs aim dot-product threshold where enhanced turning authority begins. */
export const PINBALL_TURN_BOOST_START_DOT = 0.25;
/** Deceleration against forward travel during a strong reverse U-turn request (u/s²). */
export const PINBALL_COUNTER_BRAKE = 12.0;
/** Dot-product threshold below which forward counter-braking engages. */
export const PINBALL_COUNTER_BRAKE_DOT = -0.20;
/** Caps per-frame angular steering influence and protects against lag spikes (rad/sec). */
export const PINBALL_TURN_MAX_DELTA = 16.0;



// Slice 8 — lane glide: while railing fast and not steering, drift toward the
// walkable centre of the corridor so you rail down the middle (pinball lane
// feel) instead of grinding a wall. Lateral units/sec of the centring nudge.
export const LANE_CENTER_PULL = 5.0;
/** How far out (world units) the lane-glide probes for a wall on each side —
 * beyond this it's an open room, so centring backs off. */
export const LANE_PROBE_MAX = 1.8;
/** Momentum below this multiple of PLAYER_SPEED exits pinball back to normal control. */
export const PINBALL_EXIT_MULT = 1.05;

// ── Pocket-rattle guard ── ping-ponging inside a dead-end pocket used to hold
// (even GROW) speed forever — the ball got stuck rattling in small gaps with
// the player powerless. If several bounces land inside one small anchor circle
// within a rolling window, each further rattle bleeds momentum hard so control
// returns in under a second.
export const POCKET_RADIUS = 1.4; // world units — "the same small gap"
export const POCKET_BOUNCES = 5; // clustered bounces tolerated before damping
export const POCKET_DAMP = 0.62; // momSpeed multiplier per rattle past the limit
export const POCKET_WINDOW = 1.1; // seconds between bounces that still count as rattling

// ── JUICE GOVERNOR ── (entities/juice.ts)
// Playtest: "it lags when I go super fast and interact with multiple things."
// It was not frame rate. hitstop PAUSES the fixed-step sim, and fourteen call
// sites re-armed it with a bare Math.max, so a fast ricochet stacked freeze on
// freeze and the ball visibly stuttered — worse the better you played.
// A LONE hit is unchanged; only the 2nd+ inside a chain is damped.
/** Two freezes closer together than this are one stutter, not two crunches. */
export const HITSTOP_MIN_GAP = 0.11; // seconds
/** Per-chain-step multiplier on freeze length. */
export const HITSTOP_CHAIN_FALLOFF = 0.55;
/** Never damp below this fraction — a silent hit reads as a bug. */
export const HITSTOP_CHAIN_FLOOR = 0.25;
/** Hard ceiling on pending freeze: the sim can never pause longer than this,
 *  which makes the pathological stack structurally impossible. */
export const HITSTOP_MAX_PENDING = 0.09; // seconds
/** Shake re-armed inside this window is skipped when the running shake is
 *  already at least as strong (re-arming a 0.14s over a live 0.5s did nothing). */
export const SHAKE_CHAIN_WINDOW = 0.09; // seconds
/** Per-chain-step multiplier on shake length. Gentler than hitstop: shake does
 *  not stop the world, it just adds noise, so it can stay livelier. */
export const SHAKE_CHAIN_FALLOFF = 0.72;
/** Shake never damps below this fraction of the requested amount. */
export const SHAKE_CHAIN_FLOOR = 0.35;
/**
 * Seconds without a bounce before the combo counter resets (keep the chain
 * alive). This is the ANCHOR/legacy value; the live window is combo-indexed —
 * `comboWindow(n)` in combo-curve.ts shrinks it from COMBO_WINDOW_MAX toward
 * COMBO_WINDOW_MIN as the chain climbs, so a deep combo demands you stay on the
 * track. Kept as the shots.ts chain-alive reference and the reset default.
 */
export const PINBALL_COMBO_WINDOW = 1.6;
export const BALL_SPEED_MULT = 1.35; // extra speed in ball form (on top of momentum)

// ── Progressive combo ramp (combo-curve.ts) ─────────────────────
// The whole ramp is a CONCAVE curve, not the old linear chain: early combos
// pay off urgently, then the gains flatten so 100× never feels like a wall (or
// a lag spike). Every parameter below feeds a pure function in combo-curve.ts;
// see ROUTE_MATH_PLAN-adjacent notes / the combo plan for the derivations.
//
// Part 1 — logarithmic speed ceiling on WALL/CORNER gains (parts still launch
// to their own speeds; the ceiling only caps what bouncing can EARN):
export const COMBO_CEIL_BASE = 8; // u/s the wall-gain ceiling starts at
// Retuned from 0.4/40 after 2-player playtest feedback ("ramps up too quick"):
// K 0.25 flattens the early gains, NSAT 80 doubles the bounces needed to
// approach max — solo speed is now EARNED over a long chain, which is what
// makes the marble-on-marble ×2 (coop.playerCollisions) read as the jackpot.
export const COMBO_CEIL_K = 0.15; // log compression (lower = more gradual; 0.25→0.15 playtest 07-23: ramp too hot)
export const COMBO_CEIL_NSAT = 80; // bounces to ~95% of PINBALL_MAX_SPEED
// Part 3 — restitution taper: the first corner is the most exciting, deep
// corners hold speed but stop gifting it (speed comes from the LINE, not a pop):
export const COMBO_REST_LAMBDA = 0.08; // corner-restitution decay 1.12→1.0
export const COMBO_ADD_MU = 0.06; // corner flat-kick decay 1.4→~0
// Part 4 — the combo window shrinks with depth, then stabilises:
export const COMBO_WINDOW_MAX = 2.2; // generous at low combo (learn the line)
export const COMBO_WINDOW_MIN = 0.9; // tight at high combo (open floor breaks it)
export const COMBO_WINDOW_ALPHA = 0.07; // shrink rate
// Part 5 — global combo friction: at high combo open floor grips a little more,
// biasing toward tight machine routes (gentle: +15% at 100×):
export const COMBO_FRICTION_K = 0.015;
// Part 6 — tiered jackpot gold: +COMBO_GOLD_TIER per doubling of the combo,
// uncapped but logarithmic so mastery always pays and never breaks economy:
export const COMBO_GOLD_TIER = 3;
// Part 7 — the chain finally pays DAMAGE, not just speed and gold.
//
// WHY. Every other lever above rewards a deep chain with pace, economy or
// screen juice; none of them made you more lethal. A 100× chain rammed for
// exactly the same damage as an 8× chain unless you happened to draft a
// `pinballMult` card. The fantasy the chain sells — "I am a wrecking ball right
// now" — was the one thing it did not deliver.
//
// SHAPE. Same log-saturating curve as Part 1 (comboSpeedCeil) so the two read
// as one system: nothing below the Cruise gate, then a concave ramp that
// saturates at COMBO_DMG_NSAT. Deliberately CONCAVE, not linear — the deep
// chain should feel like mastery paying off, not like a damage cliff.
//
// WHY IT STARTS AT CRUISE. Combo 8 is already the game's own flow threshold
// (COMBO_ZONE_CRUISE below force-arms ball form there). Starting the damage
// ramp anywhere else would invent a second, invisible threshold.
//
// WHY THE CAP IS LOW. `pinballMult` cards and the pinballDamageMult skill are
// the INVESTED version of this idea; a free bonus that rivalled them would make
// drafting them pointless. 1.35× at saturation is a real reward that still
// leaves the cards clearly stronger, and it stacks multiplicatively on top.
// Raise it only after playing — raising reads as a buff, lowering as a nerf.
export const COMBO_DMG_MAX = 1.35; // damage multiplier at full saturation
export const COMBO_DMG_K = 0.15; // log compression, matched to COMBO_CEIL_K
export const COMBO_DMG_NSAT = 60; // bounces to ~95% of COMBO_DMG_MAX
// Part 2 — tempo zones: Launch (accelerate) → Cruise (flow) → Frenzy (edge):
export const COMBO_ZONE_CRUISE = 8; // enter Cruise: aura goes gold, ball form arms
export const COMBO_ZONE_FRENZY = 30; // enter Frenzy: faster ball, vignette + aberration
export const FRENZY_BALL_SPEED_MULT = 1.6; // ball speed mult while in Frenzy (vs BALL_SPEED_MULT)
export const FRENZY_VIGNETTE = 0.48; // vignette target at full Frenzy (vs VIGNETTE 0.32)
export const FRENZY_ABERRATION = 0.006; // peak chromatic-aberration split (UV units)
export const BALL_RAM_COOLDOWN = 0.18; // seconds between ram hits on the horde
export const BALL_RAM_KNOCKBACK = 1.1; // shove per ram (a wrecking ball, not a tap)
/** Ball clip playback. */
export const FPS_BALL = 14;

// ── STEEL: the BASE ball form is a solid ball bearing ─────────────────────────
// Ball form always LOOKED like a physics object but handled like the knight
// with momentum bolted on: it broke masonry at the same 15 u/s a bare roll did,
// shoved bodies the same 1.1, and carried no extra mass anywhere. Now the base
// form is genuinely STEEL — heavier than flesh, lighter than the Stone marble
// (which stays the "immovable boulder" pickup, a strict upgrade on every axis).
//
// These are the DEFAULTS the material hooks fall back to, so a pickup still
// overrides them wholesale and nothing about the material layer changes.
/** Masonry yields sooner to a steel ball than to a tumbling knight. */
export const STEEL_WALL_BREAK_SPEED = 11; // was WALL_BREAK_SPEED 15
export const STEEL_SECRET_BREAK_SPEED = 5.5; // was SECRET_BREAK_SPEED 7
/** Mass tells on impact: bodies get shoved harder and the ball keeps its line. */
export const STEEL_RAM_KNOCKBACK = 1.9; // was BALL_RAM_KNOCKBACK 1.1
/** Heavier = less speed scrubbed by the floor, so a good line CARRIES. */
export const STEEL_FRICTION_MULT = 0.82;
/** …and correspondingly harder to turn. Weight costs you agility. */
export const STEEL_STEER_MULT = 0.88;
/** Momentum kept when punching masonry — steel barely notices a thin wall. */
export const STEEL_WALL_BREAK_SPEED_COST = 0.82; // was WALL_BREAK_SPEED_COST 0.7
/** Ram damage multiplier: the ball's own weight behind every body it meets. */
export const STEEL_RAM_DAMAGE_MULT = 1.35;

/**
 * Hard ceiling on live floor-fx entries (grooves, slicks, fire, oil, shards).
 *
 * Every entry is its own Mesh with its own CLONED material added straight to
 * the scene, so this is a draw-call budget in the same sense the 135-zombie cap
 * is — and until this existed, nothing bounded it. The groove alone can outrun
 * that budget by an order of magnitude:
 *
 *     GROOVE_RAIL_MAX_SPEED 17 u/s ÷ GROOVE_SPACING 0.34 u  =  50 stamps/s
 *     50 stamps/s × GROOVE_LIFE 26 s                        = 1,300 live decals
 *
 * 300 keeps ~6 s of rut at top speed (the whole 26 s at a walk), which is well
 * past the range where your own trail is still useful to rail along, and caps
 * the worst case at 4.3× under what it was. Oldest is evicted first, so what
 * you lose is always the most-faded end of the trail.
 */
export const FLOOR_FX_MAX = 300;

// ── The GROOVE: the trail the steel ball gouges into the floor ────────────────
// A ball bearing this heavy doesn't glide over stone, it ENGRAVES it. The rut
// it leaves is a real feature, not a decal: it snags the horde that stumbles
// into it and RAILS a ball that finds it later, so your own trail becomes
// track you can ride. Runs on the floor-fx system (state.floorFx), so it
// already has persistence, per-frame overlap and disposal for free.
/** Minimum momentum to score the floor at all — a slow roll just polishes it. */
export const GROOVE_MIN_SPEED = 9;
/** World-units between stamps. Tighter than the ball's radius so the rut reads
 *  as ONE continuous furrow rather than a dotted line of pits. */
export const GROOVE_SPACING = 0.34;
/** Rut half-width, world units. Narrow: it is a score mark, not a puddle. */
export const GROOVE_RADIUS = 0.3;
/** How long a cut stays before the dungeon floor is "swept". Long — the point
 *  is that it's still there when you come back round. */
export const GROOVE_LIFE = 26;
/** Enemies crossing a rut stumble: the same slip channel the water slick uses,
 *  at a fraction of its drift (you trip in it, you don't skate across it). */
export const GROOVE_TRIP_TIME = 0.42;
export const GROOVE_TRIP_SPEED = 0.9;
/** A rolling ball that crosses its own groove gets STEERED along the cut, as a
 *  fraction of the lane-centring pull. This is what makes a trail into track. */
export const GROOVE_RAIL_PULL = 3.4;
/** Speed the ball must be under for the rut to grab it — a screaming ball
 *  jumps the cut, a cruising one drops into it. */
export const GROOVE_RAIL_MAX_SPEED = 17;

// ── Groove PHYSICS: the rut has a SHAPE, so the ball reacts to it ────────────
// A trail you merely follow is a decal with extra steps. A real cut in stone
// has a near lip, a trough and a far lip, and a ball meeting it does different
// things depending on the ANGLE it arrives at:
//   • broadside (crossing it) → the near lip KICKS the ball airborne; it lands
//     past the cut having lost a little speed to the impact.
//   • glancing (clipping it)  → the trough DEFLECTS the heading toward the
//     groove's own line — the rut steers you as you catch its edge.
//   • along it (riding it)    → you drop in and it rails you (RAIL_PULL above).
/** cos(angle) between travel and the cut ABOVE which you're riding it.
 *  0.72 ≈ within ~44° of the groove's line. */
export const GROOVE_ALIGN_RIDE = 0.72;
/** |cos| BELOW which the crossing is broadside enough to launch the ball.
 *  0.42 ≈ steeper than ~65° across the cut. */
export const GROOVE_ALIGN_CROSS = 0.42;
/** Peak height of the hop over a rut, world units. Small on purpose — this is
 *  a jolt, not the ramp launch. */
export const GROOVE_HOP_HEIGHT = 0.34;
/** How long that hop lasts. Short enough to read as a bump. */
export const GROOVE_HOP_TIME = 0.19;
/** Momentum kept across a broadside hit — the lip costs you a little. */
export const GROOVE_HOP_SPEED_KEEP = 0.94;
/** Minimum speed to get airborne at all; below this you just rattle. */
export const GROOVE_HOP_MIN_SPEED = 7;
/** How hard a glancing pass bends the heading toward the cut's line, 1/sec. */
export const GROOVE_DEFLECT = 5.2;
/** Re-arm before the same ball can be bumped again. Without it a dense trail
 *  fires a hop every frame and the ball buzzes in place. */
export const GROOVE_HOP_COOLDOWN = 0.26;

// ── MULTI-BALL (the 🔮 potion: two echo knights) ────────────────
/** How many echoes peel off the knight. */
export const MULTIBALL_COUNT = 2;
/** Seconds of player path kept in the follow trail — must exceed the deepest lag. */
export const MULTIBALL_TRAIL_SECONDS = 1.2;
/** Seconds each echo lags behind the live knight (index-aligned with the echoes). */
export const MULTIBALL_LAGS = [0.22, 0.4];
/** World units each echo is nudged sideways off the path, alternating side. */
export const MULTIBALL_SIDE_OFFSET = 0.42;
/** Back-step (seconds) used to read the trail HEADING for the sideways nudge. */
export const MULTIBALL_HEADING_STEP = 0.1;
/** Exponential catch-up rate toward the sampled trail point (per second). */
export const MULTIBALL_FOLLOW_RATE = 16;
/** Fraction of a full ram an echo lands — they assist, they don't replace you. */
export const MULTIBALL_RAM_MULT = 0.5;
/** Seconds an echo must wait before it can ram the SAME enemy again. */
export const MULTIBALL_RAM_COOLDOWN = 0.45;
/** Sprite opacity of an echo — clearly a ghost of you, not a second player. */
export const MULTIBALL_OPACITY = 0.5;

// ── PINBALL PARTS (the maze/pinball-machine hybrid) ─────────────
/**
 * Modular pinball components stamped into the maze by decorateMaze, placed by
 * tile TOPOLOGY so they land where they're useful, not as noise:
 *   BUMPER    → junctions/open crossings: touch it and it KICKS you radially
 *               away, adds speed + a combo tick (the pop bumper).
 *   SPRING    → dead ends, aimed back out: step/roll on and it LAUNCHES you
 *               along its direction at high speed (the plunger).
 *   RAMP      → straight corridors: a dash pad — crossing it floors your speed
 *               along its direction (the Sonic dash panel / slide).
 *   DEFLECTOR → corners: a banked 45° curve — momentum entering the corner is
 *               REDIRECTED around it with no speed loss (the rail/curve).
 * Density scales with depth via PARTS_BASE + PARTS_PER_LEVEL (capped).
 */
// Deep-research 2026-07-16 (disassembly-verified): pop bumpers SET a fixed
// radial velocity (Sonic: magnitude ≈1.2× the run cap, incoming speed ignored)
// — they are NOT restitution>1 reflectors. We keep the incoming speed via a
// flat ADDITIVE kick (never multiplicative — that's what allowed farming), so
// bumper chains build speed linearly toward the cap. ±6° scatter is authentic
// on ACTIVE parts only (plain walls stay mirror-perfect).
export const BUMPER_RADIUS = 0.46; // trigger radius, world units (body-to-centre)
export const BUMPER_KICK_MULT = 1.0; // never multiply the incoming speed…
export const BUMPER_KICK_ADD = 3.2; // …just a flat radial kick per pop (u/s)
export const BUMPER_MIN_EXIT = 9; // even a slow touch leaves at least this fast
export const BUMPER_COOLDOWN = 0.25; // per-bumper re-trigger lockout (s)
export const BUMPER_SCATTER = 0.1; // ±rad (~6°) exit-angle scatter — bumpers only
// Slice 5 — lit bumpers + jackpot: each bumper counts hits; at BUMPER_LIT_HITS it
// LIGHTS (gold, harder kick, bonus gold). Light JACKPOT_BUMPERS of them → a
// jackpot: floor-wide burst damage + gold + flash, then every bumper resets to
// re-light. The pinball scoring loop layered over the existing combo/frenzy glue.
export const BUMPER_LIT_HITS = 3; // pops to light one bumper
export const BUMPER_KICK_LIT = 5.6; // flat kick from a LIT bumper (vs 3.2 unlit)
export const BUMPER_LIT_GOLD = 3; // gold per lit-bumper pop
export const JACKPOT_BUMPERS = 5; // lit bumpers (or all, if fewer) to fire a jackpot
/**
 * LIT SHOT — the "shoot here now" light. While you're carrying real momentum,
 * parts inside a forward cone light up, so the table points at its own shots
 * instead of being a uniformly-lit scatter.
 */
/**
 * BUFF WORLD-TELLS — a buff with a timer must have a LOOK. Rage/Shield/Haste
 * previously existed only as HUD tiles; these drive tinted afterimages and the
 * shield's orbiting motes. Tints match each potion's flask colour.
 */
export const BUFF_TELL_INTERVAL = 0.1; // seconds between tinted afterimages
export const TELL_TINT_RAGE = 0xd97b29;
export const TELL_TINT_HASTE = 0x6fd0e8;
export const TELL_TINT_SHIELD = 0x8fc46b;
export const TELL_TINT_STONE = 0x9a8f77; // 🪨 Stoneskin flask
export const TELL_TINT_MAGBOOTS = 0xa83244; // 🧲 Magnet Boots flask
export const TELL_TINT_BALLFORM = 0xf0a63c; // 🪩 Ball Form flask
export const SHIELD_RING_INTERVAL = 0.13; // cadence of the orbiting bubble motes
export const SHIELD_RING_MOTES = 3; // motes emitted per pulse around the ring
export const SHIELD_RING_RADIUS = 0.55;
/** ❄️ FREEZE tell — matches POTIONS.freeze's flask colour. The freeze halts the
 * TABLE, not the knight, so its tell lives on the parts (pinball-parts.ts),
 * not in updateBuffTells with the body buffs above. */
export const TELL_TINT_FREEZE = 0xbfe8ff;
export const FREEZE_TELL_INTERVAL = 0.12; // cadence of frost glints on halted parts
export const FREEZE_TELL_PARTS = 2; // parts glinted per pulse

/**
 * SHOT IDENTITY (D2-D5) — the layer that turns motion into PLAY. The machine
 * had parts, lights and a combo counter, but every hit was anonymous: five
 * bumper taps scored exactly like ramp → orbit → target-bank. Named shots are
 * what a real table is actually made of. See shots.ts.
 */
/** ROLLOVER lane trigger: generous radius — it's a switch you roll over. */
export const ROLLOVER_RADIUS = 0.46;
export const ROLLOVER_COOLDOWN = 0.5;
/** ORBIT: seconds allowed between corners before a lap is abandoned. */
export const ORBIT_WINDOW = 2.6;
export const ORBIT_GOLD = 30; // a completed lap
export const ORBIT_LAP_BONUS = 15; // each further lap this floor pays this much more
/** ROLLOVER LANES: payout for lighting every lane in one bank. */
export const LANE_CLEAR_GOLD = 25;
/**
 * THE PLUNGER (D4): every floor OPENS parked in a launch chute the player pulls,
 * exactly like a real pinball machine. Hold the dodge key (Space / right-click)
 * to draw the plunger back — power fills over PLUNGER_CHARGE_TIME — while ←/→
 * steer the launch line up to PLUNGER_AIM_MAX off the base lane; release to fire.
 * Launch speed scales from PLUNGER_MIN_SPEED (a soft tap) to PLUNGER_SPEED (a
 * full pull), and a full pull down the base lane lands the SKILL SHOT.
 */
export const PLUNGER_SPEED = 13; // launch speed at full pull (≈3× walk — a cannon)
export const PLUNGER_MIN_SPEED = 6; // a soft tap still fires you into play (≈1.4× walk)
export const PLUNGER_CHARGE_TIME = 0.85; // seconds of full pull to reach max power
export const PLUNGER_AIM_MAX = Math.PI / 6; // ±30° of launch steer off the base lane
export const PLUNGER_AIM_RATE = 1.7; // radians/sec the launch line swings under ←/→
export const PLUNGER_SKILL_RANGE = 26; // how far out a skill target may sit
/** SKILL SHOT: the window off the floor's opening plunger launch. */
export const SKILL_SHOT_WINDOW = 6;
export const SKILL_SHOT_GOLD = 40;
/** How many shot identities are remembered inside one live combo. */
export const NAMED_CHAIN_MAX = 5;

/**
 * NAMED COMBOS — ordered LONGEST FIRST, so the biggest sequence a chain
 * satisfies is the one that pays. Each pays once per floor, which is what
 * keeps hearing its name an event rather than background noise.
 *
 * THE SHOT VOCABULARY. For a long time only seven part interactions ever
 * called `recordShot` — ramp, bank, orbit, lane(s), target, trapdoor, skill —
 * so eighteen of the twenty-three part kinds were completely invisible to this
 * table. You could catapult off a flipper, bank a mirror and light the whole
 * bumper set and the named-combo system would not have noticed any of it.
 *
 * The vocabulary now also carries `bumper` (only when a bumper LIGHTS — every
 * pop would drown the chain), `jackpot`, `flipper`, `mirror`, `sling` and
 * `spin`, and the table below spends them. Note the chain only remembers
 * NAMED_CHAIN_MAX identities, so long recipes have to be run clean.
 */
export const NAMED_COMBOS: ReadonlyArray<{ name: string; icon: string; shots: string[]; gold: number }> = [
  { name: "GRAND TOUR", icon: "👑", shots: ["ramp", "orbit", "lanes", "bank"], gold: 120 },
  { name: "PINBALL WIZARD", icon: "🧙", shots: ["bumper", "bumper", "jackpot"], gold: 150 },
  { name: "THE GAUNTLET", icon: "🥊", shots: ["flipper", "mirror", "target"], gold: 100 },
  { name: "BANK JOB", icon: "🏦", shots: ["bank", "bank", "bank"], gold: 50 },
  { name: "THE CIRCUIT", icon: "🌀", shots: ["orbit", "orbit"], gold: 90 },
  { name: "TRICK SHOT", icon: "🪞", shots: ["mirror", "mirror"], gold: 80 },
  { name: "SLING RUNNER", icon: "🌠", shots: ["sling", "orbit"], gold: 75 },
  { name: "ORBIT RUNNER", icon: "↻", shots: ["ramp", "orbit"], gold: 70 },
  { name: "KICKOFF", icon: "🦿", shots: ["flipper", "ramp"], gold: 65 },
  { name: "LANE RUNNER", icon: "⋯", shots: ["ramp", "lanes"], gold: 60 },
  { name: "SHARPSHOOTER", icon: "🎯", shots: ["skill", "target"], gold: 55 },
  { name: "ROULETTE", icon: "🎡", shots: ["spin", "target"], gold: 55 },
];

export const SHOT_LIGHT_MIN_SPEED = 5; // below this you're walking, not shooting
export const SHOT_LIGHT_RANGE = 14; // world units the light reaches down a lane
export const SHOT_LIGHT_COS = 0.94; // ~20° half-angle cone
/**
 * How far from the knight a part still gets ANIMATED (world units, squared for
 * a branch-free compare). Only the visual half is gated — cooldowns and hit
 * timers always tick, everywhere, because those are game state and a part whose
 * readiness depended on being looked at would be a nightmare to reason about.
 *
 * Sized to comfortably clear both the camera window (VIEW_W 20 × VIEW_H 11.25
 * tiles, so a corner sits ~11.5 units out) and SHOT_LIGHT_RANGE (14), which
 * must keep working or the "shoot HERE" light would pop in as you approached.
 * 24 leaves generous headroom for both while still skipping most parts on a
 * big floor, where the deal can place 60-100 of them.
 */
export const PART_ANIM_RANGE = 24;
export const PART_ANIM_RANGE_SQ = PART_ANIM_RANGE * PART_ANIM_RANGE;

/**
 * BROAD-PHASE cutoff for `touchPinballParts` (world units, squared).
 *
 * The collision scan walks every part on the floor each sim step; each handler
 * then does its own radius test. Parts far away can only ever answer "no", so
 * rejecting them before the call is free work saved.
 *
 * SAFETY: this must stay comfortably ABOVE the largest per-part trigger reach,
 * or parts would silently stop firing — a collision bug wearing an
 * optimisation's clothes. Measured maxima today: MAGNET_PULL_RANGE 4.2,
 * VENT_LANE_LEN 2.4, GLOVE_LANE_LEN 1.7, everything else ≤1.6. 12 is roughly
 * 3× the worst case. A part_touch test pins this relationship so a future part
 * with a longer reach fails the suite instead of failing in play.
 */
export const PART_TOUCH_BROAD = 12;
export const PART_TOUCH_BROAD_SQ = PART_TOUCH_BROAD * PART_TOUCH_BROAD;

export const JACKPOT_GOLD = 45;
export const JACKPOT_DAMAGE = 6; // burst dealt to every enemy on the floor
// Springs are the STRONGEST launcher (research: plunger-class ≈ 2.5-3× top run
// speed, an order of magnitude over a bumper tap in real tables).
export const SPRING_SPEED = 16; // ≈3.8× walk — the big dead-end cannon
export const SPRING_COOLDOWN = 0.6;
// Dash panels follow Sonic's booster rule exactly (disassembly-verified): SET
// the speed as a FLOOR (never slow a faster player) + a short steering lock.
export const RAMP_SPEED = 13; // dash-pad speed floor along its direction
export const RAMP_COOLDOWN = 0.35;
export const RAMP_STEER_LOCK = 0.25; // seconds of no-steer after a dash panel (Sonic's 15 frames)
// ── A2 RAMP HOP — a ramp doesn't just floor your speed, it LAUNCHES you into a
// short ballistic arc that flies OVER wall bands and sets down on the far floor
// (collision bypassed while airborne, like the trapdoor coaster but bite-sized).
// Landing hands the speed to the pinball system, so you bounce if you set down
// against a wall. Walls are 2 tiles thick, so the arc must reach ≥3 tiles to
// clear one — scan a landing in [MIN,MAX] tiles and take the farthest floor.
/**
 * Peak arc height. MUST clear WALL_H (1.1) with daylight to spare — at exactly
 * wall height the knight only grazes the parapet, and only for the single
 * instant at u = 0.5, so a vault read as a scuff. This is the game's ONE
 * airborne arc over the walls — the trapdoor's ride goes UNDER them.
 */
export const RAMP_HOP_HEIGHT = 1.75;
export const RAMP_HOP_MIN = 2.5; // nearest tiles ahead a hop will set down
export const RAMP_HOP_MAX = 4.75; // farthest tiles ahead to look for a landing (clears a 2-thick band + a corridor)
/**
 * VAULT RAMPS — the ones deliberately aimed ACROSS a wall band rather than
 * along the corridor, so the hop actually jumps the maze. Without these every
 * ramp points down its own lane and the airborne arc has nothing to clear.
 */
export const VAULT_RAMPS_PER_FLOOR = 3;
/**
 * Tiles the knight reveals around themselves on the floor map.
 *
 * Generous rather than a torch-radius: this is a navigation aid, not a stealth
 * mechanic, and a stingy reveal on a ~134x102 deep floor means the map is empty
 * exactly when it would be most useful.
 */
export const FOG_RADIUS = 6;
export const RAMP_HOP_SPEED = 16; // u/s the arc travels (governs airtime) — snappy, a touch above RAMP_SPEED
/** Banked curve keeps all your speed and adds a whisper (reward the clean line). */
export const DEFLECTOR_BOOST = 1.03;
/** Re-trigger lockout after a bank, so one corner can't fire twice in a frame. */
export const DEFLECTOR_COOLDOWN = 0.3;
// ── Deflector GRAB-THROW (the corner catches the knight and HURLS him) ──
// Instead of a smooth bank, a deflector snaps the ball to its centre, holds it
// for a wind-up beat, then launches it hard around the corner.
/** Seconds the knight is pinned mid-wind-up before the throw fires. */
export const DEFLECTOR_GRAB_TIME = 0.13;
/** The throw is at least this fast (u/s) — a hurl, not a nudge. Floors the
 *  launch so even a slow arrival gets flung; clamped to PINBALL_MAX_SPEED. */
export const DEFLECTOR_THROW_SPEED = 19;
/** …and multiplies whatever you brought in, so a fast entry throws faster. */
export const DEFLECTOR_THROW_BOOST = 1.18;

// ── Booster pad (Sonic's speed booster — the accelerating LANE element) ──
// Unlike a ramp (a one-shot dash floor), boosters are placed in CHAINS down a
// lane and each one SNAPS your heading to its arrow + floors your speed, so a
// row of them reads as a single accelerating channel you rail down. Works from
// a cold walk too (starts a momentum ride), which is what makes a booster lane
// feel like stepping onto a moving walkway.
export const BOOSTER_SPEED = 15; // speed floor along the arrow (a touch above a ramp)
export const BOOSTER_RADIUS = 0.5; // trigger radius, world units
export const BOOSTER_COOLDOWN = 0.18; // short — a chain must re-fire tile-to-tile
export const BOOSTER_STEER_LOCK = 0.16; // brief lock so the arrow carries you to the next pad
// ── Booster JAM guard ── a pad firing into a corner catches the ball on the
// rebound and fires it again: a standing wave the pocket-rattle damp can't win,
// because the booster's speed FLOOR re-floors whatever the damp just scrubbed.
// A pad that re-fires while the ball is still in front of it is jammed.
// 1, not 3: catching the ball a SECOND time in the same spot already proves the
// pad is bouncing it back to itself, and every extra tolerated cycle is a beat
// the player feels as friction/stutter (live QA). At 3 the knight rattled for
// ~0.77s before release; at 1, ~0.3s. A legitimate chain is unaffected — those
// pads catch you somewhere NEW, which resets the streak (see BOOSTER_JAM_RADIUS).
export const BOOSTER_JAM_HITS = 1; // re-fires at the same spot before a pad stands down
export const BOOSTER_JAM_RADIUS = 0.9; // world units — "caught the same ball again"
export const BOOSTER_JAM_WINDOW = 0.75; // s between re-fires that still count as a jam
export const BOOSTER_JAM_COOLDOWN = 0.9; // s the jammed pad stays dark, long enough to roll clear

// ── THE BOOSTER FAMILY ──────────────────────────────────────────────────────
//
// Live QA: "maybe that's the issue — because we keep recycling this one type of
// booster, we need corner booster, curved boosters, more jumpers in the mix."
// The census agreed: `booster` was 73% of all launch furniture on a floor (2471
// of 3364 across 78 floors) and every instance was the same flat straight pad.
// These three are the rest of the family. Each solves a piece of geometry the
// straight pad handles badly rather than being a reskin of it.

// CORNER BOOSTER — a turn that ACCELERATES. Enters on `dir`, leaves along
// `dir2`. It replaces the old "curve carry" hack, which was a straight pad
// dropped in a corner aimed down the outgoing leg: with the corner wall right
// behind it, a ball that reached the far wall rebounded onto the pad and was
// re-fired blind. This part knows which leg the ball arrived on, so a rebound
// coming back down the OUTGOING leg is treated as an entry from the wrong side
// and declined instead of relaunched.
export const CORNER_BOOST_RADIUS = 0.62; // wider than a straight pad — it has to catch a turning ball
export const CORNER_BOOST_SPEED = 16; // a shade above BOOSTER_SPEED: a good line through a turn should pay
export const CORNER_BOOST_COOLDOWN = 0.22;
export const CORNER_BOOST_STEER_LOCK = 0.2; // long enough to carry you clear of the corner wall
/** Below this the entry is a graze, not a run — carry it round without the
 *  speed floor, so walking into a corner pad doesn't fling you. */
export const CORNER_BOOST_MIN_ENTRY = 3;

// CURVED BOOSTER — a lane pad that sits ON an authored arc and drives you along
// the tangent rather than along a cardinal. It is the only launcher whose
// heading is not a unit cardinal, which is why it is deliberately EXCLUDED from
// every pass that reasons about cardinals (the duel breaker, the runway re-aim,
// the loop breaker's `movable`): those all gate on |dirI|+|dirJ| === 1, so the
// exclusion is automatic rather than another flag to keep in sync.
export const CURVE_BOOST_RADIUS = 0.55;
export const CURVE_BOOST_SPEED = 15.5;
export const CURVE_BOOST_COOLDOWN = 0.2;
export const CURVE_BOOST_STEER_LOCK = 0.18;

// JUMP PAD — the kicker that hops you clean over a wall band. The `vault` ramp
// already did this, but disguised as an ordinary ramp: same mesh, same silhouette,
// and the only thing distinguishing "this one flies" from "this one doesn't" was
// a boolean the player cannot see. A dedicated part makes the shot READ.
export const JUMP_PAD_RADIUS = 0.5;
export const JUMP_PAD_SPEED = 17; // faster than a ramp — it has a band to clear
export const JUMP_PAD_COOLDOWN = 0.45; // longer: an airborne knight shouldn't re-trigger on landing
export const JUMP_PAD_STEER_LOCK = 0.28; // the whole airtime, so the arc lands where it aimed

// ── Curved walls (auto-banked maze corners — see collision.computeArcCorners) ──
/** How close to a corner's centre a fast entry banks (world units). */
export const ARC_BANK_RADIUS = 0.62;
/** A swept curve is a return lane, not a pocket: keep speed + a whisper. */
export const ARC_BOOST = 1.03;
/** Re-bank lockout so hugging a corner doesn't machine-gun the redirect. */
export const ARC_COOLDOWN = 0.25;
/** Below this you're just walking a corner — no bank, only the visual. */
export const ARC_MIN_SPEED = 6;
/** Radius of the rendered quarter-cylinder wedge that caps a banked corner.
 *  Bumped 2026-07-20 to match the banked-rail read (was 0.5, buried against the
 *  2-tile wall bands so the real sweepable corners never looked curved). */
export const ARC_WEDGE_R = 0.62;

// ── Curved-wall KICKERS (booster rubber on the sweeps — see maze/arc-sweeps) ──
/**
 * Real tables wrap their curved guides in live rubber: the ball doesn't just
 * bank off a swept wall, it gets THROWN off it. A kicker band is an angular
 * sub-span of an ArcFeature that converts a ricochet into a bumper-grade kick.
 * Tuned against the bumper (BUMPER_KICK_ADD 3.2 / BUMPER_MIN_EXIT) so a wall
 * kicker reads as the same family of accelerator, slightly softer — it is free
 * and unavoidable on the sweep, where a bumper has to be aimed at.
 */
/** Never multiplies the incoming speed — a flat kick, like a bumper. */
export const ARC_KICK_MULT = 1.0;
/** Flat speed added on top of the reflection (u/s). */
export const ARC_KICK_ADD = 2.6;
/** Speed floor leaving the rubber — a slow graze still gets flung. */
export const ARC_KICK_MIN_EXIT = 9;
/** Below this, contact is a lean, not a hit: bank normally, no kick, no flash. */
export const ARC_KICK_MIN_SPEED = 3.5;
/** Authentic ±rad exit scatter, same rule as bumpers (active parts scatter). */
export const ARC_KICK_SCATTER = 0.1;
/** Re-fire lockout so hugging the band can't machine-gun it. */
export const ARC_KICK_COOLDOWN = 0.3;
/** Gold paid per kick — small; the payout is the SPEED, not the purse. */
export const ARC_KICK_GOLD = 1;
/** Seconds the rubber stays visibly compressed + lit after a kick. */
export const ARC_KICK_FLASH = 0.26;
/** How far the rubber stands proud of the collider face (world units). */
export const ARC_KICK_THICK = 0.07;
// ⚠️ DEAD MIRRORS — the five below are NOT read by anything. maze/arc-sweeps.ts
// declares its own copies (KICK_BAND_FRAC/KICK_CHANCE/KICK_ISLAND_BANDS/
// KICK_ISLAND_SPAN/KICK_MAX_PER_FLOOR) and never imports these, so editing them
// changes nothing. Tune the ones in arc-sweeps.ts. Kept only because deleting
// exports is a wider blast radius than labelling them.
/** Fraction of a fillet sweep's span the band covers (centred on the arc). */
export const ARC_KICK_BAND_FRAC = 0.62;
/** Chance a qualifying fillet sweep is authored with rubber. */
export const ARC_KICK_CHANCE = 0.45;
/** Bands strung evenly around an orbit island, and each one's width (rad). */
export const ARC_KICK_ISLAND_BANDS = 3;
export const ARC_KICK_ISLAND_SPAN = 0.62;
/** Hard cap per floor — a machine, not a trampoline. */
export const ARC_KICK_MAX = 10;

// ── Curved-wall BOOSTER LANES (speed strips ON the sweeps — arc-sweeps.ts) ──
/**
 * A lane is the OTHER thing a curved guide can do. Rubber (above) is a RADIAL
 * accelerator — it throws the ball off the wall. A lane is TANGENTIAL: roll into
 * the bend with its grain and it sweeps you around and spits you out ALONG the
 * curve, faster than you came in. That is the "curved booster lane" feel — a
 * banked corner you take at speed, not a trampoline you bounce off.
 *
 * Deliberately stronger than a kick (ADD 3.4 vs 2.6): a lane only fires when you
 * are already running its way, so it rewards a line the player chose, where
 * rubber fires on any contact at all. The exit is the arc's live tangent, so the
 * ball leaves following the wall it just rode.
 */
/** Multiplies incoming speed — a lane COMPOUNDS a good line, unlike flat rubber. */
export const ARC_LANE_MULT = 1.12;
/** Flat speed added on top of the multiply (u/s). */
export const ARC_LANE_ADD = 3.4;
/** Speed floor leaving a lane — entering slow still leaves you moving. */
export const ARC_LANE_MIN_EXIT = 10;
/** Below this, a lane is just a wall to lean on: no boost, no flash. */
export const ARC_LANE_MIN_SPEED = 3;
/** Re-fire lockout — long enough that one sweep is one boost, not a grind. */
export const ARC_LANE_COOLDOWN = 0.45;
/** Gold paid per boost — the payout is the LINE, not the purse. */
export const ARC_LANE_GOLD = 2;
/** Seconds the strip stays lit after a boost. */
export const ARC_LANE_FLASH = 0.34;
/** How far the strip stands proud of the collider face (world units). */
export const ARC_LANE_THICK = 0.05;

// ── BANKED RAILS ── the inside-curve ride (entities/rail.ts)
//
// The playtest ask, in the player's own words: "like a NASCAR driver scraping
// the sidewall to get faster speed... Hot Wheels mixed with pinball mixed with
// Sonic". That is not the one-shot lane boost above, and it is not rubber. It
// is a SUSTAINED state: hold yourself into the banked inside wall and keep
// accelerating for as long as you can stay on it.
//
// Three rules define the feel, and all three were the player's explicit call:
//
//   1. It goes on the INSIDE of the curve (concave sweeps). Standing inside the
//      circle with the wall banking around you is the racing line; the outside
//      of a bulge is just a corner you glance off.
//   2. You EARN it. Contact alone is not enough — you must steer INTO the wall
//      to hold the rail, and you drift off if you stop. A rail that grabbed you
//      automatically would be a conveyor belt, not a skill.
//   3. It EXCEEDS the normal speed cap while held, and decays back afterwards.
//      Without this a long rail hits PINBALL_MAX_SPEED almost immediately and
//      stops feeling like acceleration — the whole Sonic payoff is the overspeed
//      you carry out of the loop.
/** Accel while held, u/s². Compounds over a long arc — a big sweep is worth it. */
export const RAIL_ACCEL = 15;
/** Minimum speed to catch a rail at all. Below this you just slide along stone. */
export const RAIL_MIN_SPEED = 5;
/**
 * How hard you must be steering into the wall to hold on: the dot of your input
 * against the inward normal. ~0.35 is a lean, not a pixel-perfect press — the
 * skill should be reading the curve, not fighting the stick.
 */
export const RAIL_HOLD_DOT = 0.35;
/** Grace after breaking the hold before the rail drops you (s). Forgives a
 *  momentary wobble mid-corner without forgiving letting go. */
export const RAIL_GRACE = 0.16;
/** Ceiling while railing, as a multiple of PINBALL_MAX_SPEED. This is the
 *  over-cap the player asked for — earned speed a normal bounce cannot reach. */
export const RAIL_OVERSPEED = 1.6;
/** Decay back toward the normal cap once you leave, u/s². Slow enough that the
 *  exit is a payoff you carry down the next corridor. */
export const RAIL_DECAY = 9;
/** Contact band: how far off the exact collider face still counts as railing. */
export const RAIL_STICK = 0.34;
/** Sparks per second while railing — the scrape. */
export const RAIL_SPARK_HZ = 26;
/** Gold per second while held. Rewards the long ride, not the touch. */
export const RAIL_GOLD_HZ = 6;
// ── Wave-A parts (2026-07-16 pinball build-out — see PINBALL_ROADMAP.md) ──
/**
 * BOXING GLOVE — a wall-mounted piston that fires on its own clock, punching
 * across the corridor. Anything in the lane when it fires gets launched: the
 * PLAYER is flung into a momentum ride (it's a flipper, not a trap — no
 * damage), ZOMBIES take a haymaker + hard knockback. Placed on straight
 * corridor tiles, aimed off the wall it mounts.
 */
export const GLOVE_PERIOD = 2.4; // seconds between punches (jittered per part)
export const GLOVE_ACTIVE = 0.22; // seconds the fist is extended + live
export const GLOVE_LANE_LEN = 1.7; // how far the punch reaches, world units
export const GLOVE_LANE_HALF = 0.55; // lane half-width
export const GLOVE_SPEED = 12; // launch speed handed to the player
export const GLOVE_DAMAGE = 2; // haymaker damage to zombies in the lane
export const GLOVE_KNOCKBACK = 1.6; // and they FLY
/**
 * OIL SLICK — the floor booster: walk onto it while moving and your walk
 * converts into a frictionless momentum slide along your heading; ride over
 * it mid-pinball and it re-greases the ride (no friction, almost no steering)
 * for OIL_SLICK_TIME. The cheap "wheee" part.
 */
export const OIL_RADIUS = 0.72; // slick footprint
export const OIL_LAUNCH_SPEED = 7.5; // minimum slide speed off a walking touch
export const OIL_LAUNCH_MULT = 1.35; // × current speed if that's faster
export const OIL_SLICK_TIME = 0.55; // seconds of zero-friction after contact
export const OIL_STEER_FACTOR = 0.18; // steering authority while slicked
export const OIL_COOLDOWN = 0.4; // re-trigger lockout after a slick launch
/**
 * SPIN PAD — the slot machine: step on it and it flings you in a RANDOM
 * direction at high speed. Junction furniture; chaos by design.
 */
export const SPINPAD_SPEED = 11;
export const SPINPAD_COOLDOWN = 0.8;
/**
 * THE TURNTABLE'S SPIN RATE (rad/s), and the phase both the physics and the
 * renderer read.
 *
 * The spinpad used to fling you at `Math.random() * 2π` — unaimable, unlearnable
 * and a live RNG draw inside a physics path that co-op has to replay. It is now
 * a rotating deflector: it turns your entry heading by however far the pad has
 * spun. That only works if what you SEE is exactly what the physics uses, so
 * both sides call this one function; the rotor mesh's rotation and the exit
 * angle are the same number by construction and cannot drift.
 *
 * The `+ i` de-synchronises neighbouring pads without a random seed.
 */
export const SPINPAD_SPIN_RATE = 3.4;
export function spinPadPhase(elapsed: number, i: number): number {
  return elapsed * SPINPAD_SPIN_RATE + i;
}
/**
 * SLINGSHOT GATE — two posts with a band between them. Passing through with
 * momentum PINGS you out (×mult + add, min exit); a walking touch launches you
 * along the gate's axis. The double-speed lane.
 */
export const SLING_SPEED_MULT = 1.4;
export const SLING_ADD = 2.2;
export const SLING_MIN_EXIT = 10;
export const SLING_COOLDOWN = 0.5;
/**
 * TARGET BULLSEYES — wall-mounted targets that break when you carry pinball
 * momentum past them. Break ALL of a floor's targets and the machine pays out
 * (gold + a prize dropped at your feet). The floor's objective layer.
 */
export const TARGET_HIT_SPEED = 5; // momentum needed to break one
export const TARGET_RADIUS = 0.62; // trigger distance
export const TARGET_GOLD = 4; // per target
export const TARGET_CLEAR_GOLD = 30; // all-targets payout
// Slice 6 — drop-target BANK: a row of BANK_SIZE targets you must light in 1-2-3
// order (a wrong-order hit resets the bank); completing it pays BANK_CLEAR_GOLD.
export const BANK_SIZE = 3;
export const BANK_CLEAR_GOLD = 25;
export const TARGETS_PER_FLOOR = 5;
/**
 * TRAPDOOR → UNDERGROUND RUN — a floor hatch on dead ends, and the floor's ONE
 * AND ONLY way to be moved somewhere you didn't walk to. Step on it: the hatch
 * swings wide (TRAPDOOR_OPEN), you're pulled onto it and fall through
 * (TRAPDOOR_DROP), and then you are GONE — carried along a spline BENEATH the
 * floor (control locked, invulnerable, sprite hidden, only a run of dust on the
 * flagstones to say where you are) until you BURST back out of the ground
 * somewhere far (TRAPDOOR_BURST) at spring speed.
 *
 * It used to fly that same spline OVER the walls at TRAPDOOR_HEIGHT, and that
 * is the bug this shape fixes: a knight sailing across the room in plain sight
 * reads as floating, not as a trapdoor. A trapdoor SWALLOWS you — the floor is
 * the thing you travel through, which is the whole point of the hatch.
 *
 * Mechanically still a teleport with a ride, so it can't desync combat.
 * Nothing else in the game relocates the knight: pits shove you clear of the
 * rim, and the Magician shuffles the ROOM instead of you.
 */
export const TRAPDOOR_OPEN = 0.22; // hatch swings fully open before the floor gives way
export const TRAPDOOR_DROP = 0.58; // total hatch beat (open + fall through), seconds
export const TRAPDOOR_DROP_DEPTH = 1.5; // how far below the floor you sink — and the depth you are carried at
export const TRAPDOOR_RIDE_SPEED = 9; // spline traversal speed, u/s
export const TRAPDOOR_RIDE_MIN = 1.6; // tunnel-run duration clamp, seconds
export const TRAPDOOR_RIDE_MAX = 3.4;
export const TRAPDOOR_EXIT_SPEED = 14; // momentum handed over on touchdown
/**
 * THE POP-OUT. The tunnel run ends parked under the exit tile and the knight
 * ERUPTS: up through the floor to TRAPDOOR_POP and back down onto it, all
 * inside TRAPDOOR_BURST seconds, with the flagstones blowing out around him.
 * Two things ride on these numbers:
 *  - the climb must last long enough to READ as coming up out of a hole. Below
 *    y=0 he is genuinely occluded by the floor plane (the one thing that makes
 *    this look like a hole rather than a fade-in), so the first half of the
 *    beat is a knight growing out of the ground — that wants a beat, not a
 *    frame;
 *  - the apex must clear his own height so the exit reads as a LAUNCH, since
 *    touchdown hands its speed straight to the pinball machine.
 */
export const TRAPDOOR_BURST = 0.5; // pop-out beat: under the floor → apex → touchdown, seconds
export const TRAPDOOR_BURST_RISE = 0.55; // fraction of that beat spent climbing to the apex
export const TRAPDOOR_POP = 1.0; // apex above the floor as he bursts back out
export const TRAPDOORS_PER_FLOOR = 2;
export const TRAPDOOR_COOLDOWN = 2.5;
/** Bounce-combo part-hits inside one live combo that trigger FRENZY. */
export const FRENZY_PART_HITS = 5;
export const FRENZY_GOLD = 20;

// ── Wave-G parts: flipper + angle mirror (PINBALL_ROADMAP deferred set) ──
/**
 * FLIPPER — a big paddle that FLIPS on contact and launches you along its
 * paddle arc at the strongest speed in the machine (the "real pinball
 * flipper" ask). Placed in open rooms / junctions; the launch direction is
 * the paddle's swing dir. Distinct from the spring (dead-end plunger) by
 * being a room-scale, high-arc catapult with a rotating paddle.
 */
export const FLIPPER_SPEED = 18; // ≈4.3× walk — the hardest single launch
export const FLIPPER_COOLDOWN = 0.7;
export const FLIPPER_RADIUS = 0.6; // contact trigger radius
export const FLIPPER_SWING = 0.22; // seconds the paddle takes to snap up
/**
 * The swing, in radians about Y — the paddle sweeps ACROSS the floor plane.
 * It RESTS cocked back off the launch line and finishes past it, so the arc
 * carries through the direction it throws you rather than stopping on it.
 */
export const FLIPPER_REST = -0.62;
export const FLIPPER_ARC = 0.95;

/**
 * ── THE FLIPPER BUTTON (F on the keyboard, B/circle on a pad) ───────────────
 *
 * Until this existed the flipper was a radial trigger that auto-fired on
 * contact — a kicker with aim-assist wearing a flipper's name. There was no
 * button, no hold and no timing, which is the entire verb set a pinball player
 * has. The three constants below are that verb set.
 *
 * PASSIVE contact still fires a flipper, at `FLIPPER_PASSIVE_SPEED` rather than
 * `FLIPPER_SPEED`. That is deliberate and load-bearing: `flipper` is in
 * `LAUNCH_KINDS` and `FORWARD_FLOW_KINDS` in maze/decorate.ts, so level-gen
 * counts flippers when it guarantees a floor's routes are traversable under
 * momentum. A press-only flipper would silently invalidate every one of those
 * guarantees on every floor already generated. So the button does not turn the
 * part on — it turns it UP, from 12 to 18, which is 1.5x for a timed hit.
 */
/** Contact with no button: still launches, at two thirds of a timed one. */
export const FLIPPER_PASSIVE_SPEED = 12;
/** How far the button reaches to find a paddle, world units (TILE = 1). */
export const FLIPPER_REACH = 3.2;
/**
 * Seconds of the swing that count as LIVE. Shorter than FLIPPER_SWING (0.22),
 * because the window you have to hit is the paddle ACCELERATING, not the whole
 * travel — the back half of the arc is follow-through and should not pay.
 */
export const FLIPPER_ACTIVE = 0.16;
/** A timed hit is a named shot; this is what it pays. */
export const FLIPPER_TIMED_GOLD = 12;

/**
 * ── THE NUDGE, AND THE TILT ────────────────────────────────────────────────
 *
 * SHIFT (keyboard) or LT (pad) plus a direction, while momentum is live —
 * the sprint modifier, which is inert while riding and was the only binding
 * free on BOTH devices. See entities/nudge.ts for why a nudge is an impulse
 * with a price rather than a stronger steer.
 */
/** Radians the heading rotates toward the push. One shove, one fixed angle. */
export const NUDGE_BEND = 0.42;
/** The shove adds a little pace as well as a lot of direction. */
export const NUDGE_SPEED_ADD = 1.5;
/** Re-shove guard: one held Shift is one nudge, not sixty a second. */
export const NUDGE_COOLDOWN = 0.35;
/**
 * Meter cost per shove, and the rate it drains at.
 *
 * These three numbers are ONE decision and must be read together, because what
 * matters is the NET gain per shove at the fastest rate `NUDGE_COOLDOWN`
 * allows — not the cost on its own:
 *
 *     net = TILT_PER_NUDGE - TILT_DECAY * NUDGE_COOLDOWN
 *         = 0.5            - 0.4        * 0.35            = 0.36
 *
 * So a player shoving as fast as the game lets them reaches 0.5, then 0.86,
 * then 1.0 — fine, WARNING, TILT. That is exactly a real machine's two-warnings
 * -then-out, and it is why `TILT_WARN` sits at 0.66: it has to fall between the
 * second and third rungs of that ladder.
 *
 * An earlier pass had 0.34 and 0.5, whose net is 0.165 — seven shoves to tilt,
 * not three, while the comment beside it claimed three. `nudge.test.ts` drives
 * the real function at the real cadence rather than trusting the arithmetic.
 */
export const TILT_PER_NUDGE = 0.5;
export const TILT_DECAY = 0.4;
/** The warning light: one note per floor, between the second and third shove. */
export const TILT_WARN = 0.66;
/** Seconds after a tilt during which a shove does nothing and the meter is
 *  frozen full. This IS the penalty, alongside the lost combo. */
export const TILT_LOCKOUT = 2.0;

// ── THE PLAZA PARTS ────────────────────────────────────────────────────────
//
// Three kinds the PLAZA_PLAN named and never defined. The plan was retired on
// 2026-08-27 with these still nowhere in `PinballPartKind`; what they actually
// DO was specified by the user on 2026-08-28, and that specification is what is
// built here. Two of the plan's five are deliberately absent: `gate` was
// dropped outright, and `maw` was never defined by anyone — inventing it would
// be exactly the kind of unsourced content the plan itself became.

/**
 * SWINGARM — a bar with a hand on the end, spinning in a circle.
 *
 * Continuous rotation, direction per part (both ways exist on a floor). The
 * HAND is the business end: the hub is harmless furniture and only the hand
 * connects, which is what makes the part a moving TIMING problem rather than a
 * radius you avoid. It throws you along its TANGENT — the direction the hand
 * was actually travelling — so where you end up depends on when you arrived,
 * and a swingarm is a shot you wait for.
 */
export const SWINGARM_LEN = 1.15; // hub → hand centre, world units
export const SWINGARM_RATE = 2.1; // radians/sec
export const SWINGARM_HAND_R = 0.42; // the hand's own contact radius
export const SWINGARM_SPEED = 16; // tangential launch
export const SWINGARM_COOLDOWN = 0.55;
/** The hand's phase at time `t`. `spin` is +1 or -1; `seed` de-syncs the floor
 *  so two arms in one room are not a matched pair. Shared by the physics and
 *  the renderer, which is the only way they can agree about where the hand is —
 *  a mesh drawn from one clock and a hit tested against another is a part that
 *  connects on empty air. */
export function swingArmPhase(elapsed: number, spin: number, seed: number): number {
  return seed + spin * elapsed * SWINGARM_RATE;
}

/**
 * FLYWHEEL — two counter-rotating wheels with a gap you shoot through.
 *
 * Not a scoop: the ball is not picked up and dropped, it is FED between two
 * spinning wheels and spat out the far side faster than it went in, the way a
 * pitching machine works. So it is a booster whose speed does not depend on
 * what you arrived with — the wheels are doing the work, not your momentum —
 * which is what makes it the recovery part. Walk into one at a standstill and
 * you still come out at speed.
 */
export const FLYWHEEL_RADIUS = 0.55; // the gap's catch radius
export const FLYWHEEL_SPEED = 21; // out the far side, faster than a flipper
export const FLYWHEEL_COOLDOWN = 0.6;
export const FLYWHEEL_STEER_LOCK = 0.22; // committed to the barrel, briefly
export const FLYWHEEL_SPIN_RATE = 9.5; // radians/sec, for the wheels' spin

/**
 * MAGPOST — a pachinko post. Scattered in small fields, with bumpers mixed in.
 *
 * A post DEFLECTS rather than launches: you glance off it and keep going, so a
 * field of them turns a straight run into a cascade you cannot fully predict —
 * the coin-down-the-pegs game. That only works if the cascade does not eat your
 * pace, which is why `MAGPOST_KEEP` is so close to 1 and why the placement
 * seeds bumpers into every field: a post takes a little speed, a bumper gives
 * it back, and the field stays a scramble instead of becoming a sand trap.
 */
export const MAGPOST_RADIUS = 0.34; // small — you thread between them
export const MAGPOST_KEEP = 0.94; // speed retained per glance
export const MAGPOST_MIN_EXIT = 6; // …and never below this, so a field cannot stall you
export const MAGPOST_SCATTER = 0.3; // radians of jitter on the bounce
export const MAGPOST_COOLDOWN = 0.12; // low: a cascade is MANY posts in a row
// How MANY of each a floor gets, and how big a peg field is, live in
// maze/decorate.ts beside KICKBACK_CHANCE and ROLLOVER_ARRAYS_DEFAULT — that
// module owns placement budgets, and one number with two homes is one number
// that drifts.
/**
 * ANGLE MIRROR — a fixed 45°/90° reflector: momentum entering it REFLECTS
 * across the mirror's surface line (unlike the deflector, which banks around
 * a corner). Turns a straight into a bank shot — the puzzle-ricochet piece.
 * mirrorX/Z is the surface DIRECTION (the line the mirror lies along); the
 * reflection normal is its perpendicular.
 */
export const MIRROR_RADIUS = 0.5;
export const MIRROR_COOLDOWN = 0.18;
export const MIRROR_BOOST = 1.02; // a whisper of speed for the clean bank

// ── Wave-H floor hazards (pit / electric / fire vent / magnet strip) ──────
/**
 * PIT — a hole in the floor. Fall in (the coaster is the only thing that
 * clears one) and it costs you a heart, a little gold and all your speed —
 * then you HAUL YOURSELF OUT at the rim you fell in at. It does NOT send you
 * back to the level start: losing the whole floor's progress to one bad bounce
 * in a machine built on ricochets is a punishment, not a hazard. The map's
 * "ouch", not its "start over".
 */
export const PIT_RADIUS = 0.5;
export const PIT_GOLD_PENALTY = 8;
export const PIT_DAMAGE = 1;
export const PIT_CLIMB_COOLDOWN = 1.2; // re-trigger lockout so a rim landing can't loop
/**
 * GRAVE PIT — the lethal hole torn open where a knight left the pool.
 *
 * Wider than a normal pit and LETHAL (see fallInGravePit). The extra radius is
 * not just menace: this hazard appears mid-run with no warning, so it has to be
 * seen from further away than the furniture a player walked past on arrival.
 */
export const GRAVEPIT_RADIUS = 0.66;
/** Seconds the detonation's shockwave keeps damaging, before the hole settles. */
export const GRAVEPIT_BLAST_LIFE = 0.5;
/** Radius the departing knight's blast reaches (world units). */
export const GRAVEPIT_BLAST_RADIUS = 2.4;
/** Damage the blast deals to ENEMIES caught in it (players are never hurt by
 *  it — the hole is the threat, and a hit at spawn time would be unavoidable). */
export const GRAVEPIT_BLAST_DAMAGE = 3;
/**
 * ELECTRIC GRID — a floor plate that PULSES: dark and safe for ELEC_OFF
 * seconds, then live and lethal-ish for ELEC_ON. Standing on a live plate
 * zaps you (damage + a hard scatter). Rhythm dodge; the plates on one floor
 * share a phase offset so a room reads as a wave.
 */
export const ELEC_RADIUS = 0.5;
export const ELEC_ON = 1.0; // seconds live
export const ELEC_OFF = 1.6; // seconds safe
export const ELEC_DAMAGE = 1;
export const ELEC_ZAP_COOLDOWN = 0.9; // per-plate re-zap lockout
/**
 * FIRE VENT — a wall nozzle that jets a flame LANE across the corridor on a
 * cycle (like the glove, but fire). In the lane while it's roaring → burn.
 * Telegraphed by a sputter before the jet.
 */
export const VENT_PERIOD = 2.6; // seconds between jets (jittered)
export const VENT_WARN = 0.5; // sputter tell before the jet
export const VENT_ACTIVE = 0.7; // seconds the jet roars
export const VENT_LANE_LEN = 2.4; // reach across the corridor
export const VENT_LANE_HALF = 0.5;
export const VENT_DAMAGE = 1;
export const VENT_BURN_COOLDOWN = 0.5; // player re-burn lockout in the jet
/**
 * MAGNET STRIP — a charged floor band that DRAGS on momentum: while you're
 * over it your speed is capped low and steering goes heavy, so a fast line
 * dies in it unless you power through. The anti-speed zone (a foil to oil).
 */
export const MAGSTRIP_RADIUS = 0.55;
export const MAGSTRIP_SPEED_CAP = 3.2; // momentum clamped to this over the strip
export const MAGSTRIP_WALK_MULT = 0.5; // and walking crawls too

/** How many of each hazard a floor rolls (scales gently with depth in core). */
export const HAZARDS_BASE = 3;
export const HAZARDS_PER_LEVEL = 1;
export const HAZARDS_MAX = 10;

// ── Wave-K power-ups: Curve Shot + Magnet Boots ─────────────────
/**
 * CURVE SHOT — for its window, your projectiles CURVE: they bend toward the
 * side your momentum/facing sweeps, arcing around corners. A lateral accel
 * applied each tick perpendicular to the shot's heading.
 */
// Duration lives on POTIONS.curveshot in items.ts (the owner of every potion's
// duration) — it was duplicated here and the copy was wired to nothing.
export const CURVE_ACCEL = 10; // u/s² lateral bend
/**
 * MAGNET BOOTS — inverts the Magnet Crawler's pull to a REPEL and, on a magnet
 * strip, turns the drag into a LAUNCH: momentum tricks off the very things
 * that used to trap you.
 */
// Duration lives on POTIONS.magnetboots in items.ts (see CURVE_ACCEL above).
export const MAGBOOTS_REPEL = 3.0; // push strength away from a crawler
export const MAGBOOTS_STRIP_LAUNCH = 12; // speed a strip flings you at instead of dragging
export const MAGSTRIP_BOOTS_COOLDOWN = 0.4; // lockout after a boots-inverted strip launch

// ── MARBLE MATERIALS ────────────────────────────────────────────
// A second "ball" axis: what the pinball is MADE OF. Modifies ride physics at
// the same choke points that branch on springT/turboT/oilT, plus on-bounce and
// on-slam emitters. See entities/marble.ts and state.MarbleMaterial.
/** How long a picked-up material lasts (seconds), by material. */
export const MATERIAL_DURATION = { diamond: 20, water: 16, stone: 24, storm: 16, shadow: 12, lava: 14 } as const;
/** Fusion window: after a 2nd pickup, both materials co-fire this long. */
export const MATERIAL_FUSION_TIME = 2;
/** Min momentum (u/s) before a bounce emits anything — rewards flow, kills spam. */
export const MATERIAL_EMIT_SPEED = 6;
/** Min seconds between on-bounce emissions. */
export const MATERIAL_EMIT_COOLDOWN = 0.12;

// 💎 Diamond — offense / projectiles
export const DIAMOND_RESTITUTION = 1.0; // perfectly elastic flat walls
export const DIAMOND_WALL_BREAK_SPEED = 8; // was WALL_BREAK_SPEED 15
export const DIAMOND_SECRET_BREAK_SPEED = 4; // was SECRET_BREAK_SPEED 7
export const DIAMOND_BOUNCE_SHARDS = 4; // shards per qualifying bounce
export const DIAMOND_BOUNCE_FAN = 0.7; // ±rad fan around the ricochet vector (~40°)
export const DIAMOND_BOUNCE_DMG = 1;
export const DIAMOND_SLAM_SHARDS = 8; // radial burst on pounce slam
export const DIAMOND_SLAM_SPEED = 12; // u/s
export const DIAMOND_SLAM_DMG = 2;
export const DIAMOND_SHARD_SPEED = 14; // u/s of an on-bounce shard

// 💧 Water — fast & slippery (mobility / flow)
export const WATER_RESTITUTION = 0.98; // keeps almost all speed
export const WATER_FRICTION_MULT = 0.08; // near-frictionless glide (permanent-oil feel)
export const WATER_STEER_MULT = 0.55; // slippery: weak grip, momentum-dominated
export const WATER_RAM_KNOCKBACK = 0.2; // flows through, barely shoves
export const WATER_SLICK_RADIUS = 0.7; // tile radius of a slick scar
export const WATER_SLICK_LIFE = 4; // seconds a slick persists
export const WATER_SLAM_SLICKS = 5; // slick patches thrown on slam
export const WATER_SLAM_SPEED_KICK = 4; // u/s forward kick on slam
export const WATER_SLIP_TIME = 0.8; // seconds an enemy slides after touching slick
export const WATER_SLIP_SPEED = 2.4; // u/s an enemy drifts while slipping

// 🪨 Stone — force / area-denial
export const STONE_RAM_KNOCKBACK = 3.3; // was BALL_RAM_KNOCKBACK 1.1
export const STONE_FRICTION_MULT = 1.6; // rolls, doesn't glide
/** Stone stays a strict upgrade on steel for the two new mass axes. */
export const STONE_RAM_DAMAGE_MULT = 1.7; // vs STEEL_RAM_DAMAGE_MULT 1.35
export const STONE_WALL_BREAK_SPEED_COST = 0.9; // vs STEEL 0.82 — a boulder shrugs off masonry
export const STONE_MAX_SPEED = 16; // lower ceiling (vs PINBALL_MAX_SPEED 22)
export const STONE_BUMPER_KICK_MULT = 0.15; // ignores small bumper forces
export const STONE_CORNER_ADD_MULT = 3; // corner hits accelerate harder
export const STONE_SHOCK_RADIUS = 0.6; // on-bounce shockwave radius (tiles)
export const STONE_SHOCK_DMG = 1;
export const STONE_SHOCK_GOLEM_MULT = 2; // stone bullies golems
export const STONE_SLAM_RADIUS = 1.4; // boulder-slam AoE
export const STONE_SLAM_BASE_DMG = 4;
export const STONE_SLAM_DMG_PER_SPEED = 0.3; // + this × speed converted

// ── MATERIAL × TERRAIN REACTIONS ──
// The ball's substance reacts to hazard tiles it crosses (see entities/marble.ts
// materialTerrain* + the pinball-collide / hazards handlers that call them).
// 💧 Water × magstrip → STEAM ERUPTION (the anti-speed trap flash-boils into a
//    launch + a scalding radial burst instead of dragging you to a crawl).
export const WATER_STEAM_LAUNCH = 14; // u/s the eruption flings you (vs the crawl)
export const WATER_STEAM_RADIUS = 2.0; // scald radius (tiles)
export const WATER_STEAM_DMG = 3;
export const WATER_STEAM_COOLDOWN = 0.5; // per-strip re-arm
// 🪨 Stone × magstrip → PLOW: too heavy for the field to grip; barely slowed.
export const STONE_MAGSTRIP_CAP = 13; // speed clamp for stone (vs MAGSTRIP_SPEED_CAP 3.2)
// 💎 Diamond × electric → DISCHARGE: prismatic lattice channels a live plate
//    into a zap on nearby foes, and diamond eats the shock itself.
export const DIAMOND_DISCHARGE_RADIUS = 2.4;
export const DIAMOND_DISCHARGE_DMG = 4;

// ⚡ Storm — corridor rails / lightning (mobility + electric offense)
export const STORM_LANE_PULL_MULT = 2.0; // rails corridors with inhuman precision
export const STORM_STEER_MULT = 1.45; // sharper mid-flight response
export const STORM_BOUNCE_ARC_DMG = 2; // sideways zap on each fast bounce
export const STORM_BOUNCE_ARC_LEN = 3.2; // arc reach (blocks)
export const STORM_BOUNCE_ARC_HALF = 0.9; // arc half-width band
export const STORM_CLAP_RADIUS = 3.0; // thunderclap ring (slam)
export const STORM_CLAP_DMG = 3;
export const STORM_CLAP_STUN = 0.6; // seconds a foe is stunned (frozen in place)
// Storm × water-slick → ELECTRIFIED FLOOR: a storm bounce over a wet tile
// discharges into everything standing on any slick, chaining the shock.
export const STORM_WET_DMG = 2;

// 🌑 Shadow — evasion / control (slips gaps, decoys, void implosion)
export const SHADOW_PLAYER_R = 0.21; // shrunk collider (vs PLAYER_R 0.3) — slips tight gaps
export const SHADOW_RESTITUTION = 1.05; // flat walls slowly ACCELERATE — slippery unreality
export const SHADOW_BUMPER_SCATTER_MULT = 2.0; // bumper exits get unpredictable
export const SHADOW_LURE_RADIUS = 4.0; // foes this close get pulled onto the decoy
export const SHADOW_LURE_TIME = 1.2; // seconds a foe chases the shadow clone
export const SHADOW_IMPLODE_RADIUS = 4.2; // void-implosion reach (slam)
export const SHADOW_IMPLODE_PULL = 0.45; // fraction of the way to you a foe is yanked
export const SHADOW_IMPLODE_DMG = 2; // collision damage as they crush together

// 🔥 Lava — terrain scorcher (leave the machine burning)
export const LAVA_BUMPER_MULT = 1.6; // reactive off parts — explosive bumper kicks
export const LAVA_SLAM_GLOBS = 6; // fire puddles thrown in a ring on the slam
export const LAVA_SLAM_FIRE_RADIUS = 0.9;
export const LAVA_SLAM_FIRE_LIFE = 3;

// ── THE MELT: the scar a lava ball leaves in the floor it rolls over ─────────
// The steel ball's groove, one substance over: stone that briefly went liquid
// and is setting again behind you. Built on the same stamp-by-DISTANCE rig
// (see carveGroove), so the wake is one continuous line at any framerate, and
// on the same floor-fx list, so it inherits eviction and disposal.
//
// PURELY COSMETIC, deliberately. Lava already scars the machine with fire
// puddles on every fast bounce, which is the hazard; a second damaging surface
// under the ball at ALL times would quietly double the material's floor
// control. What the melt adds is the read, not the reach.
/** Below this you are rolling, not melting — a slow lava ball just glows. */
export const MELT_MIN_SPEED = 7;
/** World-units between stamps. Tighter than GROOVE_SPACING because a melt has
 *  no line of its own to follow: the overlap IS the continuity. */
export const MELT_SPACING = 0.28;
/** Scar half-width. Wider than the groove's cut — heat spreads, a chisel does
 *  not — but still narrower than a fire puddle, which is a POOL. */
export const MELT_RADIUS = 0.46;
/**
 * How long a scar stays on the floor. Far shorter than the groove's 26 s: a rut
 * is structural and the point is that it is still there next lap, while a melt
 * is a burn that the dungeon's own cold takes back. It also has to be short
 * enough that the trail cannot monopolise FLOOR_FX_MAX:
 *
 *     PINBALL_MAX_SPEED 20 u/s ÷ MELT_SPACING 0.28 u = 71 stamps/s
 *     71 stamps/s × MELT_LIFE 2.4 s                  = 171 live decals
 *
 * — inside the 300 budget with room for the fire puddles and slicks that lava
 * runs alongside, where a groove-length melt would have evicted all of them.
 */
export const MELT_LIFE = 2.4;

// Floor-fx (persistent scars)
export const FLOORFX_TICK = 0.4; // seconds between floor-fx damage/status ticks
export const FIRE_PUDDLE_DMG = 1; // per tick (deferred Lava; wired for R&D)
export const FIRE_PUDDLE_LIFE = 3;
export const FIRE_PUDDLE_RADIUS = 0.8;
export const MATERIAL_SELF_HARM_DMG = 1; // player dmg per tick on own hazard (toggle)

// ── SQUASH & STRETCH — the ball DEFORMS on wall contact ──────────
// Only the two fluid materials deform. That contrast is the whole point: if
// diamond and stone squashed too, "made of water" would stop meaning anything.
export const WATER_SQUASH = 1; // a droplet flattens hard and snaps back
export const LAVA_SQUASH = 0.5; // a crusted shell over liquid — it gives, it doesn't splat
/** Seconds for a squash to recover. Short: past ~0.25s it reads as a wobble. */
export const SQUASH_RECOVER = 0.18;
/**
 * Peak compression along the contact at full amplitude (0.3 = 30% flatter).
 * The bulge across it is the RECIPROCAL (≈1.43), so the deformation preserves
 * area exactly; at 0.4 the reciprocal bulge (1.67) read as a water balloon.
 */
export const SQUASH_DEPTH = 0.3;
/** Min impact speed (u/s) that deforms at all — a gentle roll into a wall doesn't. */
export const SQUASH_MIN_SPEED = 5;

// ── 💎 DIAMOND: CUTS, and cannot be broken ───────────────────────
// The hardest thing in the dungeon does not bounce off flesh — it goes through.
/** Momentum (u/s) at which diamond stops ramming and starts CUTTING. */
export const DIAMOND_CUT_SPEED = 7;
/** Damage multiplier on a cut vs an ordinary ram — an edge concentrates force. */
export const DIAMOND_CUT_DMG_MULT = 1.6;
/**
 * Ram re-hit cooldown while cutting, vs BALL_RAM_COOLDOWN.
 * This is the mechanic: a ram hits one clump and pauses, a cut opens a LINE
 * through a crowd. At the normal cooldown diamond just felt like a ram that
 * did more damage.
 */
export const DIAMOND_CUT_COOLDOWN = 0.05;
/** A cut delivers no knockback — the foe is sliced where it stands, not shoved. */
export const DIAMOND_CUT_KNOCKBACK = 0;

// ── 🪨 STONE: smashes masonry by MASS ────────────────────────────
// Deliberately well above diamond's 8/4 and below the bare 15/7: diamond breaks
// walls by being HARD (it barely needs to be moving), stone by being HEAVY (it
// has to be thrown). If these matched, the two would feel like one material.
export const STONE_WALL_BREAK_SPEED = 11;
export const STONE_SECRET_BREAK_SPEED = 5.5;

// ── RICOCHET FORM (entities/ricochet-form.ts) ────────────────────
// A few seconds where the ball is NOT yours: input ignored, high fixed speed,
// every wall contact deflecting randomly. Shared by ⚡ storm's lightning bolt
// and the ✨ laser potion — same behaviour, two flavours.
/** How wide the random deflection is on each bounce, radians (±half this).
 *  A clean mirror reflection traces a tidy billiard path, which is the exact
 *  opposite of "bounces around like crazy" — the jitter IS the effect. */
export const RICOCHET_DEFLECT_JITTER = 1.6;
/** Extra reach past the two bodies before a pass-through hit lands. */
export const RICOCHET_HIT_RADIUS = 0.35;
/** Seconds between damage ticks — without it a foe is hit every frame. */
export const RICOCHET_TICK = 0.12;
/** Momentum handed back when the form ends. Not zero: freezing the player in
 *  place the instant it lapses would waste every bit of speed it built. */
export const RICOCHET_EXIT_SPEED = 9;

// ⚡ Lightning bolt — storm's special (fires off the material slam).
export const BOLT_DURATION = 2.5;
export const BOLT_SPEED = 26;
export const BOLT_DAMAGE = 3;

// ✨ Laser — its own potion. Faster, hits harder, and shorter to pay for it.
export const LASER_DURATION = 2.2;
export const LASER_SPEED = 32;
export const LASER_DAMAGE = 4;
/**
 * THE ZIGZAG. Seconds between mid-air heading kinks.
 *
 * ── IT WAS 0.055s / 0.85rad, AND THAT WAS RIGHT FOR THE OLD TRAIL ──
 * Bouncing off walls alone does not make a laser IF ALL YOU DRAW IS A STUB:
 * between two walls the path is a straight line, and with a 0.12s tail at this
 * speed that line drew as a short beam sliding sideways across the room. A kink
 * every few hundredths of a second fixed it — the ball read as a point of light
 * darting, and the crosses it stamped carried the path.
 *
 * The beam grid (2026-07-29, on request) removes the premise. With the whole
 * cast's path held on screen the straight legs ARE the effect — that is what a
 * spy-movie laser lattice IS — and the old kink rate turned it into a scribble:
 * shot on a real adapter, a 35-corner saw-tooth milled around one corner of the
 * room instead of crossing it, and the accumulated path read as a ball of wool.
 *
 * So the kink is kept but demoted: 0.30s is a ~9.6-unit leg at LASER_SPEED
 * (most of a room crossing) and 0.16rad is a visible lean rather than a turn.
 * The path still is not machined — the legs bend and no two crossings are
 * parallel — while the walls do the rest of the work, which is what was wanted.
 * Both numbers are compared A/B in the same room in the wave notes.
 */
export const LASER_ZIG_PERIOD = 0.3;
/** How far each kink turns, radians. Applied with ALTERNATING sign, so the
 *  heading saws about a mean direction and still crosses the room — a signed
 *  random walk would just wander in place. Small since the beam grid landed:
 *  see LASER_ZIG_PERIOD. */
export const LASER_ZIG_ANGLE = 0.16;
/** World units of travel between stamped laser crosses. Roughly half a leg, so
 *  a leg carries a couple of marks and the corners stay the densest part. */
export const LASER_MARK_STEP = 0.85;
/**
 * Seconds a laser trail point lives — i.e. how long the beam it has already
 * drawn stays on the floor.
 *
 * ── THIS WAS 0.12, AND THE REVERSAL IS THE POINT (2026-07-29, on request) ──
 * The original brief was "a DOT with a stub of tail", with the marks
 * (`vfx.laserMark`) carrying the path, because an EARLY cut drew the path as one
 * long line sliding sideways across the room and that is not what a bolt of
 * light darting looks like.
 *
 * The ask now is the spy-movie laser GRID: the beam bounces off the walls and
 * the beams it has already laid stay up, so what you see accumulates into a
 * lattice you have to look at. That needs the opposite of a stub — near the
 * whole cast, held bright (TRAIL_FADE_HOLD) rather than tapered.
 *
 * 1.9 against LASER_DURATION 2.2 keeps the oldest legs alive almost to the end
 * of the form while still dying back visibly once it lapses, so the lattice
 * fades out instead of blinking off. It also sets the ribbon's capacity
 * requirement: 180 points/sec × 1.9 = 342, which is why TRAIL_POINTS is 448 and
 * why a test now ties the two together.
 */
export const LASER_TRAIL_LIFE = 1.9;

// ── 🔥 LAVA: MELTS masonry (entities/wall-erosion.ts) ────────────
// Walls used to be binary — fast enough to smash, or nothing. Lava introduces
// PARTIAL wall damage, which is a system, not a constant: see wall-erosion.ts.
/** Erosion added per qualifying lava wall-bounce, before the speed scale.
 *  ~4-5 solid hits to breach: "a little bit", per the ask — a melted shortcut
 *  should feel earned, not incidental. */
export const LAVA_MELT_PER_HIT = 0.18;
/** Below this impact speed lava leaves scorch marks but does no structural harm. */
export const LAVA_MELT_MIN_SPEED = 6;
/** Extra erosion per u/s above the minimum — a hard slam melts deeper. */
export const LAVA_MELT_SPEED_SCALE = 0.03;
/** How far a fully-eroded wall has visibly slumped, as a fraction of its height. */
export const WALL_EROSION_MELT_SAG = 0.55;
/** Embers thrown off a melt hit. */
export const WALL_EROSION_EMBERS = 5;

// ── 🌑 SHADOW: phases, slays the phasers, and feeds ──────────────
/**
 * Seconds of "you are inside masonry" tolerated before the eject fires.
 * Phasing OUT of a wall is the whole point; being STUCK in one when the
 * material lapses is an unrecoverable run, so the eject is not optional.
 */
export const SHADOW_PHASE_GRACE = 0.15;
/** Damage multiplier vs the wall-phasing roster (ghost/reaper/wisp). */
export const SHADOW_SLAYER_MULT = 4;
/** HP restored per ram while shadow is up. */
export const SHADOW_LIFESTEAL = 1;
/** Min seconds between lifesteal procs — without it a crowd is a full heal. */
export const SHADOW_LIFESTEAL_CD = 1.2;

// ══ EXPANSION ROSTER (CONTENT_EXPANSION_PLAN.md) ══════════════════
// Reuse existing sprite sheets (tinted) — art is borrowed; behavior is bespoke.
// 🐕 Hound — charger
export const HOUND_HP = 3;
export const HOUND_R = 0.3;
export const HOUND_CONTACT_RANGE = 0.75;
export const HOUND_ATTACK_WINDUP = 0.3;
export const HOUND_ATTACK_COOLDOWN = 1.4;
export const HOUND_SPEED_FACTOR = 1.35;
export const HOUND_FROM_LEVEL = 1; // 2→1 playtest 07-23: floor 1 was zombies-only
export const HOUND_CHARGE_RANGE = 5.5; // starts a charge when you're in this range + line
export const HOUND_CHARGE_WINDUP = 0.45; // telegraph before the dash
export const HOUND_CHARGE_SPEED = 10; // dash speed (tiles/s)
export const HOUND_CHARGE_TIME = 0.5; // dash duration
export const HOUND_CHARGE_DMG = 3;
// 🤢 Bloater — exploder
export const BLOATER_HP = 6;
export const BLOATER_R = 0.4;
export const BLOATER_CONTACT_RANGE = 0.7;
export const BLOATER_ATTACK_WINDUP = 0.4;
export const BLOATER_ATTACK_COOLDOWN = 2;
export const BLOATER_SPEED_FACTOR = 0.62;
export const BLOATER_FROM_LEVEL = 3;
export const BLOATER_BURST_RADIUS = 1.6; // fire puddle radius left on death
// 💀 Necromancer — summoner
export const NECRO_HP = 4;
export const NECRO_R = 0.32;
export const NECRO_CONTACT_RANGE = 4.5; // ranged: kites like a spitter
export const NECRO_ATTACK_WINDUP = 0.5;
export const NECRO_ATTACK_COOLDOWN = 2;
export const NECRO_SPEED_FACTOR = 0.8;
export const NECRO_FROM_LEVEL = 4;
export const NECRO_SUMMON_CD = 4.5; // seconds between raising an add
export const NECRO_SUMMON_MAX = 6; // don't summon past this live-horde count nearby
// 🛡 Warden — cop guard with bouncing bullets
export const WARDEN_HP = 8;
export const WARDEN_R = 0.4;
export const WARDEN_CONTACT_RANGE = 7.5;
export const WARDEN_FIRE_RANGE = 7.5;
export const WARDEN_ATTACK_WINDUP = 0.45;
export const WARDEN_ATTACK_COOLDOWN = 2.0;
export const WARDEN_SPEED_FACTOR = 0.7;
export const WARDEN_FROM_LEVEL = 4;
export const WARDEN_BULLET_SPEED = 9.5;
export const WARDEN_BULLET_DAMAGE = 2;
export const WARDEN_BULLET_BOUNCES = 3;
export const WARDEN_AIM_MISS_ANGLE = 0.40; // ~23 degrees intentional offset
export const WARDEN_SHIELD_RADIUS = 3.5;
export const WARDEN_SHIELD_HP = 3; // legacy absorb
export const WARDEN_PULSE_CD = 3; // legacy cadence
// 🔮 Wisp — evasive
export const WISP_HP = 2;
export const WISP_R = 0.28;
export const WISP_CONTACT_RANGE = 0.7;
export const WISP_ATTACK_WINDUP = 0.3;
export const WISP_ATTACK_COOLDOWN = 1.2;
export const WISP_SPEED_FACTOR = 1.0;
export const WISP_FROM_LEVEL = 3;
export const WISP_BLINK_DIST = 2.6; // teleport distance when hit
export const WISP_BLINK_CD = 0.6; // min seconds between blinks
// ⚡ Sapper — anti-material
export const SAPPER_HP = 3;
export const SAPPER_R = 0.3;
export const SAPPER_CONTACT_RANGE = 0.75;
export const SAPPER_ATTACK_WINDUP = 0.35;
export const SAPPER_ATTACK_COOLDOWN = 1.5;
export const SAPPER_SPEED_FACTOR = 1.1;
export const SAPPER_FROM_LEVEL = 5;
// 💎 Crystalback — reflector (rooted, momentum-gated like a golem)
export const CRYSTAL_HP = 6;
export const CRYSTAL_R = 0.42;
export const CRYSTAL_CONTACT_RANGE = 0.82;
export const CRYSTAL_ATTACK_WINDUP = 0.5;
export const CRYSTAL_ATTACK_COOLDOWN = 1.5;
export const CRYSTAL_FROM_LEVEL = 4;
export const CRYSTAL_SHARDS = 7; // shards sprayed at YOU when rammed at speed
export const CRYSTAL_SHARD_DMG = 2;
// 🪞 Mimic — ambusher
export const MIMIC_HP = 4;
export const MIMIC_R = 0.34;
export const MIMIC_CONTACT_RANGE = 0.72;
export const MIMIC_ATTACK_WINDUP = 0.25;
export const MIMIC_ATTACK_COOLDOWN = 1.4;
export const MIMIC_SPEED_FACTOR = 1.3;
export const MIMIC_FROM_LEVEL = 3;
export const MIMIC_WAKE_RANGE = 1.7; // dormant until you step this close
