import { BALL_RADIUS, CONTACT, GRAVITY } from '../../core/constants';

export interface ServeReceptionPoint2 {
  readonly x: number;
  readonly z: number;
}

export interface ServeReceptionPoint3 extends ServeReceptionPoint2 {
  readonly y: number;
}

export interface ServeReceptionBallAfter {
  readonly position: ServeReceptionPoint3;
  readonly velocity: ServeReceptionPoint3;
  readonly inFlight: boolean;
}

export interface ServeReceptionOutcomeInput {
  readonly ballAfter: ServeReceptionBallAfter;
  readonly setterPosition: ServeReceptionPoint2;
}

export const SERVE_RECEPTION_OUTCOME_TUNING = Object.freeze({
  weights: Object.freeze({ position: 0.55, height: 0.3, timing: 0.15 }),
  timing: Object.freeze({ min: 0.18, ideal: 0.65, max: 1.35 }),
  miss: Object.freeze({ good: 0.12, bad: 2.25 }),
  height: Object.freeze({ good: 0.08, bad: 1.1 }),
  planarSpeedEpsilon: 0.05,
});

function finite(value: number, label: string): void {
  if (!Number.isFinite(value)) throw new RangeError(`${label} deve ser finito`);
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function penalty(value: number, good: number, bad: number): number {
  return clamp01((value - good) / (bad - good));
}

function descendingFloorContactTime(positionY: number, velocityY: number): number {
  if (positionY < BALL_RADIUS) return 0;
  const discriminant = velocityY * velocityY - 2 * GRAVITY * (positionY - BALL_RADIUS);
  if (discriminant < 0) return Number.POSITIVE_INFINITY;
  const time = (-velocityY - Math.sqrt(discriminant)) / GRAVITY;
  return time >= 0 ? time : 0;
}

export function serveReceptionEffectiveness(input: ServeReceptionOutcomeInput): number {
  const { position, velocity, inFlight } = input.ballAfter;
  const setter = input.setterPosition;
  finite(position.x, 'ballAfter.position.x');
  finite(position.y, 'ballAfter.position.y');
  finite(position.z, 'ballAfter.position.z');
  finite(velocity.x, 'ballAfter.velocity.x');
  finite(velocity.y, 'ballAfter.velocity.y');
  finite(velocity.z, 'ballAfter.velocity.z');
  finite(setter.x, 'setterPosition.x');
  finite(setter.z, 'setterPosition.z');
  if (typeof inFlight !== 'boolean') throw new RangeError('inFlight deve ser booleano');

  if (!inFlight) return 1;

  const mirror = setter.x > 0 ? -1 : 1;
  const px = position.x * mirror;
  const pz = position.z * mirror;
  const vx = velocity.x * mirror;
  const vz = velocity.z * mirror;
  const sx = setter.x * mirror;
  const sz = setter.z * mirror;
  const dx = sx - px;
  const dz = sz - pz;
  const planarSpeed2 = vx * vx + vz * vz;
  const epsilon2 =
    SERVE_RECEPTION_OUTCOME_TUNING.planarSpeedEpsilon *
    SERVE_RECEPTION_OUTCOME_TUNING.planarSpeedEpsilon;
  if (planarSpeed2 <= epsilon2) return 1;

  const approach = dx * vx + dz * vz;
  if (approach <= 0) return 1;
  const time = approach / planarSpeed2;
  const timing = SERVE_RECEPTION_OUTCOME_TUNING.timing;
  if (time < timing.min || time > timing.max) return 1;
  if (descendingFloorContactTime(position.y, velocity.y) <= time) return 1;

  const projectedX = px + vx * time;
  const projectedZ = pz + vz * time;
  const miss = Math.hypot(projectedX - sx, projectedZ - sz);
  const projectedHeight = position.y + velocity.y * time + 0.5 * GRAVITY * time * time;
  const heightMiss = Math.abs(projectedHeight - CONTACT.set);
  const timingSpan = time < timing.ideal ? timing.ideal - timing.min : timing.max - timing.ideal;
  const timingMiss = Math.abs(time - timing.ideal) / timingSpan;
  const weights = SERVE_RECEPTION_OUTCOME_TUNING.weights;
  return clamp01(
    weights.position *
      penalty(
        miss,
        SERVE_RECEPTION_OUTCOME_TUNING.miss.good,
        SERVE_RECEPTION_OUTCOME_TUNING.miss.bad,
      ) +
      weights.height *
        penalty(
          heightMiss,
          SERVE_RECEPTION_OUTCOME_TUNING.height.good,
          SERVE_RECEPTION_OUTCOME_TUNING.height.bad,
        ) +
      weights.timing * clamp01(timingMiss),
  );
}
