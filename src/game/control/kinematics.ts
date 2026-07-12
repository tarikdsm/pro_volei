export interface PlanarVector {
  x: number;
  z: number;
}

const EPSILON = 1e-9;

function vectorSpeed(vector: Readonly<PlanarVector>): number {
  return Math.hypot(vector.x, vector.z);
}

export function advancePlanarMotion(
  position: PlanarVector,
  velocity: PlanarVector,
  target: Readonly<PlanarVector>,
  dt: number,
  maxSpeed: number,
  acceleration: number,
  deceleration: number,
  stopRadius = 0.06,
): number {
  if (dt <= 0 || !Number.isFinite(dt)) return vectorSpeed(velocity);

  const deltaX = target.x - position.x;
  const deltaZ = target.z - position.z;
  const distance = Math.hypot(deltaX, deltaZ);
  const radius = Math.max(0, stopRadius);
  if (distance <= radius || maxSpeed <= 0) {
    velocity.x = 0;
    velocity.z = 0;
    return 0;
  }

  const directionX = deltaX / distance;
  const directionZ = deltaZ / distance;
  const speedLimit = Math.max(0, maxSpeed);
  const braking = Math.max(0, deceleration);
  const desiredSpeed = Math.min(
    speedLimit,
    braking > 0 ? Math.sqrt(2 * braking * Math.max(0, distance - radius)) : speedLimit,
  );
  const desiredX = directionX * desiredSpeed;
  const desiredZ = directionZ * desiredSpeed;
  const changeX = desiredX - velocity.x;
  const changeZ = desiredZ - velocity.z;
  const changeLength = Math.hypot(changeX, changeZ);
  const currentSpeed = vectorSpeed(velocity);
  const projectedVelocity = velocity.x * directionX + velocity.z * directionZ;
  const slowing = projectedVelocity < 0 || desiredSpeed < currentSpeed;
  const rate = Math.max(0, slowing ? deceleration : acceleration);
  const maxChange = rate * dt;

  if (changeLength <= maxChange || changeLength <= EPSILON) {
    velocity.x = desiredX;
    velocity.z = desiredZ;
  } else if (maxChange > 0) {
    const changeScale = maxChange / changeLength;
    velocity.x += changeX * changeScale;
    velocity.z += changeZ * changeScale;
  }

  const stepX = velocity.x * dt;
  const stepZ = velocity.z * dt;
  const stepTowardTarget = stepX * directionX + stepZ * directionZ;
  if (stepTowardTarget >= distance) {
    position.x = target.x;
    position.z = target.z;
    velocity.x = 0;
    velocity.z = 0;
    return 0;
  }

  position.x += stepX;
  position.z += stepZ;
  return vectorSpeed(velocity);
}

export function estimateArrivalTime(
  distance: number,
  projectedVelocity: number,
  maxSpeed: number,
  acceleration: number,
): number {
  if (!Number.isFinite(distance) || !Number.isFinite(projectedVelocity)) return Infinity;
  if (distance <= 0) return 0;
  if (maxSpeed <= 0 || acceleration <= 0) return Infinity;

  const speedLimit = Math.max(0, maxSpeed);
  let velocity = Math.max(-speedLimit, Math.min(speedLimit, projectedVelocity));
  let remaining = distance;
  let elapsed = 0;

  if (velocity < 0) {
    elapsed = -velocity / acceleration;
    remaining += (velocity * velocity) / (2 * acceleration);
    velocity = 0;
  }

  const accelerationDistance = (speedLimit * speedLimit - velocity * velocity) / (2 * acceleration);
  if (remaining <= accelerationDistance) {
    return (
      elapsed +
      (-velocity + Math.sqrt(velocity * velocity + 2 * acceleration * remaining)) / acceleration
    );
  }

  const accelerationTime = (speedLimit - velocity) / acceleration;
  return elapsed + accelerationTime + (remaining - accelerationDistance) / speedLimit;
}

/** ETA conservador que replica o integrador 2D do fixed step, inclusive custo de mudar direção. */
export function estimatePlanarArrivalTime(
  distance: number,
  projectedVelocity: number,
  lateralVelocity: number,
  maxSpeed: number,
  acceleration: number,
  deceleration: number,
  technicalRadius: number,
  dt = 1 / 60,
  maxDuration = 10,
): number {
  if (
    !Number.isFinite(distance) ||
    !Number.isFinite(projectedVelocity) ||
    !Number.isFinite(lateralVelocity) ||
    !Number.isFinite(dt) ||
    dt <= 0 ||
    !Number.isFinite(maxDuration) ||
    maxDuration <= 0
  ) {
    return Infinity;
  }
  const radius = Math.max(0, technicalRadius);
  if (distance <= radius) return 0;
  if (maxSpeed <= 0 || acceleration <= 0 || deceleration <= 0) return Infinity;

  const position = { x: 0, z: 0 };
  const velocity = { x: projectedVelocity, z: lateralVelocity };
  const target = { x: Math.max(0, distance), z: 0 };
  const maxSteps = Math.ceil(maxDuration / dt);

  for (let step = 1; step <= maxSteps; step++) {
    advancePlanarMotion(position, velocity, target, dt, maxSpeed, acceleration, deceleration);
    if (Math.hypot(target.x - position.x, target.z - position.z) <= radius) return step * dt;
  }
  return Infinity;
}
