//! 🪧 THE JOIN BOARD — "who's down there", and a way to go with them.
//! Pure grouping logic of `legacy/src/scenes/tavern/join-board.ts` (+ the
//! `floorOfScene` parser it re-exports from `net/rally.ts`). The realtime
//! presence layer itself is P8 scope; this is the data shape the board reads.
//!
//! PORTS: `legacy/src/scenes/tavern/join-board.ts`

/// A pool-mate as presence reports them — only the fields the board reads.
#[derive(Debug, Clone)]
pub struct PeerInfo {
    pub name: String,
    /// Scene tag: `"tavern"` or `"dungeon:<n>"`.
    pub scene: String,
}

/// Parse the `dungeon:<n>` scene tag. Returns 0 for the tavern or a bad tag.
pub fn floor_of_scene(scene: &str) -> i32 {
    let Some(rest) = scene.strip_prefix("dungeon:") else {
        return 0;
    };
    // JS parseInt semantics: leading digits parse, garbage after is fine —
    // but every legacy tag is a bare integer, so a plain parse of the leading
    // digit run mirrors it.
    let digits: String = rest.chars().take_while(|c| c.is_ascii_digit()).collect();
    match digits.parse::<i32>() {
        Ok(n) if n > 0 => n,
        _ => 0,
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FloorGroup {
    pub floor: i32,
    /// Display names of the knights on that floor, join order.
    pub names: Vec<String>,
    /// True when the viewer has already reached this depth — no warning shown.
    pub safe: bool,
}

/// Group the pool by floor, shallowest first. `best_depth` decides the SAFE
/// flag only — it never filters: a player is always allowed to follow friends
/// past their own record.
pub fn group_by_floor(peers: &[PeerInfo], best_depth: i32) -> Vec<FloorGroup> {
    // Insertion-ordered per floor (legacy Map preserves insertion), then
    // sorted by floor for the final list.
    let mut floors: Vec<(i32, Vec<String>)> = Vec::new();
    for p in peers {
        let f = floor_of_scene(&p.scene);
        if f == 0 {
            continue; // still in the tavern — not somewhere you can join
        }
        if let Some(entry) = floors.iter_mut().find(|(floor, _)| *floor == f) {
            entry.1.push(p.name.clone());
        } else {
            floors.push((f, vec![p.name.clone()]));
        }
    }
    let mut out: Vec<FloorGroup> = floors
        .into_iter()
        .map(|(floor, names)| FloorGroup {
            floor,
            names,
            safe: floor <= best_depth,
        })
        .collect();
    out.sort_by_key(|g| g.floor);
    out
}

/// One-line summary for a floor row: "Cobalt & Sage" / "Cobalt +3".
pub fn describe_party(names: &[String]) -> String {
    match names {
        [] => String::new(),
        [one] => one.clone(),
        [a, b] => format!("{a} & {b}"),
        [first, rest @ ..] => format!("{first} +{}", rest.len()),
    }
}

#[cfg(test)]
mod tests {
    //! Ported from `legacy/src/scenes/tavern/join-board.test.ts`.
    use super::*;

    fn peer(name: &str, scene: &str) -> PeerInfo {
        PeerInfo {
            name: name.into(),
            scene: scene.into(),
        }
    }

    #[test]
    fn reads_the_dungeon_floor_out_of_a_scene_tag() {
        assert_eq!(floor_of_scene("dungeon:7"), 7);
        assert_eq!(floor_of_scene("dungeon:12"), 12);
    }

    #[test]
    fn treats_the_tavern_and_junk_tags_as_nowhere_to_join() {
        assert_eq!(floor_of_scene("tavern"), 0);
        assert_eq!(floor_of_scene("dungeon:abc"), 0);
        assert_eq!(floor_of_scene("dungeon:0"), 0);
        assert_eq!(floor_of_scene(""), 0);
    }

    #[test]
    fn groups_the_pool_by_depth_shallowest_first() {
        let groups = group_by_floor(
            &[
                peer("Cobalt", "dungeon:4"),
                peer("Iron", "dungeon:15"),
                peer("Sage", "dungeon:4"),
            ],
            10,
        );
        assert_eq!(
            groups.iter().map(|g| g.floor).collect::<Vec<_>>(),
            vec![4, 15]
        );
        assert_eq!(groups[0].names, vec!["Cobalt", "Sage"]);
        assert_eq!(groups[1].names, vec!["Iron"]);
    }

    #[test]
    fn excludes_knights_standing_in_the_tavern_there_is_nothing_to_join() {
        let groups = group_by_floor(&[peer("Crimson", "tavern"), peer("Cobalt", "dungeon:3")], 5);
        assert_eq!(groups.len(), 1);
        assert_eq!(groups[0].floor, 3);
    }

    #[test]
    fn flags_depths_past_your_record_without_filtering_them_out() {
        let groups = group_by_floor(
            &[peer("Cobalt", "dungeon:4"), peer("Iron", "dungeon:15")],
            10,
        );
        assert!(groups[0].safe); // floor 4, best 10
        assert!(!groups[1].safe); // floor 15 — warned, still listed
                                  // The load-bearing half: a deep floor must remain JOINABLE.
        assert!(groups.iter().any(|g| g.floor == 15));
    }

    #[test]
    fn treats_your_exact_best_depth_as_safe() {
        assert!(group_by_floor(&[peer("Iron", "dungeon:10")], 10)[0].safe);
    }

    #[test]
    fn is_empty_when_the_whole_pool_is_in_the_tavern() {
        assert!(group_by_floor(&[peer("A", "tavern"), peer("B", "tavern")], 5).is_empty());
    }

    #[test]
    fn names_one_and_two_knights_outright_then_abbreviates() {
        let v = |s: &[&str]| s.iter().map(|x| x.to_string()).collect::<Vec<_>>();
        assert_eq!(describe_party(&v(&["Cobalt"])), "Cobalt");
        assert_eq!(describe_party(&v(&["Cobalt", "Sage"])), "Cobalt & Sage");
        assert_eq!(describe_party(&v(&["Cobalt", "Sage", "Iron"])), "Cobalt +2");
    }

    #[test]
    fn handles_an_empty_floor_without_inventing_a_name() {
        assert_eq!(describe_party(&[]), "");
    }
}
