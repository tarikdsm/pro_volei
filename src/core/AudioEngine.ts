// Áudio 100% procedural via Web Audio API — nenhum asset externo, funciona offline.
import type { TimingFeedbackEvent } from '../game/feedback/TimingFeedback';
import { scheduleSequence } from './audio/AudioScheduler';
import {
  DEFAULT_AUDIO_SETTINGS,
  normalizeAudioSettings,
  type AudioSettings,
} from './audio/AudioSettings';

export interface AudioCaption {
  readonly text: string;
  readonly durationMs: number;
}

type AudioCaptionSink = (caption: Readonly<AudioCaption>) => void;
type MixerChannel = 'effects' | 'crowd' | 'music';

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private effectsGain!: GainNode;
  private crowdBus!: GainNode;
  private musicGain!: GainNode;
  private noiseBuf!: AudioBuffer;
  private crowdEnvelope!: GainNode;
  private crowdFilter!: BiquadFilterNode;
  private crowdTarget = 0.05;
  private settings: AudioSettings;
  private captionSink: AudioCaptionSink | null = null;
  enabled = true;

  constructor(
    initialSettings: AudioSettings = DEFAULT_AUDIO_SETTINGS,
    private readonly panProvider: () => number = () => 0,
  ) {
    this.settings = normalizeAudioSettings(initialSettings);
  }

  // Precisa ser chamado após um gesto do usuário (política de autoplay).
  init(): void {
    if (this.ctx) {
      this.resume();
      return;
    }
    const audioGlobal = globalThis as typeof globalThis & {
      webkitAudioContext?: typeof AudioContext;
    };
    const AudioContextConstructor = audioGlobal.AudioContext ?? audioGlobal.webkitAudioContext;
    if (typeof AudioContextConstructor !== 'function') {
      this.enabled = false;
      return;
    }
    const ctx = new AudioContextConstructor();
    this.ctx = ctx;

    this.master = ctx.createGain();
    this.effectsGain = ctx.createGain();
    this.crowdBus = ctx.createGain();
    this.musicGain = ctx.createGain();
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -6;
    limiter.knee.value = 8;
    limiter.ratio.value = 12;
    limiter.attack.value = 0.003;
    limiter.release.value = 0.2;
    this.effectsGain.connect(this.master);
    this.crowdBus.connect(this.master);
    this.musicGain.connect(this.master);
    this.master.connect(limiter).connect(ctx.destination);
    this.applySettings(this.settings);

    const len = ctx.sampleRate * 2;
    this.noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;

    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    this.crowdFilter = ctx.createBiquadFilter();
    this.crowdFilter.type = 'bandpass';
    this.crowdFilter.frequency.value = 520;
    this.crowdFilter.Q.value = 0.6;
    this.crowdEnvelope = ctx.createGain();
    this.crowdEnvelope.gain.value = 0;
    src.connect(this.crowdFilter).connect(this.crowdEnvelope).connect(this.crowdBus);
    src.start();

    this.resume();
  }

  applySettings(settings: AudioSettings): void {
    this.settings = normalizeAudioSettings(settings);
    if (!this.ctx) return;
    this.master.gain.value = this.settings.master;
    this.effectsGain.gain.value = this.settings.effects;
    this.crowdBus.gain.value = this.settings.crowd;
    this.musicGain.gain.value = this.settings.music;
  }

  settingsSnapshot(): Readonly<AudioSettings> {
    return Object.freeze({ ...this.settings });
  }

  setCaptionSink(sink: AudioCaptionSink | null): void {
    this.captionSink = sink;
  }

  resume(): void {
    void this.ctx?.resume().catch(() => {});
  }

  suspend(): void {
    void this.ctx?.suspend().catch(() => {});
  }

  update(dt: number): void {
    if (!this.ctx) return;
    const gain = this.crowdEnvelope.gain;
    gain.value += (this.crowdTarget - gain.value) * Math.min(1, dt * 2.5);
    this.crowdTarget += (0.05 - this.crowdTarget) * Math.min(1, dt * 0.35);
  }

  excite(intensity: number): void {
    this.crowdTarget = Math.max(this.crowdTarget, 0.05 + intensity * 0.22);
  }

  private noiseBurst(
    dur: number,
    freq: number,
    q: number,
    gain: number,
    type: BiquadFilterType = 'bandpass',
    when = this.ctx?.currentTime ?? 0,
    pan = 0,
    channel: MixerChannel = 'effects',
  ): void {
    if (!this.ctx || !this.enabled) return;
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.playbackRate.value = 1;
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = freq;
    filter.Q.value = q;
    const envelope = ctx.createGain();
    const attenuation = 1 - Math.abs(clampPan(pan)) * 0.12;
    envelope.gain.setValueAtTime(gain * attenuation, when);
    envelope.gain.exponentialRampToValueAtTime(0.001, when + dur);
    src.connect(filter).connect(envelope);
    this.connectToChannel(envelope, channel, pan);
    src.start(when, Math.random() * 1.2, dur + 0.05);
  }

  private tone(
    freq: number,
    dur: number,
    gain: number,
    type: OscillatorType = 'sine',
    slideTo?: number,
    when = this.ctx?.currentTime ?? 0,
    channel: MixerChannel = 'effects',
    pan = 0,
  ): void {
    if (!this.ctx || !this.enabled) return;
    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, when);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, when + dur);
    const envelope = ctx.createGain();
    const attenuation = 1 - Math.abs(clampPan(pan)) * 0.12;
    envelope.gain.setValueAtTime(gain * attenuation, when);
    envelope.gain.exponentialRampToValueAtTime(0.001, when + dur);
    osc.connect(envelope);
    this.connectToChannel(envelope, channel, pan);
    osc.start(when);
    osc.stop(when + dur + 0.02);
  }

  private connectToChannel(source: AudioNode, channel: MixerChannel, pan: number): void {
    if (!this.ctx) return;
    const destination =
      channel === 'music' ? this.musicGain : channel === 'crowd' ? this.crowdBus : this.effectsGain;
    if (typeof this.ctx.createStereoPanner === 'function') {
      const panner = this.ctx.createStereoPanner();
      panner.pan.value = clampPan(pan);
      source.connect(panner).connect(destination);
      return;
    }
    source.connect(destination);
  }

  private caption(text: string, durationMs = 900): void {
    this.captionSink?.({ text, durationMs });
  }

  whistle(): void {
    this.caption('Apito');
    this.tone(2350, 0.45, 0.16, 'square', 2280);
    this.tone(2960, 0.45, 0.08, 'square', 2900);
  }

  whistleLong(): void {
    this.caption('Fim de set', 1200);
    this.tone(2350, 0.9, 0.16, 'square', 2250);
    this.tone(2960, 0.9, 0.08, 'square', 2860);
  }

  hitHard(pan = this.panProvider()): void {
    this.caption('Ataque');
    this.noiseBurst(0.12, 900, 1.2, 0.5, 'bandpass', this.ctx?.currentTime, pan);
    this.tone(120, 0.09, 0.4, 'sine', 60, this.ctx?.currentTime, 'effects', pan);
  }

  hitSoft(pan = this.panProvider()): void {
    this.caption('Toque');
    this.noiseBurst(0.08, 600, 1.5, 0.28, 'bandpass', this.ctx?.currentTime, pan);
    this.tone(160, 0.06, 0.2, 'sine', 90, this.ctx?.currentTime, 'effects', pan);
  }

  timingCue(event: Readonly<TimingFeedbackEvent>): void {
    this.caption(
      event.tier === 'perfect'
        ? 'Tempo perfeito'
        : event.tier === 'good'
          ? 'Bom tempo'
          : 'Fora do tempo',
      650,
    );
    if (event.tier === 'perfect') {
      this.tone(880, 0.08, 0.055, 'sine', 1040);
      this.tone(1320, 0.09, 0.035, 'sine', 1560);
    } else if (event.tier === 'good') {
      this.tone(760, 0.07, 0.05, 'sine', 830);
    } else {
      this.tone(220, 0.055, 0.045, 'triangle', 180);
    }
  }

  bounce(pan = this.panProvider()): void {
    this.caption('Bola no chão');
    this.noiseBurst(0.1, 300, 1, 0.35, 'lowpass', this.ctx?.currentTime, pan);
    this.tone(90, 0.12, 0.45, 'sine', 45, this.ctx?.currentTime, 'effects', pan);
  }

  netTouch(pan = this.panProvider()): void {
    this.caption('Rede');
    this.noiseBurst(0.25, 1600, 0.8, 0.15, 'highpass', this.ctx?.currentTime, pan);
  }

  block(pan = this.panProvider()): void {
    this.caption('Bloqueio');
    this.noiseBurst(0.1, 500, 0.8, 0.55, 'bandpass', this.ctx?.currentTime, pan);
    this.tone(80, 0.1, 0.5, 'sine', 50, this.ctx?.currentTime, 'effects', pan);
  }

  cheer(big = false): void {
    this.caption('Torcida', big ? 1300 : 900);
    if (!this.ctx || !this.enabled) return;
    const count = big ? 5 : 3;
    const times = scheduleSequence(
      this.ctx.currentTime,
      Array.from({ length: count }, (_, index) => index * 0.09),
    );
    for (const when of times) {
      this.noiseBurst(
        big ? 1.4 : 0.8,
        700 + Math.random() * 500,
        0.5,
        big ? 0.26 : 0.15,
        'bandpass',
        when,
        0,
        'crowd',
      );
    }
    this.excite(big ? 1 : 0.55);
  }

  applause(dur = 1.6): void {
    this.caption('Aplausos', Math.round(dur * 1000));
    this.scheduleApplause(dur);
  }

  private scheduleApplause(dur: number): void {
    if (!this.ctx || !this.enabled) return;
    const count = Math.floor(dur * 26);
    const times = scheduleSequence(
      this.ctx.currentTime,
      Array.from({ length: count }, () => Math.random() * dur),
    );
    for (const when of times) {
      this.noiseBurst(0.025, 1800 + Math.random() * 1400, 2.5, 0.09, 'bandpass', when, 0, 'crowd');
    }
  }

  scoreJingle(home: boolean): void {
    this.caption(home ? 'Ponto do seu time' : 'Ponto da CPU');
    if (!this.ctx || !this.enabled) return;
    const notes = home ? [523, 659, 784] : [392, 330];
    const times = scheduleSequence(
      this.ctx.currentTime,
      notes.map((_, index) => index * 0.095),
    );
    notes.forEach((frequency, index) =>
      this.tone(frequency, 0.18, 0.12, 'triangle', undefined, times[index], 'music'),
    );
  }

  victoryFanfare(): void {
    this.caption('Vitória', 1800);
    if (!this.ctx || !this.enabled) return;
    const notes = [523, 659, 784, 1047, 784, 1047];
    const times = scheduleSequence(
      this.ctx.currentTime,
      notes.map((_, index) => index * 0.16),
    );
    notes.forEach((frequency, index) =>
      this.tone(frequency, 0.3, 0.14, 'triangle', undefined, times[index], 'music'),
    );
    this.scheduleApplause(4);
    this.excite(1);
  }

  uiClick(): void {
    this.tone(880, 0.05, 0.08, 'square');
  }
}

function clampPan(value: number): number {
  return Number.isFinite(value) ? Math.max(-1, Math.min(1, value)) : 0;
}
