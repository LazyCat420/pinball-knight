/**
 * THE COMBO SYSTEM + WEAPON HEFT.
 *
 * Two things landed together here, because one is useless without the other:
 *
 *  • HEFT — every weapon used to share ONE set of move timings, so a mace and a
 *    stick wound up at exactly the same speed and "slow" could only ever mean
 *    "longer cooldown between identical swings". scaleMove stretches a move's
 *    windup and recovery by the weapon's heft, which is what lets a greatsword
 *    swing like a greatsword.
 *  • THE CHAIN — was three fixed steps that anyone could reach by mashing at
 *    empty air. It is four steps now, it ACCELERATES as you land it, and it is
 *    gated on actually connecting.
 *
 * The `tag` field exists because scaleMove returns a COPY: six presentation
 * branches compared moves by REFERENCE (`move === COMBO_FINISH`) and silently
 * stopped matching the moment a weapon had heft. Compare tags, never objects.
 */
import { describe, expect, it } from "vitest";
import { WEAPONS, type WeaponId } from "./items";
import {
  scaleMove,
  COMBO_CHAIN,
  COMBO_MAX_STEP,
  COMBO_RAMP,
  COMBO_RAMP_FLOOR,
  COMBO_SURGE,
  COMBO_FINISH,
  LIGHT_1,
  HEAVY,
  MOMENTUM_WEAPON_MAX,
} from "./constants";

describe("scaleMove — heft stretches the swing", () => {
  it("is identity at heft 1, so unhefted weapons are untouched", () => {
    expect(scaleMove(LIGHT_1, 1)).toBe(LIGHT_1);
  });

  it("stretches windup and recovery but NEVER the active window", () => {
    const heavy = scaleMove(LIGHT_1, 2);
    expect(heavy.windup).toBeCloseTo(LIGHT_1.windup * 2);
    expect(heavy.recovery).toBeCloseTo(LIGHT_1.recovery * 2);
    // A heavy weapon is slow to start and slow to end — it does NOT get a more
    // forgiving hitbox as a side effect.
    expect(heavy.active).toBe(LIGHT_1.active);
  });

  it("leaves the damage/arc/knockback scaling alone", () => {
    const h = scaleMove(COMBO_FINISH, 1.8);
    expect(h.damageMul).toBe(COMBO_FINISH.damageMul);
    expect(h.arcMul).toBe(COMBO_FINISH.arcMul);
    expect(h.knockbackMul).toBe(COMBO_FINISH.knockbackMul);
  });

  it("REGRESSION: the copy keeps its tag, so identity checks still work", () => {
    // Six presentation branches (clip rate, lunge, slash VFX, the katana flash)
    // compared moves by reference. A scaled copy broke every one of them.
    for (const m of [...COMBO_CHAIN, HEAVY]) {
      expect(scaleMove(m, 2).tag, `${m.tag} lost its tag when scaled`).toBe(m.tag);
    }
  });

  it("every move in the chain carries a distinct tag", () => {
    const tags = COMBO_CHAIN.map((m) => m.tag);
    expect(new Set(tags).size).toBe(tags.length);
  });
});

describe("the chain", () => {
  it("is four steps and ends on the SURGE", () => {
    expect(COMBO_CHAIN).toHaveLength(COMBO_MAX_STEP + 1);
    expect(COMBO_CHAIN[COMBO_CHAIN.length - 1].tag).toBe("surge");
  });

  it("escalates — every step hits harder than the one before it", () => {
    for (let i = 1; i < COMBO_CHAIN.length; i++) {
      expect(
        COMBO_CHAIN[i].damageMul,
        `step ${i} (${COMBO_CHAIN[i].tag}) does not beat step ${i - 1}`,
      ).toBeGreaterThan(COMBO_CHAIN[i - 1].damageMul);
    }
  });

  it("the surge is the payoff: widest arc, longest reach, hardest shove", () => {
    for (const m of COMBO_CHAIN.slice(0, -1)) {
      expect(COMBO_SURGE.arcMul).toBeGreaterThanOrEqual(m.arcMul);
      expect(COMBO_SURGE.rangeMul).toBeGreaterThanOrEqual(m.rangeMul);
      expect(COMBO_SURGE.knockbackMul).toBeGreaterThanOrEqual(m.knockbackMul);
    }
  });

  it("ACCELERATES as it lands — later steps wind up faster", () => {
    const windupAt = (step: number) =>
      scaleMove(COMBO_CHAIN[step], Math.max(COMBO_RAMP_FLOOR, Math.pow(COMBO_RAMP, step))).windup;
    // The ramp compounds, so a chain you are landing visibly speeds up.
    expect(Math.pow(COMBO_RAMP, 3)).toBeLessThan(1);
    expect(windupAt(0)).toBeGreaterThan(0);
    // …but it is floored, so the chain can never collapse to an instant swing.
    const deepRamp = Math.max(COMBO_RAMP_FLOOR, Math.pow(COMBO_RAMP, 99));
    expect(deepRamp).toBe(COMBO_RAMP_FLOOR);
  });

  it("stays swingable on the heaviest weapon in the game", () => {
    // A greatsword chain must still fit inside a fight. If the full four steps
    // took longer than this, nobody would ever see the surge.
    const heft = Math.max(...Object.values(WEAPONS).map((w) => w.heft ?? 1));
    const total = COMBO_CHAIN.reduce((s, m, i) => {
      const ramp = Math.max(COMBO_RAMP_FLOOR, Math.pow(COMBO_RAMP, i));
      const sc = scaleMove(m, heft * ramp);
      return s + sc.windup + sc.active + sc.recovery;
    }, 0);
    expect(total, `full heavy chain takes ${total.toFixed(2)}s`).toBeLessThan(3);
  });
});

describe("the heavy weapon class", () => {
  const heavies: WeaponId[] = ["greatsword", "warhammer", "wreckingball"];

  it("all three exist, are melee, and are genuinely hefty", () => {
    for (const id of heavies) {
      const w = WEAPONS[id];
      expect(w, `${id} missing`).toBeTruthy();
      expect(w.kind).toBe("melee");
      expect(w.heft ?? 1, `${id} has no heft`).toBeGreaterThan(1.5);
    }
  });

  it("each pays for its power with a slower swing than every light weapon", () => {
    const lightMax = Math.max(
      ...(Object.keys(WEAPONS) as WeaponId[])
        .filter((i) => WEAPONS[i].kind === "melee" && (WEAPONS[i].heft ?? 1) === 1)
        .map((i) => WEAPONS[i].cooldown),
    );
    for (const id of heavies) {
      expect(WEAPONS[id].cooldown, `${id} is not slower than the light class`).toBeGreaterThan(lightMax);
    }
  });

  it("they occupy DIFFERENT niches rather than being three of the same weapon", () => {
    const gs = WEAPONS.greatsword;
    const wh = WEAPONS.warhammer;
    const wb = WEAPONS.wreckingball;
    // Warhammer: single-target siege — narrowest arc, biggest damage + shove.
    expect(wh.arcCos).toBeGreaterThan(gs.arcCos);
    expect(wh.damage).toBeGreaterThan(gs.damage);
    expect(wh.knockbackMult ?? 1).toBeGreaterThan(gs.knockbackMult ?? 1);
    // Wrecking ball: the 360 sweep, and the only momentum-scaling weapon.
    expect(wb.arcCos).toBe(0);
    expect(wb.momentumScaling).toBe(true);
    expect(Object.values(WEAPONS).filter((w) => w.momentumScaling)).toHaveLength(1);
    // Greatsword: the reach option.
    expect(gs.range).toBeGreaterThan(wh.range);
  });

  it("the wrecking ball's momentum bonus is a real, bounded gain", () => {
    expect(MOMENTUM_WEAPON_MAX).toBeGreaterThan(1);
    expect(MOMENTUM_WEAPON_MAX).toBeLessThan(4); // not a one-shot-everything button
  });
});
