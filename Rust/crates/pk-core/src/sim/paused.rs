//! The Simulation Pause Contract — Universal modal pause check for the physics tick and frame loop.
//!
//! PORTS: `sim/paused.ts`

#[derive(Clone, Copy, Debug, PartialEq, Eq, Default)]
pub struct PauseState {
    pub ui_pauses: bool,
    pub tavern_open: bool,
}

impl PauseState {
    pub fn new(ui_pauses: bool, tavern_open: bool) -> Self {
        Self {
            ui_pauses,
            tavern_open,
        }
    }

    /// True while ANY modal surface or tavern scene owns the screen.
    pub fn is_sim_paused(&self) -> bool {
        self.ui_pauses || self.tavern_open
    }
}

/// Evaluates whether the simulation should pause based on active modal UI or tavern state.
pub fn is_sim_paused(ui_pauses: bool, tavern_open: bool) -> bool {
    ui_pauses || tavern_open
}
