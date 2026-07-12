import { describe, expect, it, vi } from 'vitest';
import type { TimingFeedbackEvent } from '../game/feedback/TimingFeedback';
import { PresentationFeedback } from './PresentationFeedback';

function event(token = 7, simulationTick = 20): Readonly<TimingFeedbackEvent> {
  return Object.freeze({
    kind: 'timing',
    token,
    simulationTick,
    context: 'receive',
    idealLeadTicks: 5,
    measuredLeadTicks: 5,
    errorTicks: 0,
    quality: 1,
    phase: 'on-time',
    tier: 'perfect',
    position: Object.freeze({ x: -3, y: 1, z: 0 }),
  });
}

describe('PresentationFeedback', () => {
  it('entrega a mesma instância sincronicamente a todos os sinks uma vez', () => {
    const visual = { timingCue: vi.fn() };
    const audio = { timingCue: vi.fn() };
    const haptic = { timingCue: vi.fn() };
    const feedback = new PresentationFeedback([visual, audio, haptic]);
    const cue = event();

    feedback.emit(cue);

    expect(visual.timingCue).toHaveBeenCalledWith(cue);
    expect(audio.timingCue).toHaveBeenCalledWith(cue);
    expect(haptic.timingCue).toHaveBeenCalledWith(cue);
    expect(feedback.snapshot()).toBe(cue);
  });

  it('deduplica token/tick, mas aceita novo tick ou token', () => {
    const sink = { timingCue: vi.fn() };
    const feedback = new PresentationFeedback([sink]);

    feedback.emit(event(7, 20));
    feedback.emit(event(7, 20));
    feedback.emit(event(7, 21));
    feedback.emit(event(8, 21));

    expect(sink.timingCue).toHaveBeenCalledTimes(3);
  });
});
