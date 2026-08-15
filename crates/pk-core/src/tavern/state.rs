//! Tavern-scene state — the pure parts of `legacy/src/scenes/tavern/state.ts`.
//!
//! Everything PERSISTENT (gold, weapons, gear, cards) stays with the run;
//! this module owns only what the diorama needs to report a run.
//!
//! PORTS: `legacy/src/scenes/tavern/state.ts`

/// Run stats handed in by the dungeon when it opens the tavern.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TavernStats {
    pub grade: String,
    pub floor: i32,
    pub kills: i32,
    pub best_combo: i32,
}

impl Default for TavernStats {
    fn default() -> Self {
        Self {
            grade: "-".into(),
            floor: 0,
            kills: 0,
            best_combo: 0,
        }
    }
}

/// How the central diorama should read for a given run.
/// The pinball table is the room's thesis — a machine that reports the floor
/// you just cleared, never a free-running decoration.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct DioramaState {
    /// How many bumper caps are lit — completed targets.
    pub lit: usize,
    /// Ball orbit rate, rad/s. 0 parks it: a weak floor leaves the machine still.
    pub ball_speed: f64,
}

/// Letter grades, best first. Anything unrecognised (including "-") ranks 0.
pub fn grade_rank(grade: &str) -> i32 {
    match grade.to_uppercase().as_str() {
        "S" => 5,
        "A" => 4,
        "B" => 3,
        "C" => 2,
        "D" => 1,
        _ => 0, // "F" and everything unrecognised
    }
}

/// Targets are ordered easiest-first, so the caps light left-to-right as a run
/// gets better and a glance at the table tells you roughly how it went.
pub fn read_diorama(stats: &TavernStats, bumper_count: usize) -> DioramaState {
    let rank = grade_rank(&stats.grade);
    let targets = [
        stats.floor >= 1,
        stats.kills >= 10,
        stats.best_combo >= 5,
        stats.kills >= 40,
        rank >= 4,
    ];
    let lit = targets.iter().filter(|t| **t).count().min(bumper_count);
    // B or better sends the ball round, and it goes faster the better you did.
    let ball_speed = if rank >= 3 {
        0.3 + f64::from(rank - 3) * 0.32
    } else {
        0.0
    };
    DioramaState { lit, ball_speed }
}

#[cfg(test)]
mod tests {
    //! Ported from `legacy/src/scenes/tavern/state.test.ts`, case for case.
    use super::*;

    const CAPS: usize = 5;

    fn run(grade: &str, floor: i32, kills: i32, best_combo: i32) -> TavernStats {
        TavernStats {
            grade: grade.into(),
            floor,
            kills,
            best_combo,
        }
    }

    #[test]
    fn shows_a_dead_machine_before_any_run() {
        let d = read_diorama(&TavernStats::default(), CAPS);
        assert_eq!(d.lit, 0);
        assert_eq!(d.ball_speed, 0.0);
    }

    #[test]
    fn lights_one_cap_for_simply_clearing_a_floor() {
        assert_eq!(read_diorama(&run("-", 1, 0, 0), CAPS).lit, 1);
    }

    #[test]
    fn lights_more_caps_the_better_the_run_went() {
        let weak = read_diorama(&run("D", 1, 4, 2), CAPS).lit;
        let mid = read_diorama(&run("C", 3, 15, 6), CAPS).lit;
        let great = read_diorama(&run("S", 7, 60, 12), CAPS).lit;
        assert!(weak < mid);
        assert!(mid < great);
        assert_eq!(great, CAPS);
    }

    #[test]
    fn never_lights_more_caps_than_the_table_has() {
        let d = read_diorama(&run("S", 99, 9999, 99), 3);
        assert_eq!(d.lit, 3);
    }

    #[test]
    fn parks_the_ball_on_a_weak_floor_and_rolls_it_on_a_strong_one() {
        assert_eq!(read_diorama(&run("D", 1, 0, 0), CAPS).ball_speed, 0.0);
        assert_eq!(read_diorama(&run("C", 1, 0, 0), CAPS).ball_speed, 0.0);
        assert!(read_diorama(&run("B", 1, 0, 0), CAPS).ball_speed > 0.0);
    }

    #[test]
    fn rolls_the_ball_faster_the_better_the_grade() {
        let b = read_diorama(&run("B", 0, 0, 0), CAPS).ball_speed;
        let a = read_diorama(&run("A", 0, 0, 0), CAPS).ball_speed;
        let s = read_diorama(&run("S", 0, 0, 0), CAPS).ball_speed;
        assert!(a > b);
        assert!(s > a);
    }

    #[test]
    fn treats_an_unknown_or_absent_grade_as_the_worst_not_as_a_crash() {
        assert_eq!(grade_rank("-"), 0);
        assert_eq!(grade_rank(""), 0);
        assert_eq!(grade_rank("???"), 0);
        assert_eq!(read_diorama(&run("???", 0, 0, 0), CAPS).ball_speed, 0.0);
    }

    #[test]
    fn reads_a_lowercase_grade_the_same_as_an_uppercase_one() {
        assert_eq!(grade_rank("s"), grade_rank("S"));
    }
}
