import { describe, expect, it } from 'vitest';
import { classifyLocomotion } from './locomotion';

describe('classifyLocomotion', () => {
  it('parada abaixo de 0,35 m/s', () => {
    expect(classifyLocomotion(0.2, 0.1, false).mode).toBe('idle');
    expect(classifyLocomotion(0, 0, false).mode).toBe('idle');
  });

  it('ajuste em velocidade baixa, sem inclinação', () => {
    const state = classifyLocomotion(1.0, 0.5, false);
    expect(state.mode).toBe('adjust');
    expect(state.lean).toBe(0);
  });

  it('corrida acima de 1,6 m/s com inclinação limitada', () => {
    const slow = classifyLocomotion(2.0, 0, false);
    expect(slow.mode).toBe('run');
    expect(slow.lean).toBeCloseTo(0.1, 6);
    const fast = classifyLocomotion(8, 0, false);
    expect(fast.lean).toBeCloseTo(0.3, 6); // teto
  });

  it('freada ativa em velocidade de corrida', () => {
    expect(classifyLocomotion(2.5, 0, true).mode).toBe('brake');
    expect(classifyLocomotion(1.0, 0, true).mode).toBe('adjust'); // devagar não é freada
  });

  it('strideYaw aponta a direção da passada no referencial da atleta', () => {
    expect(classifyLocomotion(3, 0, false).strideYaw).toBeCloseTo(0, 6); // frente
    expect(classifyLocomotion(0, 3, false).strideYaw).toBeCloseTo(Math.PI / 2, 6); // esquerda
    expect(classifyLocomotion(0, -3, false).strideYaw).toBeCloseTo(-Math.PI / 2, 6); // direita
    expect(classifyLocomotion(-3, 0, false).speed).toBeCloseTo(3, 6); // ré: speed positiva
  });
});
