//! Floor Haul Card Reader — Aggregates floor pickups into readable stacks and flags notable pulls.
//!
//! Port of `legacy/src/game/pinball-knight/card-reader.ts` (148 lines).
//!
//! PORTS: `card-reader.ts`

use std::collections::{HashMap, HashSet};

use super::{card_base, card_def, card_tier, is_shiny_card};

#[derive(Clone, Debug, PartialEq)]
pub struct HaulEntry {
    pub id: String,
    pub note: Option<String>,
    pub fresh: bool,
}

#[derive(Clone, Debug, PartialEq)]
pub struct HaulStack {
    pub id: String,
    pub count: usize,
    pub fresh: bool,
    pub notes: Vec<String>,
}

/// Is this pull one to call out — the first copy this run, or epic and above?
pub fn is_notable_pull(id: &str, seen: &HashSet<String>) -> bool {
    card_tier(id) >= 2 || is_shiny_card(id) || !seen.contains(card_base(id))
}

/// Fold a floor's haul into one row per DISTINCT card.
///
/// Grouped by the full instance id, ordered BEST PULL FIRST
/// (rarity tier → shine → level → count).
pub fn stack_haul(entries: &[HaulEntry]) -> Vec<HaulStack> {
    let mut by: HashMap<String, HaulStack> = HashMap::new();
    let mut order = Vec::new();

    for e in entries {
        if card_def(&e.id).is_none() {
            continue;
        }
        if let Some(s) = by.get_mut(&e.id) {
            s.count += 1;
            s.fresh = s.fresh || e.fresh;
            if let Some(note) = &e.note {
                if !s.notes.contains(note) {
                    s.notes.push(note.clone());
                }
            }
        } else {
            order.push(e.id.clone());
            by.insert(
                e.id.clone(),
                HaulStack {
                    id: e.id.clone(),
                    count: 1,
                    fresh: e.fresh,
                    notes: e.note.as_ref().map(|n| vec![n.clone()]).unwrap_or_default(),
                },
            );
        }
    }

    let mut result: Vec<HaulStack> = by.into_values().collect();
    result.sort_by(|a, b| {
        let ta = card_tier(&a.id);
        let tb = card_tier(&b.id);
        if ta != tb {
            return tb.cmp(&ta);
        }
        let sa = if is_shiny_card(&a.id) { 1 } else { 0 };
        let sb = if is_shiny_card(&b.id) { 1 } else { 0 };
        if sa != sb {
            return sb.cmp(&sa);
        }
        let la = card_def(&a.id).map(|c| c.level).unwrap_or(1);
        let lb = card_def(&b.id).map(|c| c.level).unwrap_or(1);
        if la != lb {
            return lb.cmp(&la);
        }
        b.count.cmp(&a.count)
    });
    result
}

pub fn present_card_pickup(_id: &str, _note: &str) {}

pub fn show_card_haul(_entries: &[HaulEntry], _floor: u32) {}

pub fn advance_card_reader() {}

pub fn dismiss_card_reader() {}
