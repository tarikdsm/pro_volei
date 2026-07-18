// Métricas puras de balanceamento (Fase 3D): classificação de ponto, zonas de ataque e
// agregados estatísticos das metas do §4.3 do design 2.0. Sem estado; não importa o runner.
import { ATTACK_ZONES, TeamSide, otherSide, type TouchKind } from '../../core/constants';
import type { PointCause } from './SimulationTelemetry';

export type PointClass = 'decisive' | 'unforced';

export interface RallyTouch {
  readonly side: TeamSide;
  readonly kind: TouchKind | 'block-touch';
}

export interface PointClassificationInput {
  readonly cause: PointCause;
  readonly ace: boolean;
  readonly winner: TeamSide;
  readonly lastTouchSide: TeamSide | null;
  readonly lastKind: TouchKind | null;
  /** Contatos + toques de bloqueio do rally, em ordem de tick. */
  readonly touches: readonly RallyTouch[];
}

/**
 * Ponto "decisive" = decidido por ataque, bloqueio ou defesa forçada; "unforced" = erro
 * gratuito (meta: ≥65% decisivos). Determinístico a partir da telemetria do rally.
 */
export function classifyPoint(input: PointClassificationInput): PointClass {
  const { cause, ace, winner, lastTouchSide, lastKind, touches } = input;
  if (ace) return 'decisive';
  if (cause === 'serve-net' || cause === 'other') return 'unforced';
  if (lastTouchSide === winner) {
    // Bola do vencedor decidiu o rally: cortada/bloqueio fecham por decisão ofensiva.
    return lastKind === 'spike' || lastKind === 'block' ? 'decisive' : 'unforced';
  }
  // Erro do lado perdedor: forçado quando o toque errado foi defesa sob ataque,
  // recepção estourada por saque/cortada, ou cortada desviada pelo bloqueio rival.
  if (lastKind === 'dig' || lastKind === 'block') return 'decisive';
  if (lastKind === 'pass' && lastTouchSide !== null) {
    const prior = [...touches].reverse().find((touch) => touch.side !== lastTouchSide);
    if (prior && (prior.kind === 'serve' || prior.kind === 'spike')) return 'decisive';
  }
  if (lastKind === 'spike' && lastTouchSide !== null) {
    const last = touches.at(-1);
    if (last && last.kind === 'block-touch' && last.side !== lastTouchSide) return 'decisive';
  }
  return 'unforced';
}

/**
 * Corredor (0 = esquerda, 1 = centro, 2 = direita) de uma coordenada z no referencial do lado
 * indicado. Usado com o lado que DEFENDE para classificar a zona que recebe o ataque (§4.3).
 */
export function attackZoneIndex(side: TeamSide, contactZ: number): 0 | 1 | 2 {
  const localZ = side === TeamSide.HOME ? contactZ : -contactZ;
  const half = (ATTACK_ZONES[2] - ATTACK_ZONES[1]) / 2;
  return localZ < -half ? 0 : localZ > half ? 2 : 1;
}

/** Percentil p ∈ [0,1] com interpolação linear entre vizinhos; lança em lista vazia. */
export function percentile(values: readonly number[], p: number): number {
  if (values.length === 0) throw new RangeError('percentile exige pelo menos um valor');
  if (!(p >= 0 && p <= 1)) throw new RangeError('p deve estar em [0,1]');
  const sorted = [...values].sort((left, right) => left - right);
  const rank = p * (sorted.length - 1);
  const lo = Math.floor(rank);
  const hi = Math.ceil(rank);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (rank - lo);
}

/** Mediana (percentil 0,5). */
export function median(values: readonly number[]): number {
  return percentile(values, 0.5);
}

export interface BalanceRallySample {
  readonly winner: TeamSide;
  readonly contacts: number;
  readonly pointClass: PointClass;
  /** Contagem de ataques por zona [esq, centro, dir], indexada por lado [HOME, AWAY]. */
  readonly attackZones: readonly (readonly [number, number, number])[];
}

export interface BalanceReport {
  readonly rallies: number;
  readonly contactsMedian: number;
  readonly decisiveShare: number;
  /** Pontos entregues de graça por cada lado (erro unforced do lado perdedor). */
  readonly unforcedBySide: readonly [number, number];
  readonly zoneShares: readonly (readonly [number, number, number])[];
  readonly maxZoneShare: number;
}

/** Consolida amostras (uma por ponto) nas metas mensuráveis do §4.3. */
export function buildBalanceReport(samples: readonly BalanceRallySample[]): BalanceReport {
  if (samples.length === 0) throw new RangeError('buildBalanceReport exige pelo menos um rally');
  const zoneTotals: [number, number, number][] = [
    [0, 0, 0],
    [0, 0, 0],
  ];
  const unforced: [number, number] = [0, 0];
  let decisive = 0;
  for (const sample of samples) {
    if (sample.pointClass === 'decisive') decisive += 1;
    else unforced[otherSide(sample.winner)] += 1;
    for (const side of [TeamSide.HOME, TeamSide.AWAY]) {
      for (let zone = 0; zone < 3; zone += 1) {
        zoneTotals[side][zone] += sample.attackZones[side][zone];
      }
    }
  }
  const zoneShares = zoneTotals.map((zones) => {
    const total = zones[0] + zones[1] + zones[2];
    return total === 0
      ? ([0, 0, 0] as const)
      : ([zones[0] / total, zones[1] / total, zones[2] / total] as const);
  });
  return Object.freeze({
    rallies: samples.length,
    contactsMedian: median(samples.map((sample) => sample.contacts)),
    decisiveShare: decisive / samples.length,
    unforcedBySide: Object.freeze(unforced) as unknown as readonly [number, number],
    zoneShares: Object.freeze(zoneShares),
    maxZoneShare: Math.max(...zoneShares.flat()),
  });
}
