//! Tavern Boot Notice — Plain DOM fallback overlay visible before the WebGPU renderer initializes or on initialization failure.
//!
//! PORTS: `legacy/src/scenes/tavern/boot-notice.ts`

pub const TAVERN_NOTICE_ID: &str = "tavern-boot-notice";
pub const COLOR_BG: &str = "#07090d";
pub const COLOR_GOLD: &str = "#c8a24a";
pub const COLOR_CRIMSON: &str = "#c4453f";
pub const COLOR_MUTED: &str = "#8a8578";

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum TavernBootState {
    Loading,
    Failed,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct TavernBootNotice {
    pub state: TavernBootState,
    pub heading: String,
    pub detail: Option<String>,
    pub reload_button: bool,
}

impl TavernBootNotice {
    /// Creates the loading notice state displayed during shader pipeline warm-up.
    pub fn loading() -> Self {
        Self {
            state: TavernBootState::Loading,
            heading: "OPENING THE TAVERN…".to_string(),
            detail: None,
            reload_button: false,
        }
    }

    /// Creates the failed notice state displayed if the graphics backend refuses to start.
    pub fn failed(reason: Option<&str>) -> Self {
        let detail = reason.unwrap_or(
            "the graphics backend refused to start. this is usually a second webgpu context the browser would not grant — closing other tabs and reloading normally clears it."
        );
        Self {
            state: TavernBootState::Failed,
            heading: "THE TAVERN COULD NOT START".to_string(),
            detail: Some(detail.to_string()),
            reload_button: true,
        }
    }
}

/// Evaluates the `?tavernfail=1` fault-injection condition.
pub fn evaluate_fault_injection(has_fault_flag: bool) -> Result<(), &'static str> {
    if has_fault_flag {
        Err("FAULT INJECTION: ?tavernfail=1")
    } else {
        Ok(())
    }
}
