//! Pickup Toasts + Floor Titles — the transient text layer over the game viewport.
//!
//! PORTS: `gui/screens/toasts.ts`

use crate::im::{fill_rect, rect, stroke_rect, text, Align, Rect, TextOpts, UiFrame};
use crate::theme::Ui;

pub const MAX_ROWS: usize = 4;
pub const HOLD_MS: u64 = 2200;
pub const CARD_HOLD_MS: u64 = 2900;
pub const FADE_MS: u64 = 260;
pub const BANNER_DEFAULT_MS: u64 = 2400;

#[derive(Clone, Debug, PartialEq)]
pub struct Toast {
    pub text: String,
    pub card_id: Option<String>,
    pub until_ms: u64,
}

#[derive(Clone, Debug, PartialEq)]
pub struct Banner {
    pub title: String,
    pub sub: String,
    pub until_ms: u64,
}

#[derive(Clone, Debug, Default, PartialEq)]
pub struct ToastQueue {
    pub toasts: Vec<Toast>,
    pub banner: Option<Banner>,
}

impl ToastQueue {
    pub fn new() -> Self {
        Self::default()
    }

    /// Pushes a plain text toast (pickup, item swap, floor event).
    pub fn push_toast(&mut self, msg: &str, now_ms: u64) {
        self.toasts.push(Toast {
            text: msg.to_string(),
            card_id: None,
            until_ms: now_ms + HOLD_MS,
        });

        if self.toasts.len() > MAX_ROWS {
            let overflow = self.toasts.len() - MAX_ROWS;
            self.toasts.drain(0..overflow);
        }
    }

    /// Pushes a card pickup toast holding longer to allow card reading.
    pub fn push_card_toast(&mut self, card_id: &str, note: &str, now_ms: u64) {
        self.toasts.push(Toast {
            text: note.to_string(),
            card_id: Some(card_id.to_string()),
            until_ms: now_ms + CARD_HOLD_MS,
        });

        if self.toasts.len() > MAX_ROWS {
            let overflow = self.toasts.len() - MAX_ROWS;
            self.toasts.drain(0..overflow);
        }
    }

    /// Sets a big centered announcement banner (floor titles, rampage, boss).
    pub fn push_banner(&mut self, title: &str, sub: &str, now_ms: u64, duration_ms: u64) {
        self.banner = Some(Banner {
            title: title.to_string(),
            sub: sub.to_string(),
            until_ms: now_ms + duration_ms,
        });
    }

    /// Clears all active toasts and banners.
    pub fn clear(&mut self) {
        self.toasts.clear();
        self.banner = None;
    }

    /// Evicts expired toasts and banners based on current timestamp.
    pub fn prune(&mut self, now_ms: u64) {
        self.toasts.retain(|t| t.until_ms > now_ms);
        if let Some(b) = &self.banner {
            if b.until_ms <= now_ms {
                self.banner = None;
            }
        }
    }

    /// Paints the active toasts and banner onto the UI frame.
    pub fn paint_toasts(&self, f: &mut UiFrame, bounds: Rect, now_ms: u64) {
        // Paint active toasts from bottom up
        let mut y = bounds.h - 52.0;
        for t in self.toasts.iter().rev() {
            if t.until_ms <= now_ms {
                continue;
            }

            let row_rect = rect(bounds.x + 16.0, y - 20.0, 260.0, 18.0);
            fill_rect(f, &row_rect, Ui::WELL);
            stroke_rect(f, &row_rect, Ui::WELL_EDGE, 1.0);

            text(
                f,
                &t.text,
                row_rect.x + 6.0,
                row_rect.y + 2.0,
                TextOpts {
                    size: 10,
                    colour: Some(Ui::TEXT),
                    align: Align::Left,
                    max: None,
                },
            );

            y -= 22.0;
        }

        // Paint banner if active
        if let Some(b) = &self.banner {
            if b.until_ms > now_ms {
                let banner_w = 400.0;
                let banner_h = 60.0;
                let banner_rect = rect(
                    bounds.x + (bounds.w - banner_w) * 0.5,
                    bounds.y + (bounds.h - banner_h) * 0.35,
                    banner_w,
                    banner_h,
                );

                fill_rect(f, &banner_rect, Ui::SCRIM);
                stroke_rect(f, &banner_rect, Ui::GOLD, 2.0);

                text(
                    f,
                    &b.title,
                    banner_rect.x + banner_rect.w * 0.5,
                    banner_rect.y + 8.0,
                    TextOpts {
                        size: 16,
                        colour: Some(Ui::HEADING),
                        align: Align::Center,
                        max: None,
                    },
                );

                if !b.sub.is_empty() {
                    text(
                        f,
                        &b.sub,
                        banner_rect.x + banner_rect.w * 0.5,
                        banner_rect.y + 32.0,
                        TextOpts {
                            size: 10,
                            colour: Some(Ui::TEXT_DIM),
                            align: Align::Center,
                            max: None,
                        },
                    );
                }
            }
        }
    }
}
