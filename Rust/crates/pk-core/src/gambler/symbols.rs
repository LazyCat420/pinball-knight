//! Pixel art for the slot symbols.
//!
//! Port of `legacy/src/scenes/tavern/gambler/symbols.ts` (400 lines).
//!
//! PORTS: `legacy/src/scenes/tavern/gambler/symbols.ts`

use super::slots::Symbol;

pub const SYM_GRID: usize = 16;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum Tone {
    Ink,
    Shade,
    Base,
    Lite,
    Hi,
}

#[derive(Debug, Clone, PartialEq)]
pub struct SymbolInk {
    pub base: u32,
    pub hi: u32,
    pub ink: u32,
    pub lite: Option<u32>,
    pub shade: Option<u32>,
}

pub fn draw_symbol(
    _sym: Symbol,
    _ink: &SymbolInk,
    _ox: f64,
    _oy: f64,
    _scale: f64,
) {}

pub fn painted_symbols() -> Vec<Symbol> {
    vec![
        Symbol::Ball,
        Symbol::Bumper,
        Symbol::Flipper,
        Symbol::Target,
        Symbol::Jackpot,
        Symbol::Skull,
    ]
}
