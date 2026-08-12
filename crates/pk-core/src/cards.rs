//! The card system — `legacy/src/game/pinball-knight/cards.ts` (885 lines).
//!
//! Two axes upgrade you: the skill tree upgrades the PLAYER, cards upgrade the
//! GEAR. A card is never equipped standalone; it slots into a weapon bounded by
//! that item's rarity. Effects come in three flavours — STAT (folded by
//! [`aggregate_cards`]), ON-HIT (a status stamped on the struck enemy), and
//! PINBALL (live only while carrying momentum).
//!
//! The oracle file is deliberately DOM-free and three-free so the aggregation
//! maths is unit-testable, which is why it ports here as pure rules with no
//! renderer attached. The card FACE is a separate bake — a card in the UI is
//! `cardFaceAt()`, a different renderer at a different aspect, not an icon.
//!
//! ## Three things a reader will want to change, and should not
//!
//! 1. **No memo cache.** The oracle memoises `cardDef` into `_instanceDefs`
//!    because its painter resolves the same id many times a frame. Here a bare
//!    id returns `&'static` with zero work and only a `#LVs` id derives — ~12
//!    branches and one small `Vec`. A `OnceLock<Mutex<HashMap>>` would put
//!    interior mutability and a lock into the one module that must stay
//!    trivially testable, in a crate that compiles to wasm. Recompute.
//! 2. **No HashMap for the catalogue.** 25 string compares that fail on the
//!    first byte beat hashing, need no `OnceLock`, and keep the order that
//!    [`cards_of_rarity`]'s callers index into.
//! 3. **THE STASH IS UNCAPPED.** The oracle deleted an old cap of 10 on
//!    purpose and replaced it with a doc comment; every former cap site simply
//!    pushes. Do not reintroduce one.
//!
//! RNG is threaded as `&mut dyn FnMut() -> f64`, not the single `roll: f64`
//! value [`crate::economy::forge`] takes: these functions make a VARIABLE
//! number of draws, and the count and order is the thing the tests pin.

use std::borrow::Cow;

use crate::economy::forge::{Weapon, WeaponKind};

/// `Math.round` — half UP toward +∞, not Rust's half-away-from-zero. Every
/// value here is positive so the two agree in practice; transcribed anyway
/// because the port's convention is to write the JS semantics down.
fn js_round(v: f64) -> f64 {
    (v + 0.5).floor()
}

/// Round a multiplier to 3dp, so float noise never reaches a card face.
fn r3(v: f64) -> f64 {
    js_round(v * 1000.0) / 1000.0
}

/// JS truthiness for an optional number: `if (m.x)` is false for `undefined`
/// AND for `0`.
///
/// ⚠️ Load-bearing. Every branch in the oracle guards this way, so `Some(0)`
/// and `Some(0.0)` must read as ABSENT or a zero-valued field would start
/// emitting rows and scaling. `Some(1.0)` is truthy (1 is truthy in JS) and IS
/// reached — `scale_modifier` scales it and `modifier_rows` then filters it
/// with a separate `!= 1` test.
fn truthy(v: Option<f64>) -> Option<f64> {
    v.filter(|x| *x != 0.0)
}

fn truthy_i(v: Option<i32>) -> Option<i32> {
    v.filter(|x| *x != 0)
}

/// Card rarity, low → high.
///
/// **That ordering IS the oracle's `CARD_RANK`** (`tavern-shop.ts:83`), so
/// [`CardRarity::rank`] is the discriminant and insurance can sort rarest-first
/// without a second table.
///
/// ⚠️ NOT [`crate::economy::forge::ItemRarity`], which has four variants and no
/// Mythic. They answer different questions — item rarity decides sockets,
/// salvage and insurance price; card rarity decides shelf price and what an
/// un-socket drops to — and merging them would give a mythic weapon four slots.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub enum CardRarity {
    Common,
    Rare,
    Epic,
    Legendary,
    Mythic,
}

impl CardRarity {
    /// The insurance sort key. Higher is rarer.
    pub fn rank(self) -> i32 {
        self as i32
    }

    /// One tier down, or `None` at common — the oracle's `lowerRarity`. An
    /// un-socketed common has nowhere to fall, which is why it crumbles.
    pub fn lower(self) -> Option<CardRarity> {
        match self {
            CardRarity::Common => None,
            CardRarity::Rare => Some(CardRarity::Common),
            CardRarity::Epic => Some(CardRarity::Rare),
            CardRarity::Legendary => Some(CardRarity::Epic),
            CardRarity::Mythic => Some(CardRarity::Legendary),
        }
    }

    /// `RARITY_HEX` — the band colour on a card face.
    pub fn hex(self) -> u32 {
        match self {
            CardRarity::Common => 0x9a_a4b4,
            CardRarity::Rare => 0x4f_8fdb,
            CardRarity::Epic => 0xa4_6fe8,
            CardRarity::Legendary => 0xf0_a63c,
            CardRarity::Mythic => 0xff_77e9,
        }
    }

    pub fn label(self) -> &'static str {
        match self {
            CardRarity::Common => "common",
            CardRarity::Rare => "rare",
            CardRarity::Epic => "epic",
            CardRarity::Legendary => "legendary",
            CardRarity::Mythic => "mythic",
        }
    }
}

/// The status a card stamps on a struck enemy.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum OnHit {
    Chill,
    Burn,
}

/// Which weapons a card fits — `CardDef.weaponKinds`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum WeaponKinds {
    Melee,
    Ranged,
    Both,
}

/// The monster a card is the essence of.
///
/// ⚠️ A SUBSET, pending the `state.ts` port: only the 12 kinds the card
/// catalogue names. [`cards_of_source`] is its one consumer here. When the
/// full `EnemyKind` lands this becomes a re-export.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EnemyKind {
    Zombie,
    Bat,
    Spider,
    Goblin,
    Spitter,
    Wisp,
    Ghost,
    Crystalback,
    Webspinner,
    Reaper,
    Necromancer,
    Golem,
    Brute,
}

/// The eight zombie sub-types.
///
/// All eight share `kind: Zombie`, so `source` alone cannot tell a Hulk card
/// from a Midget card — hence a second field. Same subset caveat as
/// [`EnemyKind`].
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ZombieType {
    Shambler,
    Midget,
    Hobbler,
    Runner,
    Lurcher,
    Hulk,
    Crawler,
    Flailer,
}

/// What a card DOES. Every field optional; absent means neutral.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct CardModifier {
    /// Flat damage, added AFTER the percent multiplier.
    pub damage_flat: Option<i32>,
    /// 1.3 = +30%. Multiplied across sockets.
    pub damage_mult: Option<f64>,
    /// < 1 is faster. Multiplied across sockets.
    pub cooldown_mult: Option<f64>,
    /// > 1 is tougher. Multiplied across sockets.
    pub durability_mult: Option<f64>,
    pub on_hit: Option<OnHit>,
    /// Bonus damage only while riding momentum.
    pub pinball_mult: Option<f64>,
    /// On hit, arc a THUNDERBOLT along the strike line.
    ///
    /// A plain `bool` and not an `Option`: the catalogue only ever holds
    /// `true`, and `if (m.bolt)` is the same test either way.
    pub bolt: bool,
    /// Bonus only while a marble MATERIAL is active.
    pub material_mult: Option<f64>,
    /// [0..1], summed across sockets, capped at 1.
    pub crit_chance: Option<f64>,
    /// Max across sockets; defaults to 2 when any crit card is present.
    pub crit_mult: Option<f64>,
    /// HP per landed hit, summed.
    pub lifesteal: Option<i32>,
    /// Extra enemies a ranged shot passes through, summed.
    pub pierce: Option<i32>,
}

/// The all-absent modifier — the `..NEUTRAL` every catalogue entry ends with.
pub const NEUTRAL: CardModifier = CardModifier {
    damage_flat: None,
    damage_mult: None,
    cooldown_mult: None,
    durability_mult: None,
    on_hit: None,
    pinball_mult: None,
    bolt: false,
    material_mult: None,
    crit_chance: None,
    crit_mult: None,
    lifesteal: None,
    pierce: None,
};

impl Default for CardModifier {
    fn default() -> Self {
        NEUTRAL
    }
}

/// A card definition — a catalogue entry, or one derived for a levelled copy.
#[derive(Debug, Clone, PartialEq)]
pub struct CardDef {
    /// The full id, `base` or `base#LVs`.
    pub id: &'static str,
    pub label: &'static str,
    pub icon: &'static str,
    pub rarity: CardRarity,
    pub description: &'static str,
    pub weapon_kinds: WeaponKinds,
    pub source: Option<EnemyKind>,
    pub sub_type: Option<ZombieType>,
    /// Only for SOURCELESS cards (the mythics). A sourced card takes its type
    /// line and flavour from its monster; without these the five rarest cards
    /// in the game all printed one shared "UNBOUND RELIC".
    pub type_line: Option<&'static str>,
    pub flavour: Option<&'static str>,
    pub modifier: CardModifier,
}

/// A resolved card — a catalogue def, or a levelled copy of one.
///
/// `Cow` so the overwhelmingly common case (a level-1 plain card) borrows the
/// static entry and allocates nothing; only a `#LVs` id owns a derived def.
#[derive(Debug, Clone, PartialEq)]
pub struct ResolvedCard {
    pub def: Cow<'static, CardDef>,
    pub level: i32,
    pub shiny: bool,
    /// Regenerated from the scaled modifier for a levelled copy, because the
    /// authored `description` ("+35% durability") becomes a LIE the moment a
    /// card levels, and a card that misreports its own stats is worse than one
    /// with no text at all.
    pub description: Cow<'static, str>,
}

impl ResolvedCard {
    pub fn modifier(&self) -> CardModifier {
        self.def.modifier
    }
    pub fn rarity(&self) -> CardRarity {
        self.def.rarity
    }
    pub fn label(&self) -> &str {
        self.def.label
    }
}

/// A card id split into its parts — the oracle's `CardInstance`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CardInstance {
    pub base: String,
    pub level: i32,
    pub shiny: bool,
}

pub const CARD_LEVEL_MAX: i32 = 10;
/// Fraction of the base delta added per level above 1. At level 10 a card
/// carries ~2.08x its base delta.
pub const CARD_LEVEL_STEP: f64 = 0.12;
/// A shiny is worth about two and a half levels.
pub const SHINY_GROWTH: f64 = 0.3;
pub const SHINY_CHANCE: f64 = 0.04;
pub const SHINY_CHANCE_MAX: f64 = 0.12;
/// Piling on approaches best x5 and never reaches it — see [`soften`].
pub const CARD_STACK_SOFT_CAP: f64 = 4.0;
pub const AFFINITY_CHANCE: f64 = 0.7;
pub const COMMON_DROP_CHANCE: f64 = 0.01;
pub const MYTHIC_FLOOR: i32 = 10;
pub const MYTHIC_CHANCE: f64 = 0.18;

include!("cards_catalogue.rs");

/// Every id, in catalogue order.
pub fn card_ids() -> impl Iterator<Item = &'static str> {
    CARDS.iter().map(|c| c.id)
}

/// The catalogue entry for a BASE id. Linear over 25 — see the header.
pub fn card_catalogue(base: &str) -> Option<&'static CardDef> {
    CARDS.iter().find(|c| c.id == base)
}

/// Every base id of one rarity, in catalogue order.
///
/// Order matters: `pick`'s `floor(rand() * len)` indexes this, so the drop
/// tests pin which card a given stream produces.
pub fn cards_of_rarity(r: CardRarity) -> Vec<&'static str> {
    CARDS
        .iter()
        .filter(|c| c.rarity == r)
        .map(|c| c.id)
        .collect()
}

/// Every base id dropped by one monster kind.
pub fn cards_of_source(kind: EnemyKind) -> Vec<&'static str> {
    CARDS
        .iter()
        .filter(|c| c.source == Some(kind))
        .map(|c| c.id)
        .collect()
}

pub fn clamp_level(level: i32) -> i32 {
    level.clamp(1, CARD_LEVEL_MAX)
}

/// The id up to `#`.
pub fn card_base(id: &str) -> &str {
    match id.find('#') {
        Some(i) => &id[..i],
        None => id,
    }
}

/// Split `base#LVs`. Tolerant, exactly as the oracle is.
pub fn parse_card(id: &str) -> CardInstance {
    let Some(hash) = id.find('#') else {
        return CardInstance {
            base: id.to_string(),
            level: 1,
            shiny: false,
        };
    };
    let base = id[..hash].to_string();
    let tail = &id[hash + 1..];
    let shiny = tail.ends_with('s');
    let digits = if shiny { &tail[..tail.len() - 1] } else { tail };
    // ⚠️ LEADING NUMERIC RUN, not `parse()`. JS `parseInt("4x")` is 4 where
    // Rust's `parse::<i32>()` errors, so a hand-typed dev id like
    // `spidersilk#4x` reads as level 4 there and would read as 1 here.
    let n: String = digits.chars().take_while(char::is_ascii_digit).collect();
    let level = n.parse::<i32>().map(clamp_level).unwrap_or(1);
    CardInstance { base, level, shiny }
}

pub fn card_level(id: &str) -> i32 {
    parse_card(id).level
}

pub fn is_shiny_card(id: &str) -> bool {
    id.contains('#') && id.ends_with('s')
}

/// The CANONICAL spelling of a card id.
///
/// ⚠️ A level-1 plain card collapses to its bare base id, and that is what
/// makes stash stacking work by raw string equality — it is also why
/// `dev_weapon()`'s `"goblintooth"` is a valid id today.
pub fn card_key(base: &str, level: i32, shiny: bool) -> String {
    let lv = clamp_level(level);
    if lv <= 1 && !shiny {
        return base.to_string();
    }
    format!("{base}#{lv}{}", if shiny { "s" } else { "" })
}

/// Re-point a card at a new base, KEEPING this copy's level and shine.
pub fn re_key_card(id: &str, new_base: &str) -> String {
    let c = parse_card(id);
    card_key(new_base, c.level, c.shiny)
}

/// How much bigger than base a copy is.
///
/// ⚠️ Keep the association identical to the JS. Do not "simplify"
/// `1 + 0.12*(l-1) + 0.3` into `0.12*l + 1.18`: the sum of binary-inexact
/// decimals is bit-identical only in the same order.
pub fn card_growth(level: i32, shiny: bool) -> f64 {
    1.0 + CARD_LEVEL_STEP * f64::from(clamp_level(level) - 1)
        + if shiny { SHINY_GROWTH } else { 0.0 }
}

/// Scale a modifier by `growth`.
///
/// THE RULE: a level multiplies the DELTA FROM NEUTRAL, in BOTH directions. A
/// level-6 Hulk Knuckle has more damage AND more cooldown penalty. Scaling
/// only the upside would quietly launder every drawback card into a strict
/// upgrade, and cards with real downsides are a design pillar.
pub fn scale_modifier(m: CardModifier, growth: f64) -> CardModifier {
    // Exactly 1.0 for a level-1 plain card, which is the common case.
    if growth == 1.0 {
        return m;
    }
    // Integers never regress: at low growth `round(1 * 1.12)` is still 1, and
    // a levelled card giving LESS pierce than its level-1 twin would be a bug.
    let scale_int = |v: i32| v.max(js_round(f64::from(v) * growth) as i32);
    let scale_mult = |v: f64| r3(1.0 + (v - 1.0) * growth);
    let mut out = NEUTRAL;
    if let Some(v) = truthy_i(m.damage_flat) {
        out.damage_flat = Some(scale_int(v));
    }
    if let Some(v) = truthy(m.damage_mult) {
        out.damage_mult = Some(scale_mult(v));
    }
    if let Some(v) = truthy(m.cooldown_mult) {
        // Clamped both ways: an unclamped level-10 Time Ripper reaches 0.17,
        // at which point the swing stops reading as a swing at all.
        out.cooldown_mult = Some(scale_mult(v).clamp(0.35, 2.0));
    }
    if let Some(v) = truthy(m.durability_mult) {
        out.durability_mult = Some(scale_mult(v).max(0.05));
    }
    out.on_hit = m.on_hit;
    if let Some(v) = truthy(m.pinball_mult) {
        out.pinball_mult = Some(scale_mult(v));
    }
    out.bolt = m.bolt;
    if let Some(v) = truthy(m.material_mult) {
        out.material_mult = Some(scale_mult(v));
    }
    if let Some(v) = truthy(m.crit_chance) {
        // ⚠️ Scaled by growth DIRECTLY, not through `scale_mult`. It is a
        // probability, not a multiplier — there is no "delta from 1" to scale.
        out.crit_chance = Some(r3(v * growth).min(0.9));
    }
    if let Some(v) = truthy(m.crit_mult) {
        out.crit_mult = Some(scale_mult(v).min(6.0));
    }
    if let Some(v) = truthy_i(m.lifesteal) {
        out.lifesteal = Some(scale_int(v));
    }
    if let Some(v) = truthy_i(m.pierce) {
        out.pierce = Some(scale_int(v));
    }
    out
}

/// A card's POWER — one number summarising how strong a copy is.
///
/// A flavour stat: printed on the face and the natural sort key for a stash,
/// but NOTHING IN COMBAT READS IT. It lives here, with the schema, because it
/// is a third exhaustive consumer of `CardModifier` alongside
/// [`scale_modifier`] and [`modifier_rows`] — and when it lived in the canvas
/// painter it had silently omitted `material_mult`, so Crystal Shard (a x1.5
/// epic) printed the floor value of 10, the same as a card with no effects.
pub fn card_power(m: &CardModifier) -> i32 {
    let mut p = 10.0;
    if let Some(v) = truthy_i(m.damage_flat) {
        p += f64::from(v) * 15.0;
    }
    if let Some(v) = truthy(m.damage_mult) {
        p += (v - 1.0) * 100.0;
    }
    if let Some(v) = truthy(m.pinball_mult) {
        p += (v - 1.0) * 40.0;
    }
    if let Some(v) = truthy(m.cooldown_mult) {
        p += (1.0 - v) * 80.0;
    }
    if let Some(v) = truthy(m.durability_mult) {
        p += (v - 1.0) * 20.0;
    }
    if let Some(v) = truthy(m.material_mult) {
        p += (v - 1.0) * 40.0;
    }
    if m.bolt {
        p += 45.0;
    }
    if let Some(v) = truthy(m.crit_chance) {
        p += v * 60.0;
    }
    if let Some(v) = truthy_i(m.lifesteal) {
        p += f64::from(v) * 25.0;
    }
    if let Some(v) = truthy_i(m.pierce) {
        p += f64::from(v) * 12.0;
    }
    if m.on_hit.is_some() {
        p += 20.0;
    }
    (js_round(p / 5.0) as i32 * 5).max(10)
}

/// One effect of a card, formatted for both a stat table and a prose line.
#[derive(Debug, Clone, PartialEq)]
pub struct ModifierRow {
    /// The table label, e.g. "Attack speed".
    pub name: String,
    /// The table value, e.g. "−12%" or "ON HIT".
    pub value: String,
    /// The prose phrase, e.g. "12% faster". EMPTY means table-only.
    pub prose: String,
    /// Is this an upside?
    pub good: bool,
}

/// `−12%` / `+35%`.
///
/// ⚠️ U+2212 MINUS SIGN, not an ASCII hyphen. The oracle prints it and the
/// port keeps the exact bytes; `pk_gui::font::substitute` maps the glyph at
/// DRAW time, because Press Start 2P has no such character and a face is a
/// rendering concern, not a rule.
fn pct(v: f64) -> String {
    let sign = if v > 1.0 { '+' } else { '\u{2212}' };
    format!("{sign}{}%", js_round((v - 1.0).abs() * 100.0) as i64)
}

fn mult(v: f64) -> String {
    format!("\u{00d7}{}", js_round(v * 10.0) / 10.0)
}

/// Every effect a modifier carries, as rows.
///
/// ⚠️ THE EMISSION ORDER IS FIXED AND LOAD-BEARING. This function exists to
/// stop a renderer independently re-encoding the cooldown INVERSION and the
/// crit-damage rounding — that bug (a card reading x4.32) had to be fixed
/// twice before the logic moved here.
pub fn modifier_rows(m: &CardModifier) -> Vec<ModifierRow> {
    let mut rows = Vec::new();
    let mut row = |name: &str, value: String, prose: String, good: bool| {
        rows.push(ModifierRow {
            name: name.to_string(),
            value,
            prose,
            good,
        });
    };
    if let Some(v) = truthy(m.damage_mult).filter(|v| *v != 1.0) {
        row("Damage", pct(v), format!("{} damage", pct(v)), v > 1.0);
    }
    if let Some(v) = truthy_i(m.damage_flat) {
        row("Flat damage", format!("+{v}"), format!("+{v} dmg"), v > 0);
    }
    if m.bolt {
        row(
            "Thunderbolt",
            "ON HIT".into(),
            "arcs a THUNDERBOLT".into(),
            true,
        );
    }
    if let Some(h) = m.on_hit {
        let (name, word) = match h {
            OnHit::Burn => ("Burn", "BURN"),
            OnHit::Chill => ("Chill", "CHILL"),
        };
        row(name, "ON HIT".into(), format!("hits {word}"), true);
    }
    if let Some(v) = truthy(m.crit_chance) {
        let cm = js_round(m.crit_mult.unwrap_or(2.0) * 10.0) / 10.0;
        let n = js_round(v * 100.0) as i64;
        row(
            "Crit chance",
            format!("{n}%"),
            format!("{n}% CRIT (\u{00d7}{cm})"),
            true,
        );
        if let Some(cv) = truthy(m.crit_mult).filter(|v| *v != 2.0) {
            // EMPTY prose: this row is table-only, because the crit-chance
            // phrase above already names the multiplier.
            row("Crit damage", mult(cv), String::new(), true);
        }
    }
    if let Some(v) = truthy_i(m.lifesteal) {
        row(
            "Lifesteal",
            format!("+{v} HP"),
            format!("heal {v}/hit"),
            true,
        );
    }
    if let Some(v) = truthy_i(m.pierce) {
        row("Pierce", format!("+{v}"), format!("pierce +{v}"), true);
    }
    if let Some(v) = truthy(m.pinball_mult).filter(|v| *v > 1.0) {
        row(
            "On momentum",
            mult(v),
            format!("{} on momentum", mult(v)),
            true,
        );
    }
    if let Some(v) = truthy(m.material_mult).filter(|v| *v > 1.0) {
        row("On marble", mult(v), format!("{} on marble", mult(v)), true);
    }
    if let Some(v) = truthy(m.cooldown_mult).filter(|v| *v != 1.0) {
        // ⚠️ INVERTED: below 1 is FASTER, which is good. This is the encoding
        // the renderer kept getting wrong.
        let faster = v < 1.0;
        let n = js_round((1.0 - v).abs() * 100.0) as i64;
        row(
            if faster {
                "Attack speed"
            } else {
                "Slower swing"
            },
            format!("{}{n}%", if faster { '\u{2212}' } else { '+' }),
            format!("{n}% {}", if faster { "faster" } else { "slower" }),
            faster,
        );
    }
    if let Some(v) = truthy(m.durability_mult).filter(|v| *v != 1.0) {
        row(
            "Durability",
            pct(v),
            format!("{} durability", pct(v)),
            v > 1.0,
        );
    }
    rows
}

/// The card's effects as one sentence, generated from the modifier.
pub fn describe_modifier(m: &CardModifier) -> String {
    modifier_rows(m)
        .into_iter()
        .filter(|r| !r.prose.is_empty())
        .map(|r| r.prose)
        .collect::<Vec<_>>()
        .join(", ")
}

/// THE LOOKUP for a card that came out of the world.
///
/// A bare id returns the catalogue entry unchanged and borrows it. A `#LVs` id
/// derives: parse, scale the modifier by [`card_growth`], and REPLACE the
/// description, because the authored one is a lie once the card levels.
pub fn card_def(id: &str) -> Option<ResolvedCard> {
    if let Some(def) = card_catalogue(id) {
        return Some(ResolvedCard {
            def: Cow::Borrowed(def),
            level: 1,
            shiny: false,
            description: Cow::Borrowed(def.description),
        });
    }
    let inst = parse_card(id);
    let base = card_catalogue(&inst.base)?;
    let growth = card_growth(inst.level, inst.shiny);
    let modifier = scale_modifier(base.modifier, growth);
    let described = describe_modifier(&modifier);
    let description = if described.is_empty() {
        Cow::Borrowed(base.description)
    } else {
        Cow::Owned(described)
    };
    let mut def = base.clone();
    def.modifier = modifier;
    Some(ResolvedCard {
        def: Cow::Owned(def),
        level: inst.level,
        shiny: inst.shiny,
        description,
    })
}

/// Does this card fit that weapon?
pub fn card_fits_kind(card: &str, kind: WeaponKind) -> bool {
    let Some(c) = card_def(card) else {
        return false;
    };
    match c.def.weapon_kinds {
        WeaponKinds::Both => true,
        WeaponKinds::Melee => kind == WeaponKind::Melee,
        WeaponKinds::Ranged => kind == WeaponKind::Ranged,
    }
}

/// Everything a weapon's sockets add up to.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct CardAggregate {
    pub damage_flat: i32,
    pub damage_mult: f64,
    pub cooldown_mult: f64,
    pub durability_mult: f64,
    pub chill: bool,
    pub burn: bool,
    pub pinball_mult: f64,
    pub bolt: bool,
    pub material_mult: f64,
    pub crit_chance: f64,
    pub crit_mult: f64,
    pub lifesteal: i32,
    pub pierce: i32,
}

impl Default for CardAggregate {
    fn default() -> Self {
        Self {
            damage_flat: 0,
            damage_mult: 1.0,
            cooldown_mult: 1.0,
            durability_mult: 1.0,
            chill: false,
            burn: false,
            pinball_mult: 1.0,
            bolt: false,
            material_mult: 1.0,
            crit_chance: 0.0,
            crit_mult: 2.0,
            lifesteal: 0,
            pierce: 0,
        }
    }
}

/// Diminishing returns on a stack.
///
/// One card does what it says; four do NOT do four times what one says. The
/// curve approaches `best * CARD_STACK_SOFT_CAP` and never reaches it.
fn soften(raw: f64) -> f64 {
    if raw <= 1.0 {
        return raw;
    }
    let over = raw - 1.0;
    1.0 + over / (1.0 + over / CARD_STACK_SOFT_CAP)
}

/// Soften a stack while leaving the SINGLE BEST card's printed value exact.
fn soften_stack(raw: f64, best: f64) -> f64 {
    if raw <= 1.0 || best <= 1.0 {
        return raw;
    }
    best * soften(raw / best)
}

/// Fold every socketed card into one aggregate.
///
/// Two passes: fold, then SET BONUSES. Note the ordering — set bonuses run
/// BEFORE the soften, so their multiplier bends with the stack rather than
/// riding on top of it. Penalties stay LINEAR: a drawback below 1x bites at
/// full value, because softening it would delete the cost half of every
/// trade-off card.
pub fn aggregate_cards(cards: &[String]) -> CardAggregate {
    let mut agg = CardAggregate::default();
    let (mut best_damage, mut best_pinball, mut best_material) = (1.0_f64, 1.0_f64, 1.0_f64);
    let (mut bolt_n, mut crit_n, mut material_n) = (0, 0, 0);
    for id in cards {
        let Some(c) = card_def(id) else { continue };
        let m = c.modifier();
        if let Some(v) = truthy_i(m.damage_flat) {
            agg.damage_flat += v;
        }
        if let Some(v) = truthy(m.damage_mult) {
            agg.damage_mult *= v;
            best_damage = best_damage.max(v);
        }
        if let Some(v) = truthy(m.cooldown_mult) {
            agg.cooldown_mult *= v;
        }
        if let Some(v) = truthy(m.durability_mult) {
            agg.durability_mult *= v;
        }
        match m.on_hit {
            Some(OnHit::Chill) => agg.chill = true,
            Some(OnHit::Burn) => agg.burn = true,
            None => {}
        }
        if let Some(v) = truthy(m.pinball_mult) {
            agg.pinball_mult *= v;
            best_pinball = best_pinball.max(v);
        }
        if m.bolt {
            agg.bolt = true;
            bolt_n += 1;
        }
        if let Some(v) = truthy(m.material_mult) {
            agg.material_mult *= v;
            best_material = best_material.max(v);
            material_n += 1;
        }
        if let Some(v) = truthy(m.crit_chance) {
            agg.crit_chance += v;
            crit_n += 1;
        }
        if let Some(v) = truthy(m.crit_mult) {
            agg.crit_mult = agg.crit_mult.max(v);
        }
        if let Some(v) = truthy_i(m.lifesteal) {
            agg.lifesteal += v;
        }
        if let Some(v) = truthy_i(m.pierce) {
            agg.pierce += v;
        }
    }
    // SET BONUSES — two of a mechanic, and it pays extra.
    if bolt_n >= 2 {
        agg.damage_mult *= 1.25; // STORM
    }
    if crit_n >= 2 {
        agg.crit_mult += 0.5; // ASSASSIN
    }
    if material_n >= 2 {
        agg.material_mult *= 1.3; // ATTUNED
    }
    agg.crit_chance = agg.crit_chance.min(1.0);
    agg.damage_mult = soften_stack(agg.damage_mult, best_damage);
    agg.pinball_mult = soften_stack(agg.pinball_mult, best_pinball);
    agg.material_mult = soften_stack(agg.material_mult, best_material);
    agg
}

/// Slot a card into a weapon. Returns false if it does not fit or there is no
/// room.
///
/// A card that raises max durability tops the weapon up by the DIFFERENCE, so
/// socketing a toughness card is not a repair but does not waste the gain.
pub fn socket_card(w: &mut Weapon, id: &str) -> bool {
    if card_def(id).is_none() || !card_fits_kind(id, w.id.kind()) {
        return false;
    }
    if w.cards.len() >= w.slot_count() as usize {
        return false;
    }
    let before = aggregate_cards(&w.cards).durability_mult;
    w.cards.push(id.to_string());
    let after = aggregate_cards(&w.cards).durability_mult;
    if after > before {
        if let (Some(dur), Some(max)) = (w.durability, w.id.max_durability()) {
            w.durability = Some(dur + js_round(f64::from(max) * (after - before)) as i32);
        }
    }
    true
}

/// What a drop roll is being asked for.
#[derive(Debug, Clone, Default)]
pub struct DropOpts {
    pub floor: i32,
    pub boss: bool,
    pub gold_wall: bool,
    pub legendary_allowed: bool,
    pub mythic_allowed: bool,
    pub kind: Option<EnemyKind>,
    pub sub_type: Option<ZombieType>,
    pub drop_mult: Option<f64>,
    pub affinity: Option<f64>,
    pub guaranteed: bool,
}

/// Pick one card from a rarity pool, biased toward the slain monster's own.
///
/// A free function and not a closure, because it needs `rand` mutably while
/// the caller also holds it.
fn pick(
    pool: &[&'static str],
    opts: &DropOpts,
    affinity_chance: f64,
    rand: &mut dyn FnMut() -> f64,
) -> &'static str {
    let def = |id: &str| card_catalogue(id).expect("pool ids are catalogue ids");
    // A sub-typed affinity first: a Hulk should hand you the Hulk card.
    if let (Some(kind), Some(st)) = (opts.kind, opts.sub_type) {
        let sub: Vec<_> = pool
            .iter()
            .copied()
            .filter(|id| {
                let d = def(id);
                d.source == Some(kind) && d.sub_type == Some(st)
            })
            .collect();
        if !sub.is_empty() && rand() < affinity_chance {
            return sub[(rand() * sub.len() as f64).floor() as usize % sub.len()];
        }
    }
    if let Some(kind) = opts.kind {
        let own: Vec<_> = pool
            .iter()
            .copied()
            .filter(|id| {
                let d = def(id);
                d.source == Some(kind) && (opts.sub_type.is_none() || d.sub_type == opts.sub_type)
            })
            .collect();
        if !own.is_empty() && rand() < affinity_chance {
            return own[(rand() * own.len() as f64).floor() as usize % own.len()];
        }
    }
    // Non-affinity fallback. A foreign SUB-TYPED card must never arrive from
    // the wrong monster, so those are filtered out entirely.
    let eligible: Vec<_> = pool
        .iter()
        .copied()
        .filter(|id| {
            let d = def(id);
            match d.sub_type {
                None => true,
                Some(st) => d.source == opts.kind && Some(st) == opts.sub_type,
            }
        })
        .collect();
    let from = if eligible.is_empty() { pool } else { &eligible };
    from[(rand() * from.len() as f64).floor() as usize % from.len()]
}

/// Does a card drop, and which?
///
/// ⚠️ THE GATE ORDER AND THE DRAW ORDER ARE BOTH PINNED. Mythic is checked
/// FIRST so the top tier is not shadowed by the legendary branch consuming the
/// same roll, and every affinity draw happens INSIDE [`pick`] — i.e. only
/// after a drop is already decided. Drawing earlier would shift the stream and
/// change the drop RATE, which is a regression the oracle's tests exist to
/// catch.
pub fn roll_card_drop(opts: &DropOpts, rand: &mut dyn FnMut() -> f64) -> Option<&'static str> {
    let ac = (AFFINITY_CHANCE * opts.affinity.unwrap_or(1.0)).min(1.0);
    if opts.boss && opts.floor >= MYTHIC_FLOOR && opts.mythic_allowed && rand() < MYTHIC_CHANCE {
        return Some(pick(&cards_of_rarity(CardRarity::Mythic), opts, ac, rand));
    }
    if opts.boss && opts.floor >= 5 && opts.legendary_allowed && rand() < 0.5 {
        return Some(pick(
            &cards_of_rarity(CardRarity::Legendary),
            opts,
            ac,
            rand,
        ));
    }
    if (opts.boss || opts.gold_wall) && rand() < 0.3 {
        return Some(pick(&cards_of_rarity(CardRarity::Epic), opts, ac, rand));
    }
    if opts.boss && rand() < 0.5 {
        return Some(pick(&cards_of_rarity(CardRarity::Rare), opts, ac, rand));
    }
    // Drawn FIRST and unconditionally, so the `guaranteed` toggle can never
    // shift the stream.
    let roll = rand();
    if roll < (COMMON_DROP_CHANCE * opts.drop_mult.unwrap_or(1.0)).min(0.5) || opts.guaranteed {
        return Some(pick(&cards_of_rarity(CardRarity::Common), opts, ac, rand));
    }
    None
}

/// What level a dropped card comes in at.
pub fn roll_card_level(floor: i32, rand: &mut dyn FnMut() -> f64) -> i32 {
    let base = 1 + (floor.max(1) - 1) / 2;
    let r = rand();
    let lv = if r < 0.2 {
        base - 1
    } else if r < 0.75 {
        base
    } else if r < 0.95 {
        base + 1
    } else {
        base + 2
    };
    clamp_level(lv)
}

pub fn roll_shiny(boss: bool, rand: &mut dyn FnMut() -> f64) -> bool {
    rand() < (SHINY_CHANCE * if boss { 2.0 } else { 1.0 }).min(SHINY_CHANCE_MAX)
}

/// A whole dropped card, level and shine included.
///
/// ⚠️ DELIBERATELY A WRAPPER and not folded into [`roll_card_drop`]. The level
/// and shiny draws must happen strictly AFTER the gates have decided a card
/// drops; inlining them would move the draws earlier and inflate the rate.
pub fn roll_card_instance(opts: &DropOpts, rand: &mut dyn FnMut() -> f64) -> Option<String> {
    let base = roll_card_drop(opts, rand)?;
    let level = roll_card_level(opts.floor, rand);
    let shiny = roll_shiny(opts.boss, rand);
    Some(card_key(base, level, shiny))
}

#[cfg(test)]
mod tests {
    //! The oracle's own quirks, each pinned by the comment that records why it
    //! is a quirk. Reference numbers were computed by running the oracle's
    //! arithmetic, not by reading it.
    use super::*;

    /// A fixed stream, so a change to the draw ORDER shows up as a different
    /// result rather than as flakiness.
    fn seq(vals: &[f64]) -> impl FnMut() -> f64 + '_ {
        let mut i = 0;
        move || {
            let v = vals[i % vals.len()];
            i += 1;
            v
        }
    }

    #[test]
    fn the_catalogue_is_twenty_five_cards_five_of_each_rarity() {
        assert_eq!(CARDS.len(), 25);
        for r in [
            CardRarity::Common,
            CardRarity::Rare,
            CardRarity::Epic,
            CardRarity::Legendary,
            CardRarity::Mythic,
        ] {
            assert_eq!(cards_of_rarity(r).len(), 5, "{r:?}");
        }
    }

    /// The ordering IS the insurance sort key, so it is asserted, not assumed.
    #[test]
    fn rarity_ranks_low_to_high_and_steps_down_one_tier() {
        assert!(CardRarity::Common < CardRarity::Rare);
        assert!(CardRarity::Legendary < CardRarity::Mythic);
        assert_eq!(CardRarity::Common.rank(), 0);
        assert_eq!(CardRarity::Mythic.rank(), 4);
        assert_eq!(CardRarity::Mythic.lower(), Some(CardRarity::Legendary));
        // A common has nowhere to fall — which is why un-socketing destroys it.
        assert_eq!(CardRarity::Common.lower(), None);
    }

    /// The canonical spelling the stash's string equality rests on.
    #[test]
    fn a_level_one_plain_card_collapses_to_its_bare_base_id() {
        assert_eq!(card_key("goblintooth", 1, false), "goblintooth");
        assert_eq!(card_key("goblintooth", 1, true), "goblintooth#1s");
        assert_eq!(card_key("goblintooth", 4, false), "goblintooth#4");
        assert_eq!(card_key("goblintooth", 4, true), "goblintooth#4s");
        // …and out of range collapses too, rather than minting a #0 id.
        assert_eq!(card_key("goblintooth", 0, false), "goblintooth");
        assert_eq!(card_key("goblintooth", 99, false), "goblintooth#10");
    }

    #[test]
    fn parse_card_is_tolerant_of_a_hand_typed_dev_id() {
        assert_eq!(parse_card("spidersilk").level, 1);
        assert_eq!(parse_card("spidersilk#7").level, 7);
        assert!(parse_card("spidersilk#7s").shiny);
        assert!(!parse_card("spidersilk").shiny);
        // JS `parseInt("4x")` is 4, so the leading numeric run wins — Rust's
        // own `parse()` would error here and read as level 1.
        assert_eq!(parse_card("spidersilk#4x").level, 4);
        assert_eq!(parse_card("spidersilk#zz").level, 1);
        assert_eq!(card_base("spidersilk#4s"), "spidersilk");
    }

    /// THE ANTI-LAUNDERING PILLAR: a level scales the delta BOTH ways.
    #[test]
    fn a_level_scales_the_delta_in_both_directions() {
        let hulk = card_catalogue("hulkknuckle").unwrap().modifier;
        assert_eq!(hulk.damage_mult, Some(1.6));
        assert_eq!(hulk.cooldown_mult, Some(1.15));
        let l6 = scale_modifier(hulk, card_growth(6, false));
        // Oracle: growth 1.6 → damage 1.96 AND cooldown penalty 1.24.
        assert_eq!(l6.damage_mult, Some(1.96));
        assert_eq!(l6.cooldown_mult, Some(1.24));
        assert!(
            l6.cooldown_mult.unwrap() > hulk.cooldown_mult.unwrap(),
            "the drawback must grow with the upside or the card is laundered"
        );
    }

    #[test]
    fn growth_is_twelve_percent_a_level_and_a_shiny_is_worth_two_and_a_half() {
        assert_eq!(card_growth(1, false), 1.0);
        assert_eq!(card_growth(6, false), 1.6);
        assert_eq!(card_growth(10, true), 2.38);
    }

    /// `scaleInt`'s `max(v, round(v*growth))` — a levelled card giving LESS
    /// pierce than its level-1 twin would be a bug.
    #[test]
    fn an_integer_modifier_never_regresses_at_low_growth() {
        let m = CardModifier {
            pierce: Some(1),
            lifesteal: Some(1),
            ..NEUTRAL
        };
        let l2 = scale_modifier(m, card_growth(2, false));
        assert_eq!(l2.pierce, Some(1));
        assert_eq!(l2.lifesteal, Some(1));
    }

    #[test]
    fn the_clamps_stop_a_level_ten_shiny_from_leaving_the_rails() {
        let ripper = card_catalogue("timeripper").unwrap().modifier;
        let m = scale_modifier(ripper, card_growth(10, true));
        // Unclamped this reaches 0.17 and the swing stops reading as a swing.
        assert_eq!(m.cooldown_mult, Some(0.35));
        let pact = card_catalogue("bloodpact").unwrap().modifier;
        let p = scale_modifier(pact, card_growth(10, true));
        assert!(p.crit_chance.unwrap() <= 0.9);
        assert!(p.crit_mult.unwrap() <= 6.0);
        assert!(p.durability_mult.unwrap() >= 0.05);
    }

    /// The one field that breaks the `scale_mult` pattern.
    #[test]
    fn crit_chance_scales_by_growth_directly_and_not_through_the_multiplier_rule() {
        let m = CardModifier {
            crit_chance: Some(0.2),
            ..NEUTRAL
        };
        // Directly: 0.2 * 1.6 = 0.32. Through scale_mult it would be
        // 1 + (0.2-1)*1.6 = -0.28, which is not a probability at all.
        assert_eq!(
            scale_modifier(m, card_growth(6, false)).crit_chance,
            Some(0.32)
        );
    }

    /// THE ×4.32 TRIPWIRE. The whole function exists so a renderer cannot
    /// re-encode the cooldown inversion; the order is what pins that.
    #[test]
    fn the_modifier_rows_come_out_in_the_oracles_order() {
        let m = CardModifier {
            damage_flat: Some(2),
            damage_mult: Some(1.5),
            cooldown_mult: Some(0.88),
            durability_mult: Some(1.35),
            on_hit: Some(OnHit::Burn),
            pinball_mult: Some(1.35),
            bolt: true,
            material_mult: Some(1.5),
            crit_chance: Some(0.3),
            crit_mult: Some(2.5),
            lifesteal: Some(1),
            pierce: Some(2),
        };
        let names: Vec<_> = modifier_rows(&m).into_iter().map(|r| r.name).collect();
        assert_eq!(
            names,
            vec![
                "Damage",
                "Flat damage",
                "Thunderbolt",
                "Burn",
                "Crit chance",
                "Crit damage",
                "Lifesteal",
                "Pierce",
                "On momentum",
                "On marble",
                "Attack speed",
                "Durability",
            ]
        );
    }

    /// The inversion, named. Below 1 is FASTER, and faster is good.
    #[test]
    fn the_cooldown_row_reads_faster_and_is_the_only_inverted_one() {
        let fast = modifier_rows(&CardModifier {
            cooldown_mult: Some(0.88),
            ..NEUTRAL
        });
        assert_eq!(fast[0].name, "Attack speed");
        assert_eq!(fast[0].prose, "12% faster");
        assert!(fast[0].good);
        let slow = modifier_rows(&CardModifier {
            cooldown_mult: Some(1.15),
            ..NEUTRAL
        });
        assert_eq!(slow[0].name, "Slower swing");
        assert_eq!(slow[0].value, "+15%");
        assert!(!slow[0].good);
    }

    /// The oracle prints U+2212, not an ASCII hyphen. `pk_gui` substitutes the
    /// GLYPH at draw time; the RULE keeps the oracle's bytes.
    #[test]
    fn a_percent_uses_the_unicode_minus_sign_and_not_a_hyphen() {
        let rows = modifier_rows(&CardModifier {
            durability_mult: Some(0.6),
            ..NEUTRAL
        });
        assert_eq!(rows[0].value, "\u{2212}40%");
        assert!(!rows[0].value.contains('-'), "ASCII hyphen leaked in");
    }

    #[test]
    fn the_crit_damage_row_is_table_only_and_never_reaches_the_prose() {
        let m = CardModifier {
            crit_chance: Some(0.3),
            crit_mult: Some(2.5),
            ..NEUTRAL
        };
        let rows = modifier_rows(&m);
        let crit_dmg = rows.iter().find(|r| r.name == "Crit damage").unwrap();
        assert_eq!(crit_dmg.value, "\u{00d7}2.5");
        assert!(crit_dmg.prose.is_empty());
        // …so the sentence names the multiplier once, in the chance phrase.
        assert_eq!(describe_modifier(&m), "30% CRIT (\u{00d7}2.5)");
    }

    /// The exact bug the oracle's comment records: Crystal Shard printed the
    /// floor value of 10 when this weight lived in the canvas painter.
    #[test]
    fn card_power_weights_material_mult() {
        let shard = card_catalogue("crystalshard").unwrap();
        assert_eq!(shard.modifier.material_mult, Some(1.5));
        assert!(
            card_power(&shard.modifier) > 10,
            "a x1.5 epic must not score the floor"
        );
    }

    /// The oracle's own published numbers for the soften curve.
    #[test]
    fn four_thirty_percent_cards_land_at_two_point_five_not_two_point_eight_six() {
        let raw: f64 = 1.3_f64.powi(4);
        assert!((raw - 2.8561).abs() < 1e-4, "raw product moved");
        assert!((soften_stack(raw, 1.3) - 2.497_691).abs() < 1e-5);
        // Two +20%: 1.44 raw becomes 1.4286.
        assert!((soften_stack(1.2 * 1.2, 1.2) - 1.428_571).abs() < 1e-5);
    }

    /// A card cannot lie about itself: one card does exactly what it prints.
    #[test]
    fn the_single_best_card_keeps_its_printed_value_exactly() {
        assert_eq!(soften_stack(1.7, 1.7), 1.7);
        assert_eq!(
            aggregate_cards(&["brutecleaver".to_string()]).damage_mult,
            1.7
        );
    }

    /// Softening a drawback would delete the cost half of every trade-off card.
    #[test]
    fn a_penalty_below_one_bites_at_full_value() {
        assert_eq!(
            aggregate_cards(&["gladeath".to_string()]).durability_mult,
            0.4
        );
        let two = aggregate_cards(&["gladeath".to_string(), "bloodpact".to_string()]);
        // 0.4 * 0.6 — multiplied straight, no curve.
        assert!((two.durability_mult - 0.24).abs() < 1e-9);
    }

    #[test]
    fn the_three_set_bonuses_each_need_two_cards() {
        // One bolt card: no STORM.
        assert_eq!(aggregate_cards(&["wispspark".to_string()]).damage_mult, 1.0);
        // Two: STORM multiplies damage by 1.25.
        let two = aggregate_cards(&["wispspark".to_string(), "tempestcrown".to_string()]);
        assert!(
            two.damage_mult > 1.25,
            "STORM did not fire: {}",
            two.damage_mult
        );
        // Two crit cards: ASSASSIN adds 0.5 to the max crit mult.
        let crit = aggregate_cards(&["goblintooth".to_string(), "flailerjaw".to_string()]);
        assert_eq!(crit.crit_mult, 3.0); // max(2, 2.5) + 0.5
                                         // Two material cards: ATTUNED.
        let mat = aggregate_cards(&["crystalshard".to_string(), "golemcore".to_string()]);
        assert!(mat.material_mult > 1.5 * 1.35);
    }

    #[test]
    fn crit_chance_is_summed_and_capped_at_one() {
        let agg = aggregate_cards(&[
            "bloodpact".to_string(),
            "flailerjaw".to_string(),
            "goblintooth".to_string(),
        ]);
        assert_eq!(agg.crit_chance, 1.0);
    }

    #[test]
    fn a_missing_card_id_is_skipped_rather_than_panicking() {
        let agg = aggregate_cards(&["not_a_card".to_string(), "brutecleaver".to_string()]);
        assert_eq!(agg.damage_mult, 1.7);
    }

    #[test]
    fn a_levelled_card_regenerates_its_description_and_a_plain_one_keeps_it() {
        let plain = card_def("shamblerhide").unwrap();
        assert_eq!(plain.description, "+35% durability");
        assert_eq!(plain.level, 1);
        let levelled = card_def("shamblerhide#6").unwrap();
        assert_eq!(levelled.level, 6);
        assert_ne!(
            levelled.description, "+35% durability",
            "an authored description becomes a LIE once the card levels"
        );
        assert!(levelled.description.contains("durability"));
    }

    #[test]
    fn a_plain_card_borrows_the_catalogue_and_a_levelled_one_owns_its_copy() {
        assert!(matches!(
            card_def("spidersilk").unwrap().def,
            Cow::Borrowed(_)
        ));
        assert!(matches!(
            card_def("spidersilk#5").unwrap().def,
            Cow::Owned(_)
        ));
        assert!(card_def("nonsense").is_none());
    }

    #[test]
    fn a_ranged_only_card_refuses_a_sword_and_a_melee_only_card_refuses_a_bow() {
        use crate::economy::forge::WeaponId;
        assert_eq!(WeaponId::Sword.kind(), WeaponKind::Melee);
        assert_eq!(WeaponId::Bow.kind(), WeaponKind::Ranged);
        // webspinnersilk is ranged-only, brutecleaver melee-only.
        assert!(!card_fits_kind("webspinnersilk", WeaponKind::Melee));
        assert!(card_fits_kind("webspinnersilk", WeaponKind::Ranged));
        assert!(card_fits_kind("brutecleaver", WeaponKind::Melee));
        assert!(!card_fits_kind("brutecleaver", WeaponKind::Ranged));
        // …and a "both" card fits either.
        assert!(card_fits_kind("spidersilk", WeaponKind::Melee));
        assert!(card_fits_kind("spidersilk", WeaponKind::Ranged));
    }

    #[test]
    fn socketing_a_durability_card_tops_the_weapon_up_by_the_difference() {
        use crate::economy::forge::{ItemRarity, Weapon, WeaponId};
        let mut w = Weapon::new(WeaponId::Sword, ItemRarity::Rare);
        w.durability = Some(10);
        let max = WeaponId::Sword.max_durability().unwrap();
        assert!(socket_card(&mut w, "shamblerhide"));
        // +35% of max, added to CURRENT — a top-up, not a repair.
        assert_eq!(
            w.durability,
            Some(10 + js_round(f64::from(max) * 0.35) as i32)
        );
    }

    #[test]
    fn an_infinite_weapon_is_never_topped_up() {
        use crate::economy::forge::{ItemRarity, Weapon, WeaponId};
        let mut w = Weapon::new(WeaponId::Fists, ItemRarity::Common);
        assert_eq!(w.durability, None, "fists are the oracle's Infinity");
        assert!(socket_card(&mut w, "shamblerhide"));
        assert_eq!(w.durability, None);
    }

    #[test]
    fn a_full_weapon_refuses_another_card() {
        use crate::economy::forge::{ItemRarity, Weapon, WeaponId};
        let mut w = Weapon::new(WeaponId::Sword, ItemRarity::Common); // 1 slot
        assert!(socket_card(&mut w, "spidersilk"));
        assert!(!socket_card(&mut w, "midgetclaw"));
        assert_eq!(w.cards.len(), 1);
    }

    /// The shadowing bug the oracle's comment names: mythic is checked FIRST
    /// so the legendary branch cannot eat its roll.
    #[test]
    fn the_drop_gates_are_checked_mythic_first() {
        let opts = DropOpts {
            floor: 12,
            boss: true,
            mythic_allowed: true,
            legendary_allowed: true,
            ..Default::default()
        };
        // 0.1 clears the 0.18 mythic gate on the very first draw.
        let got = roll_card_drop(&opts, &mut seq(&[0.1, 0.9, 0.0])).unwrap();
        assert_eq!(card_catalogue(got).unwrap().rarity, CardRarity::Mythic);
        // 0.5 fails mythic, then 0.1 clears legendary.
        let got = roll_card_drop(&opts, &mut seq(&[0.5, 0.1, 0.9, 0.0])).unwrap();
        assert_eq!(card_catalogue(got).unwrap().rarity, CardRarity::Legendary);
    }

    /// THE RATE-INFLATION REGRESSION, and the most important test here.
    ///
    /// Every affinity draw happens INSIDE `pick`, i.e. only after a gate has
    /// already decided a card drops. If one moved out in front of the gates it
    /// would consume the value a gate was about to read, and the DROP RATE
    /// would change while every gate constant stayed the same.
    ///
    /// ⚠️ MEASURED AS A GATE-DRAW SEQUENCE, not as a count over a shared
    /// stream. My first attempt asserted equal drop counts from one fixed
    /// sequence and failed 292 vs 271 — and re-running the ORACLE's own gate
    /// structure gave 292 vs 255, so the count is not invariant there either.
    /// It cannot be: `pick` legitimately consumes draws, so an affinity pick
    /// leaves the next call at a different offset. What must be identical is
    /// the run of values the GATES see, which is what this asserts.
    #[test]
    fn the_affinity_draws_happen_after_the_gates_and_never_shift_them() {
        // Record every value handed out, then compare the prefix each variant
        // consumed BEFORE its first pick.
        fn gate_draws(opts: &DropOpts) -> Vec<f64> {
            let stream: Vec<f64> = (0..64).map(|i| f64::from(i % 97) / 97.0).collect();
            let seen = std::cell::RefCell::new(Vec::new());
            let mut i = 0;
            let mut rand = || {
                let v = stream[i % stream.len()];
                i += 1;
                seen.borrow_mut().push(v);
                v
            };
            roll_card_drop(opts, &mut rand);
            seen.into_inner()
        }
        let plain = DropOpts {
            floor: 12,
            boss: true,
            mythic_allowed: true,
            legendary_allowed: true,
            ..Default::default()
        };
        let affine = DropOpts {
            kind: Some(EnemyKind::Zombie),
            sub_type: Some(ZombieType::Hulk),
            affinity: Some(2.0),
            ..plain.clone()
        };
        let (a, b) = (gate_draws(&plain), gate_draws(&affine));
        // The FIRST draw is the mythic gate in both. If an affinity draw ever
        // moved ahead of it, this is where it would show.
        assert_eq!(
            a[0], b[0],
            "an affinity draw got in front of the first gate"
        );
        // Affinity only ever ADDS draws (inside pick), never removes or
        // reorders the ones the gates take.
        assert!(
            b.len() >= a.len(),
            "affinity consumed FEWER draws, so it replaced a gate draw"
        );
        // And with affinity off entirely, the streams are identical.
        let no_affinity = DropOpts {
            affinity: Some(0.0),
            ..affine.clone()
        };
        assert_eq!(
            gate_draws(&plain)[0],
            gate_draws(&no_affinity)[0],
            "the gates must not care whether affinity is configured"
        );
    }

    /// The rate itself, measured the only way it is meaningful: over MANY
    /// independent streams, where the offset shifting cannot bias the answer.
    #[test]
    fn the_common_gate_fires_at_its_stated_one_percent() {
        let opts = DropOpts {
            floor: 1,
            drop_mult: Some(1.0),
            ..Default::default()
        };
        // A non-boss, non-goldwall roll reaches only the common gate, whose
        // one draw must clear 0.01.
        let hits = (0..1000)
            .filter(|i| {
                let v = f64::from(*i) / 1000.0;
                roll_card_drop(&opts, &mut seq(&[v, 0.5, 0.5])).is_some()
            })
            .count();
        assert_eq!(hits, 10, "the 1% common gate moved: {hits}/1000");
    }

    /// A foreign sub-typed card must never arrive from the wrong monster.
    #[test]
    fn a_hulk_never_hands_you_the_midget_card() {
        let opts = DropOpts {
            floor: 1,
            guaranteed: true,
            kind: Some(EnemyKind::Zombie),
            sub_type: Some(ZombieType::Hulk),
            ..Default::default()
        };
        for i in 0..200 {
            let r = f64::from(i) / 200.0;
            if let Some(id) = roll_card_drop(&opts, &mut seq(&[0.99, r, r, r])) {
                if let Some(st) = card_catalogue(id).unwrap().sub_type {
                    assert_eq!(st, ZombieType::Hulk, "{id} came from the wrong monster");
                }
            }
        }
    }

    #[test]
    fn a_level_roll_tracks_the_floor_and_stays_in_range() {
        // floor 1 → base 1; the 20% branch would give 0, clamped to 1.
        assert_eq!(roll_card_level(1, &mut seq(&[0.1])), 1);
        assert_eq!(roll_card_level(9, &mut seq(&[0.5])), 5); // base
        assert_eq!(roll_card_level(9, &mut seq(&[0.99])), 7); // base + 2
        assert_eq!(roll_card_level(99, &mut seq(&[0.99])), CARD_LEVEL_MAX);
    }

    #[test]
    fn a_boss_doubles_the_shiny_chance_and_the_cap_holds() {
        assert!(roll_shiny(false, &mut seq(&[0.03])));
        assert!(!roll_shiny(false, &mut seq(&[0.05])));
        assert!(roll_shiny(true, &mut seq(&[0.07])));
        assert!(!roll_shiny(true, &mut seq(&[0.09])));
    }

    /// The wrapper's whole reason to exist: level and shine are drawn AFTER
    /// the gates, so they cannot shift the drop stream.
    #[test]
    fn a_rolled_instance_resolves_to_a_real_card() {
        let opts = DropOpts {
            floor: 5,
            guaranteed: true,
            ..Default::default()
        };
        let id = roll_card_instance(&opts, &mut seq(&[0.99, 0.0, 0.5, 0.99])).unwrap();
        assert!(card_def(&id).is_some(), "{id} did not resolve");
    }

    #[test]
    fn re_keying_keeps_the_level_and_the_shine() {
        assert_eq!(re_key_card("flailerjaw#7s", "grimscythe"), "grimscythe#7s");
        assert_eq!(re_key_card("flailerjaw", "grimscythe"), "grimscythe");
    }

    /// JS truthiness: `if (m.x)` is false for 0, so a zero field is ABSENT.
    #[test]
    fn a_zero_valued_field_reads_as_absent_exactly_as_js_does() {
        let m = CardModifier {
            damage_flat: Some(0),
            crit_chance: Some(0.0),
            ..NEUTRAL
        };
        assert!(modifier_rows(&m).is_empty(), "a zero field emitted a row");
        assert_eq!(card_power(&m), 10);
        // …but 1.0 IS truthy in JS, and is filtered later by an explicit != 1.
        let one = CardModifier {
            damage_mult: Some(1.0),
            ..NEUTRAL
        };
        assert!(modifier_rows(&one).is_empty());
        assert_eq!(scale_modifier(one, 1.6).damage_mult, Some(1.0));
    }
}
