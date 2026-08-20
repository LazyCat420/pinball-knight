//! GUI Dev Console Hooks — Programmatic in-game UI inspection and screen driving API.
//!
//! PORTS: `dev/gui-hooks.ts`

use crate::stack::{ScreenEntry, UiStack};

#[derive(Clone, Debug, PartialEq)]
pub struct GuiInspectorStatus {
    pub open: Vec<&'static str>,
    pub top: Option<&'static str>,
    pub focus: i64,
    pub scroll: f64,
    pub paused: bool,
    pub frames: u64,
    pub painted: u64,
    pub fonts: bool,
}

#[derive(Clone, Debug, Default)]
pub struct GuiHooksController {
    pub stack: UiStack<&'static str>,
    pub frames_drawn: u64,
    pub painted_count: u64,
    pub fonts_ready: bool,
}

pub fn install_gui_hooks() -> GuiHooksController {
    GuiHooksController::new()
}

impl GuiHooksController {
    pub fn new() -> Self {
        Self {
            stack: UiStack::new(),
            frames_drawn: 0,
            painted_count: 0,
            fonts_ready: true,
        }
    }

    /// Inspects current UI stack and focus state.
    pub fn inspect(&self) -> GuiInspectorStatus {
        let top_entry = self.stack.top();
        GuiInspectorStatus {
            open: self.stack.screens().iter().map(|s| s.id).collect(),
            top: top_entry.map(|s| s.id),
            focus: top_entry.map(|s| s.focus).unwrap_or(-1),
            scroll: top_entry.map(|s| s.scroll).unwrap_or(0.0),
            paused: self.stack.pauses(),
            frames: self.frames_drawn,
            painted: self.painted_count,
            fonts: self.fonts_ready,
        }
    }

    pub fn settings(&mut self) -> GuiInspectorStatus {
        self.stack.push(ScreenEntry::new("settings", true));
        self.inspect()
    }

    pub fn characters(&mut self) -> GuiInspectorStatus {
        self.stack.push(ScreenEntry::new("character-select", true));
        self.inspect()
    }

    pub fn menu(&mut self, _tab: Option<&str>) -> GuiInspectorStatus {
        self.stack.push(ScreenEntry::new("menu", true));
        self.inspect()
    }

    pub fn tavern(&mut self, _vendor: Option<&str>) -> GuiInspectorStatus {
        self.stack.push(ScreenEntry::new("tavern", true));
        self.inspect()
    }

    pub fn dead(&mut self) -> GuiInspectorStatus {
        self.stack.push(ScreenEntry::new("game-over", true));
        self.inspect()
    }

    pub fn shop(&mut self) -> GuiInspectorStatus {
        self.stack.push(ScreenEntry::new("shop", true));
        self.inspect()
    }

    pub fn probe(&mut self) -> &'static str {
        self.stack.push(ScreenEntry::new("probe", true));
        "probe screen pushed — the gold block belongs TOP-LEFT, the cyan bar down the LEFT edge"
    }

    pub fn close(&mut self) -> GuiInspectorStatus {
        self.stack.pop();
        self.inspect()
    }

    pub fn clear(&mut self) -> GuiInspectorStatus {
        self.stack.clear();
        self.inspect()
    }
}
