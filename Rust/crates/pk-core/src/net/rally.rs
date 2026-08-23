//! 🧲 RALLY — Destination floor election for multiplayer pools.
//!
//! PORTS: `legacy/src/net/rally.ts`

use std::collections::BTreeMap;
use crate::net::presence::PeerInfo;

pub fn floor_of_scene(scene: &str) -> u32 {
    if !scene.starts_with("dungeon:") {
        return 0;
    }
    let suffix = &scene["dungeon:".len()..];
    suffix.parse::<u32>().unwrap_or(0)
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct FloorPop {
    pub floor: u32,
    pub count: usize,
    pub names: Vec<String>,
}

pub fn pool_floors(peers: &[PeerInfo], my_floor: u32) -> Vec<FloorPop> {
    let mut by_floor: BTreeMap<u32, FloorPop> = BTreeMap::new();

    if my_floor > 0 {
        by_floor.entry(my_floor).or_insert_with(|| FloorPop {
            floor: my_floor,
            count: 0,
            names: Vec::new(),
        }).count += 1;
    }

    for p in peers {
        let f = floor_of_scene(&p.scene);
        if f == 0 {
            continue;
        }
        let entry = by_floor.entry(f).or_insert_with(|| FloorPop {
            floor: f,
            count: 0,
            names: Vec::new(),
        });
        entry.count += 1;
        entry.names.push(p.name.clone());
    }

    by_floor.into_values().collect()
}

pub fn rally_floor(peers: &[PeerInfo], my_floor: u32) -> Option<FloorPop> {
    let floors = pool_floors(peers, my_floor);
    let mut best: Option<FloorPop> = None;
    for f in floors {
        match &best {
            None => best = Some(f),
            Some(b) => {
                if f.count > b.count {
                    best = Some(f);
                }
            }
        }
    }
    best
}

pub fn resolve_descend_floor(peers: &[PeerInfo], resume_floor: u32, explicit: Option<u32>) -> u32 {
    if let Some(exp) = explicit {
        if exp > 0 {
            return exp;
        }
    }

    if let Some(rally) = rally_floor(peers, 0) {
        return rally.floor;
    }

    if resume_floor > 0 {
        return resume_floor;
    }

    1
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::net::protocol::NetFacing;

    fn mock_peer(name: &str, scene: &str) -> PeerInfo {
        PeerInfo {
            id: name.into(),
            slot: 0,
            name: name.into(),
            scene: scene.into(),
            x: 0.0,
            z: 0.0,
            facing: NetFacing::S,
            mode: "idle".into(),
            last_seen: 0.0,
        }
    }

    #[test]
    fn floor_of_scene_parsing() {
        assert_eq!(floor_of_scene("tavern"), 0);
        assert_eq!(floor_of_scene("dungeon:1"), 1);
        assert_eq!(floor_of_scene("dungeon:12"), 12);
        assert_eq!(floor_of_scene("dungeon:invalid"), 0);
    }

    #[test]
    fn rally_floor_picks_most_populous_and_shallowest_tie() {
        let peers = vec![
            mock_peer("Alice", "dungeon:3"),
            mock_peer("Bob", "dungeon:5"),
            mock_peer("Charlie", "dungeon:3"),
            mock_peer("Dave", "dungeon:5"),
        ];

        let rally = rally_floor(&peers, 0).unwrap();
        // Tie between 3 and 5 (2 knights each) -> breaks shallowest (floor 3)
        assert_eq!(rally.floor, 3);
        assert_eq!(rally.count, 2);
    }

    #[test]
    fn resolve_descend_floor_priorities() {
        let peers = vec![mock_peer("Alice", "dungeon:4")];
        assert_eq!(resolve_descend_floor(&peers, 2, Some(9)), 9); // explicit wins
        assert_eq!(resolve_descend_floor(&peers, 2, None), 4);    // rally wins over resume
        assert_eq!(resolve_descend_floor(&[], 2, None), 2);       // resume wins if pool empty
        assert_eq!(resolve_descend_floor(&[], 0, None), 1);       // default floor 1
    }
}
