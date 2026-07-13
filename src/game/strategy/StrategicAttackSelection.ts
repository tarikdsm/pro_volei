import { CONTACT, PLAYER, TeamSide } from '../../core/constants';
import { estimatePlanarArrivalTime } from '../control/kinematics';
import { canonicalStrategyOptions, strategyToLocal, strategyToWorld } from './CourtZones';
import { isCanonicalOwnContactRead, type OwnContactRead } from './OwnContactRead';
import type { StrategyPoint2 } from './StrategyTypes';
import type {
  FallbackAttackExecution,
  StrategicAttackFallbackReason,
} from './StrategicAttackTypes';

export const STRATEGIC_ATTACK_TUNING = Object.freeze({
  minimumLeadTicks: 19,
  deliveryPerfectRadius: 0.3,
  deliveryZeroRadius: 2.4,
} as const);

export interface AttackerEtaSelection {
  readonly athleteId: number;
  readonly arrivalIn: number;
  readonly distance: number;
}

export interface AttackerEtaInput {
  readonly read: OwnContactRead;
  readonly setterAthleteId: number;
  readonly target: StrategyPoint2;
  readonly availableIn: number;
  readonly preferredAthleteId?: number;
}

function canonicalNumber(value: number): number {
  return Object.is(value, -0) ? 0 : value;
}

function finitePoint(point: StrategyPoint2): boolean {
  return Number.isFinite(point.x) && Number.isFinite(point.z);
}

/** Seleciona uma atacante de rede pela cinemática executada, sem qualquer sorteio. */
export function selectAttackerByEta(input: AttackerEtaInput): AttackerEtaSelection | null {
  if (
    !isCanonicalOwnContactRead(input.read) ||
    !Number.isSafeInteger(input.setterAthleteId) ||
    input.setterAthleteId < 0 ||
    !finitePoint(input.target) ||
    !Number.isFinite(input.availableIn) ||
    input.availableIn < 0 ||
    (input.preferredAthleteId !== undefined &&
      (!Number.isSafeInteger(input.preferredAthleteId) || input.preferredAthleteId < 0))
  ) {
    return null;
  }
  const candidates = input.read.ownAthletes
    .filter(
      (athlete) =>
        athlete.row === 'front' && athlete.id !== input.setterAthleteId && !athlete.airborne,
    )
    .map((athlete) => {
      const dx = input.target.x - athlete.position.x;
      const dz = input.target.z - athlete.position.z;
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
    .filter((candidate) => candidate.arrivalIn <= input.availableIn + 1e-9)
    .sort(
      (left, right) =>
        Number(right.athleteId === input.preferredAthleteId) -
          Number(left.athleteId === input.preferredAthleteId) ||
        left.arrivalIn - right.arrivalIn ||
        left.distance - right.distance ||
        left.athleteId - right.athleteId,
    );
  const chosen = candidates[0];
  return chosen
    ? Object.freeze({
        athleteId: chosen.athleteId,
        arrivalIn: canonicalNumber(chosen.arrivalIn),
        distance: canonicalNumber(chosen.distance),
      })
    : null;
}

export function fallbackPlacedSeam(
  side: TeamSide,
  attackOriginZ: number,
  reason: StrategicAttackFallbackReason,
): FallbackAttackExecution {
  const localOrigin = strategyToLocal({ x: 0, z: attackOriginZ }, side).z;
  const seam = canonicalStrategyOptions('attack', { attackOriginZ: localOrigin }).find(
    (option) => option.optionId === 'attack.placed-seam',
  );
  if (!seam) throw new Error('zona placed-seam ausente');
  const target = strategyToWorld(seam.center, side);
  return Object.freeze({
    mode: 'fallback-placed-seam' as const,
    reason,
    optionId: 'attack.placed-seam' as const,
    family: 'placed' as const,
    target: Object.freeze({
      x: canonicalNumber(target.x),
      z: canonicalNumber(target.z),
    }),
  });
}

/** Qualidade observável do set: erro entre target comprometido e origem física da cortada. */
export function setDeliveryEffectiveness(
  plannedTarget: StrategyPoint2,
  executedOrigin: StrategyPoint2,
): number {
  if (!finitePoint(plannedTarget) || !finitePoint(executedOrigin)) {
    throw new RangeError('pontos da entrega devem ser finitos');
  }
  const error = Math.hypot(plannedTarget.x - executedOrigin.x, plannedTarget.z - executedOrigin.z);
  const span =
    STRATEGIC_ATTACK_TUNING.deliveryZeroRadius - STRATEGIC_ATTACK_TUNING.deliveryPerfectRadius;
  return canonicalNumber(
    Math.max(0, Math.min(1, 1 - (error - STRATEGIC_ATTACK_TUNING.deliveryPerfectRadius) / span)),
  );
}
