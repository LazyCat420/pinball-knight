//! THE ARMORER — "Manage Loadout", the station at (-4.8, 2.8).
//!
//! PORTS: `items.ts` gear block (`GEAR`, `GEAR_SLOTS`), `economy/tavern-shop.ts`
//! (`PRICE_GEAR`, `PRICE_REPAIR_GEAR`, `buyGear`, `repairGear`, `buyStyleSet`,
//! `wearStyle`), `armor-styles.ts` (the elemental sets and `styleGearGrant`).
//!
//! The counter sells two different things and they are easy to conflate:
//!
//! | | what it is | persistence |
//! |---|---|---|
//! | **PLATE** — helmet / armor / boots | consumable soak, spent by taking hits | the RUN |
//! | **ELEMENTAL SETS** — ice / wind / fire / thunder | a permanent re-skin that also buys finer steel | FOREVER, like wallet gold |
//!
//! So a player can own Storm Plate and still stand at the counter with an empty
//! helmet slot. The screen shows both for that reason.

use super::{ActionResult, Wallet};

/// `items.ts:332`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum GearSlot {
    Helmet,
    Armor,
    Boots,
}

/// `GEAR_SLOTS` — the order the counter lists them in (`items.ts:348`).
pub const GEAR_SLOTS: [GearSlot; 3] = [GearSlot::Helmet, GearSlot::Armor, GearSlot::Boots];

impl GearSlot {
    /// `GEAR[s].label`.
    pub fn label(self) -> &'static str {
        match self {
            GearSlot::Helmet => "Helmet",
            GearSlot::Armor => "Armor",
            GearSlot::Boots => "Boots",
        }
    }

    /// `GEAR[s].absorb` — damage the piece soaks over its lifetime.
    ///
    /// ⚠️ **Boots are 0 and that is not "no gear", it is "does not absorb".**
    /// Every rule below reads `absorb > 0 ? absorb : 1`, so boots still have a
    /// full/empty state of 1; treating 0 as "no such slot" drops them from the
    /// repair sweep and from the counter's own full/empty colouring.
    pub fn absorb(self) -> i32 {
        match self {
            GearSlot::Helmet => 3,
            GearSlot::Armor => 5,
            GearSlot::Boots => 0,
        }
    }

    /// The oracle's `base` — `absorb > 0 ? absorb : 1`, written once.
    pub fn base(self) -> i32 {
        if self.absorb() > 0 {
            self.absorb()
        } else {
            1
        }
    }

    /// `PRICE_GEAR` (`tavern-shop.ts:77`).
    pub fn price(self) -> i64 {
        match self {
            GearSlot::Helmet => 45,
            GearSlot::Armor => 70,
            GearSlot::Boots => 40,
        }
    }
}

/// `PRICE_REPAIR_GEAR` (`tavern-shop.ts:74`).
pub const PRICE_REPAIR_GEAR: i64 = 40;

/// `armor-styles.ts:18`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum ArmorStyle {
    Iron,
    Ice,
    Wind,
    Fire,
    Thunder,
}

/// `ELEMENTAL_STYLE_IDS` — the PURCHASABLE sets, in shop order. Iron is absent
/// on purpose: it is the free classic default and has no row.
pub const ELEMENTAL_STYLE_IDS: [ArmorStyle; 4] = [
    ArmorStyle::Ice,
    ArmorStyle::Wind,
    ArmorStyle::Fire,
    ArmorStyle::Thunder,
];

impl ArmorStyle {
    pub fn label(self) -> &'static str {
        match self {
            ArmorStyle::Iron => "Crypt Iron",
            ArmorStyle::Ice => "Glacier Plate",
            ArmorStyle::Wind => "Gale Plate",
            ArmorStyle::Fire => "Ember Plate",
            ArmorStyle::Thunder => "Storm Plate",
        }
    }

    pub fn blurb(self) -> &'static str {
        match self {
            ArmorStyle::Iron => "the classic plate you marched in with",
            ArmorStyle::Ice => "hoarfrost steel, cold-blue sheen",
            ArmorStyle::Wind => "jade-green tempest steel",
            ArmorStyle::Fire => "forge-hot plate, ember glow",
            ArmorStyle::Thunder => "storm-slate chased with lightning gold",
        }
    }

    /// Wallet gold to unlock, forever. 0 = always owned.
    pub fn price(self) -> i64 {
        match self {
            ArmorStyle::Iron => 0,
            ArmorStyle::Ice | ArmorStyle::Wind => 600,
            ArmorStyle::Fire => 750,
            ArmorStyle::Thunder => 900,
        }
    }

    /// The UI swatch — "matches the sprite's plate mid tone".
    pub fn swatch(self) -> u32 {
        match self {
            ArmorStyle::Iron => 0x8a94a6,
            ArmorStyle::Ice => 0x6fd0e8,
            ArmorStyle::Wind => 0x8fc46b,
            ArmorStyle::Fire => 0xf0a63c,
            ArmorStyle::Thunder => 0xffd98a,
        }
    }

    /// `bonusAbsorb` — extra soak the Armorer's plate carries while worn.
    fn bonus_absorb(self, slot: GearSlot) -> i32 {
        if self == ArmorStyle::Iron {
            return 0;
        }
        match slot {
            GearSlot::Helmet => 2,
            GearSlot::Armor => 3,
            GearSlot::Boots => 0,
        }
    }

    /// `styleGearGrant` (`armor-styles.ts:119`) — finer steel while an
    /// elemental set is worn. **Boots return `base` unchanged**, before the
    /// table is consulted at all.
    pub fn gear_grant(self, slot: GearSlot, base: i32) -> i32 {
        if slot == GearSlot::Boots {
            return base;
        }
        base + self.bonus_absorb(slot)
    }
}

/// Everything the counter reads and writes. The shell owns persistence: `gear`
/// is the RUN's, `unlocked`/`active` and the wallet survive death.
#[derive(Debug, Clone)]
pub struct Loadout {
    /// Remaining soak per slot. Absent = never bought.
    pub gear: [Option<i32>; 3],
    pub unlocked: Vec<ArmorStyle>,
    pub active: ArmorStyle,
}

impl Default for Loadout {
    fn default() -> Self {
        Self {
            gear: [None; 3],
            unlocked: Vec::new(),
            active: ArmorStyle::Iron,
        }
    }
}

fn idx(s: GearSlot) -> usize {
    match s {
        GearSlot::Helmet => 0,
        GearSlot::Armor => 1,
        GearSlot::Boots => 2,
    }
}

impl Loadout {
    pub fn worn(&self, s: GearSlot) -> i32 {
        self.gear[idx(s)].unwrap_or(0)
    }

    /// `isStyleUnlocked` — iron is ALWAYS owned and is never in the list.
    pub fn is_unlocked(&self, id: ArmorStyle) -> bool {
        id == ArmorStyle::Iron || self.unlocked.contains(&id)
    }

    /// `buyGear` (`tavern-shop.ts:215`). Order is load-bearing: the
    /// already-equipped check happens BEFORE the charge, so a full slot is
    /// free to click.
    pub fn buy_gear(&mut self, w: &mut Wallet, s: GearSlot) -> ActionResult {
        let grant = self.active.gear_grant(s, s.base());
        if self.worn(s) >= grant {
            return Some("already equipped".into());
        }
        if !w.spend(s.price()) {
            return Some("not enough gold".into());
        }
        self.gear[idx(s)] = Some(grant);
        Some(format!("{} equipped", s.label()))
    }

    /// `repairGear` (`tavern-shop.ts:251`).
    ///
    /// ⚠️ **"Sound" is measured against `absorb || 1`, NOT against the style's
    /// grant.** So a player wearing Storm Plate whose helmet sits at 3 of a
    /// possible 5 is "sound" and cannot repair — and refilling sets it to 3,
    /// not 5. That asymmetry with `buy_gear` is the oracle's and is reproduced,
    /// not fixed: see RISK-4 in the 1:1 plan.
    pub fn repair_gear(&mut self, w: &mut Wallet) -> ActionResult {
        let missing = GEAR_SLOTS.iter().any(|s| self.worn(*s) < s.base());
        if !missing {
            return Some("all gear is sound".into());
        }
        if !w.spend(PRICE_REPAIR_GEAR) {
            return Some("not enough gold".into());
        }
        for s in GEAR_SLOTS {
            // The oracle's guard is `state.gear[s] !== undefined || absorb > 0`
            // — boots are only refilled once they have been bought.
            if self.gear[idx(s)].is_some() || s.absorb() > 0 {
                self.gear[idx(s)] = Some(s.base());
            }
        }
        Some("plate repaired".into())
    }

    /// `buyStyleSet` (`tavern-shop.ts:227`) — unlock AND wear, and you walk out
    /// dressed in the set's finer steel, never downgrading a piece that somehow
    /// has more left.
    pub fn buy_style(&mut self, w: &mut Wallet, id: ArmorStyle) -> ActionResult {
        if id.price() <= 0 || self.is_unlocked(id) {
            return None;
        }
        if !w.spend(id.price()) {
            return Some("not enough gold".into());
        }
        self.unlocked.push(id);
        self.active = id;
        for s in GEAR_SLOTS {
            let grant = id.gear_grant(s, s.base());
            self.gear[idx(s)] = Some(self.worn(s).max(grant));
        }
        Some(format!("{} — forged & worn", id.label()))
    }

    /// `wearStyle` — `setActiveStyle` refuses a set you do not own, and the
    /// oracle returns `null` for that, not a message.
    pub fn wear_style(&mut self, id: ArmorStyle) -> ActionResult {
        if !self.is_unlocked(id) {
            return None;
        }
        self.active = id;
        Some(format!("{} worn", id.label()))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn rich() -> (Loadout, Wallet) {
        (Loadout::default(), Wallet::new(10_000))
    }

    #[test]
    fn plate_prices_and_soak_match_the_tables() {
        assert_eq!(GearSlot::Helmet.price(), 45);
        assert_eq!(GearSlot::Armor.price(), 70);
        assert_eq!(GearSlot::Boots.price(), 40);
        assert_eq!(GearSlot::Helmet.absorb(), 3);
        assert_eq!(GearSlot::Armor.absorb(), 5);
        assert_eq!(GearSlot::Boots.absorb(), 0);
        // …and boots' BASE is 1, which is the number every rule uses.
        assert_eq!(GearSlot::Boots.base(), 1);
    }

    #[test]
    fn buying_plate_charges_once_and_a_full_slot_is_free_to_click() {
        let (mut l, mut w) = rich();
        assert_eq!(
            l.buy_gear(&mut w, GearSlot::Armor).unwrap(),
            "Armor equipped"
        );
        assert_eq!(l.worn(GearSlot::Armor), 5);
        assert_eq!(w.balance(), 10_000 - 70);
        // Already full: the oracle checks BEFORE it charges.
        assert_eq!(
            l.buy_gear(&mut w, GearSlot::Armor).unwrap(),
            "already equipped"
        );
        assert_eq!(w.balance(), 10_000 - 70, "a no-op must not charge");
    }

    #[test]
    fn a_broke_player_keeps_their_empty_slot_and_their_gold() {
        let mut l = Loadout::default();
        let mut w = Wallet::new(44); // one short of a helmet
        assert_eq!(
            l.buy_gear(&mut w, GearSlot::Helmet).unwrap(),
            "not enough gold"
        );
        assert_eq!(w.balance(), 44);
        assert_eq!(l.worn(GearSlot::Helmet), 0);
    }

    #[test]
    fn an_elemental_set_buys_finer_steel_but_never_for_boots() {
        let (mut l, mut w) = rich();
        l.buy_style(&mut w, ArmorStyle::Thunder);
        assert_eq!(l.active, ArmorStyle::Thunder);
        // helmet 3+2, armor 5+3, boots 1 (base, untouched by the table).
        assert_eq!(l.worn(GearSlot::Helmet), 5);
        assert_eq!(l.worn(GearSlot::Armor), 8);
        assert_eq!(l.worn(GearSlot::Boots), 1);
    }

    #[test]
    fn buying_a_set_never_downgrades_a_piece_that_has_more_left() {
        let (mut l, mut w) = rich();
        l.gear[1] = Some(99); // a piece with more left than the set grants
        l.buy_style(&mut w, ArmorStyle::Ice);
        assert_eq!(l.worn(GearSlot::Armor), 99, "max(), not assignment");
    }

    #[test]
    fn a_set_you_already_own_is_a_no_op_and_not_a_message() {
        let (mut l, mut w) = rich();
        l.buy_style(&mut w, ArmorStyle::Fire);
        let before = w.balance();
        assert_eq!(l.buy_style(&mut w, ArmorStyle::Fire), None);
        assert_eq!(w.balance(), before, "owning it twice must not charge twice");
        // Iron is free and always owned, so it can never be bought.
        assert_eq!(l.buy_style(&mut w, ArmorStyle::Iron), None);
    }

    #[test]
    fn you_cannot_wear_what_you_do_not_own_and_iron_is_always_yours() {
        let mut l = Loadout::default();
        assert_eq!(l.wear_style(ArmorStyle::Ice), None);
        assert_eq!(l.active, ArmorStyle::Iron);
        assert_eq!(l.wear_style(ArmorStyle::Iron).unwrap(), "Crypt Iron worn");
    }

    #[test]
    fn repair_refills_to_the_base_and_not_to_the_styles_grant() {
        // THE ORACLE'S ASYMMETRY, pinned deliberately. `repairGear` measures
        // and refills against `absorb || 1`; only `buyGear` knows about the
        // style. Reproduce bit-for-bit, fix after parity (RISK-4).
        let (mut l, mut w) = rich();
        l.buy_style(&mut w, ArmorStyle::Thunder); // armor → 8
        l.gear[1] = Some(1); // took a beating
        assert_eq!(l.repair_gear(&mut w).unwrap(), "plate repaired");
        assert_eq!(l.worn(GearSlot::Armor), 5, "base, not the 8 the set grants");
    }

    #[test]
    fn repair_is_free_when_nothing_is_missing() {
        let (mut l, mut w) = rich();
        for s in GEAR_SLOTS {
            l.gear[idx(s)] = Some(s.base());
        }
        let before = w.balance();
        assert_eq!(l.repair_gear(&mut w).unwrap(), "all gear is sound");
        assert_eq!(before, w.balance(), "a refused repair must not charge");
    }

    #[test]
    fn repair_leaves_unbought_boots_unbought() {
        // `state.gear[s] !== undefined || absorb > 0` — helmet and armor are
        // refilled because they absorb; boots are only refilled once owned.
        let (mut l, mut w) = rich();
        assert_eq!(l.repair_gear(&mut w).unwrap(), "plate repaired");
        assert_eq!(l.worn(GearSlot::Helmet), 3);
        assert_eq!(l.worn(GearSlot::Armor), 5);
        assert_eq!(l.gear[2], None, "boots were never bought");
    }

    #[test]
    fn the_shop_lists_four_sets_and_iron_is_not_one_of_them() {
        assert_eq!(ELEMENTAL_STYLE_IDS.len(), 4);
        assert!(!ELEMENTAL_STYLE_IDS.contains(&ArmorStyle::Iron));
        assert_eq!(ArmorStyle::Ice.price(), 600);
        assert_eq!(ArmorStyle::Wind.price(), 600);
        assert_eq!(ArmorStyle::Fire.price(), 750);
        assert_eq!(ArmorStyle::Thunder.price(), 900);
    }
}
