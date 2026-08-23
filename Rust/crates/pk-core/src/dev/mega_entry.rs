//! Dev Mega-Map Bundle Entry — Unified interface surface for offline mega-floor diagnostics.
//!
//! PORTS: `dev/mega-entry.ts`

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct MegaMapBundle {
    pub name: &'static str,
}

impl MegaMapBundle {
    pub fn new() -> Self {
        Self {
            name: "mega-map-bundle",
        }
    }
}
