// SoundSystem.js — Procedural 8-bit audio for Adventure Mode.
// All sounds synthesized at runtime via Web Audio API. No external files.
//
// Timbres mirror the NES sound chip (2A03):
//   Pulse 1 (melody)  — 25% duty square wave
//   Pulse 2 (harmony) — 50% duty square wave
//   Triangle (bass)   — triangle wave
//   Noise (drums/sfx) — white noise + filters

// ── Note table (Hz) ──────────────────────────────────────────────────────────
const HZ = {
  A2:110.00, B2:123.47,
  C3:130.81, D3:146.83, E3:164.81, F3:174.61, G3:196.00,
  A3:220.00, B3:246.94,
  C4:261.63, D4:293.66, E4:329.63, F4:349.23, G4:392.00,
  A4:440.00, B4:493.88,
  C5:523.25, D5:587.33, E5:659.25, F5:698.46, G5:783.99,
  A5:880.00, B5:987.77,
  C6:1046.50, D6:1174.66, E6:1318.51,
};
const _ = null; // rest

// ── Timing (120 BPM) ─────────────────────────────────────────────────────────
const Q = 0.50; // quarter note
const E = 0.25; // 8th note
const H = 1.00; // half note

// ── "Broken Village" BGM — A natural minor, 8-bar loop (16 s) ───────────────
// Pulse 1: melody (25% duty square)
const MELODY = [
  // ── A section (bars 1–4) ──────────────────────────────────────────────────
  [HZ.A5,E],[HZ.G5,E],[HZ.E5,E],[_,E],[HZ.G5,E],[HZ.E5,E],[HZ.D5,E],[_,E],
  [HZ.E5,E],[HZ.D5,E],[HZ.C5,E],[HZ.A4,E],[_,H],
  [HZ.G5,E],[HZ.A5,E],[HZ.G5,E],[HZ.E5,E],[HZ.G5,E],[HZ.E5,E],[HZ.D5,E],[HZ.C5,E],
  [HZ.D5,E],[_,E],[HZ.E5,E],[_,E],[HZ.A4,Q],[_,Q],
  // ── B section (bars 5–8) ──────────────────────────────────────────────────
  [HZ.C5,E],[HZ.D5,E],[HZ.E5,E],[HZ.G5,E],[HZ.A5,E],[_,E],[HZ.G5,E],[_,E],
  [HZ.G5,E],[HZ.E5,E],[HZ.D5,E],[HZ.C5,E],[HZ.B4,E],[_,E],[HZ.A4,E],[_,E],
  [HZ.C5,E],[HZ.B4,E],[HZ.A4,E],[HZ.G4,E],[HZ.A4,Q],[_,Q],
  [HZ.A4,Q],[_,Q],[_,H],
];

// Triangle: bass line
const BASS = [
  [HZ.A3,Q],[_,Q],[HZ.E3,Q],[_,Q],
  [HZ.A3,Q],[_,Q],[HZ.A3,Q],[_,Q],
  [HZ.C4,Q],[_,Q],[HZ.G3,Q],[_,Q],
  [HZ.A3,Q],[_,Q],[HZ.E3,Q],[_,Q],
  [HZ.C4,Q],[_,Q],[HZ.G3,Q],[_,Q],
  [HZ.G3,Q],[_,Q],[HZ.G3,Q],[_,Q],
  [HZ.A2,Q],[_,Q],[HZ.E3,Q],[_,Q],
  [HZ.A2,H],[_,H],
];

// Pulse 2: harmony (50% duty square, lower volume)
const HARMONY = [
  [HZ.C5,H],[HZ.E4,H],
  [HZ.A4,H],[_,H],
  [HZ.C5,H],[HZ.G4,H],
  [HZ.A4,H],[_,H],
  [HZ.C5,H],[HZ.E5,H],
  [HZ.G4,H],[HZ.B4,H],
  [HZ.C5,H],[HZ.A4,H],
  [HZ.A4,H],[_,H],
];

const LOOP_DUR = MELODY.reduce((s, [, d]) => s + d, 0); // 16.0 s

// ── SoundSystem ──────────────────────────────────────────────────────────────
export class SoundSystem {
  constructor(scene) {
    this._ctx  = scene.sound.context;
    this._dead = false;

    // Master gain → destination
    this._master = this._ctx.createGain();
    this._master.gain.value = 0.28;
    this._master.connect(this._ctx.destination);

    // Pre-baked NES pulse duty-cycle waves
    this._w25 = this._makeWave(0.25);  // NES pulse-channel "thin" sound
    this._w12 = this._makeWave(0.125); // even thinner, for portal chimes

    // Pre-cached noise buffers (reused for every drum hit)
    this._noiseBufs = {
      kick:  this._makeNoiseBuf(0.14),
      snare: this._makeNoiseBuf(0.09),
      hat:   this._makeNoiseBuf(0.035),
      sfx:   this._makeNoiseBuf(0.35),
    };

    this._nextLoop  = null;
    this._loopTimer = null;
  }

  // ── Utility builders ────────────────────────────────────────────────────────

  // Fourier-series PeriodicWave for a pulse wave with given duty cycle.
  _makeWave(duty) {
    const N = 64;
    const real = new Float32Array(N);
    const imag = new Float32Array(N);
    for (let k = 1; k < N; k++) {
      imag[k] = (2 / (k * Math.PI)) * Math.sin(k * Math.PI * duty);
    }
    return this._ctx.createPeriodicWave(real, imag);
  }

  // Pre-fill a noise buffer (shared across all playback nodes for that sound).
  _makeNoiseBuf(dur) {
    const sr  = this._ctx.sampleRate;
    const len = Math.ceil(sr * dur);
    const buf = this._ctx.createBuffer(1, len, sr);
    const d   = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  // Schedule a single oscillator tone with attack+release to avoid clicks.
  _tone(hz, t, dur, vol = 0.25, type = 'square', wave = null) {
    if (!hz || dur <= 0) return;
    const ctx = this._ctx;
    const osc = ctx.createOscillator();
    const g   = ctx.createGain();

    if (wave) osc.setPeriodicWave(wave);
    else      osc.type = type;
    osc.frequency.value = hz;

    const attack  = Math.min(0.005, dur * 0.05);
    const release = Math.min(0.015, dur * 0.1);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + attack);
    g.gain.setValueAtTime(vol, t + dur - release);
    g.gain.linearRampToValueAtTime(0, t + dur);

    osc.connect(g);
    g.connect(this._master);
    osc.start(t);
    osc.stop(t + dur + 0.01);
  }

  // Play a noise buffer with optional hi-pass / lo-pass filter.
  _noise(buf, t, vol, locut = 0, hicut = 0) {
    const ctx = this._ctx;
    const src = ctx.createBufferSource();
    src.buffer = buf;

    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + buf.duration);

    let chain = src;
    if (locut > 0) {
      const hp = ctx.createBiquadFilter();
      hp.type = 'highpass'; hp.frequency.value = locut;
      chain.connect(hp); chain = hp;
    }
    if (hicut > 0) {
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass'; lp.frequency.value = hicut;
      chain.connect(lp); chain = lp;
    }
    chain.connect(g);
    g.connect(this._master);
    src.start(t);
    // BufferSource stops automatically at end of buffer
  }

  // ── Sound effects ────────────────────────────────────────────────────────────

  playAttack() {
    const t = this._ctx.currentTime;
    // Broom whoosh: square sweep down + hi-freq noise burst
    const osc = this._ctx.createOscillator();
    const g   = this._ctx.createGain();
    osc.type = 'square';
    osc.frequency.setValueAtTime(520, t);
    osc.frequency.exponentialRampToValueAtTime(130, t + 0.09);
    g.gain.setValueAtTime(0.22, t);
    g.gain.linearRampToValueAtTime(0, t + 0.10);
    osc.connect(g); g.connect(this._master);
    osc.start(t); osc.stop(t + 0.11);
    this._noise(this._noiseBufs.sfx, t, 0.07, 2000);
  }

  playHit() {
    const t = this._ctx.currentTime;
    // Punchy smack: band-passed noise + low thud
    this._noise(this._noiseBufs.sfx, t, 0.22, 300, 5000);
    this._tone(160, t, 0.06, 0.16, 'square');
  }

  playEnemyDefeat() {
    const t = this._ctx.currentTime;
    // Descending arpeggio — classic NES enemy-defeated sound
    [[659, 0.00], [523, 0.07], [392, 0.14], [261, 0.21]].forEach(([f, dt]) => {
      this._tone(f, t + dt, 0.11, 0.22, 'square', this._w25);
    });
    this._noise(this._noiseBufs.sfx, t, 0.10, 100, 4000);
  }

  playPortalEnter() {
    const t = this._ctx.currentTime;
    // Rising harp arpeggio — magical portal chime (very thin duty cycle)
    [[440,0.00],[523,0.07],[659,0.14],[784,0.21],[1047,0.28],[1319,0.35]].forEach(([f, dt]) => {
      this._tone(f, t + dt, 0.22, 0.14, 'square', this._w12);
    });
  }

  playPlayerHurt() {
    const t = this._ctx.currentTime;
    // Descending sawtooth buzz — jarring hurt cue
    const osc = this._ctx.createOscillator();
    const g   = this._ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(880, t);
    osc.frequency.exponentialRampToValueAtTime(110, t + 0.28);
    g.gain.setValueAtTime(0.28, t);
    g.gain.linearRampToValueAtTime(0, t + 0.30);
    osc.connect(g); g.connect(this._master);
    osc.start(t); osc.stop(t + 0.31);
    this._noise(this._noiseBufs.sfx, t, 0.15, 80, 3000);
  }

  playCoinPickup() {
    const t = this._ctx.currentTime;
    // Classic two-note bling (Mario-coin style)
    this._tone(1046, t,        0.07, 0.20, 'square', this._w25);
    this._tone(1319, t + 0.07, 0.12, 0.20, 'square', this._w25);
  }

  playLevelUp() {
    const t = this._ctx.currentTime;
    // 5-note ascending fanfare with triangle harmonics underneath
    [[523,0.0],[659,0.1],[784,0.2],[1047,0.3],[1319,0.4]].forEach(([f, dt]) => {
      this._tone(f,       t + dt,        0.18, 0.22, 'square',   this._w25);
      this._tone(f * 1.5, t + dt + 0.01, 0.16, 0.08, 'triangle');
    });
  }

  playCombo(multiplier = 2) {
    const t    = this._ctx.currentTime;
    const base = multiplier >= 3 ? 880 : 659;
    this._tone(base,          t,        0.07, 0.18, 'square', this._w25);
    this._tone(base * 1.25,   t + 0.07, 0.07, 0.18, 'square', this._w25);
    if (multiplier >= 3) {
      this._tone(base * 1.5,  t + 0.14, 0.09, 0.22, 'square', this._w25);
    }
  }

  playBossWarning() {
    const t = this._ctx.currentTime;
    // Low menacing two-note growl
    this._tone(110, t,        0.15, 0.22, 'sawtooth');
    this._tone(165, t + 0.15, 0.12, 0.18, 'sawtooth');
    this._noise(this._noiseBufs.sfx, t, 0.08, 50, 600);
  }

  playChoreComplete() {
    const t = this._ctx.currentTime;
    // NES "got item" fanfare
    const seq = [
      [HZ.G5, E * 0.9], [HZ.A5, E * 0.9], [HZ.B5, E * 0.9],
      [HZ.C6, E * 0.9], [HZ.D6, Q * 0.9],
    ];
    let off = 0;
    seq.forEach(([f, d]) => {
      this._tone(f, t + off, d, 0.22, 'square', this._w25);
      off += d + 0.01;
    });
  }

  // ── BGM sequencer ─────────────────────────────────────────────────────────────
  // Uses the Web Audio clock for drift-free scheduling.
  // Schedules one full 16 s loop, then re-schedules 500 ms before it ends.

  startBGM() {
    if (this._dead || this._loopTimer !== null) return;
    this._nextLoop = this._ctx.currentTime + 0.05;
    this._tick();
  }

  stopBGM() {
    if (this._loopTimer !== null) {
      clearTimeout(this._loopTimer);
      this._loopTimer = null;
    }
  }

  _tick() {
    if (this._dead) return;
    const loopStart = this._nextLoop;
    this._nextLoop += LOOP_DUR;

    // ── Schedule note patterns ──
    this._playPattern(MELODY,   loopStart, 0.17, 'square',   this._w25, 0.88);
    this._playPattern(BASS,     loopStart, 0.10, 'triangle', null,       0.92);
    this._playPattern(HARMONY,  loopStart, 0.07, 'square',   null,       0.82);

    // ── Schedule drum track ──
    this._playDrums(loopStart);

    // Re-schedule 500 ms before this loop ends so the next loop queues seamlessly
    const msUntilNext = (this._nextLoop - this._ctx.currentTime - 0.5) * 1000;
    this._loopTimer = setTimeout(() => {
      this._loopTimer = null;
      this._tick();
    }, Math.max(50, msUntilNext));
  }

  _playPattern(pattern, loopStart, vol, type, wave, gate = 0.88) {
    let t = loopStart;
    pattern.forEach(([hz, dur]) => {
      if (hz) this._tone(hz, t, dur * gate, vol, type, wave);
      t += dur;
    });
  }

  _playDrums(loopStart) {
    const BAR = Q * 4; // 2.0 s per 4/4 bar at 120 BPM
    for (let b = 0; b < 8; b++) {
      const bs = loopStart + b * BAR;

      // Beat 1 — kick
      this._kick(bs);

      // Beat 3 — snare (with slight 8th-note variation on bars 4 & 8)
      const snareOffset = (b === 3 || b === 7) ? Q * 2 + E : Q * 2;
      this._snare(bs + snareOffset);

      // Every 8th note — hi-hat (quieter on off-beats)
      for (let h = 0; h < 8; h++) {
        const hatVol = (h % 2 === 0) ? 0.055 : 0.030; // on-beat louder
        this._hat(bs + h * E, hatVol);
      }
    }
  }

  // NES-style kick: sine pitch-drop 120→40 Hz + low noise thud
  _kick(t) {
    const ctx = this._ctx;
    const osc = ctx.createOscillator();
    const g   = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(120, t);
    osc.frequency.exponentialRampToValueAtTime(40, t + 0.10);
    g.gain.setValueAtTime(0.30, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.13);
    osc.connect(g); g.connect(this._master);
    osc.start(t); osc.stop(t + 0.14);
    this._noise(this._noiseBufs.kick, t, 0.06, 0, 180); // body rumble
  }

  // NES-style snare: band-passed noise burst + pitch-popped square
  _snare(t) {
    this._noise(this._noiseBufs.snare, t, 0.18, 700, 9000);
    this._tone(220, t, 0.04, 0.07, 'square');
  }

  // NES hi-hat: very short high-freq noise tick
  _hat(t, vol = 0.045) {
    this._noise(this._noiseBufs.hat, t, vol, 7000);
  }

  // ── Lifecycle ────────────────────────────────────────────────────────────────

  setVolume(v) {
    this._master.gain.value = Math.max(0, Math.min(1, v));
  }

  destroy() {
    this._dead = true;
    this.stopBGM();
    try { this._master.disconnect(); } catch (_) { /* already disconnected */ }
  }
}
