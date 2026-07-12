import { describe, expect, it } from 'vitest';
import { advancePlanarMotion, estimateArrivalTime, estimatePlanarArrivalTime } from './kinematics';

describe('advancePlanarMotion', () => {
  it('acelera desde o repouso na direção do alvo e muta os vetores recebidos', () => {
    const position = { x: 0, z: 0 };
    const velocity = { x: 0, z: 0 };

    const speed = advancePlanarMotion(position, velocity, { x: 10, z: 0 }, 0.1, 6, 30, 40);

    expect(speed).toBeCloseTo(3);
    expect(velocity).toEqual({ x: 3, z: 0 });
    expect(position.x).toBeCloseTo(0.3);
    expect(position.z).toBe(0);
  });

  it('freia ao se aproximar do alvo', () => {
    const position = { x: 0, z: 0 };
    const velocity = { x: 6, z: 0 };

    const speed = advancePlanarMotion(position, velocity, { x: 0.5, z: 0 }, 0.05, 6, 30, 40);

    expect(speed).toBeLessThan(6);
    expect(position.x).toBeLessThanOrEqual(0.5);
  });

  it('desacelera antes de inverter a direção', () => {
    const position = { x: 0, z: 0 };
    const velocity = { x: 3, z: 0 };

    advancePlanarMotion(position, velocity, { x: -10, z: 0 }, 0.1, 6, 10, 20);
    advancePlanarMotion(position, velocity, { x: -10, z: 0 }, 0.1, 6, 10, 20);

    expect(velocity.x).toBeLessThan(0);
  });

  it('não ultrapassa o alvo e zera a velocidade ao alcançá-lo', () => {
    const position = { x: 0, z: 0 };
    const velocity = { x: 5, z: 0 };

    const speed = advancePlanarMotion(position, velocity, { x: 0.1, z: 0 }, 0.1, 6, 30, 40, 0);

    expect(position).toEqual({ x: 0.1, z: 0 });
    expect(velocity).toEqual({ x: 0, z: 0 });
    expect(speed).toBe(0);
  });
});

describe('estimateArrivalTime', () => {
  it('resolve analiticamente a aceleração desde o repouso até a velocidade máxima', () => {
    expect(estimateArrivalTime(0.6, 0, 6, 30)).toBeCloseTo(0.2);
    expect(estimateArrivalTime(6, 0, 6, 30)).toBeCloseTo(1.1);
  });

  it('considera a velocidade projetada a favor e contra o ponto de contato', () => {
    expect(estimateArrivalTime(0.45, 3, 6, 30)).toBeCloseTo(0.1);
    expect(estimateArrivalTime(0.6, -3, 6, 30)).toBeCloseTo(0.325);
  });

  it('retorna zero para distância já coberta e infinito sem movimento possível', () => {
    expect(estimateArrivalTime(0, 0, 6, 30)).toBe(0);
    expect(estimateArrivalTime(1, 0, 0, 30)).toBe(Infinity);
    expect(estimateArrivalTime(1, 0, 6, 0)).toBe(Infinity);
  });
});

describe('estimatePlanarArrivalTime', () => {
  it('cobra o giro de uma velocidade lateral usando o mesmo integrador de movimento', () => {
    const eta = estimatePlanarArrivalTime(2, 0, 6.2, 6.2, 31, 38, 1.15);

    expect(eta).toBeCloseTo(1 / 3, 6);
    expect(eta).toBeGreaterThan(0.28);
  });
});
