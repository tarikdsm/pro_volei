import { TeamSide } from '../../core/constants';

const NET_EPSILON = 1e-9;

/** Resolve o lado do contato com desempate simétrico no plano exato da rede. */
export function contactSideAt(x: number, velocityX: number, fallback: TeamSide): TeamSide {
  if (x < -NET_EPSILON) return TeamSide.HOME;
  if (x > NET_EPSILON) return TeamSide.AWAY;
  if (velocityX < -NET_EPSILON) return TeamSide.HOME;
  if (velocityX > NET_EPSILON) return TeamSide.AWAY;
  return fallback;
}
