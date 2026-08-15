//! Outward Ring Shell Walkable Tile Scanner — Spatial query for nearest open ground.
//!
//! PORTS: `maze/nearest-open-tile.ts`

/// Scans concentric ring shells outward from (ci, cj) and returns the `n`-th walkable tile.
///
/// `n` is an ordinal index (1-based), not a distance.
pub fn nearest_open_tile<F: Fn(i32, i32) -> bool>(
    ci: i32,
    cj: i32,
    n: usize,
    min_ring: usize,
    is_walkable: F,
) -> Option<(i32, i32)> {
    if n == 0 {
        return None;
    }
    let mut found = Vec::new();
    let r_start = (min_ring.max(1)) as i32;
    let r_end = 6.max(min_ring as i32 + 5);

    for r in r_start..=r_end {
        if found.len() >= n {
            break;
        }
        for dj in -r..=r {
            for di in -r..=r {
                if di.abs().max(dj.abs()) != r {
                    continue; // ring shell perimeter only
                }
                let i = ci + di;
                let j = cj + dj;
                if is_walkable(i, j) {
                    found.push((i, j));
                }
                if found.len() >= n {
                    break;
                }
            }
            if found.len() >= n {
                break;
            }
        }
    }

    if n <= found.len() {
        Some(found[n - 1])
    } else {
        found.last().copied()
    }
}
