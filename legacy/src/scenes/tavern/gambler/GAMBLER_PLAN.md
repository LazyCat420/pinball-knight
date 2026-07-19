# The Gambler — four pixel games in the tavern

_Live plan. Delete when all four ship._

A sixth tavern station at **(3.0, 5.6)** — beside the stair you arrive on, off
the walking spine, clear of every other station's interaction radius (verified
against `layout.ts`). You land in the tavern flush with the floor's gold and the
gambler is the first thing you pass; the shops sit between it and the exit, so a
loss has a visible cost — you can't afford the card you wanted. Gambling
leftovers on the way *out* would be a much weaker beat.

Walk up → `[E]` → pick a game → bet gold → play.

---

## The economy is the hard constraint

Everything below is shaped by numbers that already exist:

| | |
|---|---|
| Gold per floor | ~80–200 (kills 2g · jackpot 45g · frenzy 20g · bank 25g · targets 4g · lit bumpers 3g · descent 10g) |
| Card prices | 20 / 60 / 140 / **320** / **600** |
| Legendary drop | floor-5+ boss only, 50%, **once per run** |
| Epic drop | boss or gold wall, 30% |

Two consequences:

1. **A stake of 10–50g is meaningful.** One good pull is a rare card; a bad run
   is the epic you were saving for. No need for big numbers to create tension.
2. **The house must win on average, or the card economy dies.** If gambling has
   positive expected value it becomes the optimal way to buy mythics, and both
   the shop and the boss reward loop stop mattering.

### The house edge is a gradient, and skill is the axis

This is the design's spine. The more the game rewards *playing well*, the better
it pays back — the same lesson the dungeon already teaches.

| Game | Skill | Target RTP | House edge |
|---|---|---|---|
| Slots | none | ~90% | 10% |
| Roulette | bet choice only | ~95% | 5% |
| Blackjack | real decisions | ~98% | 2% |
| Darts | pure execution | player-determined | ~0% at perfect play |

A player who only ever pulls the slot lever slowly bleeds gold. A player who
gets good at darts can farm it — which is why darts needs the table limit below,
and why its payout curve must be steep rather than generous.

### Table limit

**Six rounds per tavern visit**, then the gambler waves you off ("that's enough
from you tonight"). Without it, any skill game is an infinite gold faucet: the
tavern is entered once per floor, so unlimited rounds means unlimited farming
for anyone who masters darts or blackjack basic strategy.

Also: **min stake 5g, max stake `min(100, floor(purse / 2))`**. The purse
fraction stops a floor-1 player nuking their whole run in one pull; the flat cap
stops a floor-10 player trivialising the shop.

---

## Architecture

Same split that has worked everywhere else this session: **pure logic in its own
module, rendering separate.** The logic is where the money is, so the logic is
what gets tested — odds, payouts and hand resolution are all assertable without
a canvas.

```
src/scenes/tavern/gambler/
  index.ts        Station entry + the game-select cabinet
  table.ts        Shared: stake selector, purse, round limit, payout resolution
  slots.ts        Pure: reel strips, spin, paytable
  roulette.ts     Pure: wheel, bet types, payout
  blackjack.ts    Pure: deck, deal, hit/stand/double, dealer policy, settle
  darts.ts        Pure: board scoring, throw resolution
  cards-art.ts    Pixel playing-card faces (NEW — no card art exists in the repo)
  render.ts       The cabinet shell + per-game draw routines
```

Reused as-is: `src/pixel/pixel-canvas.ts` (crisp low-res surface, integer blit),
`pixel-font.ts` (`labelFont`/`numFont`), `utils/gold-wallet.ts`
(`getBalance`/`spendGold`/`addGold`), and the tavern's station + prompt plumbing.

**Every game renders through `createPixelSurface`** — low logical resolution,
whole-number upscale, smoothing off. Same rule as the maps: never DPR-scale.

---

## 1. SLOTS — "The One-Armed Bandit"

Pure chance, fast, the worst odds in the house. The game you play when you don't
want to think.

**Theme.** Reels of pinball hardware, not fruit: `● BALL`, `◉ BUMPER`,
`⌒ FLIPPER`, `◆ TARGET`, `★ JACKPOT`, `☠ SKULL`.

**Mechanic.** Stake, pull the lever, three reels stop **left to right in
sequence** — the pause between reel 2 and reel 3 is the entire drama and is
worth animating properly.

**Paytable** (3-of-a-kind unless noted):

| Line | Pays |
|---|---|
| ★ ★ ★ | 40× |
| ◆ ◆ ◆ | 12× |
| ⌒ ⌒ ⌒ | 8× |
| ◉ ◉ ◉ | 5× |
| ● ● ● | 3× |
| any two ★ | 2× |
| ☠ anywhere | 0 (the reel strip's tax) |

Tuned by **weighted reel strips**, not by a flat symbol roll — that's how real
machines hit a target RTP, and it lets ★ be visibly present on the reel while
still being rare. `slots.ts` exposes the strips so a test can Monte-Carlo the
RTP and assert it lands near 90%.

**Pixel.** Three reel windows in a chunky cabinet, symbols scrolling with motion
blur faked as vertical smear, a lever that pulls down and springs back.

---

## 2. ROULETTE — "The Orbit Wheel"

Chance, but you choose your risk. Themed as a pinball **orbit**: the ball rides
the outer rail, loses speed, drops into a pocket.

**Wheel.** Not a real 37-pocket wheel — unreadable at pixel scale. **13 pockets:
0 plus 1–12**, red/black alternating, 0 green. That keeps a single-number bet at
a believable 12:1 while fitting the display.

**Bets.**

| Bet | Pays | True odds | Edge |
|---|---|---|---|
| Single number | 11:1 | 12:1 | 7.7% |
| Red / Black | 1:1 | 12:13 | 7.7% |
| Odd / Even | 1:1 | 12:13 | 7.7% |
| Low (1–6) / High (7–12) | 1:1 | 12:13 | 7.7% |
| Column (1–4, 5–8, 9–12) | 2:1 | 4:13 | 7.7% |

Every bet carries the same edge, which is the correct roulette property — the
choice is about **variance**, not value. If the 7.7% is too steep next to the
5% target, widen to 0 + 1–18 and re-derive.

**Pixel.** The wheel as a ring of pockets drawn in the game's palette, the ball
a single bright pixel orbiting and slowing with real deceleration, then a
settle-bounce into its pocket.

---

## 3. BLACKJACK — "Twenty-One"

The thinking game, and the best odds in the house for a player who knows what
they're doing.

**Rules** (deliberately trimmed):

- Single deck, reshuffled every round (keeps it stateless and kills counting).
- Dealer stands on all 17, including soft 17.
- Blackjack pays **3:2**.
- **Hit / Stand / Double** only — no splits, no insurance, no surrender. Splits
  need a second hand's worth of UI and state for a marginal decision.
- Double allowed on any two cards.

**Why these.** Dealer-stands-soft-17 plus 3:2 blackjack is roughly 99.5% RTP
under perfect basic strategy; dropping splits costs the player ~0.5%. That lands
near the 98% target while leaving the skill ceiling real.

**Pixel.** Needs **new art**: there are no playing cards anywhere in the repo.
Small pixel faces — rank in the corner, a suit pip, red/black in the palette.
Face cards get a simple crown/figure glyph rather than portrait art, which does
not survive at this resolution.

---

## 4. DARTS — "The Board"

Pure execution. No RNG at all in the outcome — the only game here you can
actually beat, which is why it is capped hardest.

**Mechanic.** Two-axis timing, the classic arcade solution and a natural fit for
a game already built on timed skill shots:

1. A horizontal bar sweeps → click to lock X.
2. A vertical bar sweeps → click to lock Y.
3. The dart lands there. Three darts per round.

Sweep speed scales with the stake — **the bigger the bet, the faster the bar** —
so risk is something you feel in your hands rather than a number you read. This
is the same idea the plunger wager was built on and it is the best mechanic in
the set.

**Board** (concentric, pixel rings):

| Ring | Points |
|---|---|
| Bullseye | 50 |
| Outer bull | 25 |
| Triple ring | 3× wedge |
| Double ring | 2× wedge |
| Single | wedge value |
| Off board | 0 |

**Payout** by three-dart total, steep so only genuinely good play profits:

| Total | Pays |
|---|---|
| 100+ | 4× |
| 75–99 | 2.5× |
| 50–74 | 1.5× |
| 30–49 | 1× (push) |
| < 30 | 0 |

**Pixel.** Board as concentric rings with wedge dividers, the sweeping bars as
chunky meters, darts sticking where they land and staying for the round.

---

## Build order

1. ✅ **`table.ts` + the station + cabinet shell.** Station at (3.0, 5.6) with an
   arcade-cabinet prop; stake selector, purse, round counter, net, payout
   plumbing. Browser-verified: walk up, bet, gold moves, limit closes the table.
2. ✅ **Slots.** Weighted strip tuned to ~90% RTP by enumeration, hand-authored
   pixel symbols, sequential reel stops.
3. ⬜ **Roulette.** Reuses the shell; adds bet-type selection.
4. ⬜ **Darts.** The best mechanic, and the one worth the most polish.
5. ⬜ **Blackjack.** Last: most logic, and it needs the new card art.

### Notes from building 1–2

- **Compute the RTP; never eyeball it.** The first slots paytable read as
  reasonable and enumerated to 13%.
- **Unicode glyphs are not pixel art.** The first symbols were `●◉⌒◆★☠` in Press
  Start 2P, which has none of them — every one silently fell back to a system
  face and rendered smooth. Anything drawn in the cabinet must be hand-authored
  pixel runs (`symbols.ts`) or it will quietly not match the game.
- **Decide the outcome before the animation starts.** `slots-game.ts` rolls on
  `play()`, so the reels can never land on something other than what was paid.
- **A refused bet must SAY so.** The first shell computed refusal messages and
  discarded them; a dead button reads as a broken one.

Each game ships with its pure logic tested before its renderer exists — for the
chance games that means a Monte-Carlo RTP assertion, which is the only way to
know the tuning is right rather than merely plausible.

## Rules

- **The house edge is not optional.** Any change to a paytable re-runs the RTP
  test. A game that pays over 100% is a bug, not a feature.
- Never let a game write gold directly — everything goes through `table.ts` so
  the round limit and stake caps cannot be bypassed.
- Losing must be legible: show the stake leaving the purse, and say why you lost.
- No game may award **cards** — gold only. Cards are the boss/shop economy and
  a gambling faucet would gut both.
