import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { TeamSide } from '../../core/constants';
import {
  buildOwnContactRead,
  deriveAttackOriginFromExecutedSet,
  isCanonicalOwnContactRead,
  selectSetterByEta,
  type OwnContactReadSource,
} from './OwnContactRead';

function source(): OwnContactReadSource {
  return {
    tick: 120,
    side: TeamSide.HOME,
    kind: 'pass',
    athleteId: 0,
    ballAfter: {
      position: { x: -4, y: 1, z: 0 },
      velocity: { x: 3, y: 6, z: 0 },
      inFlight: true,
    },
    ownAthletes: Array.from({ length: 6 }, (_, id) => ({
      side: TeamSide.HOME,
      id,
      slot: id,
      row: id <= 2 ? ('back' as const) : ('front' as const),
      position: { x: id === 1 ? -2.2 : -7 - id * 0.2, z: id - 3 },
      velocity: { x: 0, z: 0 },
      airborne: false,
    })),
  };
}

describe('OwnContactRead', () => {
  it('copia por valor e congela profundamente somente o recorte permitido', () => {
    const input = source();
    const read = buildOwnContactRead(input);

    (input.ballAfter.position as { x: number }).x = 99;
    (input.ownAthletes[1].position as { x: number }).x = 99;

    expect(read.ballAfter.position.x).toBe(-4);
    expect(read.ownAthletes[1].position.x).toBe(-2.2);
    expect(Object.isFrozen(read)).toBe(true);
    expect(Object.isFrozen(read.ballAfter.position)).toBe(true);
    expect(Object.isFrozen(read.ownAthletes)).toBe(true);
    expect(Object.isFrozen(read.ownAthletes[0].velocity)).toBe(true);
    expect(isCanonicalOwnContactRead(read)).toBe(true);
    expect(isCanonicalOwnContactRead(structuredClone(read))).toBe(false);
  });

  it('rejeita roster incompleto, duplicado, de outro lado ou sem o atleta do contato', () => {
    const base = source();
    expect(() =>
      buildOwnContactRead({ ...base, ownAthletes: base.ownAthletes.slice(0, 5) }),
    ).toThrow(/seis|6/i);
    expect(() =>
      buildOwnContactRead({
        ...base,
        ownAthletes: base.ownAthletes.map((athlete, index) =>
          index === 1 ? { ...athlete, id: 0 } : athlete,
        ),
      }),
    ).toThrow(/duplicad/i);
    expect(() =>
      buildOwnContactRead({
        ...base,
        ownAthletes: base.ownAthletes.map((athlete, index) =>
          index === 1 ? { ...athlete, slot: 0 } : athlete,
        ),
      }),
    ).toThrow(/slot|duplicad/i);
    expect(() =>
      buildOwnContactRead({
        ...base,
        ownAthletes: base.ownAthletes.map((athlete, index) =>
          index === 1 ? { ...athlete, side: TeamSide.AWAY } : athlete,
        ),
      }),
    ).toThrow(/lado/i);
    expect(() => buildOwnContactRead({ ...base, athleteId: 99 })).toThrow(/contato|atleta/i);
  });

  it('rejeita tick, kind e trajetória inválidos', () => {
    const base = source();
    expect(() => buildOwnContactRead({ ...base, tick: -1 })).toThrow(/inteiro|tick/i);
    expect(() => buildOwnContactRead({ ...base, kind: 'spike' as never })).toThrow(/kind|contato/i);
    expect(() =>
      buildOwnContactRead({
        ...base,
        ballAfter: { ...base.ballAfter, velocity: { x: Number.NaN, y: 1, z: 0 } },
      }),
    ).toThrow(/finit/i);
  });

  it('seleciona por ETA à trajetória executada, exclui quem passou e desempata por id', () => {
    const base = source();
    const chosen = selectSetterByEta(buildOwnContactRead(base));
    expect(chosen).toMatchObject({ athleteId: 1 });
    expect(chosen?.arrivalIn).toBeLessThanOrEqual(chosen!.contactIn);

    const tied = buildOwnContactRead({
      ...base,
      ownAthletes: base.ownAthletes.map((athlete) =>
        athlete.id === 1 || athlete.id === 2
          ? { ...athlete, position: { x: -2.2, z: 0 }, velocity: { x: 0, z: 0 } }
          : athlete,
      ),
    });
    expect(selectSetterByEta(tied)?.athleteId).toBe(1);
    expect(selectSetterByEta(tied)?.athleteId).not.toBe(base.athleteId);
  });

  it('retorna null sem voo ou sem atleta capaz de chegar à janela', () => {
    const base = source();
    expect(
      selectSetterByEta(
        buildOwnContactRead({ ...base, ballAfter: { ...base.ballAfter, inFlight: false } }),
      ),
    ).toBeNull();
    expect(
      selectSetterByEta(
        buildOwnContactRead({
          ...base,
          ballAfter: {
            position: { x: -4, y: 2.4, z: 0 },
            velocity: { x: 0, y: -10, z: 0 },
            inFlight: true,
          },
          ownAthletes: base.ownAthletes.map((athlete) => ({
            ...athlete,
            position: { x: -9, z: 4 },
            velocity: { x: 0, z: 0 },
          })),
        }),
      ),
    ).toBeNull();
  });

  it('rejeita janela de levantamento fora da própria meia-quadra ou largura', () => {
    const base = source();
    expect(
      selectSetterByEta(
        buildOwnContactRead({
          ...base,
          ballAfter: {
            position: { x: -0.2, y: 1, z: 0 },
            velocity: { x: 9, y: 6, z: 0 },
            inFlight: true,
          },
        }),
      ),
    ).toBeNull();
    expect(
      selectSetterByEta(
        buildOwnContactRead({
          ...base,
          ballAfter: {
            position: { x: -4, y: 1, z: 4.4 },
            velocity: { x: 0, y: 6, z: 2 },
            inFlight: true,
          },
        }),
      ),
    ).toBeNull();
  });

  it('deriva a origem do ataque somente do voo executado de um set jogável', () => {
    const base = source();
    const executedSet = buildOwnContactRead({
      ...base,
      kind: 'set',
      athleteId: 3,
      ballAfter: {
        position: { x: -1, y: 2.25, z: 1 },
        velocity: { x: 0, y: 5, z: 0.5 },
        inFlight: true,
      },
    });
    const origin = deriveAttackOriginFromExecutedSet(executedSet);
    expect(origin?.position.x).toBe(-1);
    expect(origin?.position.z).toBeGreaterThan(1);
    expect(origin?.contactIn).toBeGreaterThan(0);
    expect(deriveAttackOriginFromExecutedSet(buildOwnContactRead(base))).toBeNull();
    expect(
      deriveAttackOriginFromExecutedSet(
        buildOwnContactRead({
          ...base,
          kind: 'set',
          athleteId: 3,
          ballAfter: {
            position: { x: -0.1, y: 2.25, z: 0 },
            velocity: { x: 8, y: 5, z: 0 },
            inFlight: true,
          },
        }),
      ),
    ).toBeNull();
  });

  it('não importa Three.js, DOM, Match, mechanics ou RNG', () => {
    const implementation = readFileSync(
      fileURLToPath(new URL('./OwnContactRead.ts', import.meta.url)),
      'utf8',
    );
    expect(implementation).not.toMatch(/from ['"]three['"]/);
    expect(implementation).not.toMatch(/\b(document|window|Match|MechanicsCtx|Random)\b/);
  });
});
