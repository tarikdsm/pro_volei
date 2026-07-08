// Geometria de cruzamento da bola pelo plano da rede (x = 0). Pura, extraída de Match.ts.
import { COURT, BALL_RADIUS, GRAVITY } from '../../core/constants';

export type NetCrossing =
  | { kind: 'none' }
  | { kind: 'net'; t: number; y: number; z: number }
  | { kind: 'cross'; t: number; y: number; z: number };

interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/**
 * Quando e como a bola cruza o plano da rede (x = 0), dada posição e velocidade atuais.
 * - `none`: não vai cruzar (sem componente horizontal ou cruzamento no passado);
 * - `net`: cruza na faixa de altura/largura da rede (bate na rede);
 * - `cross`: passa limpo (por cima ou pela lateral).
 */
export function computeNetCrossing(pos: Vec3, vel: Vec3): NetCrossing {
  if (Math.abs(vel.x) < 0.01) return { kind: 'none' };
  const t = -pos.x / vel.x;
  if (t <= 0.005) return { kind: 'none' };
  const y = pos.y + vel.y * t + 0.5 * GRAVITY * t * t;
  const z = pos.z + vel.z * t;
  const hitsNet =
    y > BALL_RADIUS &&
    y < COURT.netHeight + BALL_RADIUS * 0.4 &&
    Math.abs(z) < COURT.halfWidth + 0.5;
  return hitsNet ? { kind: 'net', t, y, z } : { kind: 'cross', t, y, z };
}
