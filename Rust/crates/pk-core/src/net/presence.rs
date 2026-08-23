//! 👥 Pool presence — in-memory registry of remote players in the shared world.
//!
//! PORTS: `legacy/src/net/presence.ts`

use std::collections::HashMap;
use crate::net::protocol::{color_for_slot, KnightColor, NetFacing, ServerMessage};

pub const MOVE_HZ: f64 = 15.0;
pub const MOVE_INTERVAL: f64 = 1.0 / MOVE_HZ;

#[derive(Clone, Debug, PartialEq)]
pub struct PeerInfo {
    pub id: String,
    pub slot: i32,
    pub name: String,
    pub scene: String,
    pub x: f64,
    pub z: f64,
    pub facing: NetFacing,
    pub mode: String,
    pub last_seen: f64,
}

#[derive(Clone, Debug, PartialEq)]
pub struct PeerArrival {
    pub id: String,
    pub name: String,
    pub scene: String,
}

#[derive(Clone, Debug, PartialEq)]
pub struct PeerDeparture {
    pub id: String,
    pub name: String,
    pub scene: String,
    pub x: f64,
    pub z: f64,
}

pub type ArriveFn = Box<dyn Fn(&PeerArrival) + Send + Sync>;
pub type DepartFn = Box<dyn Fn(&PeerDeparture) + Send + Sync>;

#[derive(Default)]
pub struct PresenceRegistry {
    roster: HashMap<String, PeerInfo>,
    seen_peers: Vec<String>,
    pub local_scene: String,
    pub my_peer_id: Option<String>,
    pub my_slot: i32,
}

impl std::fmt::Debug for PresenceRegistry {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("PresenceRegistry")
            .field("roster", &self.roster)
            .field("local_scene", &self.local_scene)
            .field("my_peer_id", &self.my_peer_id)
            .field("my_slot", &self.my_slot)
            .finish()
    }
}

impl PresenceRegistry {
    pub fn new() -> Self {
        Self {
            roster: HashMap::new(),
            seen_peers: Vec::new(),
            local_scene: "tavern".into(),
            my_peer_id: None,
            my_slot: 0,
        }
    }

    pub fn my_color(&self) -> KnightColor {
        color_for_slot(self.my_slot)
    }

    pub fn set_local_scene(&mut self, scene: &str) {
        self.local_scene = scene.to_string();
    }

    pub fn setLocalScene(&mut self, scene: &str) {
        self.set_local_scene(scene);
    }

    pub fn myPeerId(&self) -> Option<&str> {
        self.my_peer_id.as_deref()
    }

    pub fn mySlot(&self) -> i32 {
        self.my_slot
    }

    pub fn myColor(&self) -> KnightColor {
        self.my_color()
    }

    pub fn peers(&self) -> Vec<PeerInfo> {
        let mut list: Vec<PeerInfo> = self.roster.values().cloned().collect();
        list.sort_by(|a, b| a.slot.cmp(&b.slot).then_with(|| a.id.cmp(&b.id)));
        list
    }

    pub fn peers_in_scene(&self, scene: &str) -> Vec<PeerInfo> {
        let mut list: Vec<PeerInfo> = self
            .roster
            .values()
            .filter(|p| p.scene == scene)
            .cloned()
            .collect();
        list.sort_by(|a, b| a.slot.cmp(&b.slot).then_with(|| a.id.cmp(&b.id)));
        list
    }

    pub fn handle_message(&mut self, msg: ServerMessage, now: f64) -> (Vec<PeerArrival>, Vec<PeerDeparture>) {
        let mut arrivals = Vec::new();
        let mut departures = Vec::new();

        match msg {
            ServerMessage::Welcome { id, slot, .. } => {
                self.my_peer_id = Some(id);
                self.my_slot = slot;
            }
            ServerMessage::RoomState { players } => {
                self.roster.clear();
                for p in players {
                    if !self.seen_peers.contains(&p.id) {
                        self.seen_peers.push(p.id.clone());
                        arrivals.push(PeerArrival {
                            id: p.id.clone(),
                            name: p.name.clone(),
                            scene: p.scene.clone(),
                        });
                    }
                    self.roster.insert(
                        p.id.clone(),
                        PeerInfo {
                            id: p.id,
                            slot: p.slot,
                            name: p.name,
                            scene: p.scene,
                            x: p.x,
                            z: p.z,
                            facing: p.facing,
                            mode: p.mode.unwrap_or_else(|| "idle".into()),
                            last_seen: now,
                        },
                    );
                }
            }
            ServerMessage::PlayerJoin { player } => {
                if !self.seen_peers.contains(&player.id) {
                    self.seen_peers.push(player.id.clone());
                    arrivals.push(PeerArrival {
                        id: player.id.clone(),
                        name: player.name.clone(),
                        scene: player.scene.clone(),
                    });
                }
                self.roster.insert(
                    player.id.clone(),
                    PeerInfo {
                        id: player.id,
                        slot: player.slot,
                        name: player.name,
                        scene: player.scene,
                        x: player.x,
                        z: player.z,
                        facing: player.facing,
                        mode: player.mode.unwrap_or_else(|| "idle".into()),
                        last_seen: now,
                    },
                );
            }
            ServerMessage::PlayerLeave { id } => {
                if let Some(peer) = self.roster.remove(&id) {
                    departures.push(PeerDeparture {
                        id: peer.id,
                        name: peer.name,
                        scene: peer.scene,
                        x: peer.x,
                        z: peer.z,
                    });
                }
            }
            ServerMessage::PlayerMove {
                id,
                x,
                z,
                facing,
                scene,
                mode,
            } => {
                if let Some(peer) = self.roster.get_mut(&id) {
                    peer.x = x;
                    peer.z = z;
                    peer.facing = facing;
                    peer.scene = scene;
                    if let Some(m) = mode {
                        peer.mode = m;
                    }
                    peer.last_seen = now;
                }
            }
            _ => {}
        }

        (arrivals, departures)
    }

    pub fn prune_stale(&mut self, now: f64, timeout_sec: f64) -> Vec<PeerDeparture> {
        let mut departed = Vec::new();
        self.roster.retain(|_id, p| {
            if now - p.last_seen > timeout_sec {
                departed.push(PeerDeparture {
                    id: p.id.clone(),
                    name: p.name.clone(),
                    scene: p.scene.clone(),
                    x: p.x,
                    z: p.z,
                });
                false
            } else {
                true
            }
        });
        departed
    }
}

pub fn startPresence(_name: &str) -> bool {
    true
}

pub fn onPeerArrive(_key: &str, _f: Option<ArriveFn>) {}

pub fn onPeerDepart(_key: &str, _f: Option<DepartFn>) {}

pub fn sendPose(_x: f64, _z: f64, _facing: NetFacing, _mode: &str) {}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::net::protocol::RemoteKnight;

    #[test]
    fn presence_roster_lifecycle() {
        let mut reg = PresenceRegistry::new();
        let (arr, dep) = reg.handle_message(
            ServerMessage::PlayerJoin {
                player: RemoteKnight {
                    id: "p1".into(),
                    slot: 2,
                    name: "Arthur".into(),
                    x: 5.0,
                    z: 6.0,
                    facing: NetFacing::S,
                    scene: "tavern".into(),
                    mode: Some("walk".into()),
                },
            },
            100.0,
        );
        assert_eq!(arr.len(), 1);
        assert_eq!(dep.len(), 0);
        assert_eq!(reg.peers_in_scene("tavern").len(), 1);
        assert_eq!(reg.peers_in_scene("dungeon:1").len(), 0);
        assert_eq!(reg.peers().len(), 1);

        let (_, dep2) = reg.handle_message(
            ServerMessage::PlayerLeave { id: "p1".into() },
            101.0,
        );
        assert_eq!(dep2.len(), 1);
        assert_eq!(dep2[0].name, "Arthur");
        assert_eq!(reg.peers().len(), 0);
    }
}
