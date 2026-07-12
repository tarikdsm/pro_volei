import { describe, expect, it } from 'vitest';
import { SlowMotionClock } from './SlowMotionClock';

describe('SlowMotionClock', () => {
  it('começa em velocidade normal sem fronteira pendente', () => {
    const clock = new SlowMotionClock();

    expect(clock.scale).toBe(1);
    expect(clock.secondsUntilBoundary).toBe(Number.POSITIVE_INFINITY);
  });

  it('mantém a escala até a fronteira exata e volta instantaneamente a 1', () => {
    const clock = new SlowMotionClock();
    clock.trigger(0.35, 0.4);

    clock.advanceActiveReal(0.15);
    expect(clock.scale).toBe(0.35);
    expect(clock.secondsUntilBoundary).toBeCloseTo(0.25, 12);

    clock.advanceActiveReal(0.25);
    expect(clock.scale).toBe(1);
    expect(clock.secondsUntilBoundary).toBe(Number.POSITIVE_INFINITY);
  });

  it('consome somente a duração ativa ao atravessar a fronteira', () => {
    const clock = new SlowMotionClock();
    clock.trigger(0.5, 0.1);

    clock.advanceActiveReal(0.4);

    expect(clock.scale).toBe(1);
    expect(clock.secondsUntilBoundary).toBe(Number.POSITIVE_INFINITY);
  });

  it('retrigger substitui escala e duração restantes', () => {
    const clock = new SlowMotionClock();
    clock.trigger(0.5, 0.4);
    clock.advanceActiveReal(0.1);

    clock.trigger(0.25, 0.2);

    expect(clock.scale).toBe(0.25);
    expect(clock.secondsUntilBoundary).toBeCloseTo(0.2, 12);
  });

  it('duração zero preserva velocidade normal', () => {
    const clock = new SlowMotionClock();

    clock.trigger(0.25, 0);

    expect(clock.scale).toBe(1);
    expect(clock.secondsUntilBoundary).toBe(Number.POSITIVE_INFINITY);
  });

  it.each([
    [0, 1],
    [-0.1, 1],
    [Number.NaN, 1],
    [0.5, -1],
    [0.5, Number.POSITIVE_INFINITY],
  ])('rejeita trigger inválido (%s, %s)', (scale, duration) => {
    const clock = new SlowMotionClock();

    expect(() => clock.trigger(scale, duration)).toThrow(RangeError);
  });

  it('rejeita avanço ativo negativo ou não finito', () => {
    const clock = new SlowMotionClock();

    expect(() => clock.advanceActiveReal(-0.01)).toThrow(RangeError);
    expect(() => clock.advanceActiveReal(Number.NaN)).toThrow(RangeError);
  });
});
