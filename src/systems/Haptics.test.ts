import { describe, expect, it, vi } from 'vitest';
import type { TimingFeedbackEvent } from '../game/feedback/TimingFeedback';
import { Haptics } from './Haptics';

function cue(tier: TimingFeedbackEvent['tier']): TimingFeedbackEvent {
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
    position: { x: 0, y: 1, z: 0 },
  };
}

describe('Haptics', () => {
  it.each([
    ['perfect', [20, 30, 20]],
    ['good', [15]],
    ['off', [10]],
  ] as const)('mapeia %s para %j', (tier, pattern) => {
    const vibrate = vi.fn();
    new Haptics(vibrate).timingCue(cue(tier));
    expect(vibrate).toHaveBeenCalledWith([...pattern]);
  });

  it('é no-op sem capability e absorve rejeição do dispositivo', () => {
    expect(() => new Haptics(null).timingCue(cue('perfect'))).not.toThrow();
    expect(() =>
      new Haptics(() => {
        throw new Error('bloqueado');
      }).timingCue(cue('perfect')),
    ).not.toThrow();
  });
});
