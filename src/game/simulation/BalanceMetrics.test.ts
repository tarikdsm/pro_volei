import { describe, expect, it } from 'vitest';
import { TeamSide } from '../../core/constants';
import {
  attackZoneIndex,
  buildBalanceReport,
  classifyPoint,
  median,
  percentile,
  type BalanceRallySample,
} from './BalanceMetrics';

const H = TeamSide.HOME;
const A = TeamSide.AWAY;

describe('classifyPoint', () => {
  const base = {
    cause: 'floor-in',
    ace: false,
    winner: H,
    lastTouchSide: H,
    lastKind: 'spike',
    touches: [],
  } as const;

  it('ace e cortada vencedora são decisivos', () => {
    expect(classifyPoint({ ...base, ace: true })).toBe('decisive');
    expect(classifyPoint({ ...base })).toBe('decisive');
    expect(classifyPoint({ ...base, lastKind: 'block' })).toBe('decisive');
  });

  it('saque na rede e bola de graça no chão rival são erro gratuito', () => {
    expect(
      classifyPoint({ ...base, cause: 'serve-net', lastTouchSide: A, lastKind: 'serve' }),
    ).toBe('unforced');
    expect(classifyPoint({ ...base, lastKind: 'freeball' })).toBe('unforced');
  });

  it('defesa sob ataque que erra é ponto forçado (decisivo)', () => {
    expect(
      classifyPoint({ ...base, cause: 'floor-out', winner: H, lastTouchSide: A, lastKind: 'dig' }),
    ).toBe('decisive');
    expect(
      classifyPoint({
        ...base,
        cause: 'floor-out',
        winner: H,
        lastTouchSide: A,
        lastKind: 'pass',
        touches: [
          { side: H, kind: 'serve' },
          { side: A, kind: 'pass' },
        ],
      }),
    ).toBe('decisive');
  });

  it('ataque para fora sem toque de bloqueio é erro gratuito; com toque é decisivo', () => {
    const rallyOut = {
      ...base,
      cause: 'floor-out',
      winner: H,
      lastTouchSide: A,
      lastKind: 'spike',
    } as const;
    expect(classifyPoint({ ...rallyOut, touches: [{ side: A, kind: 'spike' }] })).toBe('unforced');
    expect(
      classifyPoint({
        ...rallyOut,
        touches: [
          { side: A, kind: 'spike' },
          { side: H, kind: 'block-touch' },
        ],
      }),
    ).toBe('decisive');
  });

  it('saque direto para fora é erro gratuito', () => {
    expect(
      classifyPoint({
        ...base,
        cause: 'floor-out',
        winner: A,
        lastTouchSide: H,
        lastKind: 'serve',
      }),
    ).toBe('unforced');
  });
});

describe('attackZoneIndex', () => {
  it('classifica pela zona no referencial da atacante', () => {
    expect(attackZoneIndex(H, -3.0)).toBe(0);
    expect(attackZoneIndex(H, 0.4)).toBe(1);
    expect(attackZoneIndex(H, 2.9)).toBe(2);
    // AWAY olha para a rede do lado oposto: z mundial positivo é a esquerda dela.
    expect(attackZoneIndex(A, 3.0)).toBe(0);
    expect(attackZoneIndex(A, -3.0)).toBe(2);
  });
});

describe('median/percentile', () => {
  it('interpola linearmente', () => {
    expect(median([1, 3])).toBe(2);
    expect(median([1, 2, 3])).toBe(2);
    expect(percentile([10, 20, 30, 40], 0.9)).toBeCloseTo(37, 10);
    expect(() => percentile([], 0.5)).toThrow(RangeError);
    expect(() => percentile([1], 1.5)).toThrow(RangeError);
  });
});

describe('buildBalanceReport', () => {
  it('agrega mediana de contatos, share decisivo e shares de zona', () => {
    const zones = (h: [number, number, number], a: [number, number, number]) => [h, a] as const;
    const samples: BalanceRallySample[] = [
      { winner: H, contacts: 4, pointClass: 'decisive', attackZones: zones([1, 0, 0], [0, 1, 0]) },
      { winner: A, contacts: 6, pointClass: 'decisive', attackZones: zones([0, 1, 0], [1, 0, 0]) },
      { winner: H, contacts: 8, pointClass: 'unforced', attackZones: zones([0, 0, 1], [0, 0, 1]) },
      { winner: A, contacts: 2, pointClass: 'decisive', attackZones: zones([1, 0, 0], [0, 1, 0]) },
    ];
    const report = buildBalanceReport(samples);
    expect(report.rallies).toBe(4);
    expect(report.contactsMedian).toBe(5);
    expect(report.decisiveShare).toBe(0.75);
    // O único ponto unforced foi vencido pelo HOME ⇒ quem entregou de graça foi o AWAY.
    expect(report.unforcedBySide).toEqual([0, 1]);
    expect(report.zoneShares[0]).toEqual([0.5, 0.25, 0.25]);
    expect(report.maxZoneShare).toBe(0.5);
    expect(() => buildBalanceReport([])).toThrow(RangeError);
  });

  it('lado sem ataques tem shares zerados sem dividir por zero', () => {
    const report = buildBalanceReport([
      {
        winner: H,
        contacts: 1,
        pointClass: 'decisive',
        attackZones: [
          [0, 0, 0],
          [0, 0, 0],
        ],
      },
    ]);
    expect(report.zoneShares).toEqual([
      [0, 0, 0],
      [0, 0, 0],
    ]);
    expect(report.maxZoneShare).toBe(0);
  });
});
