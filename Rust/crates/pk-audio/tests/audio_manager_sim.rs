// Parity test suite for Global Audio Manager.
// Replicates legacy/src/utils/audio-manager.ts

use pk_audio::manager::GlobalAudioManager;

#[test]
fn audio_manager_procedural_noise_synthesis() {
    let mut mgr = GlobalAudioManager::new(44100);

    assert!(!mgr.is_silenced);
    mgr.set_silenced(true);
    assert!(mgr.is_silenced);

    let crack = mgr.generate_crack_buffer(42);
    assert_eq!(crack.len(), (44100.0 * 0.03) as usize);
    for &sample in &crack {
        assert!(sample >= -1.0 && sample <= 1.0);
    }

    let hiss = mgr.generate_hiss_buffer(42);
    assert_eq!(hiss.len(), (44100.0 * 0.35) as usize);
    for &sample in &hiss {
        assert!(sample >= -1.0 && sample <= 1.0);
    }

    let land = mgr.generate_land_buffer(42);
    assert_eq!(land.len(), (44100.0 * 0.05) as usize);
    for &sample in &land {
        assert!(sample >= -1.0 && sample <= 1.0);
    }
}
