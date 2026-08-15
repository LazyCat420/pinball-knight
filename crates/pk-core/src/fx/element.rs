//! Common Elemental Shader Material Configuration — Additive vs Normal blending flags and parameters.
//!
//! PORTS: `fx/elements/element.ts`

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum ElementKind {
    Fire,
    Slick,
    Frost,
    Oil,
    Tar,
    Rod,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct ElementMaterialConfig {
    pub additive: bool,
    pub transparent: bool,
    pub depth_write: bool,
}

/// Fire, frost and the rod ADD light (bloom feeds on cores); oil, tar and water sit ON the scene.
pub const fn is_element_additive(kind: ElementKind) -> bool {
    match kind {
        ElementKind::Fire | ElementKind::Frost | ElementKind::Rod => true,
        ElementKind::Slick | ElementKind::Oil | ElementKind::Tar => false,
    }
}

/// Returns the standard material blending and depth flags for an elemental surface decal.
pub const fn get_element_config(kind: ElementKind) -> ElementMaterialConfig {
    ElementMaterialConfig {
        additive: is_element_additive(kind),
        transparent: true,
        depth_write: false,
    }
}
