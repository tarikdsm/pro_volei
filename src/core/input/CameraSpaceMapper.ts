export interface GroundAxis {
  readonly x: number;
  readonly z: number;
}

export interface CameraGroundBasis {
  readonly screenRight: GroundAxis;
  readonly screenUp: GroundAxis;
  readonly revision: number;
}

export interface ScreenAxisLike {
  readonly right: number;
  readonly up: number;
}

export interface CourtAxis {
  readonly x: number;
  readonly z: number;
}

const EPSILON = 1e-9;

function normalizeGround(axis: GroundAxis): GroundAxis {
  const length = Math.hypot(axis.x, axis.z);
  if (!Number.isFinite(length) || length <= EPSILON) return { x: 0, z: 0 };
  return { x: axis.x / length, z: axis.z / length };
}

function capMagnitude(axis: CourtAxis): CourtAxis {
  const length = Math.hypot(axis.x, axis.z);
  if (!Number.isFinite(length) || length <= EPSILON) return { x: 0, z: 0 };
  if (length <= 1) return axis;
  return { x: axis.x / length, z: axis.z / length };
}

export function mapScreenToCourt(screenAxis: ScreenAxisLike, basis: CameraGroundBasis): CourtAxis {
  const input = capMagnitude({ x: screenAxis.right, z: screenAxis.up });
  const right = normalizeGround(basis.screenRight);
  const up = normalizeGround(basis.screenUp);

  return capMagnitude({
    x: right.x * input.x + up.x * input.z,
    z: right.z * input.x + up.z * input.z,
  });
}
