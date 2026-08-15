//! Floor Haul Summary Screen — Consolidates and renders cards discovered during a floor clear.
//!
//! PORTS: `gui/screens/haul.ts`

pub const FACE_W: u32 = 104;
pub const FACE_H: u32 = 146;
pub const DESIGN_WIDTH: u32 = 600;
pub const DESIGN_HEIGHT: u32 = 338;
pub const SHEET_WIDTH: u32 = 584;
pub const SHEET_HEIGHT: u32 = 322;

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct HaulCardEntry {
    pub id: String,
    pub level: u32,
    pub is_shiny: bool,
    pub is_new: bool,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct HaulSummaryStack {
    pub id: String,
    pub count: u32,
    pub is_fresh: bool,
    pub is_shiny: bool,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct HaulScreenSummary {
    pub floor: u32,
    pub total_cards: u32,
    pub distinct_kinds: u32,
    pub new_cards: u32,
    pub shiny_cards: u32,
    pub stacks: Vec<HaulSummaryStack>,
}

/// Folds raw floor card entries into stacks and derives haul metrics.
pub fn compute_haul_summary(floor: u32, entries: &[HaulCardEntry]) -> HaulScreenSummary {
    let mut stacks: Vec<HaulSummaryStack> = Vec::new();

    for entry in entries {
        if let Some(existing) = stacks.iter_mut().find(|s| s.id == entry.id) {
            existing.count += 1;
            if entry.is_shiny {
                existing.is_shiny = true;
            }
            if entry.is_new {
                existing.is_fresh = true;
            }
        } else {
            stacks.push(HaulSummaryStack {
                id: entry.id.clone(),
                count: 1,
                is_fresh: entry.is_new,
                is_shiny: entry.is_shiny,
            });
        }
    }

    let total_cards = entries.len() as u32;
    let distinct_kinds = stacks.len() as u32;
    let new_cards = stacks.iter().filter(|s| s.is_fresh).count() as u32;
    let shiny_cards = entries.iter().filter(|e| e.is_shiny).count() as u32;

    HaulScreenSummary {
        floor,
        total_cards,
        distinct_kinds,
        new_cards,
        shiny_cards,
        stacks,
    }
}
