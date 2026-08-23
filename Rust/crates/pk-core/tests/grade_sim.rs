// Parity test suite for End-of-Floor Performance Grading Rubric.
// Replicates legacy/src/game/pinball-knight/run/grade.ts

use pk_core::run::grade::{compute_floor_flow, grade_floor};

#[test]
fn compute_floor_flow_handles_zero_duration() {
    assert_eq!(compute_floor_flow(100.0, 0.0), 0.0);
    assert_eq!(compute_floor_flow(100.0, -1.0), 0.0);
    assert_eq!(compute_floor_flow(50.0, 10.0), 5.0);
}

#[test]
fn grade_floor_evaluates_all_letter_grades() {
    // S Rank: 6 points (flow >= 6.5, kill share >= 0.9, combo >= 12) -> 100g
    let s = grade_floor(10, 10, 7.0, 15);
    assert_eq!(s.grade, "S");
    assert_eq!(s.points, 6);
    assert_eq!(s.gold, 100);

    // A Rank: 5 points (flow >= 6.5, kill share >= 0.9, combo >= 6) -> 60g
    let a = grade_floor(10, 10, 7.0, 8);
    assert_eq!(a.grade, "A");
    assert_eq!(a.points, 5);
    assert_eq!(a.gold, 60);

    // B Rank: 3 points (flow >= 4.0, kill share >= 0.6, combo >= 6) -> 35g
    let b = grade_floor(7, 10, 4.5, 7);
    assert_eq!(b.grade, "B");
    assert_eq!(b.points, 3);
    assert_eq!(b.gold, 35);

    // C Rank: 2 points (flow >= 4.0, kill share >= 0.6, combo < 6) -> 15g
    let c = grade_floor(6, 10, 4.0, 2);
    assert_eq!(c.grade, "C");
    assert_eq!(c.points, 2);
    assert_eq!(c.gold, 15);

    // D Rank: 0 points (poor flow, low kills, low combo) -> 0g
    let d = grade_floor(1, 10, 1.0, 0);
    assert_eq!(d.grade, "D");
    assert_eq!(d.points, 0);
    assert_eq!(d.gold, 0);
}
