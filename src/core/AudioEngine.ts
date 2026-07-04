// Áudio 100% procedural via Web Audio API — nenhum asset externo, funciona offline.
export class AudioEngine {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private noiseBuf!: AudioBuffer;
  private crowdGain!: GainNode;
  private crowdFilter!: BiquadFilterNode;
  private crowdTarget = 0.05;
  enabled = true;

  // Precisa ser chamado após um gesto do usuário (política de autoplay)
  init(): void {
    if (this.ctx) return;
    const ctx = new AudioContext();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = 0.7;
    this.master.connect(ctx.destination);

    // buffer de ruído branco reutilizável (2s)
    const len = ctx.sampleRate * 2;
    this.noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;

    // Ambiente de torcida: ruído em loop por filtro passa-banda, ganho modulado
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    this.crowdFilter = ctx.createBiquadFilter();
    this.crowdFilter.type = 'bandpass';
    this.crowdFilter.frequency.value = 520;
    this.crowdFilter.Q.value = 0.6;
    this.crowdGain = ctx.createGain();
    this.crowdGain.gain.value = 0.0;
    src.connect(this.crowdFilter).connect(this.crowdGain).connect(this.master);
    src.start();
  }

  update(dt: number): void {
    if (!this.ctx) return;
    const g = this.crowdGain.gain;
    g.value += (this.crowdTarget - g.value) * Math.min(1, dt * 2.5);
    // decai lentamente de volta ao murmúrio
    this.crowdTarget += (0.05 - this.crowdTarget) * Math.min(1, dt * 0.35);
  }

  /** intensidade 0..1 — empolgação da torcida (aumenta o volume do ambiente) */
  excite(intensity: number): void {
    this.crowdTarget = Math.max(this.crowdTarget, 0.05 + intensity * 0.22);
  }

  private noiseBurst(dur: number, freq: number, q: number, gain: number, type: BiquadFilterType = 'bandpass'): void {
    if (!this.ctx || !this.enabled) return;
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.playbackRate.value = 1;
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = freq;
    filter.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + dur);
    src.connect(filter).connect(g).connect(this.master);
    src.start(ctx.currentTime, Math.random() * 1.2, dur + 0.05);
  }

  private tone(freq: number, dur: number, gain: number, type: OscillatorType = 'sine', slideTo?: number): void {
    if (!this.ctx || !this.enabled) return;
    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, ctx.currentTime);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, ctx.currentTime + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + dur);
    osc.connect(g).connect(this.master);
    osc.start();
    osc.stop(ctx.currentTime + dur + 0.02);
  }

  whistle(): void {
    if (!this.ctx) return;
    // apito: dois tons agudos com trinado
    this.tone(2350, 0.45, 0.16, 'square', 2280);
    this.tone(2960, 0.45, 0.08, 'square', 2900);
  }

  whistleLong(): void {
    this.tone(2350, 0.9, 0.16, 'square', 2250);
    this.tone(2960, 0.9, 0.08, 'square', 2860);
  }

  hitHard(): void { // cortada / saque forte
    this.noiseBurst(0.12, 900, 1.2, 0.5);
    this.tone(120, 0.09, 0.4, 'sine', 60);
  }

  hitSoft(): void { // manchete / toque
    this.noiseBurst(0.08, 600, 1.5, 0.28);
    this.tone(160, 0.06, 0.2, 'sine', 90);
  }

  bounce(): void { // bola no chão
    this.noiseBurst(0.1, 300, 1, 0.35, 'lowpass');
    this.tone(90, 0.12, 0.45, 'sine', 45);
  }

  netTouch(): void {
    this.noiseBurst(0.25, 1600, 0.8, 0.15, 'highpass');
  }

  block(): void {
    this.noiseBurst(0.1, 500, 0.8, 0.55);
    this.tone(80, 0.1, 0.5, 'sine', 50);
  }

  cheer(big = false): void {
    if (!this.ctx || !this.enabled) return;
    const n = big ? 5 : 3;
    for (let i = 0; i < n; i++) {
      setTimeout(() => this.noiseBurst(big ? 1.4 : 0.8, 700 + Math.random() * 500, 0.5, big ? 0.26 : 0.15), i * 90);
    }
    this.excite(big ? 1 : 0.55);
  }

  applause(dur = 1.6): void {
    if (!this.ctx || !this.enabled) return;
    const claps = Math.floor(dur * 26);
    for (let i = 0; i < claps; i++) {
      setTimeout(() => this.noiseBurst(0.025, 1800 + Math.random() * 1400, 2.5, 0.09, 'bandpass'), Math.random() * dur * 1000);
    }
  }

  scoreJingle(home: boolean): void {
    const notes = home ? [523, 659, 784] : [392, 330];
    notes.forEach((f, i) => setTimeout(() => this.tone(f, 0.18, 0.12, 'triangle'), i * 95));
  }

  victoryFanfare(): void {
    const notes = [523, 659, 784, 1047, 784, 1047];
    notes.forEach((f, i) => setTimeout(() => this.tone(f, 0.3, 0.14, 'triangle'), i * 160));
    this.applause(4);
    this.excite(1);
  }

  uiClick(): void {
    this.tone(880, 0.05, 0.08, 'square');
  }
}
