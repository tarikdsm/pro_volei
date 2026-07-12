import { AUTO_SELECTOR, COURT, TeamSide } from '../../core/constants';

export interface PlanarPoint {
  readonly x: number;
  readonly z: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/** Corrige o alvo manual sem acumular estado, teleportar ou atravessar a rede. */
export function assistedTarget(
  manual: PlanarPoint,
  contact: PlanarPoint,
  side: TeamSide,
): PlanarPoint {
  const dx = contact.x - manual.x;
  const dz = contact.z - manual.z;
  const distance = Math.hypot(dx, dz);
  const scale = distance > 0 ? Math.min(1, AUTO_SELECTOR.assistanceRadius / distance) : 0;
  const minCourtX = -COURT.halfLength - COURT.freeZone;
  const maxCourtX = COURT.halfLength + COURT.freeZone;
  const minX = side === TeamSide.HOME ? minCourtX : AUTO_SELECTOR.netMargin;
  const maxX = side === TeamSide.HOME ? -AUTO_SELECTOR.netMargin : maxCourtX;
  const halfPlayableWidth = COURT.halfWidth + COURT.freeZone;

  return Object.freeze({
    x: clamp(manual.x + dx * scale, minX, maxX),
    z: clamp(manual.z + dz * scale, -halfPlayableWidth, halfPlayableWidth),
  });
}
