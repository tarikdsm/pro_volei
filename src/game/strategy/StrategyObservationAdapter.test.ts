import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { TeamSide } from '../../core/constants';
import {
  buildStrategyObservation,
  type StrategyObservationSource,
} from './StrategyObservationAdapter';

function source(): StrategyObservationSource {
  return {
    tick: 120,
    score: [8, 7],
    phase: 'rally',
    possessionSide: TeamSide.HOME,
    servingSide: TeamSide.AWAY,
    possessionTouches: 2,
    ball: {
      position: { x: -1, y: 2.4, z: 0 },
      velocity: { x: 4, y: -1, z: -0 },
      inFlight: true,
      lastVisibleContactTick: 118,
    },
    athletes: [TeamSide.HOME, TeamSide.AWAY].flatMap((side) => {
      const sign = side === TeamSide.HOME ? 1 : -1;
      return Array.from({ length: 6 }, (_, id) => ({
        side,
        id,
        slot: id,
        position: { x: sign * (id <= 2 ? -6 : -2), z: sign * ((id % 3) - 1) * 3 },
        velocity: { x: 0, z: -0 },
        airborne: id === 4,
      }));
    }),
  };
}

function swap(side: TeamSide): TeamSide {
  return side === TeamSide.HOME ? TeamSide.AWAY : TeamSide.HOME;
}

function mirroredNumber(value: number): number {
  return value === 0 ? 0 : -value;
}

describe('StrategyObservationAdapter', () => {
  it('constrói roster completo, deriva row por slot e espelha sem assimetria', () => {
    const home = buildStrategyObservation(source());
    expect(home.athletes).toHaveLength(12);
    expect(home.athletes.filter((athlete) => athlete.side === TeamSide.HOME)).toHaveLength(6);
    expect(home.athletes.map((athlete) => athlete.row)).toEqual([
      'back',
      'back',
      'back',
      'front',
      'front',
      'front',
      'back',
      'back',
      'back',
      'front',
      'front',
      'front',
    ]);

    const input = source();
    const mirrored = buildStrategyObservation({
      ...input,
      score: [input.score[1], input.score[0]],
      possessionSide: input.possessionSide === null ? null : swap(input.possessionSide),
      servingSide: swap(input.servingSide),
      ball: {
        ...input.ball,
        position: {
          x: -input.ball.position.x,
          y: input.ball.position.y,
          z: -input.ball.position.z,
        },
        velocity: {
          x: -input.ball.velocity.x,
          y: input.ball.velocity.y,
          z: -input.ball.velocity.z,
        },
      },
      athletes: input.athletes.map((athlete) => ({
        ...athlete,
        side: swap(athlete.side),
        position: { x: -athlete.position.x, z: -athlete.position.z },
        velocity: { x: -athlete.velocity.x, z: -athlete.velocity.z },
      })),
    });

    expect(mirrored.score).toEqual([home.score[1], home.score[0]]);
    expect(mirrored.athletes).toEqual(
      home.athletes.map((athlete) => ({
        ...athlete,
        side: swap(athlete.side),
        position: {
          x: mirroredNumber(athlete.position.x),
          z: mirroredNumber(athlete.position.z),
        },
        velocity: {
          x: mirroredNumber(athlete.velocity.x),
          z: mirroredNumber(athlete.velocity.z),
        },
      })),
    );
  });

  it('copia, normaliza -0 e congela profundamente sem mutar a entrada', () => {
    const input = source();
    const before = structuredClone(input);
    const output = buildStrategyObservation(input);

    expect(input).toEqual(before);
    expect(Object.is(output.ball.velocity.z, -0)).toBe(false);
    expect(Object.is(output.athletes[0].velocity.z, -0)).toBe(false);
    expect(Object.isFrozen(output)).toBe(true);
    expect(Object.isFrozen(output.score)).toBe(true);
    expect(Object.isFrozen(output.ball.position)).toBe(true);
    expect(Object.isFrozen(output.athletes)).toBe(true);
    expect(Object.isFrozen(output.athletes[0].position)).toBe(true);
  });

  it('rejeita NaN, roster incompleto, slot duplicado e identidade duplicada', () => {
    const input = source();
    const invalid = [
      { ...input, ball: { ...input.ball, position: { ...input.ball.position, x: Number.NaN } } },
      { ...input, athletes: input.athletes.slice(1) },
      {
        ...input,
        athletes: input.athletes.map((athlete, index) =>
          index === 1 ? { ...athlete, slot: 0 } : athlete,
        ),
      },
      {
        ...input,
        athletes: input.athletes.map((athlete, index) =>
          index === 1 ? { ...athlete, id: 0 } : athlete,
        ),
      },
    ];

    for (const candidate of invalid) expect(() => buildStrategyObservation(candidate)).toThrow();
  });

  it('ignora future-poison e campos privados extras', () => {
    const clean = source();
    const poisoned = {
      ...clean,
      aim: { x: 99, z: -99 },
      chosenZone: 'future-zone',
      landing: { x: 99, z: 99, time: 0.01 },
      plan: { point: { x: -99, y: 8, z: 99 }, contactIn: 0.001 },
      ball: { ...clean.ball, landing: { x: 88, z: 77 }, target: { x: 9, z: 9 } },
      athletes: clean.athletes.map((athlete) => ({
        ...athlete,
        target: { x: 99, z: 99 },
        chosenZone: 'private',
      })),
    };

    expect(buildStrategyObservation(poisoned)).toEqual(buildStrategyObservation(clean));
  });

  it('é idempotente sobre o próprio DTO de saída', () => {
    const first = buildStrategyObservation(source());
    const second = buildStrategyObservation(first);
    expect(second).toEqual(first);
    expect(second).not.toBe(first);
  });

  it('não importa runtime privado, render, DOM ou RNG', () => {
    const implementation = readFileSync(
      fileURLToPath(new URL('./StrategyObservationAdapter.ts', import.meta.url)),
      'utf8',
    );
    expect(implementation).not.toMatch(
      /from\s+['"](?:three|.*(?:Match|Team|RallyState|TouchPlan|random).*?)['"]|\b(?:window|document|navigator|aim|chosenZone|landing|target)\b/,
    );
  });
});
