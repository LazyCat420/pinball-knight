/**
 * THE ` CONSOLE'S SKILL / POWERUP SURFACE.
 *
 * `debug-panel.test.ts` guards the spawn roster's COVERAGE. This file guards the
 * three sections added on 2026-07-29 (POWERUPS, ABILITIES, SKILL TREE), and it
 * asks two different questions:
 *
 *  1. DOES THE CHIP STILL SAY WHAT IT IS? The dock is 232 UI pixels wide and
 *     8px Press Start 2P is monospace, so every caption has a hard character
 *     budget. Overflow is not a crash — `ellipsize` quietly trims it — so a new
 *     potion called "Thunderous Draught" ships as "THUNDERO…" and nobody finds
 *     out. The budgets below are computed from the real layout arithmetic and
 *     the captions come from the SAME functions the screen paints with, not
 *     from re-derived copies.
 *
 *  2. DOES THE VERB ACTUALLY REVERSE? These controls cycle, and a console whose
 *     OFF state is not off is worse than no console — you would tune against a
 *     rule you thought you had turned off. Revoking an ability unlock is the
 *     sharp edge: `spendSkillPoint` pushes into `state.unlockedAbilities`
 *     (correctly — a purchase is permanent), and the debug path must NOT, or
 *     cycling the node back to 0 leaves the spell castable forever.
 */
import { describe, expect, it, beforeEach } from "vitest";
import { state, resetState } from "./state";
import { ABILITIES, ABILITY_IDS, abilityRank, type AbilityId } from "./abilities";
import { ABILITY_RANK_MAX } from "./constants";
import { POTIONS, POTION_IDS } from "./items";
import { SKILLS, SKILL_IDS, SKILL_BRANCHES, isKeystone } from "./skills";
import { KIND_IDS } from "./bestiary";
import { invalidateSkillAgg, playerManaMax, unlockedAbilities } from "./skill-runtime";
import {
  BED_LABEL,
  BIND_CHARS,
  CHIP_CHARS,
  HEAD_CHARS,
  ROW_CHARS,
  SECTION,
  SKILL_ACTS,
  SOUND_ACTS,
  monsterChipLabel,
  potionChipLabel,
  sfxChipLabel,
  skillChipLabel,
  soundHeading,
} from "./gui/screens/debug";
import { SFX_NAMES } from "./sfx/registry";
import { setSfxMuted, setSfxVolume } from "./sfx";
import { setGlobalMute } from "../../utils/audio-manager";
import {
  debugCycleAbilityRank,
  debugCycleSkillRank,
  debugClearSkills,
  debugFillMana,
  debugGiveAbility,
  debugMaxSkills,
} from "./dev/debug-actions";

beforeEach(() => {
  resetState();
  state.skillRanks = {};
  state.abilityRanks = {} as Record<AbilityId, number>;
  state.unlockedAbilities = ["flippercharge", "arcanepulse"];
  state.abilitySlots = ["flippercharge", "arcanepulse"];
  invalidateSkillAgg();
});

describe("console captions fit the dock", () => {
  it("gives every potion a caption that fits a two-column chip", () => {
    for (const id of POTION_IDS) {
      const label = potionChipLabel(id);
      expect(label.trim(), `${id} has no caption`).not.toBe("");
      expect(label.length, `potion "${label}" (${id}) overflows the chip — add a POTION_LABEL override`).toBeLessThanOrEqual(CHIP_CHARS);
    }
  });

  it("gives every monster a caption that fits a two-column chip", () => {
    // debug-panel.test.ts already checks the monster chips against 16
    // characters. That number was never the dock's: five names were shipping
    // ellipsized under it, so this asserts the same roster against the width the
    // panel actually has. The two guards do not conflict — 8 is stricter — but
    // the 16 is the one that let it through.
    for (const kind of KIND_IDS) {
      const label = monsterChipLabel(kind);
      expect(label.trim(), `${kind} has no caption`).not.toBe("");
      expect(label.length, `monster "${label}" (${kind}) overflows the chip — add a LABEL_OVERRIDE`).toBeLessThanOrEqual(CHIP_CHARS);
    }
  });

  it("gives every tree node a caption that fits a full-width row, rank included", () => {
    for (const id of SKILL_IDS) {
      // maxRank is the widest the rank suffix ever gets ("3/3" is no wider than
      // "0/3", but a two-digit maxRank would be).
      const label = skillChipLabel(id, SKILLS[id].maxRank);
      expect(label.length, `skill row "${label}" (${id}) overflows the dock`).toBeLessThanOrEqual(ROW_CHARS);
    }
  });

  it("keeps the hand-written captions inside their controls too", () => {
    // These are the three that actually shipped ellipsized — a written label
    // overflows exactly as easily as a generated one.
    for (const s of Object.values(SECTION)) {
      expect(s.length, `section heading "${s}" is wider than the dock and CLIPS`).toBeLessThanOrEqual(HEAD_CHARS);
    }
    // The dynamic one, at its widest.
    expect(`SPAWN — x${8}`.length).toBeLessThanOrEqual(HEAD_CHARS);
    // Branch headings come from the tree, not from SECTION.
    for (const b of SKILL_BRANCHES) expect(b.toUpperCase().length).toBeLessThanOrEqual(HEAD_CHARS);
    for (const c of Object.values(SKILL_ACTS)) {
      expect(c.length, `chip "${c}" overflows a half-row button`).toBeLessThanOrEqual(CHIP_CHARS);
    }
  });

  it("gives every sting a caption that fits a two-column chip", () => {
    // Same silent failure as the potions: `ellipsize` trims "ZOMBIEDI…" and the
    // panel keeps working. The audition panel is the ONE place a sting's name is
    // ever read, so a trimmed one costs the whole point of the section.
    for (const name of SFX_NAMES) {
      const label = sfxChipLabel(name);
      expect(label.length, `sting "${label}" (${name}) overflows the chip — add an SFX_LABEL override`).toBeLessThanOrEqual(
        CHIP_CHARS,
      );
    }
  });

  it("keeps the sound heading inside the dock in all three silent states", () => {
    // The heading is the panel's answer to "is it broken or is it off", so it
    // must be readable in exactly the states where that question is asked.
    setGlobalMute(false);
    setSfxMuted(false);
    setSfxVolume(1);
    expect(soundHeading()).toBe("SOUND — VOL 100%");
    setSfxMuted(true);
    expect(soundHeading()).toBe("SOUND — MUTED");
    setSfxMuted(false);
    setGlobalMute(true);
    expect(soundHeading()).toBe("SOUND — APP MUTED");
    setGlobalMute(false);
    for (const v of [0, 0.25, 0.5, 1]) {
      setSfxVolume(v);
      expect(soundHeading().length, `"${soundHeading()}" CLIPS off the dock`).toBeLessThanOrEqual(HEAD_CHARS);
    }
    for (const c of Object.values(SOUND_ACTS)) {
      expect(c.length, `sound control "${c}" overflows its row`).toBeLessThanOrEqual(ROW_CHARS);
    }
    // The bed latches sit in the same two-column grid as the stings.
    for (const c of Object.values(BED_LABEL)) {
      expect(c.length, `bed chip "${c}" overflows the chip`).toBeLessThanOrEqual(CHIP_CHARS);
    }
  });

  it("gives every ability a caption that fits beside its rank button", () => {
    for (const id of ABILITY_IDS) {
      // "Q·" is prefixed when the ability is bound, and that is the widest case.
      const label = `Q·${ABILITIES[id].label.toUpperCase()}`;
      expect(label.length, `ability row "${label}" (${id}) overflows the bind button`).toBeLessThanOrEqual(BIND_CHARS);
    }
  });
});

describe("keystones are recognised by shape", () => {
  it("flags exactly the three rule-changing nodes", () => {
    const flagged = SKILL_IDS.filter((id) => isKeystone(SKILLS[id]));
    expect(flagged.sort()).toEqual(["bloodprice", "cinderwake", "dynamo"]);
  });

  it("flags nothing that only prints a number", () => {
    for (const id of ["whetstone", "manawell", "overdrive", "unlockmagnet"]) {
      expect(isKeystone(SKILLS[id]), `${id} is not a keystone`).toBe(false);
    }
  });
});

describe("MAX SKILLS", () => {
  it("maxes every ordinary node and every ability rank", () => {
    debugMaxSkills();
    for (const id of SKILL_IDS) {
      if (isKeystone(SKILLS[id])) continue;
      expect(state.skillRanks[id], `${id} was not maxed`).toBe(SKILLS[id].maxRank);
    }
    for (const id of ABILITY_IDS) expect(abilityRank(id), `${id} rank`).toBe(ABILITY_RANK_MAX);
  });

  it("takes no keystone — a drawback you did not ask for is a bug you will chase", () => {
    debugMaxSkills();
    for (const id of SKILL_IDS) {
      if (!isKeystone(SKILLS[id])) continue;
      expect(state.skillRanks[id] ?? 0, `${id} was taken by MAX SKILLS`).toBe(0);
    }
  });

  it("spends no skill points, so the menu is unaffected by a debug poke", () => {
    state.skillPoints = 4;
    debugMaxSkills();
    debugCycleSkillRank("whetstone");
    debugCycleAbilityRank("arcanepulse");
    expect(state.skillPoints).toBe(4);
  });

  it("is undone by CLEAR", () => {
    debugMaxSkills();
    debugClearSkills();
    expect(state.skillRanks).toEqual({});
    for (const id of ABILITY_IDS) expect(abilityRank(id)).toBe(0);
  });
});

describe("rank cycling", () => {
  it("walks a node up to maxRank and wraps back to nothing", () => {
    const def = SKILLS.whetstone; // maxRank 3
    for (let r = 1; r <= def.maxRank; r++) {
      expect(debugCycleSkillRank("whetstone")).toBe(r);
    }
    expect(debugCycleSkillRank("whetstone")).toBe(0);
    expect(state.skillRanks.whetstone).toBeUndefined();
  });

  it("ignores prerequisites — the whole point of a console", () => {
    // bloodprice sits three nodes deep behind whetstone → ironheart → juggernaut.
    expect(debugCycleSkillRank("bloodprice")).toBe(1);
    expect(state.skillRanks.whetstone ?? 0).toBe(0);
  });

  it("walks an ability rank up and wraps", () => {
    for (let r = 1; r <= ABILITY_RANK_MAX; r++) {
      expect(debugCycleAbilityRank("arcanepulse")).toBe(r);
    }
    expect(debugCycleAbilityRank("arcanepulse")).toBe(0);
  });
});

describe("an unlock cycled back to 0 is REVOKED", () => {
  it("grants the ability while the node is held", () => {
    debugCycleSkillRank("unlocktimecrawl");
    expect(unlockedAbilities()).toContain("timecrawl");
  });

  it("takes it away again — and takes its Q/E binding with it", () => {
    debugCycleSkillRank("unlocktimecrawl");
    state.abilitySlots[0] = "timecrawl";
    debugCycleSkillRank("unlocktimecrawl"); // maxRank 1, so this wraps to 0
    expect(unlockedAbilities()).not.toContain("timecrawl");
    expect(state.abilitySlots[0], "a slot still bound to a revoked ability would cast it for free").toBeNull();
  });
});

describe("GIVE ABILITY binds on Q", () => {
  it("puts the ability on Q and slides the old Q over to E", () => {
    debugGiveAbility("bladestorm");
    expect(state.abilitySlots).toEqual(["bladestorm", "flippercharge"]);
    debugGiveAbility("timecrawl");
    expect(state.abilitySlots).toEqual(["timecrawl", "bladestorm"]);
  });

  it("unlocks it, ready to cast", () => {
    state.abilityCd.bladestorm = 9;
    debugGiveAbility("bladestorm");
    expect(unlockedAbilities()).toContain("bladestorm");
    expect(state.abilityCd.bladestorm).toBe(0);
  });

  it("never lands the same ability on both keys", () => {
    debugGiveAbility("bladestorm");
    debugGiveAbility("bladestorm");
    expect(state.abilitySlots).toEqual(["bladestorm", "flippercharge"]);
  });

  it("re-binding what is on E moves it to Q without cloning it", () => {
    debugGiveAbility("arcanepulse"); // starts on E
    expect(state.abilitySlots).toEqual(["arcanepulse", "flippercharge"]);
  });
});

describe("FILL MANA", () => {
  it("fills the pool to the tree-adjusted maximum, not to a hardcoded 100", () => {
    state.player = { mana: 0 } as unknown as typeof state.player;
    debugCycleSkillRank("manawell"); // +15 max mana per rank
    debugFillMana();
    expect(state.player?.mana).toBe(playerManaMax());
    expect(state.player?.mana).toBeGreaterThan(100);
  });

  it("does nothing without a player, rather than throwing into the paint loop", () => {
    state.player = null;
    expect(() => debugFillMana()).not.toThrow();
  });
});

describe("the potion roster is the whole table", () => {
  it("offers every potion in POTIONS, including the ones with no other supply", () => {
    const missing = Object.keys(POTIONS).filter((id) => !(POTION_IDS as string[]).includes(id));
    expect(missing, `POTION_IDS is missing: ${missing.join(", ")}`).toEqual([]);
    // The reason this section exists: the laser is a finished mechanic with no
    // floor spawn, no shop row and no recipe. If it ever gains one, this line is
    // free to go — but it must never silently drop out of the console.
    expect(POTION_IDS).toContain("laser");
  });
});
