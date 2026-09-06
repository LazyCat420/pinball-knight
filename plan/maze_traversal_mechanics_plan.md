# Plan — Chaotic Maze Traversal & Shortcut Mechanics

**Date:** 2026-09-06  
**Status:** BRAINSTORM & PLAN ONLY — Awaiting User Feedback & Selection  
**Target:** `ThreeJS/src/game/pinball-knight/` (and Rust engine parity)

---

## 1. Overview & Core Philosophy

Following the successful addition of the **Seesaw shortcut apparatus** and the existing **Jumppad** kickers, the goal is to introduce high-energy, kinetic traversal devices that give players wild, memorable shortcuts across the maze.

Rather than standard linear walking, these mechanics embrace the game's pinball DNA: extreme velocity, verticality, ballistic trajectories, unpredictability, and satisfying impact physics.

---

## 2. The 3 Traversal Concepts

### Concept 1: The Siege Catapult ("Goblin Flinger")
*High-altitude ballistic toss to a random safe corridor.*

* **Visual Design**:
  - Heavy timber frame with reinforced iron bands, pivot arm, stone counterweight bucket, and a leather/rope basket on the ground.
  - Placed at corridor dead ends or courtyard corners.
* **Mechanic**:
  1. **Trigger**: Walking into the basket locks the knight in place for 0.25s as the ratchet winds with a loud mechanical `CLINK-CLINK`.
  2. **Launch**: The counterweight slams down and hurls the knight into a towering parabolic arc.
  3. **Ballistic Flight**:
     - The knight flies high in the air ($Y \approx 10$), soaring cleanly over walls and rooms.
     - The destination is a randomly selected safe walkable tile on the current floor (guaranteed non-wall, non-pit, non-hazard, with a minimum distance threshold of $\ge 15$ tiles so it always transports you across the map).
     - Camera pulls out slightly to track the flying knight with wind trail particles.
  4. **Meteor Landing**:
     - Smashes down onto the destination tile with a radial shockwave that stuns / knocks back nearby monsters.
     - Knight performs a quick recovery roll before regaining normal movement.
* **Fun Factor**: High-energy escape button or random gamble that can drop you into unexplored territory or right past a locked door!

---

### Concept 2: The Aimable Barrel Cannon ("Dungeon Howitzer")
*Player-timed directional cannon blast that pierces enemies and smashes secret walls.*

* **Visual Design**:
  - Heavy cast-iron swivel cannon mounted on a brass azimuth gear ring with glowing directional runes.
  - Positioned at 3-way/4-way corridor intersections or facing long hallways.
* **Mechanic**:
  1. **Trigger**: Walking into the cannon swallows the knight inside.
  2. **Aiming Phase**: The cannon steadily pans back and forth across a 180° sweep (or aligns with directional arrow keys), with an aiming beam pointing down potential corridors.
  3. **Player Blast**: The player presses `Space` / `Attack` to fire!
  4. **Cannonball Rush**:
     - Knight shoots out as a spinning, flaming human pinball at hyper velocity ($V \approx 28$).
     - Bowls through enemies like bowling pins, dealing kinetic impact damage.
     - Smashes through special cracked or secret wall tiles to open hidden shortcut alcoves!
     - Ricochets off solid walls with pinball sparks until slowing down to normal speed.
* **Fun Factor**: Pure arcade skill shot — rewards timing and geometry with explosive enemy clearing and secret room discovery.

---

### Concept 3: The Minecart Blitz ("Dungeon Rollercoaster")
*Fixed-track high-speed rail shortcut piercing through walls and chasms.*

* **Visual Design**:
  - Rusted narrow-gauge iron rails mounted on wooden ties, traversing through wall cuts, over pits, or around plaza perimeters.
  - A weathered iron ore cart parked at the start station buffer.
* **Mechanic**:
  1. **Trigger**: Walking into the cart hops the knight inside.
  2. **Rail Surge**: The cart rockets forward down the tracks with grinding sparks, screen shake, and clattering iron sounds.
  3. **Passage**: Curves through wall tunnels and over hazards that are completely impassable on foot.
  4. **Switch Lever**: Optional track switch lever along the route: swinging your weapon flips the switch onto an alternate branch or secret vault!
  5. **Terminal Ejection**: Cart hits the end buffer block and launches the knight forward onto their feet.
* **Fun Factor**: Thrilling rollercoaster ride that turns a complex maze wing into an exhilarating speedrun line.

---

## 3. Open Questions & User Choices

1. **Which concepts would you like to build?**
   - Option A: **The Catapult** first.
   - Option B: **The Catapult + Aimable Barrel Cannon**.
   - Option C: **All 3** (Catapult, Barrel Cannon, and Minecart Blitz).
2. **Catapult Landing Distance**:
   - Should there be a minimum distance (e.g. at least 15–20 tiles away) so it always feels like a major map relocation, or purely unconstrained random walkable tile?
3. **Cannon Aiming**:
   - Continuous automatic sweep back and forth (press Space to time your shot)?
   - Or direct manual steering with directional keys?
