import { describe, expect, it } from 'vitest';
import type { ActionContext, ActionIntent } from '../control/ActionIntent';
import {
  createTimingFeedbackEvent,
  evaluateTiming,
  timingTier,
  type TimingContext,
} from './TimingFeedback';

function intent(context: TimingContext, pressedTick: number, resolvedTick: number): ActionIntent {
  const techniques: Record<TimingContext, ActionIntent['technique']> = {
    receive: 'platform-pass',
    set: 'high-set',
    attack: 'placed-shot',
    block: 'quick-block',
    freeball: 'safe-save',
  };
  return {
    token: 7,
    context,
    gesture: 'tap',
    charge: 0,
    direction: { x: 0, z: 0 },
    pressedTick,
    resolvedTick,
    cause: 'release',
    technique: techniques[context],
    power: 0.5,
    reach: 0.5,
    precision: 0.8,
    penetration: 0,
  };
}

describe('timingTier', () => {
  it.each([
    [1, 'perfect'],
    [0.85, 'perfect'],
    [0.849_999, 'good'],
    [0.55, 'good'],
    [0.549_999, 'off'],
    [-1, 'off'],
    [Number.NaN, 'off'],
  ] as const)('classifica %s como %s', (quality, tier) => {
    expect(timingTier(quality)).toBe(tier);
  });
});

describe('evaluateTiming', () => {
  it('usa o tick de resolução para recepção/set/freeball', () => {
    const evaluation = evaluateTiming(intent('receive', 10, 30), 5);

    expect(evaluation).toEqual({
      idealLeadTicks: 5,
      measuredLeadTicks: 5,
      errorTicks: 0,
      quality: 1,
      phase: 'on-time',
      tier: 'perfect',
    });
  });

  it('usa o início do salto para ataque e bloqueio', () => {
    const attack = evaluateTiming(intent('attack', 10, 20), 6);
    const block = evaluateTiming(intent('block', 10, 20), 9);

    expect(attack).toMatchObject({ idealLeadTicks: 16, measuredLeadTicks: 16, quality: 1 });
    expect(block).toMatchObject({ idealLeadTicks: 19, measuredLeadTicks: 19, quality: 1 });
  });

  it('distingue cedo e tarde com sinal estável e limita qualidade', () => {
    const early = evaluateTiming(intent('set', 0, 1), 17);
    const late = evaluateTiming(intent('set', 0, 1), 0);

    expect(early).toMatchObject({ errorTicks: 12, phase: 'early', quality: 0, tier: 'off' });
    expect(late).toMatchObject({ errorTicks: -5, phase: 'late' });
    expect(late.quality).toBeGreaterThanOrEqual(0);
    expect(late.quality).toBeLessThanOrEqual(1);
  });

  it('escala ampla melhora apenas tolerância, preservando ticks, fase e intenção', () => {
    const action = intent('set', 0, 1);
    const normal = evaluateTiming(action, 0);
    const wide = evaluateTiming(action, 0, 1.35);

    expect(wide.quality).toBeGreaterThan(normal.quality);
    expect(wide).toMatchObject({
      idealLeadTicks: normal.idealLeadTicks,
      measuredLeadTicks: normal.measuredLeadTicks,
      errorTicks: normal.errorTicks,
      phase: normal.phase,
    });
    expect(action).toEqual(intent('set', 0, 1));
  });

  it('rejeita escala de tolerância inválida', () => {
    expect(() => evaluateTiming(intent('set', 0, 1), 0, 0)).toThrow(/tolerância|escala/i);
    expect(() => evaluateTiming(intent('set', 0, 1), 0, Number.NaN)).toThrow(/tolerância|escala/i);
  });

  it('rejeita saque em runtime porque carga não possui sweet spot temporal', () => {
    const serve = { ...intent('receive', 0, 0), context: 'serve' as ActionContext };
    expect(() => evaluateTiming(serve)).toThrowError(/saque/i);
  });
});

describe('createTimingFeedbackEvent', () => {
  it('usa a qualidade final da física, preserva timing e congela posição/evento', () => {
    const action = intent('receive', 10, 20);
    const evaluation = evaluateTiming(action, 5);
    const event = createTimingFeedbackEvent(action, evaluation, 0.84, 30, {
      x: -3,
      y: 1,
      z: 2,
    });

    expect(event).toMatchObject({
      kind: 'timing',
      token: 7,
      simulationTick: 30,
      context: 'receive',
      quality: 0.84,
      tier: 'good',
      phase: 'on-time',
      position: { x: -3, y: 1, z: 2 },
    });
    expect(Object.isFrozen(event)).toBe(true);
    expect(Object.isFrozen(event.position)).toBe(true);
  });

  it('limita qualidade final inválida em [0,1]', () => {
    const action = intent('attack', 0, 0);
    const evaluation = evaluateTiming(action, 16);
    expect(createTimingFeedbackEvent(action, evaluation, 9, 1, { x: 0, y: 0, z: 0 }).quality).toBe(
      1,
    );
    expect(
      createTimingFeedbackEvent(action, evaluation, Number.NaN, 1, { x: 0, y: 0, z: 0 }).quality,
    ).toBe(0);
  });
});
