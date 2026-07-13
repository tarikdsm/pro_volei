import { TeamSide } from '../../core/constants';
import type {
  StrategyObservation,
  StrategyPhase,
  StrategyPoint2,
  StrategyPoint3,
} from './StrategyTypes';

// Marca de origem não forjável: somente o builder deste módulo consegue registrar um DTO.
const CANONICAL_OBSERVATIONS = new WeakSet<object>();
const PACKED_OBSERVATIONS = new WeakSet<object>();
const PACKED_VALUES = new WeakMap<object, readonly number[]>();

const PACKED_BALL_OFFSET = 2;
const PACKED_ATHLETES_OFFSET = 8;
const PACKED_ATHLETE_WIDTH = 8;
const ROSTER_IDENTITY_WIDTH = 3;

export function isCanonicalStrategyObservation(
  observation: unknown,
): observation is StrategyObservation {
  return (
    typeof observation === 'object' &&
    observation !== null &&
    CANONICAL_OBSERVATIONS.has(observation)
  );
}

export interface PackedStrategyObservation {
  readonly tick: number;
  readonly phase: StrategyPhase;
  readonly possessionSide: TeamSide | null;
  readonly servingSide: TeamSide;
  readonly possessionTouches: number;
  readonly inFlight: boolean;
  readonly lastVisibleContactTick: number | null;
}

export function isPackedStrategyObservation(
  observation: unknown,
): observation is PackedStrategyObservation {
  return (
    typeof observation === 'object' && observation !== null && PACKED_OBSERVATIONS.has(observation)
  );
}

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

/**
 * Captura compacta por valor para o ring de 60 Hz. Mantém validação defensiva sem materializar
 * dezenas de objetos congelados que só serão públicos quando uma decisão realmente perceber o tick.
 */
export function packStrategyObservation(
  source: StrategyObservationSource,
): PackedStrategyObservation {
  return packStrategyObservationWithRoster(source, null).packed;
}

/** Reaproveita somente a validação estrutural de um roster idêntico já aprovado. */
export class StrategyObservationPacker {
  private roster: readonly number[] | null = null;

  pack(source: StrategyObservationSource): PackedStrategyObservation {
    const result = packStrategyObservationWithRoster(source, this.roster);
    this.roster = result.roster;
    return result.packed;
  }
}

function packStrategyObservationWithRoster(
  source: StrategyObservationSource,
  cachedRoster: readonly number[] | null,
): Readonly<{ packed: PackedStrategyObservation; roster: readonly number[] }> {
  const tick = safeNonNegativeInteger(source.tick, 'tick');
  if (source.score.length !== 2) throw new RangeError('score exige dois lados');
  const scoreHome = safeNonNegativeInteger(source.score[0], 'score HOME');
  const scoreAway = safeNonNegativeInteger(source.score[1], 'score AWAY');
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
  const rosterMatches = matchesRoster(source.athletes, cachedRoster);
  const newRoster = rosterMatches
    ? null
    : new Array<number>(source.athletes.length * ROSTER_IDENTITY_WIDTH);
  const roster = rosterMatches ? cachedRoster! : newRoster!;

  const values = new Array<number>(PACKED_ATHLETES_OFFSET + 12 * PACKED_ATHLETE_WIDTH);
  values[0] = scoreHome;
  values[1] = scoreAway;
  values[PACKED_BALL_OFFSET] = finite(source.ball.position.x, 'ball.position.x');
  values[PACKED_BALL_OFFSET + 1] = finite(source.ball.position.y, 'ball.position.y');
  values[PACKED_BALL_OFFSET + 2] = finite(source.ball.position.z, 'ball.position.z');
  values[PACKED_BALL_OFFSET + 3] = finite(source.ball.velocity.x, 'ball.velocity.x');
  values[PACKED_BALL_OFFSET + 4] = finite(source.ball.velocity.y, 'ball.velocity.y');
  values[PACKED_BALL_OFFSET + 5] = finite(source.ball.velocity.z, 'ball.velocity.z');

  const ids = rosterMatches ? null : [new Set<number>(), new Set<number>()];
  const slotMasks = [0, 0];
  const sideCounts = [0, 0];
  for (let index = 0; index < source.athletes.length; index++) {
    const athlete = source.athletes[index];
    let id = athlete.id;
    if (!rosterMatches) {
      if (!validSide(athlete.side)) throw new RangeError('lado de atleta inválido');
      id = safeNonNegativeInteger(athlete.id, 'id de atleta');
      if (!Number.isInteger(athlete.slot) || athlete.slot < 0 || athlete.slot > 5) {
        throw new RangeError('slot de atleta deve estar em [0,5]');
      }
      if (ids![athlete.side].has(id)) {
        throw new RangeError(`identidade duplicada: ${athlete.side}:${id}`);
      }
      const slotBit = 1 << athlete.slot;
      if ((slotMasks[athlete.side] & slotBit) !== 0) {
        throw new RangeError(`slot duplicado no lado ${athlete.side}: ${athlete.slot}`);
      }
      ids![athlete.side].add(id);
      slotMasks[athlete.side] |= slotBit;
      sideCounts[athlete.side]++;
      const rosterOffset = index * ROSTER_IDENTITY_WIDTH;
      newRoster![rosterOffset] = athlete.side;
      newRoster![rosterOffset + 1] = id;
      newRoster![rosterOffset + 2] = athlete.slot;
    }
    if (typeof athlete.airborne !== 'boolean') {
      throw new RangeError('airborne deve ser booleano');
    }

    const offset = PACKED_ATHLETES_OFFSET + index * PACKED_ATHLETE_WIDTH;
    values[offset] = athlete.side;
    values[offset + 1] = id;
    values[offset + 2] = canonicalNumber(athlete.slot);
    values[offset + 3] = finite(athlete.position.x, `athlete.position.x`);
    values[offset + 4] = finite(athlete.position.z, `athlete.position.z`);
    values[offset + 5] = finite(athlete.velocity.x, `athlete.velocity.x`);
    values[offset + 6] = finite(athlete.velocity.z, `athlete.velocity.z`);
    values[offset + 7] = athlete.airborne ? 1 : 0;
  }
  if (
    !rosterMatches &&
    (sideCounts[TeamSide.HOME] !== 6 ||
      sideCounts[TeamSide.AWAY] !== 6 ||
      slotMasks[TeamSide.HOME] !== 0b11_1111 ||
      slotMasks[TeamSide.AWAY] !== 0b11_1111)
  ) {
    throw new RangeError('observação exige seis atletas e seis slots por lado');
  }
  const packed = Object.freeze({
    tick,
    phase: source.phase,
    possessionSide: source.possessionSide,
    servingSide: source.servingSide,
    possessionTouches: canonicalNumber(source.possessionTouches),
    inFlight: source.ball.inFlight,
    lastVisibleContactTick:
      lastVisibleContactTick === null ? null : canonicalNumber(lastVisibleContactTick),
  });
  PACKED_OBSERVATIONS.add(packed);
  PACKED_VALUES.set(packed, values);
  return { packed, roster };
}

function matchesRoster(
  athletes: readonly StrategyObservationAthleteSource[],
  roster: readonly number[] | null,
): boolean {
  if (!roster || roster.length !== athletes.length * ROSTER_IDENTITY_WIDTH) return false;
  for (let index = 0; index < athletes.length; index++) {
    const athlete = athletes[index];
    const offset = index * ROSTER_IDENTITY_WIDTH;
    if (
      athlete.side !== roster[offset] ||
      athlete.id !== roster[offset + 1] ||
      athlete.slot !== roster[offset + 2]
    ) {
      return false;
    }
  }
  return true;
}

/** Materializa um DTO público canônico a partir de uma captura compacta autenticada. */
export function materializePackedStrategyObservation(
  packed: PackedStrategyObservation,
): StrategyObservation {
  if (!isPackedStrategyObservation(packed)) {
    throw new RangeError('observação compacta não é canônica');
  }
  const values = PACKED_VALUES.get(packed);
  if (!values) throw new RangeError('payload da observação compacta está ausente');
  const athletes = Array.from({ length: 12 }, (_, index) => {
    const offset = PACKED_ATHLETES_OFFSET + index * PACKED_ATHLETE_WIDTH;
    const slot = values[offset + 2];
    return Object.freeze({
      side: values[offset] as TeamSide,
      id: values[offset + 1],
      slot,
      row: slot <= 2 ? ('back' as const) : ('front' as const),
      position: Object.freeze({ x: values[offset + 3], z: values[offset + 4] }),
      velocity: Object.freeze({ x: values[offset + 5], z: values[offset + 6] }),
      airborne: values[offset + 7] === 1,
    });
  });
  const observation = Object.freeze({
    tick: packed.tick,
    score: Object.freeze([values[0], values[1]]) as readonly [number, number],
    phase: packed.phase,
    possessionSide: packed.possessionSide,
    servingSide: packed.servingSide,
    possessionTouches: packed.possessionTouches,
    ball: Object.freeze({
      position: Object.freeze({
        x: values[PACKED_BALL_OFFSET],
        y: values[PACKED_BALL_OFFSET + 1],
        z: values[PACKED_BALL_OFFSET + 2],
      }),
      velocity: Object.freeze({
        x: values[PACKED_BALL_OFFSET + 3],
        y: values[PACKED_BALL_OFFSET + 4],
        z: values[PACKED_BALL_OFFSET + 5],
      }),
      inFlight: packed.inFlight,
      lastVisibleContactTick: packed.lastVisibleContactTick,
    }),
    athletes: Object.freeze(athletes),
  });
  CANONICAL_OBSERVATIONS.add(observation);
  return observation;
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

  const observation = Object.freeze({
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
  CANONICAL_OBSERVATIONS.add(observation);
  return observation;
}
