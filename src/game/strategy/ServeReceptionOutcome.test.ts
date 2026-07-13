import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CONTACT, GRAVITY } from '../../core/constants';
import {
  SERVE_RECEPTION_OUTCOME_TUNING,
  serveReceptionEffectiveness,
  type ServeReceptionOutcomeInput,
} from './ServeReceptionOutcome';

function reception(
  time: number = SERVE_RECEPTION_OUTCOME_TUNING.timing.ideal,
  miss = 0,
  height = CONTACT.set,
): ServeReceptionOutcomeInput {
  const position = { x: -6, y: 1, z: miss };
  const setterPosition = { x: -2, z: 0 };
  const velocity = {
    x: (setterPosition.x - position.x) / time,
    y: (height - position.y - 0.5 * GRAVITY * time * time) / time,
    z: 0,
  };
  return { ballAfter: { position, velocity, inFlight: true }, setterPosition };
}

function mirrored(input: ServeReceptionOutcomeInput): ServeReceptionOutcomeInput {
  return {
    ballAfter: {
      position: {
        x: -input.ballAfter.position.x,
        y: input.ballAfter.position.y,
        z: -input.ballAfter.position.z,
      },
      velocity: {
        x: -input.ballAfter.velocity.x,
        y: input.ballAfter.velocity.y,
        z: -input.ballAfter.velocity.z,
      },
      inFlight: input.ballAfter.inFlight,
    },
    setterPosition: { x: -input.setterPosition.x, z: -input.setterPosition.z },
  };
}

describe('serveReceptionEffectiveness', () => {
  it('passe perfeito produz baixa efetividade do saque', () => {
    expect(serveReceptionEffectiveness(reception())).toBeCloseTo(0, 10);
  });

  it('shank planar aumenta o resultado pelo peso posicional', () => {
    const perfect = serveReceptionEffectiveness(reception());
    const shank = serveReceptionEffectiveness(reception(undefined, 3));

    expect(shank).toBeGreaterThan(perfect);
    expect(shank).toBeGreaterThanOrEqual(SERVE_RECEPTION_OUTCOME_TUNING.weights.position);
  });

  it.each([
    [
      'parada',
      (input: ServeReceptionOutcomeInput) => ({
        ...input,
        ballAfter: { ...input.ballAfter, velocity: { x: 0, y: 4, z: 0 } },
      }),
    ],
    [
      'afastando',
      (input: ServeReceptionOutcomeInput) => ({
        ...input,
        ballAfter: { ...input.ballAfter, velocity: { ...input.ballAfter.velocity, x: -2 } },
      }),
    ],
    [
      'fora de voo',
      (input: ServeReceptionOutcomeInput) => ({
        ...input,
        ballAfter: { ...input.ballAfter, inFlight: false },
      }),
    ],
  ] as const)('%s retorna efetividade máxima', (_case, mutate) => {
    expect(serveReceptionEffectiveness(mutate(reception()))).toBe(1);
  });

  it('altura balística ruim penaliza sem usar sinal privado', () => {
    const perfect = serveReceptionEffectiveness(reception());
    const high = serveReceptionEffectiveness(reception(undefined, 0, CONTACT.set + 2));

    expect(high).toBeGreaterThan(perfect);
    expect(high).toBeGreaterThanOrEqual(SERVE_RECEPTION_OUTCOME_TUNING.weights.height);
  });

  it('timing dentro da janela é graduado e fora dela é máximo', () => {
    const ideal = serveReceptionEffectiveness(reception());
    const lateInside = serveReceptionEffectiveness(
      reception(SERVE_RECEPTION_OUTCOME_TUNING.timing.max - 0.05),
    );
    const outside = serveReceptionEffectiveness(
      reception(SERVE_RECEPTION_OUTCOME_TUNING.timing.max + 0.05),
    );

    expect(lateInside).toBeGreaterThan(ideal);
    expect(outside).toBe(1);
  });

  it('queda no piso antes do ETA invalida mesmo com projeção planar perfeita', () => {
    const input = reception();
    const groundedFirst = {
      ...input,
      ballAfter: {
        ...input.ballAfter,
        position: { ...input.ballAfter.position, y: 0.2 },
        velocity: { ...input.ballAfter.velocity, y: -1 },
      },
    };

    expect(serveReceptionEffectiveness(groundedFirst)).toBe(1);
  });

  it('espelho HOME/AWAY produz resultado idêntico', () => {
    const home = reception(0.82, 0.7, CONTACT.set + 0.35);
    expect(serveReceptionEffectiveness(mirrored(home))).toBe(serveReceptionEffectiveness(home));
  });

  it('sempre limita o resultado ao intervalo fechado [0,1]', () => {
    const cases = [
      reception(),
      reception(undefined, 100, CONTACT.set + 100),
      reception(SERVE_RECEPTION_OUTCOME_TUNING.timing.max + 10),
      { ...reception(), ballAfter: { ...reception().ballAfter, inFlight: false } },
    ];
    for (const input of cases) {
      const result = serveReceptionEffectiveness(input);
      expect(result).toBeGreaterThanOrEqual(0);
      expect(result).toBeLessThanOrEqual(1);
    }
  });

  it.each([
    [
      'position.x',
      (input: ServeReceptionOutcomeInput) => ((input.ballAfter.position as { x: number }).x = NaN),
    ],
    [
      'position.y',
      (input: ServeReceptionOutcomeInput) =>
        ((input.ballAfter.position as { y: number }).y = Infinity),
    ],
    [
      'position.z',
      (input: ServeReceptionOutcomeInput) => ((input.ballAfter.position as { z: number }).z = NaN),
    ],
    [
      'velocity.x',
      (input: ServeReceptionOutcomeInput) => ((input.ballAfter.velocity as { x: number }).x = NaN),
    ],
    [
      'velocity.y',
      (input: ServeReceptionOutcomeInput) =>
        ((input.ballAfter.velocity as { y: number }).y = Infinity),
    ],
    [
      'velocity.z',
      (input: ServeReceptionOutcomeInput) => ((input.ballAfter.velocity as { z: number }).z = NaN),
    ],
    [
      'setter.x',
      (input: ServeReceptionOutcomeInput) => ((input.setterPosition as { x: number }).x = Infinity),
    ],
    [
      'setter.z',
      (input: ServeReceptionOutcomeInput) => ((input.setterPosition as { z: number }).z = NaN),
    ],
  ])('rejeita coordenada não finita em %s', (_case, mutate) => {
    const input = reception();
    mutate(input);
    expect(() => serveReceptionEffectiveness(input)).toThrow(/finit/i);
  });

  it('rejeita flag inFlight que não seja booleana', () => {
    const input = reception();
    (input.ballAfter as { inFlight: unknown }).inFlight = 1;
    expect(() => serveReceptionEffectiveness(input)).toThrow(/inFlight|boolean/i);
  });

  it('expõe tuning readonly profundamente congelado e pesos normalizados', () => {
    expect(Object.isFrozen(SERVE_RECEPTION_OUTCOME_TUNING)).toBe(true);
    expect(Object.isFrozen(SERVE_RECEPTION_OUTCOME_TUNING.weights)).toBe(true);
    expect(Object.isFrozen(SERVE_RECEPTION_OUTCOME_TUNING.timing)).toBe(true);
    expect(Object.isFrozen(SERVE_RECEPTION_OUTCOME_TUNING.miss)).toBe(true);
    expect(Object.isFrozen(SERVE_RECEPTION_OUTCOME_TUNING.height)).toBe(true);
    expect(Object.values(SERVE_RECEPTION_OUTCOME_TUNING.weights).reduce((a, b) => a + b, 0)).toBe(
      1,
    );
  });

  it('fonte não aceita nem lê sinais privados de recepção ou dependências impuras', () => {
    const source = readFileSync(new URL('./ServeReceptionOutcome.ts', import.meta.url), 'utf8');
    expect(source).not.toMatch(/\b(?:q|quality|target|landing)\b/);
    expect(source).not.toMatch(/(?:Match|mechanics)/);
  });
});
