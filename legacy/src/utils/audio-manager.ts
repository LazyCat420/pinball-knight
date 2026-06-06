// Global Audio Manager for WebAudio procedurally generated SFX
// Reduces repetition across minigames and prevents exceeding AudioContext limits.

let _audioCtx: any = null;
let _cachedCrackBuf: any = null;
let _cachedHissBuf: any = null;
let _cachedLandBuf: any = null;

function getCrackBuffer(ctx: any): any {
  if (_cachedCrackBuf) return _cachedCrackBuf;
  const crackBufLen = ctx.sampleRate * 0.03;
  _cachedCrackBuf = ctx.createBuffer(1, crackBufLen, ctx.sampleRate);
  const crackData = _cachedCrackBuf.getChannelData(0);
  for (let i = 0; i < crackBufLen; i++) {
    crackData[i] = (Math.random() * 2 - 1) * 0.5 * (1 - i / crackBufLen);
  }
  return _cachedCrackBuf;
}

function getHissBuffer(ctx: any): any {
  if (_cachedHissBuf) return _cachedHissBuf;
  const hissBufLen = ctx.sampleRate * 0.35;
  _cachedHissBuf = ctx.createBuffer(1, hissBufLen, ctx.sampleRate);
  const hissData = _cachedHissBuf.getChannelData(0);
  for (let i = 0; i < hissBufLen; i++) {
    hissData[i] = (Math.random() * 2 - 1) * 0.18;
  }
  return _cachedHissBuf;
}

function getLandBuffer(ctx: any): any {
  if (_cachedLandBuf) return _cachedLandBuf;
  const bufLen = ctx.sampleRate * 0.05;
  _cachedLandBuf = ctx.createBuffer(1, bufLen, ctx.sampleRate);
  const data = _cachedLandBuf.getChannelData(0);
  for (let i = 0; i < bufLen; i++) {
    data[i] = (Math.random() * 2 - 1) * 0.06;
  }
  return _cachedLandBuf;
}

export function getAudioCtx(): any {
  if (typeof window === "undefined") return null;
  if (!_audioCtx) {
    _audioCtx = new ((window as any).AudioContext || (window as any).webkitAudioContext)();
  }
  if (_audioCtx.state === "suspended") {
    _audioCtx.resume().catch(() => {});
  }
  return _audioCtx;
}

// Auto-unlock AudioContext on first user interaction
if (typeof window !== "undefined") {
  const unlock = () => {
    try {
      const ctx = getAudioCtx();
      if (ctx) {
        ctx.resume().then(() => {
          if (ctx.state === "running") {
            window.removeEventListener("click", unlock);
            window.removeEventListener("keydown", unlock);
            window.removeEventListener("touchstart", unlock);
          }
        }).catch(() => {});
      }
    } catch (e) {
      // Ignore
    }
  };
  window.addEventListener("click", unlock);
  window.addEventListener("keydown", unlock);
  window.addEventListener("touchstart", unlock);
}

export function playOscillator({
  type = "sine",
  freqStart = 440,
  freqEnd = null,
  duration = 0.1,
  volStart = 0.1,
  volEnd = 0.001,
}) {
  try {
    const ctx = getAudioCtx();
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = type;
    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.frequency.setValueAtTime(freqStart, now);
    if (freqEnd !== null) {
      if (typeof freqEnd === "object" && freqEnd.linear) {
        osc.frequency.linearRampToValueAtTime(freqEnd.value, now + duration);
      } else {
        osc.frequency.exponentialRampToValueAtTime(freqEnd, now + duration);
      }
    }

    gain.gain.setValueAtTime(volStart, now);
    gain.gain.exponentialRampToValueAtTime(volEnd || 0.001, now + duration);

    osc.start(now);
    osc.stop(now + duration);
    return { osc, gain };
  } catch (err) {
    return null;
  }
}

export function playNoiseBurst({ duration = 0.1, vol = 0.1 }) {
  try {
    const ctx = getAudioCtx();
    const now = ctx.currentTime;
    const bufLen = ctx.sampleRate * duration;
    const buf = ctx.createBuffer(1, bufLen, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < bufLen; i++) data[i] = (Math.random() * 2 - 1) * vol;

    const noise = ctx.createBufferSource();
    noise.buffer = buf;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(vol, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + duration);

    noise.connect(gain).connect(ctx.destination);
    noise.start(now);
    noise.stop(now + duration);
    return { noise, gain };
  } catch (err) {
    return null;
  }
}

export function playSfx(type) {
  try {
    const ctx = getAudioCtx();
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);

    switch (type) {
      // General UI
      case "select":
        osc.type = "sine";
        osc.frequency.setValueAtTime(1200, now);
        osc.frequency.exponentialRampToValueAtTime(800, now + 0.08);
        gain.gain.setValueAtTime(0.15, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.12);
        osc.start(now);
        osc.stop(now + 0.12);
        break;

      case "turnChange":
        osc.type = "triangle";
        osc.frequency.setValueAtTime(500, now);
        osc.frequency.setValueAtTime(700, now + 0.08);
        gain.gain.setValueAtTime(0.08, now);
        gain.gain.linearRampToValueAtTime(0.08, now + 0.14);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.25);
        osc.start(now);
        osc.stop(now + 0.25);
        break;

      case "move":
      case "hop":
        osc.type = "sine";
        osc.frequency.setValueAtTime(600, now);
        osc.frequency.exponentialRampToValueAtTime(350, now + 0.15);
        gain.gain.setValueAtTime(0.12, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.18);
        osc.start(now);
        osc.stop(now + 0.18);
        break;

      case "land":
        // Low thud
        osc.type = "sine";
        osc.frequency.setValueAtTime(200, now);
        osc.frequency.exponentialRampToValueAtTime(80, now + 0.1);
        gain.gain.setValueAtTime(0.2, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.12);
        osc.start(now);
        osc.stop(now + 0.12);
        // Noise burst using cached buffer
        const noise = ctx.createBufferSource();
        noise.buffer = getLandBuffer(ctx);
        const ng = ctx.createGain();
        ng.gain.setValueAtTime(0.08, now);
        ng.gain.exponentialRampToValueAtTime(0.001, now + 0.06);
        noise.connect(ng).connect(ctx.destination);
        noise.start(now);
        noise.stop(now + 0.06);
        break;

      case "capture":
        osc.type = "sawtooth";
        osc.frequency.setValueAtTime(400, now);
        osc.frequency.exponentialRampToValueAtTime(100, now + 0.1);
        gain.gain.setValueAtTime(0.15, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.15);
        osc.start(now);
        osc.stop(now + 0.15);
        break;

      case "castle":
        osc.type = "square";
        osc.frequency.setValueAtTime(300, now);
        osc.frequency.setValueAtTime(400, now + 0.1);
        gain.gain.setValueAtTime(0.1, now);
        gain.gain.linearRampToValueAtTime(0.1, now + 0.2);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.3);
        osc.start(now);
        osc.stop(now + 0.3);
        break;

      case "check":
        osc.type = "sawtooth";
        osc.frequency.setValueAtTime(800, now);
        osc.frequency.setValueAtTime(900, now + 0.1);
        gain.gain.setValueAtTime(0.2, now);
        gain.gain.linearRampToValueAtTime(0, now + 0.3);
        osc.start(now);
        osc.stop(now + 0.3);
        break;

      case "gameover":
        osc.type = "square";
        osc.frequency.setValueAtTime(400, now);
        osc.frequency.linearRampToValueAtTime(150, now + 0.4);
        gain.gain.setValueAtTime(0.15, now);
        gain.gain.linearRampToValueAtTime(0, now + 0.5);
        osc.start(now);
        osc.stop(now + 0.5);
        break;

      case "win":
      case "catch":
        osc.type = "square";
        osc.frequency.setValueAtTime(523, now);
        osc.frequency.setValueAtTime(659, now + 0.1);
        osc.frequency.setValueAtTime(784, now + 0.2);
        osc.frequency.setValueAtTime(1047, now + 0.3);
        gain.gain.setValueAtTime(0.15, now);
        gain.gain.linearRampToValueAtTime(0, now + 0.5);
        osc.start(now);
        osc.stop(now + 0.5);
        break;

      case "lose":
        osc.type = "square";
        osc.frequency.setValueAtTime(400, now);
        osc.frequency.linearRampToValueAtTime(150, now + 0.3);
        gain.gain.setValueAtTime(0.12, now);
        gain.gain.linearRampToValueAtTime(0, now + 0.35);
        osc.start(now);
        osc.stop(now + 0.35);
        break;

      // Fishing Specific
      case "cast":
        osc.type = "square";
        osc.frequency.setValueAtTime(200, now);
        osc.frequency.linearRampToValueAtTime(800, now + 0.1);
        gain.gain.setValueAtTime(0.15, now);
        gain.gain.linearRampToValueAtTime(0, now + 0.15);
        osc.start(now);
        osc.stop(now + 0.15);
        break;

      case "splash":
        osc.type = "sawtooth";
        osc.frequency.setValueAtTime(400, now);
        osc.frequency.linearRampToValueAtTime(100, now + 0.12);
        gain.gain.setValueAtTime(0.08, now);
        gain.gain.linearRampToValueAtTime(0, now + 0.15);
        osc.start(now);
        osc.stop(now + 0.15);
        break;

      case "nibble":
        osc.type = "square";
        osc.frequency.setValueAtTime(440, now);
        osc.frequency.setValueAtTime(0, now + 0.04);
        osc.frequency.setValueAtTime(440, now + 0.08);
        gain.gain.setValueAtTime(0.12, now);
        gain.gain.linearRampToValueAtTime(0, now + 0.12);
        osc.start(now);
        osc.stop(now + 0.12);
        break;

      case "bite":
        osc.type = "square";
        osc.frequency.setValueAtTime(880, now);
        gain.gain.setValueAtTime(0.2, now);
        gain.gain.linearRampToValueAtTime(0.15, now + 0.05);
        gain.gain.linearRampToValueAtTime(0.2, now + 0.1);
        gain.gain.linearRampToValueAtTime(0, now + 0.3);
        osc.start(now);
        osc.stop(now + 0.3);
        break;

      case "hook":
        osc.type = "square";
        osc.frequency.setValueAtTime(523, now);
        osc.frequency.setValueAtTime(659, now + 0.08);
        osc.frequency.setValueAtTime(784, now + 0.16);
        gain.gain.setValueAtTime(0.15, now);
        gain.gain.linearRampToValueAtTime(0, now + 0.25);
        osc.start(now);
        osc.stop(now + 0.25);
        break;

      case "reel":
        osc.type = "triangle";
        osc.frequency.setValueAtTime(300 + Math.random() * 200, now);
        gain.gain.setValueAtTime(0.06, now);
        gain.gain.linearRampToValueAtTime(0, now + 0.06);
        osc.start(now);
        osc.stop(now + 0.06);
        break;

      case "shatter":
        // Disconnect default oscillator & gain to avoid leaks and extra sound
        osc.disconnect();
        gain.disconnect();

        // 1. Transient Impact Crack (Sharp Initial Bite) using cached buffer
        const crackSource = ctx.createBufferSource();
        crackSource.buffer = getCrackBuffer(ctx);
        const crackGain = ctx.createGain();
        crackGain.gain.setValueAtTime(0.6, now);
        crackGain.gain.exponentialRampToValueAtTime(0.001, now + 0.03);
        crackSource.connect(crackGain);
        crackGain.connect(ctx.destination);
        crackSource.start(now);
        crackSource.stop(now + 0.03);

        // 2. Main Glass Resonance (Metallic/Glassy Ringing)
        // High frequencies corresponding to natural resonant modes of a glass pane
        const resonances = [1600, 2200, 3700, 4800, 6200];
        resonances.forEach((freq) => {
          const resOsc = ctx.createOscillator();
          const resGain = ctx.createGain();
          
          resOsc.type = "sine";
          resOsc.frequency.setValueAtTime(freq, now);
          // Add a rapid downward pitch slide to simulate physical tension release
          resOsc.frequency.exponentialRampToValueAtTime(freq * 0.85, now + 0.2);
          
          const duration = 0.15 + Math.random() * 0.15;
          const vol = 0.12 / resonances.length;
          
          resGain.gain.setValueAtTime(vol, now);
          resGain.gain.exponentialRampToValueAtTime(0.001, now + duration);
          
          resOsc.connect(resGain);
          resGain.connect(ctx.destination);
          resOsc.start(now);
          resOsc.stop(now + duration);
        });

        // 3. Shard Tinkles (Scattered debris falling/tumble over time)
        const tinkleCount = 8;
        for (let i = 0; i < tinkleCount; i++) {
          const delay = 0.04 + Math.random() * 0.5;
          const tinkleTime = now + delay;
          
          const tinkleOsc = ctx.createOscillator();
          const tinkleGain = ctx.createGain();
          
          tinkleOsc.type = "sine";
          // High-pitched glassy tinkles
          const startFreq = 4000 + Math.random() * 4500;
          tinkleOsc.frequency.setValueAtTime(startFreq, tinkleTime);
          tinkleOsc.frequency.exponentialRampToValueAtTime(startFreq * 0.9, tinkleTime + 0.08);
          
          const tinkleDur = 0.04 + Math.random() * 0.06;
          const tinkleVol = 0.06 * (1 - delay / 0.6); // get quieter over time
          
          tinkleGain.gain.setValueAtTime(0, now); // silent until trigger
          tinkleGain.gain.setValueAtTime(tinkleVol, tinkleTime);
          tinkleGain.gain.exponentialRampToValueAtTime(0.001, tinkleTime + tinkleDur);
          
          tinkleOsc.connect(tinkleGain);
          tinkleGain.connect(ctx.destination);
          tinkleOsc.start(tinkleTime);
          tinkleOsc.stop(tinkleTime + tinkleDur);
        }

        // 4. Residual Noise Hiss (Friction/Breaking sound) using cached buffer
        const hissSource = ctx.createBufferSource();
        hissSource.buffer = getHissBuffer(ctx);
        
        const hissFilter = ctx.createBiquadFilter();
        hissFilter.type = "bandpass";
        hissFilter.frequency.value = 5000;
        hissFilter.Q.value = 2.0; // resonant hiss
        
        const hissGain = ctx.createGain();
        hissGain.gain.setValueAtTime(0.2, now);
        hissGain.gain.exponentialRampToValueAtTime(0.001, now + 0.3);
        
        hissSource.connect(hissFilter);
        hissFilter.connect(hissGain);
        hissGain.connect(ctx.destination);
        hissSource.start(now);
        hissSource.stop(now + 0.35);
        break;

      default:
        // Generic blip
        osc.type = "sine";
        osc.frequency.setValueAtTime(440, now);
        gain.gain.setValueAtTime(0.1, now);
        gain.gain.exponentialRampToValueAtTime(0.01, now + 0.1);
        osc.start(now);
        osc.stop(now + 0.1);
        break;
    }
  } catch (err) {
    // Audio unavailable or failed to initialize
  }
}
