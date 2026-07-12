import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { AudioEngine } from './AudioEngine';
import type { TimingFeedbackEvent } from '../game/feedback/TimingFeedback';

// O ambiente Node do Vitest não tem Web Audio API. Como o passo M8 só exercita a lógica de
// resume/idempotência (não a síntese de som), basta um dublê de AudioContext com `state` e
// `resume` mockados, além dos métodos de criação de nós que o init() encadeia. Nada de jsdom.

let ctorCalls = 0;
let resumeSpy: ReturnType<typeof vi.fn>;
let oscillatorStarts = 0;
// permite cada teste escolher se resume() resolve ou rejeita (simula contexto suspenso/iOS)
let resumeImpl: () => Promise<void> = () => Promise.resolve();

// nó de áudio genérico: connect() devolve o destino para permitir o encadeamento do init()
function fakeNode(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { connect: (dest?: unknown) => dest, ...extra };
}

class MockAudioContext {
  sampleRate = 100; // buffer de ruído pequeno mantém o teste rápido
  currentTime = 0;
  destination = fakeNode();
  resume = vi.fn(() => resumeImpl());

  constructor() {
    ctorCalls++;
    resumeSpy = this.resume;
  }

  createGain(): Record<string, unknown> {
    return fakeNode({
      gain: {
        value: 0,
        setValueAtTime: () => {},
        exponentialRampToValueAtTime: () => {},
      },
    });
  }
  createBuffer(_channels: number, len: number): Record<string, unknown> {
    return { getChannelData: () => new Float32Array(len) };
  }
  createBufferSource(): Record<string, unknown> {
    return fakeNode({ buffer: null, loop: false, playbackRate: { value: 1 }, start: () => {} });
  }
  createBiquadFilter(): Record<string, unknown> {
    return fakeNode({ type: '', frequency: { value: 0 }, Q: { value: 0 } });
  }
  createOscillator(): Record<string, unknown> {
    return fakeNode({
      type: '',
      frequency: {
        setValueAtTime: () => {},
        exponentialRampToValueAtTime: () => {},
      },
      start: () => oscillatorStarts++,
      stop: () => {},
    });
  }
}

beforeEach(() => {
  ctorCalls = 0;
  oscillatorStarts = 0;
  resumeImpl = () => Promise.resolve();
  globalThis.AudioContext = MockAudioContext as unknown as typeof AudioContext;
});

function timingCue(tier: TimingFeedbackEvent['tier']): TimingFeedbackEvent {
  return {
    kind: 'timing',
    token: 1,
    simulationTick: 1,
    context: 'receive',
    idealLeadTicks: 5,
    measuredLeadTicks: 5,
    errorTicks: 0,
    quality: tier === 'perfect' ? 1 : tier === 'good' ? 0.7 : 0.2,
    phase: 'on-time',
    tier,
    position: { x: 0, y: 0, z: 0 },
  };
}

afterEach(() => {
  globalThis.AudioContext = undefined as unknown as typeof AudioContext;
  vi.restoreAllMocks();
});

describe('AudioEngine.init', () => {
  it('destrava o contexto: chama resume() ao criar (cobre iOS/Safari nascido suspended)', () => {
    const audio = new AudioEngine();
    audio.init();
    expect(resumeSpy).toHaveBeenCalledTimes(1);
  });

  it('é idempotente: 2 inits criam só um contexto e retomam sem recriar', () => {
    const audio = new AudioEngine();
    audio.init();
    audio.init();
    expect(ctorCalls).toBe(1); // um único AudioContext
    expect(resumeSpy).toHaveBeenCalledTimes(2); // resume na 1ª criação e no 2º init (early)
  });
});

describe('AudioEngine.resume', () => {
  it('retoma o contexto existente após init()', () => {
    const audio = new AudioEngine();
    audio.init();
    resumeSpy.mockClear();
    audio.resume();
    expect(resumeSpy).toHaveBeenCalledTimes(1);
  });

  it('sem init(): não lança (no-op via optional chaining quando ctx é null)', () => {
    const audio = new AudioEngine();
    expect(() => audio.resume()).not.toThrow();
  });

  it('engole a rejeição de resume() sem propagar exceção (garante o .catch)', async () => {
    resumeImpl = () => Promise.reject(new Error('suspended'));
    const audio = new AudioEngine();
    expect(() => audio.init()).not.toThrow();
    expect(() => audio.resume()).not.toThrow();
    // deixa as promessas rejeitadas serem resolvidas: se o .catch faltasse, viraria unhandled
    await Promise.resolve();
  });
});

describe('AudioEngine.timingCue', () => {
  it('é no-op seguro antes de init e quando desabilitado', () => {
    const audio = new AudioEngine();
    expect(() => audio.timingCue(timingCue('perfect'))).not.toThrow();
    audio.init();
    audio.enabled = false;
    audio.timingCue(timingCue('perfect'));
    expect(oscillatorStarts).toBe(0);
  });

  it('sintetiza imediatamente sem setTimeout e diferencia os tiers', () => {
    const audio = new AudioEngine();
    audio.init();
    const timeout = vi.spyOn(globalThis, 'setTimeout');

    audio.timingCue(timingCue('perfect'));
    const afterPerfect = oscillatorStarts;
    audio.timingCue(timingCue('good'));
    const afterGood = oscillatorStarts;
    audio.timingCue(timingCue('off'));

    expect(afterPerfect).toBe(2);
    expect(afterGood).toBe(3);
    expect(oscillatorStarts).toBe(4);
    expect(timeout).not.toHaveBeenCalled();
  });
});
