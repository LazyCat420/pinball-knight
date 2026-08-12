//! The card dealer's counter — the card half of
//! `legacy/src/game/pinball-knight/economy/tavern-shop.ts`.
//!
//! Cards are MONSTER TROPHIES. The shelf exists so a run that rolled badly is
//! not dead, NOT as a way to buy the build you want — hence steep prices and
//! three pulls you cannot choose.
//!
//! ## The shape of this counter, and the two things that surprise a reader
//!
//! **Socketing and un-socketing are FREE in gold.** There is no `Wallet`
//! parameter on either. The cost of a respec is a RARITY TIER and a re-roll of
//! which card you get back — losing the level you earned as well would make
//! un-socketing a level-9 card unthinkable, and the point of the mechanic is
//! that respeccing stays available.
//!
//! **Buying SHRINKS the shelf.** `buy_card` removes the offer rather than
//! blanking it, so indices shift and the focusable count changes between
//! frames. That is the oracle's behaviour and it is what makes the shelf feel
//! like a counter rather than a menu; a reviewer will read it as a bug.
//!
//! PORTS: `economy/tavern-shop.ts`

use crate::cards::{
    card_base, card_def, card_fits_kind, card_key, cards_of_rarity, roll_card_level, roll_shiny,
    socket_card, CardRarity, CARD_LEVEL_MAX,
};
use crate::economy::alchemist::{ReagentId, Satchel};
use crate::economy::forge::Weapon;
use crate::economy::{ActionResult, Wallet};

/// What a card costs on the shelf.
pub fn price_card(r: CardRarity) -> i64 {
    match r {
        CardRarity::Common => 55,
        CardRarity::Rare => 170,
        CardRarity::Epic => 420,
        CardRarity::Legendary => 900,
        CardRarity::Mythic => 1800,
    }
}

pub const PRICE_REROLL_BAR: i64 = 15;
pub const PRICE_REROLL_CARD: i64 = 40;
/// The card forge eats one of these per craft.
pub const FORGE_CATALYST: ReagentId = ReagentId::GrimBone;
/// Three pulls, and you cannot choose them.
pub const SHELF_SLOTS: usize = 3;
/// Attempts to find a DISTINCT base before accepting a duplicate.
const SHELF_ATTEMPTS: usize = 12;

/// The three pulls on the counter.
///
/// The oracle keeps this in a module-level `let barOffers`. The port has no
/// global rules state, so the VISIT owns it — `TavernRes`, beside
/// `forge_armed`. That also makes [`buy_card`]'s shrink an explicit mutation
/// of a named thing rather than a hidden side effect.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Shelf {
    pub offers: Vec<String>,
}

impl Shelf {
    pub fn is_empty(&self) -> bool {
        self.offers.is_empty()
    }
    pub fn len(&self) -> usize {
        self.offers.len()
    }
}

/// Restock the shelf with three distinct cards.
///
/// ⚠️ THE SHELF'S RARITY WEIGHTS ARE NOT THE DROP RATES — 50/32/13/4/1 here,
/// against `cards::roll_card_drop`'s gates. Nothing is shared between them and
/// nothing should be: one is a shop, the other is loot.
///
/// Distinctness is by BASE, with a bounded retry rather than a filtered bag:
/// the rarity roll is what makes the shelf interesting so it is re-rolled too,
/// and the LAST attempt accepts a duplicate because a duplicate beats an empty
/// slot. Each slot used to roll independently, and with five cards per rarity
/// and half the weight on commons the shelf showed the same card twice about a
/// third of the time — three slots, two choices, and the dealer looked broken
/// rather than unlucky.
pub fn roll_bar_offers(shelf: &mut Shelf, deepest_floor: i32, rand: &mut dyn FnMut() -> f64) {
    let mut taken: Vec<&'static str> = Vec::new();
    let mut pool = Vec::with_capacity(SHELF_SLOTS);
    for _ in 0..SHELF_SLOTS {
        for attempt in 0..SHELF_ATTEMPTS {
            let r = rand();
            let rarity = if r < 0.5 {
                CardRarity::Common
            } else if r < 0.82 {
                CardRarity::Rare
            } else if r < 0.95 {
                CardRarity::Epic
            } else if r < 0.99 {
                CardRarity::Legendary
            } else {
                CardRarity::Mythic
            };
            let bag = cards_of_rarity(rarity);
            let base = bag[(rand() * bag.len() as f64).floor() as usize % bag.len()];
            if taken.contains(&base) && attempt < SHELF_ATTEMPTS - 1 {
                continue;
            }
            taken.push(base);
            // Levelled off how DEEP the run has been, not off floor 1: a
            // twenty-floor run returning to a shelf of level-1 chips would make
            // the dealer strictly worse than the dungeon, and the shelf would
            // stop being a reason to hold gold.
            let level = roll_card_level(deepest_floor, rand);
            let shiny = roll_shiny(false, rand);
            pool.push(card_key(base, level, shiny));
            break;
        }
    }
    shelf.offers = pool;
}

/// Buy the offer at `idx`.
///
/// The offer is REMOVED on success — see the module header.
pub fn buy_card(
    shelf: &mut Shelf,
    stash: &mut Vec<String>,
    idx: usize,
    wallet: &mut Wallet,
) -> ActionResult {
    let id = shelf.offers.get(idx).cloned()?;
    let def = card_def(&id)?;
    if !wallet.spend(price_card(def.rarity())) {
        return Some("not enough gold".into());
    }
    let label = def.label().to_string();
    stash.push(id);
    shelf.offers.remove(idx);
    Some(format!("bought {label}"))
}

/// Pay for a fresh shelf.
///
/// ⚠️ SILENT ON SUCCESS. The new shelf IS the feedback, so a message would be
/// noise; `None` here means "it happened", not "nothing happened".
pub fn reroll_bar(
    shelf: &mut Shelf,
    deepest_floor: i32,
    wallet: &mut Wallet,
    rand: &mut dyn FnMut() -> f64,
) -> ActionResult {
    if !wallet.spend(PRICE_REROLL_BAR) {
        return Some("not enough gold".into());
    }
    roll_bar_offers(shelf, deepest_floor, rand);
    None
}

/// Slot a stash card into the weapon. FREE.
///
/// The kind check is duplicated here (`socket_card` makes it too) purely to
/// give the two refusals distinct messages — "doesn't fit" and "no free slot"
/// send the player to different remedies.
pub fn socket_stash_card(
    stash: &mut Vec<String>,
    w: &mut Weapon,
    stash_idx: usize,
) -> ActionResult {
    let id = stash.get(stash_idx).cloned()?;
    if !card_fits_kind(&id, w.id.kind()) {
        return Some("this card doesn't fit that weapon".into());
    }
    if !socket_card(w, &id) {
        return Some("no free slot on that weapon".into());
    }
    stash.remove(stash_idx);
    None
}

/// Pull a card back out of a weapon. FREE in gold; costs a RARITY TIER.
///
/// ⚠️ THE CARD LEAVES THE WEAPON UNCONDITIONALLY, before its fate is decided,
/// and a COMMON is DESTROYED — it has no tier to fall to. Everything else
/// drops one tier AND re-rolls which card it is, keeping the level and the
/// shine. That asymmetry is the whole mechanic: the respec is always
/// available, and it is never free.
pub fn unsocket_card(
    w: &mut Weapon,
    stash: &mut Vec<String>,
    card_idx: usize,
    rand: &mut dyn FnMut() -> f64,
) -> ActionResult {
    if card_idx >= w.cards.len() {
        return None;
    }
    let removed = w.cards.remove(card_idx);
    let def = card_def(&removed)?;
    let Some(lower) = def.rarity().lower() else {
        return Some("common card crumbled to dust".into());
    };
    let bag = cards_of_rarity(lower);
    let pick = bag[(rand() * bag.len() as f64).floor() as usize % bag.len()];
    stash.push(crate::cards::re_key_card(&removed, pick));
    Some(format!("un-socketed \u{2192} dropped to {}", lower.label()))
}

/// Pay to swap a stash card for another of the SAME rarity.
pub fn reroll_card(
    stash: &mut [String],
    idx: usize,
    wallet: &mut Wallet,
    rand: &mut dyn FnMut() -> f64,
) -> ActionResult {
    let cur = stash.get(idx).cloned()?;
    let def = card_def(&cur)?;
    if !wallet.spend(PRICE_REROLL_CARD) {
        return Some("not enough gold".into());
    }
    // Excluding the current base, so the reroll always MOVES.
    let base = card_base(&cur);
    let bag: Vec<_> = cards_of_rarity(def.rarity())
        .into_iter()
        .filter(|c| *c != base)
        .collect();
    if bag.is_empty() {
        return Some(format!("rerolled \u{2192} {}", def.label()));
    }
    let pick = bag[(rand() * bag.len() as f64).floor() as usize % bag.len()];
    let next = crate::cards::re_key_card(&cur, pick);
    let label = card_def(&next).map_or_else(|| next.clone(), |d| d.label().to_string());
    stash[idx] = next;
    Some(format!("rerolled \u{2192} {label}"))
}

/// Can these two picks be forged? Exactly two, both common.
///
/// ⚠️ THE CATALYST IS NOT CHECKED HERE. The Grim Bone gate lives inside
/// [`forge_cards`] and surfaces as a message, deliberately: a greyed button
/// with no explanation never teaches the player that the catalyst exists.
pub fn can_forge(stash: &[String], picks: &[usize]) -> bool {
    picks.len() == 2
        && picks[0] != picks[1]
        && picks.iter().all(|i| {
            stash
                .get(*i)
                .and_then(|id| card_def(id))
                .is_some_and(|d| d.rarity() == CardRarity::Common)
        })
}

/// Burn two commons and a Grim Bone for one rare.
///
/// The forge used to be unlimited and free, which made rare cards
/// manufacturable from the commons the dungeon hands out by the dozen.
pub fn forge_cards(
    stash: &mut Vec<String>,
    picks: &[usize],
    satchel: &mut Satchel,
    rand: &mut dyn FnMut() -> f64,
) -> ActionResult {
    if !can_forge(stash, picks) {
        return None;
    }
    if !satchel.take_reagent(FORGE_CATALYST, 1) {
        return Some("the forge needs a Grim Bone".into());
    }
    let (a, b) = (stash[picks[0]].clone(), stash[picks[1]].clone());
    let (ia, ib) = (crate::cards::parse_card(&a), crate::cards::parse_card(&b));
    // Two of a level make something better than one; a mismatch just takes the
    // higher, so feeding a level-1 to a level-9 is never a downgrade.
    let level = (ia.level.max(ib.level) + i32::from(ia.level == ib.level)).min(CARD_LEVEL_MAX);
    let shiny = ia.shiny || ib.shiny;
    let bag = cards_of_rarity(CardRarity::Rare);
    let pick = bag[(rand() * bag.len() as f64).floor() as usize % bag.len()];
    let out = card_key(pick, level, shiny);
    // DESCENDING, so the removals cannot shift each other.
    let mut idx = picks.to_vec();
    idx.sort_unstable_by(|a, b| b.cmp(a));
    for i in idx {
        stash.remove(i);
    }
    let label = card_def(&out).map_or_else(|| out.clone(), |d| d.label().to_string());
    stash.push(out);
    let lv = if level > 1 {
        format!(" Lv{level}")
    } else {
        String::new()
    };
    let sh = if shiny { " SHINY" } else { "" };
    Some(format!("forged a RARE: {label}{lv}{sh}"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::economy::forge::{ItemRarity, WeaponId};

    fn seq(vals: &[f64]) -> impl FnMut() -> f64 + '_ {
        let mut i = 0;
        move || {
            let v = vals[i % vals.len()];
            i += 1;
            v
        }
    }

    fn purse(n: i64) -> Wallet {
        Wallet::new(n)
    }

    #[test]
    fn the_shelf_rolls_three_distinct_cards() {
        let mut shelf = Shelf::default();
        // A varied stream, so the rarity roll and the bag index both move.
        let stream: Vec<f64> = (0..64).map(|i| f64::from(i % 17) / 17.0).collect();
        roll_bar_offers(&mut shelf, 1, &mut seq(&stream));
        assert_eq!(shelf.len(), SHELF_SLOTS);
        let mut bases: Vec<_> = shelf.offers.iter().map(|o| card_base(o)).collect();
        bases.sort_unstable();
        bases.dedup();
        assert_eq!(bases.len(), SHELF_SLOTS, "the shelf showed a duplicate");
    }

    /// A duplicate beats an empty slot: the twelfth attempt gives up and takes
    /// whatever it rolled.
    #[test]
    fn the_last_attempt_accepts_a_duplicate_rather_than_leaving_a_gap() {
        let mut shelf = Shelf::default();
        // A constant stream can only ever produce ONE base, so slots 2 and 3
        // must exhaust their retries and accept it.
        roll_bar_offers(&mut shelf, 1, &mut seq(&[0.0]));
        assert_eq!(shelf.len(), SHELF_SLOTS, "a slot was left empty");
        assert_eq!(
            shelf.offers[0], shelf.offers[1],
            "the retry did not give up"
        );
    }

    #[test]
    fn the_shelf_is_levelled_off_the_deepest_floor_and_not_off_floor_one() {
        let stream: Vec<f64> = (0..64).map(|i| f64::from(i % 17) / 17.0).collect();
        let mut shallow = Shelf::default();
        roll_bar_offers(&mut shallow, 1, &mut seq(&stream));
        let mut deep = Shelf::default();
        roll_bar_offers(&mut deep, 20, &mut seq(&stream));
        let lv = |s: &Shelf| -> i32 { s.offers.iter().map(|o| crate::cards::card_level(o)).sum() };
        assert!(
            lv(&deep) > lv(&shallow),
            "a deep run must not be offered floor-1 chips"
        );
    }

    #[test]
    fn buying_splices_the_offer_out_and_the_shelf_shrinks() {
        let mut shelf = Shelf {
            offers: vec!["spidersilk".into(), "goblintooth".into()],
        };
        let mut stash = Vec::new();
        let mut w = purse(1000);
        let msg = buy_card(&mut shelf, &mut stash, 0, &mut w);
        assert_eq!(msg.as_deref(), Some("bought Spider Silk"));
        assert_eq!(shelf.offers, vec!["goblintooth".to_string()]);
        assert_eq!(stash, vec!["spidersilk".to_string()]);
        assert_eq!(w.balance(), 1000 - price_card(CardRarity::Common));
    }

    #[test]
    fn a_refused_purchase_leaves_the_shelf_and_the_purse_alone() {
        let mut shelf = Shelf {
            offers: vec!["bloodpact".into()],
        };
        let mut stash = Vec::new();
        let mut w = purse(10);
        assert_eq!(
            buy_card(&mut shelf, &mut stash, 0, &mut w).as_deref(),
            Some("not enough gold")
        );
        assert_eq!(shelf.len(), 1);
        assert!(stash.is_empty());
        assert_eq!(w.balance(), 10);
        // …and an index nobody offered is NOT an error message, it is nothing.
        assert_eq!(buy_card(&mut shelf, &mut stash, 9, &mut w), None);
    }

    /// `None` is "it happened", `Some` is "it did not" — the inverse of what a
    /// reader expects, so it is pinned.
    #[test]
    fn rerolling_the_shelf_is_silent_on_success_and_speaks_only_when_broke() {
        let mut shelf = Shelf::default();
        let mut w = purse(100);
        assert_eq!(
            reroll_bar(&mut shelf, 1, &mut w, &mut seq(&[0.3, 0.5])),
            None
        );
        assert_eq!(shelf.len(), SHELF_SLOTS);
        assert_eq!(w.balance(), 100 - PRICE_REROLL_BAR);
        let mut broke = purse(1);
        assert_eq!(
            reroll_bar(&mut shelf, 1, &mut broke, &mut seq(&[0.3])).as_deref(),
            Some("not enough gold")
        );
        assert_eq!(broke.balance(), 1);
    }

    #[test]
    fn socketing_and_un_socketing_cost_no_gold() {
        let mut w = Weapon::new(WeaponId::Sword, ItemRarity::Rare);
        let mut stash = vec!["spidersilk".to_string()];
        assert_eq!(socket_stash_card(&mut stash, &mut w, 0), None);
        assert!(stash.is_empty());
        assert_eq!(w.cards, vec!["spidersilk".to_string()]);
        // Neither function takes a Wallet at all — this is the compile-time
        // half of the claim; the runtime half is that nothing else moved.
        let msg = unsocket_card(&mut w, &mut stash, 0, &mut seq(&[0.0]));
        assert!(msg.is_some());
        assert!(w.cards.is_empty());
    }

    #[test]
    fn a_card_that_does_not_fit_is_refused_by_a_different_name_than_a_full_weapon() {
        let mut w = Weapon::new(WeaponId::Sword, ItemRarity::Common); // melee, 1 slot
        let mut stash = vec!["webspinnersilk".to_string(), "spidersilk".to_string()];
        assert_eq!(
            socket_stash_card(&mut stash, &mut w, 0).as_deref(),
            Some("this card doesn't fit that weapon")
        );
        assert_eq!(stash.len(), 2, "a refused card stays in the stash");
        // Fill the one slot, then the SAME card gets the other message.
        assert_eq!(socket_stash_card(&mut stash, &mut w, 1), None);
        stash.push("midgetclaw".to_string());
        assert_eq!(
            socket_stash_card(&mut stash, &mut w, 1).as_deref(),
            Some("no free slot on that weapon")
        );
    }

    /// The harshest rule on the counter, and the one a reader will soften.
    #[test]
    fn un_socketing_a_common_destroys_it() {
        let mut w = Weapon::new(WeaponId::Sword, ItemRarity::Rare);
        assert!(socket_card(&mut w, "spidersilk")); // common
        let mut stash = Vec::new();
        assert_eq!(
            unsocket_card(&mut w, &mut stash, 0, &mut seq(&[0.0])).as_deref(),
            Some("common card crumbled to dust")
        );
        assert!(w.cards.is_empty(), "the card left the weapon");
        assert!(stash.is_empty(), "…and nothing came back");
    }

    #[test]
    fn un_socketing_keeps_the_level_and_the_shine_and_costs_only_the_tier() {
        let mut w = Weapon::new(WeaponId::Sword, ItemRarity::Rare);
        w.cards.push("flailerjaw#7s".to_string()); // legendary, Lv7, shiny
        let mut stash = Vec::new();
        let msg = unsocket_card(&mut w, &mut stash, 0, &mut seq(&[0.0]));
        assert_eq!(msg.as_deref(), Some("un-socketed \u{2192} dropped to epic"));
        assert_eq!(stash.len(), 1);
        let back = crate::cards::parse_card(&stash[0]);
        assert_eq!(back.level, 7, "the level you EARNED must survive");
        assert!(back.shiny, "…and so must the shine");
        assert_eq!(
            card_def(&stash[0]).unwrap().rarity(),
            CardRarity::Epic,
            "only the tier is paid"
        );
    }

    #[test]
    fn rerolling_a_card_keeps_its_rarity_and_never_returns_the_same_base() {
        let mut stash = vec!["goblintooth".to_string()]; // rare
        for r in [0.0, 0.3, 0.6, 0.9] {
            stash[0] = "goblintooth".to_string();
            let mut w = purse(500);
            let msg = reroll_card(&mut stash, 0, &mut w, &mut seq(&[r]));
            assert!(msg.is_some());
            assert_ne!(
                card_base(&stash[0]),
                "goblintooth",
                "the reroll stood still"
            );
            assert_eq!(card_def(&stash[0]).unwrap().rarity(), CardRarity::Rare);
            assert_eq!(w.balance(), 500 - PRICE_REROLL_CARD);
        }
    }

    #[test]
    fn can_forge_wants_exactly_two_distinct_commons() {
        let stash = vec![
            "spidersilk".to_string(),  // common
            "midgetclaw".to_string(),  // common
            "goblintooth".to_string(), // rare
        ];
        assert!(can_forge(&stash, &[0, 1]));
        assert!(!can_forge(&stash, &[0]), "one pick is not a forge");
        assert!(!can_forge(&stash, &[0, 1, 2]), "three picks is not a forge");
        assert!(!can_forge(&stash, &[0, 2]), "a rare cannot be an input");
        assert!(
            !can_forge(&stash, &[0, 0]),
            "the same card twice is one card"
        );
        assert!(!can_forge(&stash, &[0, 9]), "an index nobody holds");
    }

    /// The button stays LIVE without a catalyst, and the refusal explains
    /// itself — see [`can_forge`].
    #[test]
    fn the_forge_needs_a_grim_bone_and_says_so_rather_than_greying_out() {
        let mut stash = vec!["spidersilk".to_string(), "midgetclaw".to_string()];
        let mut empty = Satchel::default();
        assert!(
            can_forge(&stash, &[0, 1]),
            "the button must not be disabled"
        );
        assert_eq!(
            forge_cards(&mut stash, &[0, 1], &mut empty, &mut seq(&[0.0])).as_deref(),
            Some("the forge needs a Grim Bone")
        );
        assert_eq!(stash.len(), 2, "a refused forge consumes nothing");
    }

    #[test]
    fn forging_burns_one_catalyst_and_both_inputs_whatever_the_pick_order() {
        for picks in [[0usize, 3usize], [3, 0]] {
            let mut stash = vec![
                "spidersilk".to_string(),
                "goblintooth".to_string(),
                "bloodpact".to_string(),
                "midgetclaw".to_string(),
            ];
            let mut sat = Satchel::default();
            sat.add_reagent(FORGE_CATALYST, 2);
            let msg = forge_cards(&mut stash, &picks, &mut sat, &mut seq(&[0.0]));
            assert!(msg.unwrap().starts_with("forged a RARE:"));
            assert_eq!(sat.reagents(FORGE_CATALYST), 1, "exactly one bone");
            // The two commons are gone, the two others survive, and the new
            // rare is on the end — regardless of which order the picks came in.
            assert_eq!(stash.len(), 3);
            assert!(stash.contains(&"goblintooth".to_string()));
            assert!(stash.contains(&"bloodpact".to_string()));
            assert!(!stash.contains(&"spidersilk".to_string()));
            assert!(!stash.contains(&"midgetclaw".to_string()));
            assert_eq!(
                card_def(stash.last().unwrap()).unwrap().rarity(),
                CardRarity::Rare
            );
        }
    }

    #[test]
    fn matching_levels_add_one_and_a_mismatch_takes_the_higher() {
        let forge = |a: &str, b: &str| -> String {
            let mut stash = vec![a.to_string(), b.to_string()];
            let mut sat = Satchel::default();
            sat.add_reagent(FORGE_CATALYST, 1);
            forge_cards(&mut stash, &[0, 1], &mut sat, &mut seq(&[0.0]));
            stash.pop().unwrap()
        };
        // Two level-4s make a 5.
        assert_eq!(
            crate::cards::card_level(&forge("spidersilk#4", "midgetclaw#4")),
            5
        );
        // A 4 and a 7 make a 7 — feeding a low card in is never a downgrade.
        assert_eq!(
            crate::cards::card_level(&forge("spidersilk#4", "midgetclaw#7")),
            7
        );
        // Two level-10s stay at the cap.
        assert_eq!(
            crate::cards::card_level(&forge("spidersilk#10", "midgetclaw#10")),
            CARD_LEVEL_MAX
        );
        // Either input shiny makes the output shiny.
        assert!(crate::cards::is_shiny_card(&forge(
            "spidersilk#2s",
            "midgetclaw#2"
        )));
    }

    /// The oracle deleted a cap of 10 on purpose. Guard the reintroduction at
    /// the one counter that pushes to the stash most.
    #[test]
    fn the_stash_has_no_cap() {
        let mut stash = Vec::new();
        let mut w = purse(100_000);
        for _ in 0..30 {
            let mut shelf = Shelf {
                offers: vec!["spidersilk".into()],
            };
            buy_card(&mut shelf, &mut stash, 0, &mut w);
        }
        assert_eq!(stash.len(), 30);
    }
}
