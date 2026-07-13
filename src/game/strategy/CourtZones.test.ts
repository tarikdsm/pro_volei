import { describe, expect, it } from 'vitest';
import { COURT, TeamSide } from '../../core/constants';
import {
  canonicalStrategyOptions,
  strategySubtarget,
  strategyToLocal,
  strategyToWorld,
} from './CourtZones';

describe('CourtZones', () => {
  it('espelha exatamente coordenadas locais entre HOME e AWAY', () => {
    const local = { x: 6.25, z: -2.75 };

    expect(strategyToWorld(local, TeamSide.HOME)).toEqual(local);
    expect(strategyToWorld(local, TeamSide.AWAY)).toEqual({ x: -6.25, z: 2.75 });
    expect(strategyToLocal(strategyToWorld(local, TeamSide.AWAY), TeamSide.AWAY)).toEqual(local);
  });

  it.each(['serve', 'set', 'attack'] as const)(
    'gera a matriz canônica de %s em ordem e sem IDs duplicados',
    (kind) => {
      const options = canonicalStrategyOptions(kind, { attackOriginZ: -2.5 });
      const ids = options.map((option) => option.optionId);

      expect(ids).toEqual([...ids].sort());
      expect(new Set(ids).size).toBe(ids.length);
      expect(options.every((option) => option.kind === kind)).toBe(true);
    },
  );

  it('materializa somente as combinações legais da matriz', () => {
    expect(canonicalStrategyOptions('serve').map((option) => option.optionId)).toEqual([
      'serve.float-deep.center',
      'serve.float-deep.left',
      'serve.float-deep.right',
      'serve.float-short.center',
      'serve.float-short.left',
      'serve.float-short.right',
      'serve.power-deep.center',
      'serve.power-deep.left',
      'serve.power-deep.right',
    ]);
    expect(canonicalStrategyOptions('set').map((option) => option.optionId)).toEqual([
      'set.accelerated-left',
      'set.accelerated-right',
      'set.high-left',
      'set.high-right',
      'set.quick-center',
    ]);
    expect(
      canonicalStrategyOptions('attack', { attackOriginZ: -2.5 }).map((option) => option.optionId),
    ).toEqual([
      'attack.placed-cross',
      'attack.placed-line',
      'attack.placed-seam',
      'attack.power-cross-deep',
      'attack.power-line-deep',
      'attack.tip-short-center',
      'attack.tip-short-left',
      'attack.tip-short-right',
    ]);
  });

  it('usa o segundo draw com hash keyed e mantém todo subtarget dentro da quadra', () => {
    for (const kind of ['serve', 'set', 'attack'] as const) {
      for (const option of canonicalStrategyOptions(kind, { attackOriginZ: 2.8 })) {
        const first = strategySubtarget(option, 0x1234_5678);
        const replay = strategySubtarget(option, 0x1234_5678);
        const other = strategySubtarget(option, 0x8765_4321);

        expect(replay).toEqual(first);
        expect(Number.isFinite(first.x) && Number.isFinite(first.z)).toBe(true);
        expect(Math.abs(first.x)).toBeLessThanOrEqual(COURT.halfLength);
        expect(Math.abs(first.z)).toBeLessThanOrEqual(COURT.halfWidth);
        expect(other).not.toEqual(first);
      }
    }
  });

  it('inverte linha e diagonal conforme a origem esquerda/direita do ataque', () => {
    const fromLeft = canonicalStrategyOptions('attack', { attackOriginZ: -3 });
    const fromRight = canonicalStrategyOptions('attack', { attackOriginZ: 3 });
    const target = (options: typeof fromLeft, id: string) =>
      options.find((candidate) => candidate.optionId === id)!.center.z;

    expect(target(fromLeft, 'attack.placed-line')).toBeLessThan(0);
    expect(target(fromLeft, 'attack.placed-cross')).toBeGreaterThan(0);
    expect(target(fromRight, 'attack.placed-line')).toBeGreaterThan(0);
    expect(target(fromRight, 'attack.placed-cross')).toBeLessThan(0);
  });
});
