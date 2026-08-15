//! Floor Haul Card Reader — Aggregates floor pickups into readable stacks and flags notable pulls.
//!
//! PORTS: `card-reader.ts`

use std::collections::{HashMap, HashSet};

#[derive(Clone, Debug, PartialEq)]
pub struct HaulEntry {
    pub card_id: String,
    pub socket_note: Option<String>,
}

#[derive(Clone, Debug, PartialEq)]
pub struct HaulStack {
    pub card_id: String,
    pub count: usize,
    pub fresh: bool,
    pub notes: Vec<String>,
}

/// Evaluates if a card pull is notable: tier >= 2 (Rare+), shiny variant, or never-before-seen card base.
pub fn is_notable_pull(id: &str, is_shiny: bool, tier: u8, seen_kinds: &HashSet<String>) -> bool {
    tier >= 2 || is_shiny || !seen_kinds.contains(id)
}

/// Aggregates all card pulls found during a floor into consolidated stacks.
pub fn group_floor_haul(entries: &[HaulEntry], seen_kinds: &HashSet<String>) -> Vec<HaulStack> {
    let mut map: HashMap<String, (usize, Vec<String>)> = HashMap::new();
    let mut order = Vec::new();

    for entry in entries {
        if !map.contains_key(&entry.card_id) {
            order.push(entry.card_id.clone());
        }
        let stack = map.entry(entry.card_id.clone()).or_insert((0, Vec::new()));
        stack.0 += 1;
        if let Some(note) = &entry.socket_note {
            if !stack.1.contains(note) {
                stack.1.push(note.clone());
            }
        }
    }

    order
        .into_iter()
        .map(|id| {
            let (count, notes) = map.remove(&id).unwrap();
            let fresh = !seen_kinds.contains(&id);
            HaulStack {
                card_id: id,
                count,
                fresh,
                notes,
            }
        })
        .collect()
}
