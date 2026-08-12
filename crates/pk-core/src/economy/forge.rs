//! THE WEAPONSMITH'S ANVIL — repair, socket, upgrade, insure, sacrifice.
//!
//! PORTS: `items.ts`'s weapon block (`WEAPONS`, `WeaponState`, `slotsForRarity`,
//! `weaponSlotCount`, `breakChance`, `upgradeDamageMult`,
//! `upgradeDurabilityMult`, `salvageValue`, `insuranceCost`, `insuredCards`) and
//! the smith half of `economy/tavern-shop.ts` (`repairWeapon`, `addSlot`,
//! `upgradeWeapon`, `insureWeapon`, `salvageWeapon`).
//!
//! ## The loop this file exists to make tense
//!
//! Upgrading raises damage, and past a safe floor each attempt can DESTROY the
//! weapon. That is the anti-hoard mechanic: if the best kit could be kept
//! forever, players would carry one god-item and the run would stop being a run.
//! It is also what keeps REPAIR worth paying for.
//!
//! Three rules hang off that, and each is transcribed with its reason because
//! each is the kind of thing a later reader files down into a bug:
//!
//! | | pays | keeps the cards |
//! |---|---|---|
//! | **SACRIFICE** (your choice) | `salvage_value` in gold | ALL of them |
//! | **SHATTER** (a failed roll) | nothing | only what INSURANCE bought back |
//!
//! · The asymmetry is the point: retiring a weapon on your terms is a decision,
//!   losing one to a bad roll is a consequence. If both paid out there would be
//!   no reason to ever stop upgrading.
//! · Insurance covers CARDS ONLY. The weapon still dies — protecting it would
//!   delete the risk and with it the whole mechanic.
//! · The gamble is TWO-STEP once the risk is real, and the number on the confirm
//!   is the number that gets rolled. A hidden coin-flip that eats a legendary is
//!   a feel-bad; a stated 36% gamble is a story.
//!
//! ## The roll is an argument, not a side effect
//!
//! The oracle calls `Math.random()` inside `upgradeWeapon`. Here the caller
//! draws it and passes it in, so the rules stay pure and a test can walk both
//! sides of the threshold exactly. The shell owns the stream
//! (`pk_core::rng::Mulberry32`), which is also what keeps a shatter replayable.

use super::{ActionResult, Wallet};

// ── Rarity ───────────────────────────────────────────────────────────────────

/// `ItemRarity`. Ordered low→high, which `insured_cards` needs to save the
/// rarest first.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Default)]
pub enum ItemRarity {
    #[default]
    Common,
    Rare,
    Epic,
    Legendary,
}

impl ItemRarity {
    pub fn label(self) -> &'static str {
        match self {
            ItemRarity::Common => "common",
            ItemRarity::Rare => "rare",
            ItemRarity::Epic => "epic",
            ItemRarity::Legendary => "legendary",
        }
    }

    /// `SLOTS_BY_RARITY` — 1..4.
    pub fn slots(self) -> i32 {
        match self {
            ItemRarity::Common => 1,
            ItemRarity::Rare => 2,
            ItemRarity::Epic => 3,
            ItemRarity::Legendary => 4,
        }
    }

    /// `SALVAGE_BY_RARITY`.
    pub fn salvage(self) -> i64 {
        match self {
            ItemRarity::Common => 15,
            ItemRarity::Rare => 40,
            ItemRarity::Epic => 90,
            ItemRarity::Legendary => 200,
        }
    }

    /// `INSURANCE_RARITY_MULT` — a legendary's sockets are worth more, so
    /// insuring them costs more.
    pub fn insurance_mult(self) -> f64 {
        match self {
            ItemRarity::Common => 1.0,
            ItemRarity::Rare => 1.4,
            ItemRarity::Epic => 2.0,
            ItemRarity::Legendary => 3.0,
        }
    }

    /// `ITEM_RARITY_HEX` — the accent the name and the ground glow share.
    pub fn swatch(self) -> u32 {
        match self {
            ItemRarity::Common => 0x9aa4b4,
            ItemRarity::Rare => 0x4f8fdb,
            ItemRarity::Epic => 0xa46fe8,
            ItemRarity::Legendary => 0xf0a63c,
        }
    }
}

// ── Weapons ──────────────────────────────────────────────────────────────────

/// `WeaponId`. The whole table, because the smith works on whatever is in your
/// hand and a missing arm here would be a weapon that cannot be repaired.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum WeaponId {
    Fists,
    Sword,
    Stick,
    Mace,
    Chair,
    Gun,
    Greatsword,
    Warhammer,
    WreckingBall,
    Bow,
    Flamethrower,
}

impl WeaponId {
    pub fn label(self) -> &'static str {
        match self {
            WeaponId::Fists => "Fists",
            WeaponId::Sword => "Sword",
            WeaponId::Stick => "Stick",
            WeaponId::Mace => "Mace",
            WeaponId::Chair => "Chair",
            WeaponId::Gun => "Gun",
            WeaponId::Greatsword => "Greatsword",
            WeaponId::Warhammer => "Warhammer",
            WeaponId::WreckingBall => "Wrecking Ball",
            WeaponId::Bow => "Bow",
            WeaponId::Flamethrower => "Flamer",
        }
    }

    /// The `ITEM_PAINTS` key — a table, not a lowercased label.
    pub fn item_id(self) -> &'static str {
        match self {
            WeaponId::Fists => "fists",
            WeaponId::Sword => "sword",
            WeaponId::Stick => "stick",
            WeaponId::Mace => "mace",
            WeaponId::Chair => "chair",
            WeaponId::Gun => "gun",
            WeaponId::Greatsword => "greatsword",
            WeaponId::Warhammer => "warhammer",
            WeaponId::WreckingBall => "wreckingball",
            WeaponId::Bow => "bow",
            WeaponId::Flamethrower => "flamethrower",
        }
    }

    /// `WEAPONS[id].damage` — the base the upgrade multiplier applies to.
    pub fn damage(self) -> f64 {
        match self {
            WeaponId::Fists => 1.0,
            WeaponId::Sword => 2.0,
            WeaponId::Stick => 1.0,
            WeaponId::Mace => 3.0,
            WeaponId::Chair => 2.0,
            WeaponId::Gun => 2.0,
            WeaponId::Greatsword => 5.0,
            WeaponId::Warhammer => 7.0,
            WeaponId::WreckingBall => 4.0,
            WeaponId::Bow => 3.0,
            WeaponId::Flamethrower => 1.0,
        }
    }

    /// `WEAPONS[id].maxDurability`. **`None` is the oracle's `Infinity`** — fists
    /// never wear out, and every rule below branches on that rather than on a
    /// sentinel number.
    pub fn max_durability(self) -> Option<i32> {
        match self {
            WeaponId::Fists => None,
            WeaponId::Sword => Some(30),
            WeaponId::Stick => Some(15),
            WeaponId::Mace => Some(45),
            WeaponId::Chair => Some(22),
            WeaponId::Gun => Some(30),
            WeaponId::Greatsword => Some(40),
            WeaponId::Warhammer => Some(50),
            WeaponId::WreckingBall => Some(36),
            WeaponId::Bow => Some(22),
            WeaponId::Flamethrower => Some(42),
        }
    }
}

/// `WeaponState` — one weapon in a slot.
#[derive(Debug, Clone, PartialEq)]
pub struct Weapon {
    pub id: WeaponId,
    /// `None` = infinite (fists). Otherwise the remaining hits.
    pub durability: Option<i32>,
    /// Socketed modifier cards, by `CardId`.
    ///
    /// Strings and not an enum ON PURPOSE: `cards.ts` is not ported yet, and
    /// this module only ever counts them and asks another function to rank
    /// them. When cards land these become that module's type and nothing else
    /// here changes.
    pub cards: Vec<String>,
    /// Extra sockets bought at this counter.
    pub bonus_slots: i32,
    pub rarity: ItemRarity,
    /// Smith upgrade level. Each is stronger AND riskier — see [`break_chance`].
    pub upgrade: i32,
    /// Paid insurance tier (0..=[`INSURANCE_MAX_TIER`]).
    pub insured: i32,
}

impl Weapon {
    /// A fresh drop: full durability, nothing socketed.
    pub fn new(id: WeaponId, rarity: ItemRarity) -> Self {
        Self {
            id,
            durability: id.max_durability(),
            cards: Vec::new(),
            bonus_slots: 0,
            rarity,
            upgrade: 0,
            insured: 0,
        }
    }

    /// `weaponSlotCount` — the rarity's allowance plus bought slots, capped at
    /// [`WEAPON_MAX_CARD_SLOTS`].
    pub fn slot_count(&self) -> i32 {
        (self.rarity.slots() + self.bonus_slots.max(0)).min(WEAPON_MAX_CARD_SLOTS)
    }

    /// `upgradeDamageMult` applied to the weapon's base.
    pub fn damage(&self) -> f64 {
        self.id.damage() * upgrade_damage_mult(self.upgrade)
    }

    /// The ceiling this weapon's durability can be repaired or topped up to,
    /// raised by its upgrade level. `None` for fists.
    pub fn max_durability(&self) -> Option<i32> {
        self.id
            .max_durability()
            .map(|m| (m as f64 * upgrade_durability_mult(self.upgrade)).round() as i32)
    }
}

// ── Prices and curves ────────────────────────────────────────────────────────

pub const PRICE_REPAIR_WEAPON: i64 = 30;
pub const PRICE_ADD_SLOT: i64 = 60;
/// Climbs with the level, so pushing deep costs real gold as well as real risk.
pub const PRICE_UPGRADE_BASE: i64 = 45;
pub const PRICE_UPGRADE_PER_LEVEL: i64 = 25;

/// Hard cap on socketed cards per item.
pub const WEAPON_MAX_CARD_SLOTS: i32 = 4;
/// ⚠️ **AND YET THE COUNTER STOPS SELLING AT 3.** `addSlot` refuses at
/// `weaponSlotCount(w) >= 3` and the button greys out at the same number, so a
/// legendary (4 by rarity) can never buy one and an epic is already maxed. The
/// two constants disagree in the ORACLE; the behaviour is what ships, so the
/// behaviour is what is ported — with this note, because the next reader will
/// otherwise "fix" it to `WEAPON_MAX_CARD_SLOTS` and quietly sell a fifth slot.
pub const ADD_SLOT_REFUSES_AT: i32 = 3;

/// Upgrades below this level are FREE OF RISK, so the system teaches before it
/// bites.
pub const UPGRADE_SAFE_LEVEL: i32 = 3;
pub const UPGRADE_RISK_STEP: f64 = 0.12;
pub const UPGRADE_RISK_CAP: f64 = 0.6;
pub const UPGRADE_DAMAGE_STEP: f64 = 0.12;
pub const UPGRADE_DURABILITY_STEP: f64 = 0.08;
pub const SALVAGE_PER_UPGRADE: i64 = 25;
pub const INSURANCE_MAX_TIER: i32 = 2;
pub const INSURANCE_BASE_COST: f64 = 55.0;

/// `breakChance` — the chance that upgrading FROM `level` destroys the weapon.
///
/// The number shown on the confirm MUST be the number rolled, or the gamble is
/// a lie. That is why this is one pure function with one caller.
pub fn break_chance(level: i32) -> f64 {
    let n = level.max(0);
    if n < UPGRADE_SAFE_LEVEL {
        return 0.0;
    }
    (((n - UPGRADE_SAFE_LEVEL + 1) as f64) * UPGRADE_RISK_STEP).min(UPGRADE_RISK_CAP)
}

pub fn upgrade_damage_mult(level: i32) -> f64 {
    1.0 + level.max(0) as f64 * UPGRADE_DAMAGE_STEP
}

pub fn upgrade_durability_mult(level: i32) -> f64 {
    1.0 + level.max(0) as f64 * UPGRADE_DURABILITY_STEP
}

/// What the next upgrade costs.
pub fn upgrade_price(level: i32) -> i64 {
    PRICE_UPGRADE_BASE + level.max(0) as i64 * PRICE_UPGRADE_PER_LEVEL
}

/// `salvageValue` — rarity (what it was) plus upgrades (what you put in), and
/// always LESS than the upgrades cost: salvage is a consolation, not an income
/// stream, or the optimal play becomes upgrade-then-salvage forever.
pub fn salvage_value(w: &Weapon) -> i64 {
    w.rarity.salvage() + w.upgrade.max(0) as i64 * SALVAGE_PER_UPGRADE
}

/// `insuranceCost` — price to raise insurance from `tier` to `tier + 1`.
pub fn insurance_cost(tier: i32, rarity: ItemRarity) -> i64 {
    let next = (tier.max(0) + 1) as f64;
    (INSURANCE_BASE_COST * next * rarity.insurance_mult()).round() as i64
}

/// `insuredCards` — which socketed cards survive a shatter.
///
/// Insurance saves the RAREST first: the player paid to protect what matters,
/// and making them guess which chip the game valued would be a bad surprise at
/// the worst possible moment.
///
/// `rarity_rank` is INJECTED, exactly as in the oracle (`items.ts` is imported
/// by `cards.ts`, so importing back would be a cycle). Until `cards.ts` is
/// ported the shell passes a rank that answers 0 for everything — which makes
/// "rarest first" degenerate to "first N", and
/// `insurance_saves_the_rarest_first` is the test that will notice when a real
/// ranking arrives.
pub fn insured_cards(
    cards: &[String],
    tier: i32,
    rarity_rank: impl Fn(&str) -> i32,
) -> Vec<String> {
    let n = tier.clamp(0, INSURANCE_MAX_TIER) as usize;
    if n == 0 || cards.is_empty() {
        return Vec::new();
    }
    let mut sorted: Vec<String> = cards.to_vec();
    // STABLE, descending by rank — a stable sort is what makes "the first two
    // of equal rank" a defined answer rather than an allocator's opinion.
    sorted.sort_by_key(|id| -rarity_rank(id));
    sorted.truncate(n);
    sorted
}

// ── Actions ──────────────────────────────────────────────────────────────────

/// The anvil's answer, plus what the shatter roll did to the world.
///
/// `weapon: None` means the slot is now EMPTY — the caller must drop it, and
/// making that a return value rather than a mutation of an `Option` in place is
/// what stops a screen painting a weapon that no longer exists.
#[derive(Debug, Clone, PartialEq, Default)]
pub struct ForgeOutcome {
    pub message: ActionResult,
    /// Cards that came back to the stash (saved from a shatter, or all of them
    /// after a sacrifice).
    pub returned: Vec<String>,
    /// True when the weapon is gone.
    pub destroyed: bool,
}

/// `repairWeapon`.
pub fn repair_weapon(w: &mut Weapon, wallet: &mut Wallet) -> ActionResult {
    let Some(max) = w.max_durability() else {
        return Some("weapon is already sound".into()); // fists never wear
    };
    if w.durability.unwrap_or(max) >= max {
        return Some("weapon is already sound".into());
    }
    if !wallet.spend(PRICE_REPAIR_WEAPON) {
        return Some("not enough gold".into());
    }
    w.durability = Some(max);
    Some("weapon repaired".into())
}

/// `addSlot`.
pub fn add_slot(w: &mut Weapon, wallet: &mut Wallet) -> ActionResult {
    if w.slot_count() >= ADD_SLOT_REFUSES_AT {
        return Some("weapon is maxed out".into());
    }
    if !wallet.spend(PRICE_ADD_SLOT) {
        return Some("not enough gold".into());
    }
    w.bonus_slots += 1;
    Some("socket added".into())
}

/// `insureWeapon`.
pub fn insure_weapon(w: &mut Weapon, wallet: &mut Wallet) -> ActionResult {
    let cards = w.cards.len() as i32;
    if cards == 0 {
        return Some("nothing socketed to insure".into());
    }
    let tier = w.insured.min(INSURANCE_MAX_TIER);
    if tier >= INSURANCE_MAX_TIER || tier >= cards {
        return Some("already fully insured".into());
    }
    if !wallet.spend(insurance_cost(tier, w.rarity)) {
        return Some("not enough gold".into());
    }
    w.insured = tier + 1;
    Some(format!("insured — {} card(s) survive a shatter", w.insured))
}

/// `salvageWeapon` — a DELIBERATE sacrifice pays out and returns every card.
pub fn salvage_weapon(w: &Weapon, wallet: &mut Wallet) -> ForgeOutcome {
    let gold = salvage_value(w);
    wallet.add(gold);
    let back = w.cards.clone();
    let n = back.len();
    ForgeOutcome {
        message: Some(format!(
            "sacrificed for {gold}g{}",
            if n > 0 {
                format!(" · {n} card(s) returned")
            } else {
                String::new()
            }
        )),
        returned: back,
        destroyed: true,
    }
}

/// `upgradeWeapon`, with the roll handed in.
///
/// `armed` is the level the player has already confirmed once. Returns the new
/// `armed` so the caller can hold a confirm without knowing the risk curve —
/// the same contract as the oracle, and the reason the screen carries no rules.
///
/// ⚠️ **A FIRST PRESS AT RISK CHARGES NOTHING AND RETURNS NO MESSAGE.** It only
/// arms. Charging on the arming press would take the gold for a roll that has
/// not happened.
#[allow(clippy::too_many_arguments)]
pub fn upgrade_weapon(
    w: &mut Weapon,
    wallet: &mut Wallet,
    armed: Option<i32>,
    roll: f64,
    rarity_rank: impl Fn(&str) -> i32,
) -> (ForgeOutcome, Option<i32>) {
    let lvl = w.upgrade.max(0);
    let risk = break_chance(lvl);
    if risk > 0.0 && armed != Some(lvl) {
        return (ForgeOutcome::default(), Some(lvl));
    }
    if !wallet.spend(upgrade_price(lvl)) {
        return (
            ForgeOutcome {
                message: Some("not enough gold".into()),
                ..ForgeOutcome::default()
            },
            None,
        );
    }

    if roll < risk {
        // DESTROYED. The weapon is ALWAYS gone — insuring it would delete the
        // risk. Socketed cards go with it, except the ones insurance bought
        // back out of the fire.
        let saved = insured_cards(&w.cards, w.insured, rarity_rank);
        let lost = w.cards.len() - saved.len();
        let message = if !saved.is_empty() {
            Some(format!(
                "THE BLADE SHATTERS — {} card(s) saved{}",
                saved.len(),
                if lost > 0 {
                    format!(", {lost} lost")
                } else {
                    String::new()
                }
            ))
        } else if lost > 0 {
            Some(format!("THE BLADE SHATTERS — {lost} card(s) lost"))
        } else {
            Some("THE BLADE SHATTERS".into())
        };
        return (
            ForgeOutcome {
                message,
                returned: saved,
                destroyed: true,
            },
            None,
        );
    }

    w.upgrade = lvl + 1;
    // Top the blade up to its new, higher ceiling so the upgrade is FELT now —
    // but by a step, not to full: a free repair riding along with every upgrade
    // would make REPAIR pointless.
    if let (Some(cur), Some(base), Some(max)) =
        (w.durability, w.id.max_durability(), w.max_durability())
    {
        let step = (base as f64 * UPGRADE_DURABILITY_STEP).round() as i32;
        w.durability = Some(max.min(cur + step));
    }
    (
        ForgeOutcome {
            message: Some(format!("upgraded to +{}", w.upgrade)),
            ..ForgeOutcome::default()
        },
        None,
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Until `cards.ts` lands. See [`insured_cards`].
    fn flat_rank(_: &str) -> i32 {
        0
    }

    fn sword() -> Weapon {
        Weapon::new(WeaponId::Sword, ItemRarity::Rare)
    }

    #[test]
    fn the_risk_curve_is_the_oracles_and_it_is_capped() {
        // Free below the safe level, then 12% a step, capped at 60%.
        for lvl in 0..UPGRADE_SAFE_LEVEL {
            assert_eq!(break_chance(lvl), 0.0, "level {lvl} must be free of risk");
        }
        assert!((break_chance(3) - 0.12).abs() < 1e-9);
        assert!((break_chance(4) - 0.24).abs() < 1e-9);
        assert!((break_chance(7) - 0.6).abs() < 1e-9);
        assert_eq!(break_chance(50), UPGRADE_RISK_CAP, "the cap must bind");
        assert_eq!(break_chance(-9), 0.0, "a negative level is level 0");
    }

    /// THE TWO-STEP. A first press at real risk arms and charges NOTHING.
    #[test]
    fn a_risky_upgrade_arms_before_it_rolls_and_the_arming_press_is_free() {
        let mut w = sword();
        w.upgrade = UPGRADE_SAFE_LEVEL; // 12% risk
        let mut wallet = Wallet::new(500);
        let (out, armed) = upgrade_weapon(&mut w, &mut wallet, None, 0.99, flat_rank);
        assert_eq!(
            out,
            ForgeOutcome::default(),
            "the arming press did something"
        );
        assert_eq!(armed, Some(UPGRADE_SAFE_LEVEL));
        assert_eq!(wallet.balance(), 500, "the arming press charged gold");
        assert_eq!(w.upgrade, UPGRADE_SAFE_LEVEL, "…and upgraded anyway");

        // Confirmed: it rolls. 0.99 is over a 0.12 risk, so it survives.
        let (out, armed) = upgrade_weapon(&mut w, &mut wallet, armed, 0.99, flat_rank);
        assert_eq!(out.message.as_deref(), Some("upgraded to +4"));
        assert_eq!(armed, None, "the confirm must not stay armed");
        assert_eq!(wallet.balance(), 500 - upgrade_price(3));
    }

    /// …and a SAFE upgrade needs no confirm at all.
    #[test]
    fn a_safe_upgrade_lands_on_the_first_press() {
        let mut w = sword();
        let mut wallet = Wallet::new(500);
        let (out, armed) = upgrade_weapon(&mut w, &mut wallet, None, 0.0, flat_rank);
        assert_eq!(out.message.as_deref(), Some("upgraded to +1"));
        assert_eq!(armed, None);
        assert_eq!(w.upgrade, 1);
    }

    /// THE NUMBER ON THE CONFIRM IS THE NUMBER ROLLED — both sides of it.
    #[test]
    fn the_roll_is_compared_against_exactly_the_stated_risk() {
        let mut wallet = Wallet::new(10_000);
        for (roll, dies) in [(0.1199, true), (0.12, false), (0.1201, false)] {
            let mut w = sword();
            w.upgrade = 3; // 12%
            let (out, _) = upgrade_weapon(&mut w, &mut wallet, Some(3), roll, flat_rank);
            assert_eq!(
                out.destroyed, dies,
                "roll {roll} against a 0.12 risk: expected destroyed={dies}"
            );
        }
    }

    /// A SHATTER pays nothing and keeps only what insurance bought back; a
    /// SACRIFICE pays out and returns everything. That asymmetry is the loop.
    #[test]
    fn a_shatter_and_a_sacrifice_are_not_the_same_transaction() {
        let mut w = sword();
        w.upgrade = 3;
        w.cards = vec!["a".into(), "b".into(), "c".into()];
        w.insured = 1;
        let mut wallet = Wallet::new(1_000);
        let before = wallet.balance();
        let (out, _) = upgrade_weapon(&mut w, &mut wallet, Some(3), 0.0, flat_rank);
        assert!(out.destroyed);
        assert_eq!(out.returned.len(), 1, "insurance saved one card");
        assert_eq!(
            wallet.balance(),
            before - upgrade_price(3),
            "a shatter must not pay out"
        );
        assert_eq!(
            out.message.as_deref(),
            Some("THE BLADE SHATTERS — 1 card(s) saved, 2 lost")
        );

        let w = {
            let mut w = sword();
            w.upgrade = 3;
            w.cards = vec!["a".into(), "b".into(), "c".into()];
            w
        };
        let mut wallet = Wallet::new(0);
        let out = salvage_weapon(&w, &mut wallet);
        assert!(out.destroyed);
        assert_eq!(out.returned.len(), 3, "a sacrifice returns EVERY card");
        assert_eq!(wallet.balance(), salvage_value(&w));
    }

    /// Insurance covers CARDS ONLY — the weapon still dies. Protecting it would
    /// delete the risk and with it the anti-hoard mechanic.
    #[test]
    fn insurance_never_saves_the_weapon_itself() {
        let mut w = sword();
        w.upgrade = 3;
        w.cards = vec!["a".into(), "b".into()];
        w.insured = INSURANCE_MAX_TIER;
        let mut wallet = Wallet::new(1_000);
        let (out, _) = upgrade_weapon(&mut w, &mut wallet, Some(3), 0.0, flat_rank);
        assert!(out.destroyed, "a fully insured weapon survived a shatter");
        assert_eq!(out.returned.len(), 2);
    }

    #[test]
    fn insurance_saves_the_rarest_first() {
        // With a REAL rank the order is by rarity, not by socket order — this is
        // the test that notices when `cards.ts` lands and the shell stops
        // passing a flat rank.
        let cards = vec!["common".to_string(), "mythic".into(), "rare".into()];
        let rank = |id: &str| match id {
            "mythic" => 4,
            "rare" => 1,
            _ => 0,
        };
        assert_eq!(insured_cards(&cards, 1, rank), vec!["mythic".to_string()]);
        assert_eq!(
            insured_cards(&cards, 2, rank),
            vec!["mythic".to_string(), "rare".into()]
        );
        // Over the cap saves the cap, not everything.
        assert_eq!(
            insured_cards(&cards, 99, rank).len(),
            INSURANCE_MAX_TIER as usize
        );
        assert!(insured_cards(&cards, 0, rank).is_empty());
    }

    #[test]
    fn insurance_price_climbs_with_the_tier_and_the_rarity() {
        assert_eq!(insurance_cost(0, ItemRarity::Common), 55);
        assert_eq!(insurance_cost(1, ItemRarity::Common), 110);
        assert_eq!(insurance_cost(0, ItemRarity::Rare), 77); // 55 * 1.4
        assert_eq!(insurance_cost(0, ItemRarity::Legendary), 165);
    }

    #[test]
    fn insuring_stops_at_the_tier_and_at_the_card_count() {
        let mut w = sword();
        let mut wallet = Wallet::new(10_000);
        assert_eq!(
            insure_weapon(&mut w, &mut wallet).as_deref(),
            Some("nothing socketed to insure")
        );
        w.cards = vec!["a".into()];
        assert!(insure_weapon(&mut w, &mut wallet).is_some());
        assert_eq!(w.insured, 1);
        // ONE card socketed, so tier 1 is already everything it can protect.
        assert_eq!(
            insure_weapon(&mut w, &mut wallet).as_deref(),
            Some("already fully insured")
        );
        w.cards.push("b".into());
        assert!(insure_weapon(&mut w, &mut wallet).is_some());
        assert_eq!(w.insured, INSURANCE_MAX_TIER);
        assert_eq!(
            insure_weapon(&mut w, &mut wallet).as_deref(),
            Some("already fully insured")
        );
    }

    #[test]
    fn repair_refills_to_the_upgraded_ceiling_and_refuses_when_sound() {
        let mut w = sword();
        let mut wallet = Wallet::new(1_000);
        assert_eq!(
            repair_weapon(&mut w, &mut wallet).as_deref(),
            Some("weapon is already sound")
        );
        assert_eq!(wallet.balance(), 1_000, "a refused repair charged");
        w.durability = Some(4);
        w.upgrade = 2; // ceiling 30 * 1.16 = 34.8 → 35
        assert_eq!(
            repair_weapon(&mut w, &mut wallet).as_deref(),
            Some("weapon repaired")
        );
        assert_eq!(w.durability, Some(35));
        assert_eq!(wallet.balance(), 1_000 - PRICE_REPAIR_WEAPON);
    }

    #[test]
    fn fists_are_infinite_and_cannot_be_repaired() {
        let mut w = Weapon::new(WeaponId::Fists, ItemRarity::Common);
        assert_eq!(w.durability, None);
        assert_eq!(w.max_durability(), None);
        let mut wallet = Wallet::new(1_000);
        assert_eq!(
            repair_weapon(&mut w, &mut wallet).as_deref(),
            Some("weapon is already sound")
        );
        assert_eq!(wallet.balance(), 1_000);
    }

    /// ⚠️ THE COUNTER STOPS AT 3, NOT AT `WEAPON_MAX_CARD_SLOTS`. See
    /// [`ADD_SLOT_REFUSES_AT`] — the oracle's own two constants disagree, and
    /// the behaviour is what ships.
    #[test]
    fn sockets_stop_selling_at_three_even_though_the_cap_is_four() {
        let mut wallet = Wallet::new(10_000);
        let mut w = Weapon::new(WeaponId::Sword, ItemRarity::Common); // 1 slot
        assert!(add_slot(&mut w, &mut wallet).is_some());
        assert_eq!(w.slot_count(), 2);
        assert!(add_slot(&mut w, &mut wallet).is_some());
        assert_eq!(w.slot_count(), 3);
        assert_eq!(
            add_slot(&mut w, &mut wallet).as_deref(),
            Some("weapon is maxed out")
        );
        // A legendary starts at 4 and can never buy one at all.
        let mut leg = Weapon::new(WeaponId::Sword, ItemRarity::Legendary);
        assert_eq!(leg.slot_count(), 4);
        assert_eq!(
            add_slot(&mut leg, &mut wallet).as_deref(),
            Some("weapon is maxed out")
        );
    }

    #[test]
    fn an_upgrade_tops_the_blade_up_by_a_step_and_not_to_full() {
        // A free repair riding along with every upgrade would make REPAIR
        // pointless — the top-up is `maxDurability * 0.08`, clamped to the new
        // ceiling.
        let mut w = sword();
        w.durability = Some(10);
        let mut wallet = Wallet::new(1_000);
        upgrade_weapon(&mut w, &mut wallet, None, 1.0, flat_rank);
        assert_eq!(w.durability, Some(10 + 2), "30 * 0.08 = 2.4 → 2");
        assert!(w.durability.unwrap() < w.max_durability().unwrap());
    }

    #[test]
    fn salvage_pays_less_than_the_upgrades_cost() {
        // The invariant that stops upgrade-then-salvage being an income stream.
        let mut w = sword();
        let mut spent = 0;
        for lvl in 0..6 {
            spent += upgrade_price(lvl);
            w.upgrade = lvl + 1;
        }
        assert!(
            salvage_value(&w) < spent,
            "salvage {} >= the {} spent upgrading",
            salvage_value(&w),
            spent
        );
    }
}
