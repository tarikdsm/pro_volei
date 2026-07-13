import { describe, expect, it } from 'vitest';
import { TeamSide } from '../../core/constants';
import { buildOwnContactRead, type OwnContactReadSource } from './OwnContactRead';
import {
  fallbackPlacedSeam,
  selectAttackerByEta,
  setDeliveryEffectiveness,
} from './StrategicAttackSelection';

function read(side = TeamSide.HOME) {
  const sign = side === TeamSide.HOME ? 1 : -1;
  const source: OwnContactReadSource = {
    tick: 20,
    side,
    kind: 'set',
    athleteId: 1,
    ballAfter: {
      position: { x: sign * -1, y: 2.25, z: 0 },
      velocity: { x: 0, y: 5, z: 0 },
      inFlight: true,
    },
    ownAthletes: Array.from({ length: 6 }, (_, id) => ({
      side,
      id,
      slot: id,
      row: id <= 2 ? ('back' as const) : ('front' as const),
      position: { x: sign * -1.2, z: sign * (id - 4) * 1.4 },
      velocity: { x: 0, z: 0 },
      airborne: false,
    })),
  };
  return buildOwnContactRead(source);
}

describe('StrategicAttackSelection', () => {
  it('seleciona somente front row legal por ETA e desempata por id', () => {
    const chosen = selectAttackerByEta({
      read: read(),
      setterAthleteId: 1,
      target: { x: -1, z: 0 },
      availableIn: 1,
    });
    expect(chosen?.athleteId).toBe(4);
  });

  it('mantém atacante preliminar quando ainda é legal', () => {
    const chosen = selectAttackerByEta({
      read: read(),
      setterAthleteId: 1,
      target: { x: -1, z: 0 },
      availableIn: 1,
      preferredAthleteId: 3,
    });
    expect(chosen?.athleteId).toBe(3);
  });

  it('exclui setter, back row, airborne e quem não chega', () => {
    const base = read();
    const noFront = buildOwnContactRead({
      tick: base.tick,
      side: base.side,
      kind: base.kind,
      athleteId: base.athleteId,
      ballAfter: base.ballAfter,
      ownAthletes: base.ownAthletes.map((athlete) =>
        athlete.row === 'front' ? { ...athlete, airborne: true } : athlete,
      ),
    });
    expect(
      selectAttackerByEta({
        read: noFront,
        setterAthleteId: 1,
        target: { x: -1, z: 0 },
        availableIn: 10,
      }),
    ).toBeNull();
    expect(
      selectAttackerByEta({
        read: base,
        setterAthleteId: 1,
        target: { x: -8, z: 4 },
        availableIn: 0.01,
      }),
    ).toBeNull();
  });

  it('cria fallback placed-seam espelhado e congelado', () => {
    const home = fallbackPlacedSeam(TeamSide.HOME, -2.5, 'insufficient-lead');
    const away = fallbackPlacedSeam(TeamSide.AWAY, 2.5, 'insufficient-lead');
    expect(away.target.x).toBe(-home.target.x);
    expect(away.target.z).toBe(0);
    expect(home).toMatchObject({
      mode: 'fallback-placed-seam',
      optionId: 'attack.placed-seam',
      family: 'placed',
    });
    expect(Object.isFrozen(home)).toBe(true);
    expect(Object.isFrozen(home.target)).toBe(true);
  });

  it('mede entrega por erro observável com limites [0,1]', () => {
    expect(setDeliveryEffectiveness({ x: -1, z: 0 }, { x: -1.1, z: 0.1 })).toBe(1);
    expect(setDeliveryEffectiveness({ x: -1, z: 0 }, { x: -1, z: 2.4 })).toBe(0);
    expect(setDeliveryEffectiveness({ x: -1, z: 0 }, { x: -1, z: 1.35 })).toBeCloseTo(0.5);
    expect(() => setDeliveryEffectiveness({ x: Number.NaN, z: 0 }, { x: -1, z: 0 })).toThrow(
      /finit/i,
    );
  });
});
