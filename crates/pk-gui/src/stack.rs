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
    /// This screen paints something that moves, so it needs frames even when
    /// no input arrives.
    ///
    /// The shell skips `paint_stack` entirely on a quiet frame over an
    /// unchanged stack — that skip is most of the game's idle cost and is not
    /// negotiable (it was worth a measured 36→14 fps when it regressed). A
    /// screen that animates is the one case where "nothing arrived" does not
    /// mean "nothing changed", so it opts out here rather than by weakening
    /// the skip for everyone.
    pub animates: bool,
    pub design: Option<Design>,
}

impl<Id: Copy + Eq> ScreenEntry<Id> {
    pub fn new(id: Id, pauses: bool) -> Self {
        Self {
            id,
            pauses,
            focus: 0,
            scroll: 0.0,
            animates: false,
            design: None,
        }
    }

    pub fn with_design(mut self, w: f64, h: f64, max: u32) -> Self {
        self.design = Some(Design { w, h, max });
        self
    }

    /// Mark this screen as animating — see [`ScreenEntry::animates`].
    pub fn animating(mut self) -> Self {
        self.animates = true;
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

    /// Does any open screen need frames without input?
    ///
    /// Any, not just the top: an animation under a modal keeps running, which
    /// is what the oracle's single RAF does. The shell consults this to decide
    /// whether a quiet frame may be skipped.
    pub fn animates(&self) -> bool {
        self.entries.iter().any(|s| s.animates)
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

    /// `animates()` asks about ANY open screen, not the top one.
    ///
    /// Same shape as `pauses()`, and for the same reason: a spinning wheel
    /// under a confirm box still has to be painted, so the question the shell
    /// asks is "does anything on this stack need frames", not "does the screen
    /// receiving input need them".
    #[test]
    fn a_screen_that_animates_makes_the_whole_stack_animate() {
        let mut s: UiStack<u8> = UiStack::new();
        assert!(!s.animates(), "an empty stack asks for nothing");
        s.push(ScreenEntry::new(0, false));
        assert!(!s.animates(), "a static screen asks for nothing");
        s.push(ScreenEntry::new(1, true).animating());
        assert!(s.animates());
        // Buried under a modal, it still wants frames.
        s.push(ScreenEntry::new(2, true));
        assert!(s.animates());
        s.remove(1);
        assert!(!s.animates(), "and stops wanting them once it closes");
    }

    /// Screens are static unless they say otherwise.
    ///
    /// The flag has to default false or every existing screen would silently
    /// defeat the shell's quiet-frame skip, which is most of the idle cost.
    #[test]
    fn a_screen_is_static_until_it_asks_not_to_be() {
        assert!(!ScreenEntry::new(0u8, true).animates);
        assert!(ScreenEntry::new(0u8, true).animating().animates);
        // …and it composes with the design box, in either order.
        assert!(
            ScreenEntry::new(0u8, true)
                .with_design(600.0, 420.0, 2)
                .animating()
                .animates
        );
    }

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
