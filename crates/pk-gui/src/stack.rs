//! The screen stack — `legacy/src/game/pinball-knight/gui/stack.ts`.
//!
//! Modality as data: input goes to the top, everything paints bottom-up, and a
//! screen pauses the world because it SAYS it does (`pauses`), not because a
//! DOM node happens to exist. The `remove` / `close` distinction is
//! load-bearing: `close` truncates (a parent closing must close the child it
//! raised); `remove` takes exactly one screen wherever it sits — the always-on
//! layers (station prompt, HUD) live at the bottom and must never take the
//! stack with them (stack.ts's 2026-07-29 war story).

/// The logical box a screen was authored for. The driver hands the screen the
/// largest INTEGER zoom at which the box still fits the grid, capped by `max`.
#[derive(Clone, Copy, Debug)]
pub struct Design {
    pub w: f64,
    pub h: f64,
    pub max: u32,
}

#[derive(Clone, Debug)]
pub struct ScreenEntry<Id: Copy + Eq> {
    pub id: Id,
    /// Freeze the simulation while this is open. HUDs and prompts are false;
    /// every full-screen sheet is true.
    pub pauses: bool,
    /// Focus cursor, persisted across frames. Owned by the screen.
    pub focus: i64,
    /// Scroll offset for the screen's main region, if it has one.
    pub scroll: f64,
    pub design: Option<Design>,
}

impl<Id: Copy + Eq> ScreenEntry<Id> {
    pub fn new(id: Id, pauses: bool) -> Self {
        Self {
            id,
            pauses,
            focus: 0,
            scroll: 0.0,
            design: None,
        }
    }

    pub fn with_design(mut self, w: f64, h: f64, max: u32) -> Self {
        self.design = Some(Design { w, h, max });
        self
    }
}

#[derive(Default)]
pub struct UiStack<Id: Copy + Eq> {
    entries: Vec<ScreenEntry<Id>>,
}

impl<Id: Copy + Eq> UiStack<Id> {
    pub fn new() -> Self {
        Self {
            entries: Vec::new(),
        }
    }

    /// Everything currently open, bottom-up. Painting order.
    pub fn screens(&self) -> &[ScreenEntry<Id>] {
        &self.entries
    }

    pub fn screens_mut(&mut self) -> &mut [ScreenEntry<Id>] {
        &mut self.entries
    }

    pub fn len(&self) -> usize {
        self.entries.len()
    }

    pub fn is_empty(&self) -> bool {
        self.entries.is_empty()
    }

    /// The screen that owns input right now.
    pub fn top(&self) -> Option<&ScreenEntry<Id>> {
        self.entries.last()
    }

    pub fn is_open(&self, id: Id) -> bool {
        self.entries.iter().any(|s| s.id == id)
    }

    /// Whether the UI should own the keyboard right now — NOT "is any screen
    /// open": the prompt/HUD are open all run and must not eat WASD.
    pub fn pauses(&self) -> bool {
        self.entries.iter().any(|s| s.pauses)
    }

    /// Re-opening what is already on top is a no-op, not a second copy.
    pub fn push(&mut self, s: ScreenEntry<Id>) {
        if self.top().map(|t| t.id == s.id).unwrap_or(false) {
            return;
        }
        self.entries.push(s);
    }

    pub fn pop(&mut self) -> Option<ScreenEntry<Id>> {
        self.entries.pop()
    }

    /// Remove exactly ONE screen, wherever it sits. Safe if it was never there.
    pub fn remove(&mut self, id: Id) {
        if let Some(i) = self.entries.iter().position(|s| s.id == id) {
            self.entries.remove(i);
        }
    }

    /// Pop until `id` is gone — it AND everything above it.
    pub fn close(&mut self, id: Id) {
        if let Some(i) = self.entries.iter().position(|s| s.id == id) {
            self.entries.truncate(i);
        }
    }

    pub fn clear(&mut self) {
        self.entries.clear();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn remove_takes_one_screen_and_close_truncates() {
        // The stack.ts war story: remove("hud") must not take the prompt with it.
        let mut s: UiStack<u8> = UiStack::new();
        s.push(ScreenEntry::new(0, false)); // hud
        s.push(ScreenEntry::new(1, false)); // prompt
        s.push(ScreenEntry::new(2, true)); // sheet
        s.remove(0);
        assert_eq!(s.len(), 2);
        assert!(s.is_open(1) && s.is_open(2));

        s.push(ScreenEntry::new(3, true));
        s.close(2); // closing the sheet takes the confirm it raised
        assert_eq!(s.len(), 1);
        assert!(s.is_open(1));
    }

    #[test]
    fn pauses_follows_the_flag_not_openness() {
        let mut s: UiStack<u8> = UiStack::new();
        s.push(ScreenEntry::new(0, false));
        assert!(!s.pauses());
        s.push(ScreenEntry::new(1, true));
        assert!(s.pauses());
    }

    #[test]
    fn push_dedupes_only_against_the_top() {
        let mut s: UiStack<u8> = UiStack::new();
        s.push(ScreenEntry::new(0, false));
        s.push(ScreenEntry::new(0, false));
        assert_eq!(s.len(), 1);
    }
}
