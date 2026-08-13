//! ZOMBIE SUB-TYPES — behavioural variety inside the `zombie` EnemyKind.
//!
//! A sub-type is a MULTIPLIER BUNDLE over the zombie baseline, not a new
//! EnemyKind.
//!
//! PORTS: `zombie-types.ts`

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub enum ZombieType {
    Shambler,
    Runner,
    Lurcher,
    Hulk,
    Midget,
    Crawler,
    Flailer,
    Hobbler,
}

impl ZombieType {
    pub const ALL: [Self; 8] = [
        Self::Shambler,
        Self::Runner,
        Self::Lurcher,
        Self::Hulk,
        Self::Midget,
        Self::Crawler,
        Self::Flailer,
        Self::Hobbler,
    ];

    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Shambler => "shambler",
            Self::Runner => "runner",
            Self::Lurcher => "lurcher",
            Self::Hulk => "hulk",
            Self::Midget => "midget",
            Self::Crawler => "crawler",
            Self::Flailer => "flailer",
            Self::Hobbler => "hobbler",
        }
    }

    pub fn from_str_id(s: &str) -> Option<Self> {
        match s {
            "shambler" => Some(Self::Shambler),
            "runner" => Some(Self::Runner),
            "lurcher" => Some(Self::Lurcher),
            "hulk" => Some(Self::Hulk),
            "midget" => Some(Self::Midget),
            "crawler" => Some(Self::Crawler),
            "flailer" => Some(Self::Flailer),
            "hobbler" => Some(Self::Hobbler),
            _ => None,
        }
    }

    pub const fn def(self) -> ZombieTypeDef {
        match self {
            Self::Shambler => ZombieTypeDef {
                id: Self::Shambler,
                label: "Shambler",
                speed_mult: 1.0,
                hp_mult: 1.0,
                scale: 1.0,
                body_r_mult: 1.0,
                reach_mult: 1.0,
                windup_mult: 1.0,
                weight: 34,
                from_level: 1,
                gait: None,
                knockback: None,
                movement: None,
                pain_mult: 1.0,
                exception: None,
            },
            Self::Runner => ZombieTypeDef {
                id: Self::Runner,
                label: "Runner",
                speed_mult: 1.75,
                hp_mult: 0.67,
                scale: 0.95,
                body_r_mult: 0.95,
                reach_mult: 1.0,
                windup_mult: 0.75,
                weight: 16,
                from_level: 2,
                gait: None,
                knockback: None,
                movement: Some("flanker"),
                pain_mult: 1.2,
                exception: Some(ZombieException::DodgesRanged),
            },
            Self::Lurcher => ZombieTypeDef {
                id: Self::Lurcher,
                label: "Lurcher",
                speed_mult: 0.55,
                hp_mult: 2.0,
                scale: 1.1,
                body_r_mult: 1.1,
                reach_mult: 1.05,
                windup_mult: 1.3,
                weight: 14,
                from_level: 1,
                gait: None,
                knockback: None,
                movement: None,
                pain_mult: 0.6,
                exception: Some(ZombieException::BounceImmune),
            },
            Self::Hulk => ZombieTypeDef {
                id: Self::Hulk,
                label: "Hulk",
                speed_mult: 0.7,
                hp_mult: 3.0,
                scale: 1.55,
                body_r_mult: 1.5,
                reach_mult: 1.35,
                windup_mult: 1.45,
                weight: 6,
                from_level: 4,
                gait: None,
                knockback: Some(7.5),
                movement: None,
                pain_mult: 0.25,
                exception: Some(ZombieException::SpeedOnly),
            },
            Self::Midget => ZombieTypeDef {
                id: Self::Midget,
                label: "Midget",
                speed_mult: 1.35,
                hp_mult: 0.67,
                scale: 0.62,
                body_r_mult: 0.65,
                reach_mult: 0.7,
                windup_mult: 0.85,
                weight: 12,
                from_level: 2,
                gait: None,
                knockback: None,
                movement: Some("packhunter"),
                pain_mult: 1.3,
                exception: Some(ZombieException::DodgesRanged),
            },
            Self::Crawler => ZombieTypeDef {
                id: Self::Crawler,
                label: "Crawler",
                speed_mult: 0.4,
                hp_mult: 1.33,
                scale: 0.5,
                body_r_mult: 0.7,
                reach_mult: 0.65,
                windup_mult: 1.1,
                weight: 8,
                from_level: 3,
                gait: Some("crawl"),
                knockback: None,
                movement: Some("ambusher"),
                pain_mult: 0.8,
                exception: Some(ZombieException::BounceImmune),
            },
            Self::Flailer => ZombieTypeDef {
                id: Self::Flailer,
                label: "Flailer",
                speed_mult: 1.15,
                hp_mult: 1.0,
                scale: 1.0,
                body_r_mult: 1.0,
                reach_mult: 0.6,
                windup_mult: 0.7,
                weight: 6,
                from_level: 3,
                gait: None,
                knockback: None,
                movement: Some("leaper"),
                pain_mult: 1.0,
                exception: Some(ZombieException::SpeedOnly),
            },
            Self::Hobbler => ZombieTypeDef {
                id: Self::Hobbler,
                label: "Hobbler",
                speed_mult: 0.85,
                hp_mult: 1.0,
                scale: 1.0,
                body_r_mult: 1.0,
                reach_mult: 0.9,
                windup_mult: 1.0,
                weight: 4,
                from_level: 2,
                gait: Some("limp"),
                knockback: None,
                movement: None,
                pain_mult: 1.15,
                exception: Some(ZombieException::BounceImmune),
            },
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ZombieException {
    BounceImmune,
    SpeedOnly,
    DodgesRanged,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct ZombieTypeDef {
    pub id: ZombieType,
    pub label: &'static str,
    pub speed_mult: f64,
    pub hp_mult: f64,
    pub scale: f64,
    pub body_r_mult: f64,
    pub reach_mult: f64,
    pub windup_mult: f64,
    pub weight: u32,
    pub from_level: u32,
    pub gait: Option<&'static str>,
    pub knockback: Option<f64>,
    pub movement: Option<&'static str>,
    pub pain_mult: f64,
    pub exception: Option<ZombieException>,
}

/// Integer avalanche (the xorshift-multiply finalizer). Pure, deterministic, and
/// total over uint32.
pub fn mix32(h: u32) -> u32 {
    let mut x = h;
    x ^= x >> 16;
    x = x.wrapping_mul(0x7feb352d);
    x ^= x >> 15;
    x = x.wrapping_mul(0x846ca68b);
    x ^= x >> 16;
    x
}

pub fn pick_zombie_type(hash: u32, level: u32) -> ZombieType {
    let mut eligible = Vec::new();
    let mut total = 0;
    for t in ZombieType::ALL {
        let def = t.def();
        if level >= def.from_level {
            eligible.push(t);
            total += def.weight;
        }
    }
    if total == 0 {
        return ZombieType::Shambler;
    }

    let mut r = mix32(hash) % total;
    for t in eligible {
        let w = t.def().weight;
        if r < w {
            return t;
        }
        r -= w;
    }
    ZombieType::Shambler
}

pub fn type_hp(base_hp: i32, t: ZombieType) -> i32 {
    (f64::from(base_hp) * t.def().hp_mult).round().max(1.0) as i32
}

pub fn type_drop_mult(t: ZombieType) -> f64 {
    t.def().hp_mult.min(2.0)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn weights_sum_to_100() {
        let total: u32 = ZombieType::ALL.iter().map(|t| t.def().weight).sum();
        assert_eq!(total, 100);
    }

    #[test]
    fn pick_zombie_type_is_deterministic() {
        let a = pick_zombie_type(0x12345678, 3);
        let b = pick_zombie_type(0x12345678, 3);
        assert_eq!(a, b);
    }
}
