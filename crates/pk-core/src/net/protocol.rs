//! 🕸️ Realtime protocol — client mirror of the wire contract.
//!
//! PORTS: `legacy/src/net/protocol.ts`

use serde::{Deserialize, Serialize};

pub const POOL_MAX: usize = 24;

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct KnightColor {
    pub slot: i32,
    pub name: String,
    pub hex: u32,
}

pub fn knight_colors() -> [KnightColor; 8] {
    [
        KnightColor { slot: 0, name: "Crimson".into(), hex: 0xe05050 },
        KnightColor { slot: 1, name: "Cobalt".into(), hex: 0x5080e0 },
        KnightColor { slot: 2, name: "Ember".into(), hex: 0xe09030 },
        KnightColor { slot: 3, name: "Sage".into(), hex: 0x50c878 },
        KnightColor { slot: 4, name: "Violet".into(), hex: 0xa050e0 },
        KnightColor { slot: 5, name: "Gold".into(), hex: 0xf0c040 },
        KnightColor { slot: 6, name: "Frost".into(), hex: 0x70d0e0 },
        KnightColor { slot: 7, name: "Iron".into(), hex: 0x909090 },
    ]
}

pub fn color_for_slot(slot: i32) -> KnightColor {
    if slot < 0 {
        KnightColor { slot: -1, name: "Waiting".into(), hex: 0x808080 }
    } else {
        let colors = knight_colors();
        colors[(slot as usize) % colors.len()].clone()
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, Default)]
pub enum NetFacing {
    #[default]
    S,
    N,
    E,
    W,
}

impl NetFacing {
    pub fn as_str(&self) -> &'static str {
        match self {
            NetFacing::S => "S",
            NetFacing::N => "N",
            NetFacing::E => "E",
            NetFacing::W => "W",
        }
    }

    pub fn from_str(s: &str) -> Self {
        match s {
            "N" => NetFacing::N,
            "E" => NetFacing::E,
            "W" => NetFacing::W,
            _ => NetFacing::S,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct RemoteKnight {
    pub id: String,
    pub slot: i32,
    pub name: String,
    pub x: f64,
    pub z: f64,
    pub facing: NetFacing,
    pub scene: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mode: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ClientMessage {
    Hello {
        name: String,
        #[serde(rename = "preferredSlot", skip_serializing_if = "Option::is_none")]
        preferred_slot: Option<i32>,
    },
    Move {
        x: f64,
        z: f64,
        facing: NetFacing,
        scene: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        mode: Option<String>,
    },
    World {
        scene: String,
        snap: serde_json::Value,
    },
    Act {
        scene: String,
        act: serde_json::Value,
    },
    Ping,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum ServerMessage {
    #[serde(rename = "welcome")]
    Welcome {
        id: String,
        slot: i32,
        name: String,
        colors: Vec<KnightColor>,
        seed: u64,
    },
    #[serde(rename = "room:state")]
    RoomState {
        players: Vec<RemoteKnight>,
    },
    #[serde(rename = "player:join")]
    PlayerJoin {
        player: RemoteKnight,
    },
    #[serde(rename = "player:leave")]
    PlayerLeave {
        id: String,
    },
    #[serde(rename = "room:full")]
    RoomFull,
    #[serde(rename = "player:move")]
    PlayerMove {
        id: String,
        x: f64,
        z: f64,
        facing: NetFacing,
        scene: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        mode: Option<String>,
    },
    #[serde(rename = "world")]
    World {
        #[serde(rename = "fromId")]
        from_id: String,
        scene: String,
        snap: serde_json::Value,
    },
    #[serde(rename = "act")]
    Act {
        #[serde(rename = "fromId")]
        from_id: String,
        scene: String,
        act: serde_json::Value,
    },
    #[serde(rename = "pong")]
    Pong,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn color_wrapping_matches_oracle() {
        assert_eq!(color_for_slot(0).name, "Crimson");
        assert_eq!(color_for_slot(7).name, "Iron");
        assert_eq!(color_for_slot(8).name, "Crimson");
        assert_eq!(color_for_slot(-1).name, "Waiting");
    }

    #[test]
    fn message_serialization_roundtrips() {
        let msg = ClientMessage::Move {
            x: 12.5,
            z: -4.0,
            facing: NetFacing::E,
            scene: "tavern".into(),
            mode: Some("walk".into()),
        };
        let json = serde_json::to_string(&msg).unwrap();
        assert!(json.contains(r#""type":"move""#));
        assert!(json.contains(r#""facing":"E""#));
        let decoded: ClientMessage = serde_json::from_str(&json).unwrap();
        assert_eq!(msg, decoded);
    }
}
