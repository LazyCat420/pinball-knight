//! THE ALCHEMIST — the shelf, the pouch and the brew book.
//!
//! PORTS: `economy/tavern-shop.ts` (`POTION_STOCK`, `PRICE_POTION`,
//! `PRICE_FLASK`, `buyPotion`, `buyFlask`, `brew`, and the belt helpers
//! `stowOnBelt`/`unstowFromBelt`/`beltHasRoom`), `recipes.ts` (the whole brew
//! book plus `canCraft`/`craftCost`), `reagents.ts` (the pouch materials) and
//! the `POTIONS` rows of `items.ts` that any of the above name.
//!
//! ## The two halves are not the same shop
//!
//! | | pays with | gives | scope |
//! |---|---|---|---|
//! | **SHELF** | gold | a potion, straight to the belt | the RUN's belt |
//! | **BREW BOOK** | monster reagents + a flask (+ sometimes gold) | a potion, or another flask | the RUN's pouch |
//!
//! Reagents and flasks are RUN-scoped (`reagents.ts`: "they live in
//! state.reagents and reset on death with the rest of the run") while the purse
//! is not — so a player can stand here rich and unable to brew anything.
//!
//! ## Two orderings that are load-bearing
//!
//! 1. `buyPotion` STOWS BEFORE IT PAYS and unwinds if the payment fails. The
//!    other order takes the gold and then discovers there was nowhere to put
//!    the potion.
//! 2. `brew` checks belt room BEFORE consuming, so a full belt never eats the
//!    reagents.
//!
//! Both are transcribed with their reasons because both are the kind of thing a
//! later reader "simplifies" into a bug.

use std::collections::BTreeMap;

use super::{ActionResult, Wallet};

// ── Potions ──────────────────────────────────────────────────────────────────

/// The potion rows this counter can name. `items.ts POTIONS`, restricted to the
/// ids the shelf stocks or a recipe outputs — the belt's own consumption rules
/// (heal, duration) are P4 combat and are NOT here: a screen that only prints a
/// label and a description must not be the reason a duration table exists in
/// two places.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub enum PotionId {
    Health,
    Rage,
    Haste,
    Shield,
    Freeze,
    BallForm,
    MultiBall,
    CurveShot,
    MagnetBoots,
    Regen,
    VenomCoat,
    StoneSkin,
    Static,
    Greed,
    Elixir,
}

impl PotionId {
    /// `POTIONS[id].label`.
    pub fn label(self) -> &'static str {
        match self {
            PotionId::Health => "Health",
            PotionId::Rage => "Rage",
            PotionId::Haste => "Haste",
            PotionId::Shield => "Shield",
            PotionId::Freeze => "Freeze",
            PotionId::BallForm => "Ball Form",
            PotionId::MultiBall => "Multi-Ball",
            PotionId::CurveShot => "Curve Shot",
            PotionId::MagnetBoots => "Magnet Boots",
            PotionId::Regen => "Regen Salve",
            PotionId::VenomCoat => "Venom Coat",
            PotionId::StoneSkin => "Stoneskin",
            PotionId::Static => "Static Charge",
            PotionId::Greed => "Greed Draught",
            PotionId::Elixir => "Elixir of Life",
        }
    }

    /// `POTIONS[id].description` — the shelf row's second line.
    pub fn description(self) -> &'static str {
        match self {
            PotionId::Health => "restores 3 hearts",
            PotionId::Rage => "double damage",
            PotionId::Haste => "faster moves + swings",
            PotionId::Shield => "untouchable",
            PotionId::Freeze => "the floor holds its breath",
            PotionId::BallForm => "you ARE the pinball",
            PotionId::MultiBall => "two echo knights ram for you",
            PotionId::CurveShot => "bending projectiles",
            PotionId::MagnetBoots => "repel crawlers · strips LAUNCH",
            PotionId::Regen => "regenerate over time",
            PotionId::VenomCoat => "your hits POISON",
            PotionId::StoneSkin => "halve damage taken",
            PotionId::Static => "every hit ARCS to a nearby foe",
            PotionId::Greed => "richer kills",
            PotionId::Elixir => "the full flask",
        }
    }

    /// The `ITEM_PAINTS` key — the id its sprite and its baked icon are filed
    /// under. A table, not a lowercased label: "Ball Form" is `ballform`.
    pub fn item_id(self) -> &'static str {
        match self {
            PotionId::Health => "health",
            PotionId::Rage => "rage",
            PotionId::Haste => "haste",
            PotionId::Shield => "shield",
            PotionId::Freeze => "freeze",
            PotionId::BallForm => "ballform",
            PotionId::MultiBall => "multiball",
            PotionId::CurveShot => "curveshot",
            PotionId::MagnetBoots => "magnetboots",
            PotionId::Regen => "regen",
            PotionId::VenomCoat => "venomcoat",
            PotionId::StoneSkin => "stoneskin",
            PotionId::Static => "static",
            PotionId::Greed => "greed",
            PotionId::Elixir => "elixir",
        }
    }

    /// `PRICE_POTION[id] ?? 30` — the shelf price. The fallback is the oracle's
    /// and it is REACHABLE: a brew-only potion has no entry, and `buyPotion`
    /// charges 30 for anything the caller hands it.
    pub fn price(self) -> i64 {
        match self {
            PotionId::Health => 15,
            PotionId::Rage => 28,
            PotionId::Haste => 28,
            PotionId::Shield => 34,
            PotionId::Freeze => 40,
            PotionId::BallForm => 65,
            _ => 30,
        }
    }
}

/// `POTION_STOCK` — what the shelf sells, in its own order.
pub const POTION_STOCK: [PotionId; 6] = [
    PotionId::Health,
    PotionId::Rage,
    PotionId::Haste,
    PotionId::Shield,
    PotionId::Freeze,
    PotionId::BallForm,
];

/// `PRICE_FLASK` — the catalyst, bought rather than brewed.
pub const PRICE_FLASK: i64 = 8;

/// `BELT_MAX` — four distinct potions; a fifth KIND has nowhere to go even
/// though a stack of an existing one always does.
pub const BELT_MAX: usize = 4;

// ── Reagents ─────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub enum ReagentTier {
    Common,
    Uncommon,
    Rare,
}

/// `reagents.ts` — the monster materials a brew consumes. Ordered as the table
/// declares them, which is the order the pouch line prints.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub enum ReagentId {
    SlimeGel,
    BatWing,
    RotFlesh,
    Silk,
    Hide,
    VenomSac,
    GoblinTooth,
    SteelPin,
    IronShard,
    Lodestone,
    Fang,
    Glass,
    Ectoplasm,
    GrimBone,
}

pub const REAGENT_IDS: [ReagentId; 14] = [
    ReagentId::SlimeGel,
    ReagentId::BatWing,
    ReagentId::RotFlesh,
    ReagentId::Silk,
    ReagentId::Hide,
    ReagentId::VenomSac,
    ReagentId::GoblinTooth,
    ReagentId::SteelPin,
    ReagentId::IronShard,
    ReagentId::Lodestone,
    ReagentId::Fang,
    ReagentId::Glass,
    ReagentId::Ectoplasm,
    ReagentId::GrimBone,
];

impl ReagentId {
    pub fn label(self) -> &'static str {
        match self {
            ReagentId::SlimeGel => "Slime Gel",
            ReagentId::BatWing => "Bat Wing",
            ReagentId::RotFlesh => "Rotten Flesh",
            ReagentId::Silk => "Sticky Silk",
            ReagentId::Hide => "Coarse Hide",
            ReagentId::VenomSac => "Venom Sac",
            ReagentId::GoblinTooth => "Goblin Tooth",
            ReagentId::SteelPin => "Steel Pin",
            ReagentId::IronShard => "Iron Shard",
            ReagentId::Lodestone => "Lodestone",
            ReagentId::Fang => "Sharp Fang",
            ReagentId::Glass => "Glass Shard",
            ReagentId::Ectoplasm => "Cold Ectoplasm",
            ReagentId::GrimBone => "Grim Bone",
        }
    }

    pub fn tier(self) -> ReagentTier {
        match self {
            ReagentId::SlimeGel
            | ReagentId::BatWing
            | ReagentId::RotFlesh
            | ReagentId::Silk
            | ReagentId::Hide => ReagentTier::Common,
            ReagentId::VenomSac
            | ReagentId::GoblinTooth
            | ReagentId::SteelPin
            | ReagentId::IronShard
            | ReagentId::Lodestone
            | ReagentId::Fang
            | ReagentId::Glass => ReagentTier::Uncommon,
            ReagentId::Ectoplasm | ReagentId::GrimBone => ReagentTier::Rare,
        }
    }

    /// The gem tint the drop and the pouch swatch use, 0xRRGGBB.
    pub fn swatch(self) -> u32 {
        match self {
            ReagentId::SlimeGel => 0x7bd47b,
            ReagentId::BatWing => 0x8f7bd0,
            ReagentId::RotFlesh => 0x8a9a5b,
            ReagentId::Silk => 0xdfe7f2,
            ReagentId::Hide => 0xa9744f,
            ReagentId::VenomSac => 0xa83fd0,
            ReagentId::GoblinTooth => 0xd0b23f,
            ReagentId::SteelPin => 0xb8c0cc,
            ReagentId::IronShard => 0x9a8f77,
            ReagentId::Lodestone => 0xc0506a,
            ReagentId::Fang => 0xe8e0cf,
            ReagentId::Glass => 0x6fd0e8,
            ReagentId::Ectoplasm => 0xbfe8ff,
            ReagentId::GrimBone => 0xe8e6df,
        }
    }

    /// The `ITEM_PAINTS` key — every reagent has a baked gem icon under its own
    /// lowercase id.
    pub fn item_id(self) -> &'static str {
        match self {
            ReagentId::SlimeGel => "slimegel",
            ReagentId::BatWing => "batwing",
            ReagentId::RotFlesh => "rotflesh",
            ReagentId::Silk => "silk",
            ReagentId::Hide => "hide",
            ReagentId::VenomSac => "venomsac",
            ReagentId::GoblinTooth => "goblintooth",
            ReagentId::SteelPin => "steelpin",
            ReagentId::IronShard => "ironshard",
            ReagentId::Lodestone => "lodestone",
            ReagentId::Fang => "fang",
            ReagentId::Glass => "glass",
            ReagentId::Ectoplasm => "ectoplasm",
            ReagentId::GrimBone => "grimbone",
        }
    }
}

// ── The brew book ────────────────────────────────────────────────────────────

/// What a recipe yields — a potion, or the catalyst itself. `recipes.ts`'s
/// `RecipeOutput`, and the `flask` case is not a curiosity: it is the bootstrap
/// that turns Glass Shards into the thing every other recipe needs, which is
/// why its own flask cost is 0.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RecipeOutput {
    Potion(PotionId),
    Flask,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Recipe {
    pub id: &'static str,
    pub label: &'static str,
    pub output: RecipeOutput,
    /// Reagent cost. A fixed-size slice keeps the table `const`, and no recipe
    /// in the oracle needs more than three inputs.
    pub inputs: &'static [(ReagentId, i32)],
    pub flasks: i32,
    pub gold: i64,
    pub tier: ReagentTier,
}

use PotionId as P;
use ReagentId as R;
use ReagentTier as T;

/// `RECIPES`, in `RECIPE_IDS` order — which is `Object.keys` order, i.e. the
/// literal order of the table, and it IS the order the brew book lists.
pub const RECIPES: [Recipe; 16] = [
    Recipe {
        id: "flask",
        label: "Empty Flask",
        output: RecipeOutput::Flask,
        inputs: &[(R::Glass, 3)],
        flasks: 0,
        gold: 0,
        tier: T::Uncommon,
    },
    Recipe {
        id: "health",
        label: "Health",
        output: RecipeOutput::Potion(P::Health),
        inputs: &[(R::SlimeGel, 2), (R::RotFlesh, 1)],
        flasks: 1,
        gold: 0,
        tier: T::Common,
    },
    Recipe {
        id: "haste",
        label: "Haste",
        output: RecipeOutput::Potion(P::Haste),
        inputs: &[(R::BatWing, 2)],
        flasks: 1,
        gold: 0,
        tier: T::Common,
    },
    Recipe {
        id: "rage",
        label: "Rage",
        output: RecipeOutput::Potion(P::Rage),
        inputs: &[(R::VenomSac, 1), (R::Hide, 1)],
        flasks: 1,
        gold: 0,
        tier: T::Uncommon,
    },
    Recipe {
        id: "shield",
        label: "Shield",
        output: RecipeOutput::Potion(P::Shield),
        inputs: &[(R::IronShard, 1), (R::Lodestone, 1)],
        flasks: 1,
        gold: 0,
        tier: T::Uncommon,
    },
    Recipe {
        id: "curveshot",
        label: "Curve Shot",
        output: RecipeOutput::Potion(P::CurveShot),
        inputs: &[(R::Silk, 1), (R::Fang, 1)],
        flasks: 1,
        gold: 0,
        tier: T::Uncommon,
    },
    Recipe {
        id: "magnetboots",
        label: "Magnet Boots",
        output: RecipeOutput::Potion(P::MagnetBoots),
        inputs: &[(R::Lodestone, 2)],
        flasks: 1,
        gold: 0,
        tier: T::Uncommon,
    },
    Recipe {
        id: "ballform",
        label: "Ball Form",
        output: RecipeOutput::Potion(P::BallForm),
        inputs: &[(R::IronShard, 1), (R::Lodestone, 1), (R::SteelPin, 1)],
        flasks: 1,
        gold: 0,
        tier: T::Uncommon,
    },
    Recipe {
        id: "freeze",
        label: "Freeze",
        output: RecipeOutput::Potion(P::Freeze),
        inputs: &[(R::Ectoplasm, 1), (R::Silk, 2)],
        flasks: 1,
        gold: 0,
        tier: T::Rare,
    },
    Recipe {
        id: "multiball",
        label: "Multi-Ball",
        output: RecipeOutput::Potion(P::MultiBall),
        inputs: &[(R::Lodestone, 1), (R::Ectoplasm, 1)],
        flasks: 1,
        gold: 0,
        tier: T::Rare,
    },
    Recipe {
        id: "regen",
        label: "Regen Salve",
        output: RecipeOutput::Potion(P::Regen),
        inputs: &[(R::SlimeGel, 3)],
        flasks: 1,
        gold: 0,
        tier: T::Common,
    },
    Recipe {
        id: "venomcoat",
        label: "Venom Coat",
        output: RecipeOutput::Potion(P::VenomCoat),
        inputs: &[(R::VenomSac, 2)],
        flasks: 1,
        gold: 0,
        tier: T::Uncommon,
    },
    Recipe {
        id: "stoneskin",
        label: "Stoneskin",
        output: RecipeOutput::Potion(P::StoneSkin),
        inputs: &[(R::IronShard, 2), (R::Lodestone, 1)],
        flasks: 1,
        gold: 0,
        tier: T::Uncommon,
    },
    Recipe {
        id: "static",
        label: "Static Charge",
        output: RecipeOutput::Potion(P::Static),
        inputs: &[(R::Lodestone, 2), (R::SteelPin, 1)],
        flasks: 1,
        gold: 0,
        tier: T::Uncommon,
    },
    Recipe {
        id: "greed",
        label: "Greed Draught",
        output: RecipeOutput::Potion(P::Greed),
        inputs: &[(R::GoblinTooth, 3)],
        flasks: 1,
        gold: 0,
        tier: T::Uncommon,
    },
    Recipe {
        id: "elixir",
        label: "Elixir of Life",
        output: RecipeOutput::Potion(P::Elixir),
        inputs: &[(R::GrimBone, 1), (R::Ectoplasm, 1), (R::SlimeGel, 2)],
        flasks: 2,
        gold: 40,
        tier: T::Rare,
    },
];

// ── The run's alchemy state ──────────────────────────────────────────────────

/// The belt, the pouch and the flask counter — everything the alchemist reads
/// and writes. RUN-scoped, unlike the purse.
///
/// The belt is `[Option<(PotionId, i32)>; BELT_MAX]` and not a map, because
/// SLOTS are the rule: a fifth distinct potion is refused even when the belt
/// holds only four bottles, and stacking an existing one always works.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Satchel {
    pub belt: [Option<(PotionId, i32)>; BELT_MAX],
    pub pouch: BTreeMap<ReagentId, i32>,
    pub flasks: i32,
}

impl Satchel {
    pub fn reagents(&self, id: ReagentId) -> i32 {
        self.pouch.get(&id).copied().unwrap_or(0)
    }

    pub fn add_reagent(&mut self, id: ReagentId, n: i32) {
        *self.pouch.entry(id).or_insert(0) += n;
    }

    /// Spend `n` of a reagent, or nothing at all.
    ///
    /// ALL-OR-NOTHING and `#[must_use]`, the same contract `Wallet::spend`
    /// carries: a partial take would leave a caller believing it had paid for
    /// something it could not afford. The dealer's card forge is the first
    /// consumer — it burns one Grim Bone per craft.
    #[must_use]
    pub fn take_reagent(&mut self, id: ReagentId, n: i32) -> bool {
        if n <= 0 || self.reagents(id) < n {
            return false;
        }
        *self.pouch.entry(id).or_insert(0) -= n;
        true
    }

    /// How many of this potion are on the belt.
    pub fn count(&self, id: PotionId) -> i32 {
        self.belt
            .iter()
            .flatten()
            .find(|(p, _)| *p == id)
            .map(|(_, n)| *n)
            .unwrap_or(0)
    }

    /// `beltHasRoom` — an existing stack always has room; otherwise a free slot
    /// is needed.
    pub fn belt_has_room(&self, id: PotionId) -> bool {
        self.belt.iter().flatten().any(|(p, _)| *p == id)
            || self.belt.iter().flatten().count() < BELT_MAX
    }

    /// `stowOnBelt` — stack if present, else take the FIRST free slot. False
    /// when there is nowhere to put it.
    fn stow(&mut self, id: PotionId) -> bool {
        if let Some(slot) = self.belt.iter_mut().flatten().find(|(p, _)| *p == id) {
            slot.1 += 1;
            return true;
        }
        if let Some(free) = self.belt.iter_mut().find(|s| s.is_none()) {
            *free = Some((id, 1));
            return true;
        }
        false
    }

    /// `unstowFromBelt` — the unwind for a payment that failed after a stow.
    /// Empties the slot at zero, so a refunded purchase leaves no ghost stack.
    fn unstow(&mut self, id: PotionId) {
        for slot in self.belt.iter_mut() {
            if let Some((p, n)) = slot {
                if *p == id {
                    *n -= 1;
                    if *n <= 0 {
                        *slot = None;
                    }
                    return;
                }
            }
        }
    }
}

/// `canCraft` — reagents, flasks and (if any) gold. Pure.
pub fn can_craft(r: &Recipe, s: &Satchel, gold: i64) -> bool {
    if s.flasks < r.flasks {
        return false;
    }
    if r.gold > gold {
        return false;
    }
    r.inputs.iter().all(|(id, need)| s.reagents(*id) >= *need)
}

/// `buyPotion`.
///
/// ⚠️ STOW BEFORE PAYING, AND UNWIND IF THE PAYMENT FAILS. The other order
/// takes the gold and then discovers there was nowhere to put the potion — the
/// oracle says so in as many words, and the unwind is why `unstow` exists.
pub fn buy_potion(id: PotionId, s: &mut Satchel, w: &mut Wallet) -> ActionResult {
    if !s.stow(id) {
        return Some("belt is full".into());
    }
    if !w.spend(id.price()) {
        s.unstow(id);
        return Some("not enough gold".into());
    }
    Some(format!("{} → belt", id.label()))
}

/// `buyFlask`.
pub fn buy_flask(s: &mut Satchel, w: &mut Wallet) -> ActionResult {
    if !w.spend(PRICE_FLASK) {
        return Some("not enough gold".into());
    }
    s.flasks += 1;
    Some("Empty Flask bought".into())
}

/// `brew`.
///
/// ⚠️ THE BELT CHECK COMES BEFORE THE CONSUME, so a full belt never eats the
/// reagents. Everything after the two guards is unconditional: by then the
/// materials, the flasks and the gold are all known to be there.
pub fn brew(recipe_id: &str, s: &mut Satchel, w: &mut Wallet) -> ActionResult {
    let r = RECIPES.iter().find(|r| r.id == recipe_id)?;
    if !can_craft(r, s, w.balance()) {
        return Some("missing materials".into());
    }
    if let RecipeOutput::Potion(p) = r.output {
        if !s.belt_has_room(p) {
            return Some("belt is full".into());
        }
    }
    for (id, n) in r.inputs {
        *s.pouch.entry(*id).or_insert(0) -= n;
    }
    s.flasks -= r.flasks;
    if r.gold > 0 && !w.spend(r.gold) {
        // Unreachable through `can_craft`, which already compared the balance.
        // Kept because `spend` is `#[must_use]` and silently discarding it is
        // exactly how a free-plate bug gets in.
        return Some("not enough gold".into());
    }
    match r.output {
        RecipeOutput::Flask => {
            s.flasks += 1;
            Some("Empty Flask brewed".into())
        }
        RecipeOutput::Potion(p) => {
            s.stow(p);
            Some(format!("{} → belt", r.label))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn stocked() -> (Satchel, Wallet) {
        let mut s = Satchel {
            flasks: 2,
            ..Satchel::default()
        };
        for id in REAGENT_IDS {
            s.add_reagent(id, 3);
        }
        (s, Wallet::new(500))
    }

    #[test]
    fn the_shelf_stocks_six_and_prices_them_as_the_table_does() {
        assert_eq!(POTION_STOCK.len(), 6);
        assert_eq!(PotionId::Health.price(), 15);
        assert_eq!(PotionId::BallForm.price(), 65);
        // The `?? 30` fallback is REACHABLE — a brew-only potion has no entry.
        assert_eq!(PotionId::Elixir.price(), 30);
    }

    #[test]
    fn a_purchase_that_cannot_be_paid_for_leaves_no_ghost_on_the_belt() {
        // THE UNWIND. Stow-then-pay means a failed payment has already put the
        // bottle on the belt; without `unstow` the player keeps it for free.
        let mut s = Satchel::default();
        let mut w = Wallet::new(0);
        assert_eq!(
            buy_potion(PotionId::Health, &mut s, &mut w).as_deref(),
            Some("not enough gold")
        );
        assert_eq!(
            s.count(PotionId::Health),
            0,
            "a refused purchase kept the potion"
        );
        assert_eq!(
            s.belt.iter().flatten().count(),
            0,
            "and it left an empty stack behind"
        );
        assert_eq!(w.balance(), 0);
    }

    #[test]
    fn the_belt_holds_four_kinds_but_any_number_of_one() {
        let mut s = Satchel::default();
        let mut w = Wallet::new(10_000);
        for id in [
            PotionId::Health,
            PotionId::Rage,
            PotionId::Haste,
            PotionId::Shield,
        ] {
            assert!(buy_potion(id, &mut s, &mut w).is_some());
        }
        // A FIFTH KIND has nowhere to go…
        assert_eq!(
            buy_potion(PotionId::Freeze, &mut s, &mut w).as_deref(),
            Some("belt is full")
        );
        // …while a second of one already there always does.
        assert!(buy_potion(PotionId::Health, &mut s, &mut w).is_some_and(|m| m.contains("belt")));
        assert_eq!(s.count(PotionId::Health), 2);
    }

    #[test]
    fn a_full_belt_does_not_eat_the_reagents() {
        // The ordering the oracle calls out: check belt room BEFORE consuming.
        let (mut s, mut w) = stocked();
        let mut fill = Wallet::new(10_000);
        for id in [
            PotionId::Rage,
            PotionId::Haste,
            PotionId::Shield,
            PotionId::Freeze,
        ] {
            buy_potion(id, &mut s, &mut fill);
        }
        let before = s.reagents(ReagentId::SlimeGel);
        let flasks = s.flasks;
        assert_eq!(
            brew("health", &mut s, &mut w).as_deref(),
            Some("belt is full")
        );
        assert_eq!(
            s.reagents(ReagentId::SlimeGel),
            before,
            "the brew ate the gel anyway"
        );
        assert_eq!(s.flasks, flasks, "…and the flask");
    }

    #[test]
    fn brewing_consumes_exactly_what_the_recipe_names() {
        let (mut s, mut w) = stocked();
        let gold = w.balance();
        assert_eq!(
            brew("health", &mut s, &mut w).as_deref(),
            Some("Health → belt")
        );
        assert_eq!(s.reagents(ReagentId::SlimeGel), 1, "2 gel");
        assert_eq!(s.reagents(ReagentId::RotFlesh), 2, "1 rot flesh");
        assert_eq!(s.flasks, 1, "1 flask");
        assert_eq!(w.balance(), gold, "a free recipe must not charge");
        assert_eq!(s.count(PotionId::Health), 1);
    }

    #[test]
    fn the_flask_recipe_is_the_bootstrap_and_costs_no_flask() {
        // Its own `flasks: 0` is the whole point: with none in the pouch you can
        // still turn glass into the catalyst everything else needs.
        let mut s = Satchel::default();
        s.add_reagent(ReagentId::Glass, 3);
        let mut w = Wallet::new(0);
        assert!(
            can_craft(&RECIPES[0], &s, 0),
            "the bootstrap is gated on nothing but glass"
        );
        assert_eq!(
            brew("flask", &mut s, &mut w).as_deref(),
            Some("Empty Flask brewed")
        );
        assert_eq!(s.flasks, 1);
        assert_eq!(s.reagents(ReagentId::Glass), 0);
    }

    #[test]
    fn a_gold_fee_is_charged_and_gates_the_brew() {
        let (mut s, mut w) = stocked();
        let mut poor = Wallet::new(39); // the Elixir's fee is 40
        assert!(!can_craft(&RECIPES[15], &s, poor.balance()));
        assert_eq!(
            brew("elixir", &mut s.clone(), &mut poor).as_deref(),
            Some("missing materials")
        );
        assert_eq!(poor.balance(), 39, "a refused brew must not charge");
        assert_eq!(
            brew("elixir", &mut s, &mut w).as_deref(),
            Some("Elixir of Life → belt")
        );
        assert_eq!(w.balance(), 460);
        assert_eq!(s.flasks, 0, "the Elixir takes TWO flasks");
    }

    #[test]
    fn an_unknown_recipe_is_none_and_not_a_message() {
        // `None` and `Some(message)` are different outcomes — see ActionResult.
        let (mut s, mut w) = stocked();
        assert_eq!(brew("no-such-brew", &mut s, &mut w), None);
    }

    #[test]
    fn every_recipe_names_a_reagent_the_pouch_can_hold() {
        // The oracle's tables are two files that can drift; here they are two
        // enums that cannot — but a recipe with an EMPTY input list would be a
        // free potion, and that this catches.
        for r in RECIPES {
            assert!(!r.inputs.is_empty(), "{} costs no reagents", r.id);
            assert!(r.flasks >= 0 && r.gold >= 0);
        }
    }
}
