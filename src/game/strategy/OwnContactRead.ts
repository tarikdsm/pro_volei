import { CONTACT, COURT, GRAVITY, PLAYER, TeamSide, sideSign } from '../../core/constants';
import { estimatePlanarArrivalTime } from '../control/kinematics';
import type { AthleteStrategySnapshot, StrategyPoint2, StrategyPoint3 } from './StrategyTypes';

const CANONICAL_OWN_CONTACT_READS = new WeakSet<object>();

export type OwnContactKind = 'pass' | 'dig' | 'set';

export interface PossessionRef {
  readonly matchEpoch: number;
  readonly rallyEpoch: number;
  readonly possessionEpoch: number;
  readonly contactSequence: number;
  readonly side: TeamSide;
}

export interface OwnContactBallSource {
  readonly position: StrategyPoint3;
  readonly velocity: StrategyPoint3;
  readonly inFlight: boolean;
}

export interface OwnContactReadSource {
  readonly tick: number;
  readonly side: TeamSide;
  readonly kind: OwnContactKind;
  readonly athleteId: number;
  readonly ballAfter: OwnContactBallSource;
  readonly ownAthletes: readonly AthleteStrategySnapshot[];
}

export interface OwnContactRead {
  readonly tick: number;
  readonly side: TeamSide;
  readonly kind: OwnContactKind;
  readonly athleteId: number;
  readonly ballAfter: Readonly<OwnContactBallSource>;
  readonly ownAthletes: readonly AthleteStrategySnapshot[];
}

export interface SetterEtaSelection {
  readonly athleteId: number;
  readonly contactIn: number;
  readonly arrivalIn: number;
  readonly target: StrategyPoint2;
}

export interface ExecutedSetAttackOrigin {
  readonly contactIn: number;
  readonly position: StrategyPoint2;
}

export function isCanonicalOwnContactRead(read: unknown): read is OwnContactRead {
  return typeof read === 'object' && read !== null && CANONICAL_OWN_CONTACT_READS.has(read);
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

function validSide(side: unknown): side is TeamSide {
  return side === TeamSide.HOME || side === TeamSide.AWAY;
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

/** Constrói a leitura própria imediata sem carregar objetos mutáveis do runtime. */
export function buildOwnContactRead(source: OwnContactReadSource): OwnContactRead {
  const tick = safeNonNegativeInteger(source.tick, 'tick');
  if (!validSide(source.side)) throw new RangeError('lado do contato inválido');
  if (source.kind !== 'pass' && source.kind !== 'dig' && source.kind !== 'set') {
    throw new RangeError('kind do contato próprio inválido');
  }
  const athleteId = safeNonNegativeInteger(source.athleteId, 'atleta do contato');
  if (typeof source.ballAfter.inFlight !== 'boolean') {
    throw new RangeError('ballAfter.inFlight deve ser booleano');
  }
  if (source.ownAthletes.length !== 6) {
    throw new RangeError('leitura própria exige seis atletas');
  }

  const ids = new Set<number>();
  const slots = new Set<number>();
  const ownAthletes = source.ownAthletes.map((athlete) => {
    if (athlete.side !== source.side) throw new RangeError('atleta próprio com lado inválido');
    const id = safeNonNegativeInteger(athlete.id, 'id de atleta');
    if (!Number.isInteger(athlete.slot) || athlete.slot < 0 || athlete.slot > 5) {
      throw new RangeError('slot de atleta deve estar em [0,5]');
    }
    if (ids.has(id)) throw new RangeError(`identidade duplicada: ${id}`);
    if (slots.has(athlete.slot)) throw new RangeError(`slot duplicado: ${athlete.slot}`);
    const row = athlete.slot <= 2 ? ('back' as const) : ('front' as const);
    if (athlete.row !== row) throw new RangeError(`row incompatível com slot ${athlete.slot}`);
    if (typeof athlete.airborne !== 'boolean') throw new RangeError('airborne deve ser booleano');
    ids.add(id);
    slots.add(athlete.slot);
    return Object.freeze({
      side: source.side,
      id,
      slot: canonicalNumber(athlete.slot),
      row,
      position: point2(athlete.position, `athlete ${id}.position`),
      velocity: point2(athlete.velocity, `athlete ${id}.velocity`),
      airborne: athlete.airborne,
    });
  });
  if (!ids.has(athleteId)) throw new RangeError('atleta do contato ausente no roster próprio');

  const read = Object.freeze({
    tick,
    side: source.side,
    kind: source.kind,
    athleteId,
    ballAfter: Object.freeze({
      position: point3(source.ballAfter.position, 'ballAfter.position'),
      velocity: point3(source.ballAfter.velocity, 'ballAfter.velocity'),
      inFlight: source.ballAfter.inFlight,
    }),
    ownAthletes: Object.freeze(ownAthletes),
  });
  CANONICAL_OWN_CONTACT_READS.add(read);
  return read;
}

function descendingContactTime(read: OwnContactRead, height: number): number {
  const { position, velocity } = read.ballAfter;
  const a = 0.5 * GRAVITY;
  const b = velocity.y;
  const c = position.y - height;
  const discriminant = b * b - 4 * a * c;
  if (discriminant < 0) return -1;
  const time = (-b - Math.sqrt(discriminant)) / (2 * a);
  return time > 0 ? time : -1;
}

function contactPosition(read: OwnContactRead, contactIn: number): StrategyPoint2 {
  return Object.freeze({
    x: canonicalNumber(read.ballAfter.position.x + read.ballAfter.velocity.x * contactIn),
    z: canonicalNumber(read.ballAfter.position.z + read.ballAfter.velocity.z * contactIn),
  });
}

function isOwnCourtPosition(side: TeamSide, position: StrategyPoint2): boolean {
  const depth = position.x * sideSign(side);
  return depth >= 0 && depth <= COURT.halfLength && Math.abs(position.z) <= COURT.halfWidth;
}

/** Escolhe a levantadora legal por ETA à trajetória já executada, sem qualquer sorteio. */
export function selectSetterByEta(read: OwnContactRead): SetterEtaSelection | null {
  if (!read.ballAfter.inFlight) return null;
  const contactIn = descendingContactTime(read, CONTACT.set);
  if (!Number.isFinite(contactIn) || contactIn <= 0) return null;
  const target = contactPosition(read, contactIn);
  if (!isOwnCourtPosition(read.side, target)) return null;

  const candidates = read.ownAthletes
    .filter((athlete) => athlete.id !== read.athleteId && !athlete.airborne)
    .map((athlete) => {
      const dx = target.x - athlete.position.x;
      const dz = target.z - athlete.position.z;
      const distance = Math.hypot(dx, dz);
      const directionX = distance > 1e-9 ? dx / distance : 1;
      const directionZ = distance > 1e-9 ? dz / distance : 0;
      const projectedVelocity = athlete.velocity.x * directionX + athlete.velocity.z * directionZ;
      const lateralVelocity = -athlete.velocity.x * directionZ + athlete.velocity.z * directionX;
      const arrivalIn = estimatePlanarArrivalTime(
        distance,
        projectedVelocity,
        lateralVelocity,
        PLAYER.aiSpeed,
        PLAYER.acceleration,
        PLAYER.deceleration,
        CONTACT.reach,
      );
      return { athleteId: athlete.id, arrivalIn, distance };
    })
    .filter((candidate) => candidate.arrivalIn <= contactIn)
    .sort(
      (left, right) =>
        left.arrivalIn - right.arrivalIn ||
        left.distance - right.distance ||
        left.athleteId - right.athleteId,
    );
  const chosen = candidates[0];
  if (!chosen) return null;
  return Object.freeze({
    athleteId: chosen.athleteId,
    contactIn: canonicalNumber(contactIn),
    arrivalIn: canonicalNumber(chosen.arrivalIn),
    target,
  });
}

/** Deriva a origem do ataque do voo já executado pelo levantamento, nunca de um target externo. */
export function deriveAttackOriginFromExecutedSet(
  read: OwnContactRead,
): ExecutedSetAttackOrigin | null {
  if (read.kind !== 'set' || !read.ballAfter.inFlight) return null;
  const contactIn = descendingContactTime(read, CONTACT.spike);
  if (!Number.isFinite(contactIn) || contactIn <= 0) return null;
  const position = contactPosition(read, contactIn);
  if (!isOwnCourtPosition(read.side, position)) return null;
  return Object.freeze({ contactIn: canonicalNumber(contactIn), position });
}
