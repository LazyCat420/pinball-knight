// Parity test for Stiltneck Bomb Fuse and Blast Physics.
// Replicates legacy/src/game/pinball-knight/entities/stiltneck-bomb.test.ts

use pk_core::monsters::types::{EnemyKind, EnemyMode, LiveMonster};
use pk_core::monsters::stiltneck::resolve_bomb_blast;
use pk_core::enemies::{STILTNECK_BLAST_DAMAGE, STILTNECK_BLAST_ENEMY_DAMAGE, STILTNECK_BLAST_RADIUS};

#[test]
fn blast_hurts_monsters_inside_radius_and_leaves_outside() {
    let mut monsters = vec![
        LiveMonster::new(1, EnemyKind::Zombie, 0.5, 0.0),
        LiveMonster::new(2, EnemyKind::Zombie, STILTNECK_BLAST_RADIUS + 1.0, 0.0),
    ];
    let initial_hp_near = monsters[0].hp;
    let initial_hp_far = monsters[1].hp;

    resolve_bomb_blast(0.0, 0.0, 99.0, 99.0, 0.0, &mut monsters);

    assert_eq!(
        (initial_hp_near - monsters[0].hp).round() as i32,
        STILTNECK_BLAST_ENEMY_DAMAGE
    );
    assert_eq!(monsters[1].hp, initial_hp_far);
}

#[test]
fn blast_hits_horde_at_full_damage_on_the_rim() {
    let mut monsters = vec![LiveMonster::new(1, EnemyKind::Zombie, STILTNECK_BLAST_RADIUS - 0.01, 0.0)];
    let initial_hp = monsters[0].hp;

    resolve_bomb_blast(0.0, 0.0, 99.0, 99.0, 0.0, &mut monsters);

    assert_eq!(
        (initial_hp - monsters[0].hp).round() as i32,
        STILTNECK_BLAST_ENEMY_DAMAGE
    );
}

#[test]
fn blast_cannot_touch_death_dealer_reaper() {
    let mut monsters = vec![LiveMonster::new(1, EnemyKind::Reaper, 0.2, 0.0)];
    let initial_hp = monsters[0].hp;

    resolve_bomb_blast(0.0, 0.0, 99.0, 99.0, 0.0, &mut monsters);

    assert_eq!(monsters[0].hp, initial_hp, "Reaper must be immune to bomb blasts");
}

#[test]
fn blast_skips_already_dead_corpses() {
    let mut corpse = LiveMonster::new(1, EnemyKind::Zombie, 0.2, 0.0);
    corpse.mode = EnemyMode::Dead;
    let mut monsters = vec![corpse];

    let res = resolve_bomb_blast(0.0, 0.0, 99.0, 99.0, 0.0, &mut monsters);

    assert!(res.monsters_hit.is_empty());
}

#[test]
fn blast_falls_off_with_distance_for_the_player() {
    let mut monsters = Vec::new();

    // Dead center
    let res_center = resolve_bomb_blast(0.0, 0.0, 0.0, 0.0, 0.0, &mut monsters);
    assert_eq!(res_center.player_damage, STILTNECK_BLAST_DAMAGE);

    // Near the rim
    let res_rim = resolve_bomb_blast(0.0, 0.0, STILTNECK_BLAST_RADIUS - 0.02, 0.0, 0.0, &mut monsters);
    assert!(res_rim.player_damage > 0);
    assert!(res_rim.player_damage < res_center.player_damage);

    // Outside the radius
    let res_miss = resolve_bomb_blast(0.0, 0.0, STILTNECK_BLAST_RADIUS + 0.05, 0.0, 0.0, &mut monsters);
    assert_eq!(res_miss.player_damage, 0);
}

#[test]
fn blast_still_levels_horde_when_player_is_in_iframes() {
    let mut monsters = vec![LiveMonster::new(1, EnemyKind::Zombie, 0.3, 0.0)];
    let initial_hp = monsters[0].hp;

    // Player with active i-frames (iframes = 1.0)
    let res = resolve_bomb_blast(0.0, 0.0, 0.0, 0.0, 1.0, &mut monsters);

    assert_eq!(res.player_damage, 0, "Player in iframes takes no damage");
    assert_eq!(
        (initial_hp - monsters[0].hp).round() as i32,
        STILTNECK_BLAST_ENEMY_DAMAGE,
        "Horde must take full blast damage regardless of player iframes"
    );
}

#[test]
fn blast_shakes_the_screen() {
    let mut monsters = Vec::new();
    let res = resolve_bomb_blast(0.0, 0.0, 0.0, 0.0, 0.0, &mut monsters);
    assert!(res.screen_shake > 0.0);
}
