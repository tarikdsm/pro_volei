import { COURT, TeamSide } from '../../core/constants';
import type { TacticalPoint } from './TeamTactics';

/** O referencial tático local sempre enxerga a própria equipe no lado x negativo. */
export function toLocalCourt(point: TacticalPoint, side: TeamSide): TacticalPoint {
  return side === TeamSide.HOME ? { x: point.x, z: point.z } : { x: -point.x, z: -point.z };
}

export function fromLocalCourt(point: TacticalPoint, side: TeamSide): TacticalPoint {
  return side === TeamSide.HOME ? { x: point.x, z: point.z } : { x: -point.x, z: -point.z };
}

export function clampOwnHalf(
  point: TacticalPoint,
  courtMargin: number,
  netMargin: number,
): TacticalPoint {
  return {
    x: Math.max(-COURT.halfLength + courtMargin, Math.min(-netMargin, point.x)),
    z: Math.max(-COURT.halfWidth + courtMargin, Math.min(COURT.halfWidth - courtMargin, point.z)),
  };
}
