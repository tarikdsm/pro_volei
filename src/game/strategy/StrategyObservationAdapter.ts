import { TeamSide } from '../../core/constants';
import type {
  StrategyObservation,
  StrategyPhase,
  StrategyPoint2,
  StrategyPoint3,
} from './StrategyTypes';

export interface StrategyObservationAthleteSource {
  readonly side: TeamSide;
  readonly id: number;
  readonly slot: number;
  readonly position: StrategyPoint2;
  readonly velocity: StrategyPoint2;
  readonly airborne: boolean;
}

export interface StrategyObservationBallSource {
  readonly position: StrategyPoint3;
  readonly velocity: StrategyPoint3;
  readonly inFlight: boolean;
  readonly lastVisibleContactTick: number | null;
}

export interface StrategyObservationSource {
  readonly tick: number;
  readonly score: readonly [number, number];
  readonly phase: StrategyPhase;
  readonly possessionSide: TeamSide | null;
  readonly servingSide: TeamSide;
  readonly possessionTouches: number;
  readonly ball: StrategyObservationBallSource;
  readonly athletes: readonly StrategyObservationAthleteSource[];
}

const PHASES = new Set<StrategyPhase>([
  'idle',
  'serve-prep',
  'rally',
  'point',
  'set-end',
  'match-end',
]);

function validSide(side: unknown): side is TeamSide {
  return side === TeamSide.HOME || side === TeamSide.AWAY;
}

function canonicalNumber(value: number): number {
  return Object.is(value, -0) ? 0 : value;
}

function finite(value: number, label: string): number {
  if (!Number.isFinite(value)) throw new RangeError(`${label} deve ser finito`);
  return canonicalNumber(value);
}

function safeNonNegativeInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${label} deve ser inteiro seguro não negativo`);
  }
  return canonicalNumber(value);
}

function point2(source: StrategyPoint2, label: string): StrategyPoint2 {
  return Object.freeze({ x: finite(source.x, `${label}.x`), z: finite(source.z, `${label}.z`) });
}

function point3(source: StrategyPoint3, label: string): StrategyPoint3 {
  return Object.freeze({
    x: finite(source.x, `${label}.x`),
    y: finite(source.y, `${label}.y`),
    z: finite(source.z, `${label}.z`),
  });
}

export function buildStrategyObservation(source: StrategyObservationSource): StrategyObservation {
  const tick = safeNonNegativeInteger(source.tick, 'tick');
  if (source.score.length !== 2) throw new RangeError('score exige dois lados');
  const score = Object.freeze([
    safeNonNegativeInteger(source.score[0], 'score HOME'),
    safeNonNegativeInteger(source.score[1], 'score AWAY'),
  ]) as readonly [number, number];
  if (!PHASES.has(source.phase)) throw new RangeError('phase inválida');
  if (source.possessionSide !== null && !validSide(source.possessionSide)) {
    throw new RangeError('possessionSide inválido');
  }
  if (!validSide(source.servingSide)) throw new RangeError('servingSide inválido');
  if (
    !Number.isInteger(source.possessionTouches) ||
    source.possessionTouches < 0 ||
    source.possessionTouches > 3
  ) {
    throw new RangeError('possessionTouches deve estar em [0,3]');
  }
  if (typeof source.ball.inFlight !== 'boolean') {
    throw new RangeError('ball.inFlight deve ser booleano');
  }
  const lastVisibleContactTick = source.ball.lastVisibleContactTick;
  if (
    lastVisibleContactTick !== null &&
    (!Number.isSafeInteger(lastVisibleContactTick) ||
      lastVisibleContactTick < 0 ||
      lastVisibleContactTick > tick)
  ) {
    throw new RangeError('lastVisibleContactTick inválido');
  }
  if (source.athletes.length !== 12) throw new RangeError('observação exige 12 atletas');

  const identities = new Set<string>();
  const slots = [new Set<number>(), new Set<number>()];
  const sideCounts = [0, 0];
  const athletes = source.athletes.map((athlete) => {
    if (!validSide(athlete.side)) throw new RangeError('lado de atleta inválido');
    const id = safeNonNegativeInteger(athlete.id, 'id de atleta');
    if (!Number.isInteger(athlete.slot) || athlete.slot < 0 || athlete.slot > 5) {
      throw new RangeError('slot de atleta deve estar em [0,5]');
    }
    if (typeof athlete.airborne !== 'boolean') throw new RangeError('airborne deve ser booleano');
    const identity = `${athlete.side}:${id}`;
    if (identities.has(identity)) throw new RangeError(`identidade duplicada: ${identity}`);
    if (slots[athlete.side].has(athlete.slot)) {
      throw new RangeError(`slot duplicado no lado ${athlete.side}: ${athlete.slot}`);
    }
    identities.add(identity);
    slots[athlete.side].add(athlete.slot);
    sideCounts[athlete.side]++;
    return Object.freeze({
      side: athlete.side,
      id,
      slot: athlete.slot,
      row: athlete.slot <= 2 ? ('back' as const) : ('front' as const),
      position: point2(athlete.position, `athlete ${identity}.position`),
      velocity: point2(athlete.velocity, `athlete ${identity}.velocity`),
      airborne: athlete.airborne,
    });
  });
  if (
    sideCounts[TeamSide.HOME] !== 6 ||
    sideCounts[TeamSide.AWAY] !== 6 ||
    slots.some((sideSlots) => sideSlots.size !== 6)
  ) {
    throw new RangeError('observação exige seis atletas e seis slots por lado');
  }

  return Object.freeze({
    tick,
    score,
    phase: source.phase,
    possessionSide: source.possessionSide,
    servingSide: source.servingSide,
    possessionTouches: canonicalNumber(source.possessionTouches),
    ball: Object.freeze({
      position: point3(source.ball.position, 'ball.position'),
      velocity: point3(source.ball.velocity, 'ball.velocity'),
      inFlight: source.ball.inFlight,
      lastVisibleContactTick:
        lastVisibleContactTick === null ? null : canonicalNumber(lastVisibleContactTick),
    }),
    athletes: Object.freeze(athletes),
  });
}
