// Global Audio Manager for WebAudio procedurally generated SFX
// Reduces repetition across minigames and prevents exceeding AudioContext limits.

let _audioCtx = null;

export function getAudioCtx() {
  if (!_audioCtx) {
    _audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  if (_audioCtx.state === "suspended") {
    _audioCtx.resume();
  }
  return _audioCtx;
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
        // Noise burst
        const bufLen = ctx.sampleRate * 0.05;
        const buf = ctx.createBuffer(1, bufLen, ctx.sampleRate);
        const data = buf.getChannelData(0);
        for (let i = 0; i < bufLen; i++) data[i] = (Math.random() * 2 - 1) * 0.06;
        const noise = ctx.createBufferSource();
        noise.buffer = buf;
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
        // High-pitched noise burst with sharp decay for shattering glass
        const shatterBufLen = ctx.sampleRate * 0.3;
        const shatterBuf = ctx.createBuffer(1, shatterBufLen, ctx.sampleRate);
        const shatterData = shatterBuf.getChannelData(0);
        for (let i = 0; i < shatterBufLen; i++) shatterData[i] = (Math.random() * 2 - 1) * 0.2;
        const shatterNoise = ctx.createBufferSource();
        shatterNoise.buffer = shatterBuf;
        
        // Highpass filter to make it sound "glassy" and sharp
        const filter = ctx.createBiquadFilter();
        filter.type = "highpass";
        filter.frequency.value = 6000;
        
        const shatterGain = ctx.createGain();
        shatterGain.gain.setValueAtTime(0.4, now);
        shatterGain.gain.exponentialRampToValueAtTime(0.001, now + 0.25);
        
        shatterNoise.connect(filter).connect(shatterGain).connect(ctx.destination);
        shatterNoise.start(now);
        shatterNoise.stop(now + 0.3);
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
