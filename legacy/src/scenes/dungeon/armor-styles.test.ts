import { beforeEach, describe, expect, it } from "vitest";
import {
  ARMOR_STYLES,
  ARMOR_STYLE_IDS,
  ELEMENTAL_STYLE_IDS,
  __resetArmorStylesCache,
  activeStyle,
  isStyleUnlocked,
  setActiveStyle,
  styleGearGrant,
  unlockStyle,
} from "./armor-styles";
import { GOLD_PER_KILL } from "./constants";
import { GEAR } from "./items";

describe("armor styles (elemental sets)", () => {
  beforeEach(() => {
    __resetArmorStylesCache();
    // Headless node has no localStorage; the module fails soft to in-memory.
    // Clear it when a DOM env provides one so tests stay order-independent.
    try {
      localStorage.removeItem("pinball-knight-armor-styles");
    } catch (_e) {
      /* node env — nothing to clear */
    }
  });

  it("ships iron plus the four elemental sets", () => {
    expect(ARMOR_STYLE_IDS).toEqual(["iron", "ice", "wind", "fire", "thunder"]);
    expect(ELEMENTAL_STYLE_IDS).toEqual(["ice", "wind", "fire", "thunder"]);
  });

  it("starts in iron with nothing unlocked", () => {
    expect(activeStyle()).toBe("iron");
    expect(isStyleUnlocked("iron")).toBe(true);
    for (const id of ELEMENTAL_STYLE_IDS) expect(isStyleUnlocked(id)).toBe(false);
  });

  it("sets are PRESTIGE-priced: hundreds of plain kills each", () => {
    // The tuning contract behind the feature: a set must never be an impulse
    // buy off one floor's kills. 250+ base kills (several runs of banked gold).
    for (const id of ELEMENTAL_STYLE_IDS) {
      expect(ARMOR_STYLES[id].price / GOLD_PER_KILL).toBeGreaterThanOrEqual(250);
    }
    expect(ARMOR_STYLES.iron.price).toBe(0);
  });

  it("cannot wear a locked set; buying unlocks AND wears it", () => {
    expect(setActiveStyle("fire")).toBe(false);
    expect(activeStyle()).toBe("iron");
    unlockStyle("fire");
    expect(isStyleUnlocked("fire")).toBe(true);
    expect(activeStyle()).toBe("fire");
    // switching back to iron is always free
    expect(setActiveStyle("iron")).toBe(true);
    expect(activeStyle()).toBe("iron");
    // and the unlock is remembered — wearing it again works
    expect(setActiveStyle("fire")).toBe(true);
    expect(activeStyle()).toBe("fire");
  });

  it("elemental plate is finer steel: helmet/armor soak more, boots stay a sentinel", () => {
    const helm = GEAR.helmet.absorb;
    const chest = GEAR.armor.absorb;
    expect(styleGearGrant("helmet", helm, "iron")).toBe(helm);
    expect(styleGearGrant("armor", chest, "iron")).toBe(chest);
    for (const id of ELEMENTAL_STYLE_IDS) {
      expect(styleGearGrant("helmet", helm, id)).toBeGreaterThan(helm);
      expect(styleGearGrant("armor", chest, id)).toBeGreaterThan(chest);
      expect(styleGearGrant("boots", 1, id)).toBe(1);
    }
  });

  it("grant helper reads the worn style by default", () => {
    unlockStyle("ice");
    const helm = GEAR.helmet.absorb;
    expect(styleGearGrant("helmet", helm)).toBe(helm + ARMOR_STYLES.ice.bonusAbsorb.helmet);
  });
});
