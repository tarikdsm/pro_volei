// Geometria do bloqueio: onde/quando a cortada cruza o plano da rede (x = 0) e se um
// bloqueador chega nela. Pura, extraída de Match.ts (nos moldes de net.ts).
import { CONTACT, GRAVITY } from '../../core/constants';

interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/** Janela de tempo (s) após o contato em que o bloqueio ainda pode acontecer. */
const BLOCK_WINDOW = 0.8;
/** Distância máx. na rede (eixo x) para o bloqueador contar como "na rede". */
const NEAR_NET_X = 1.4;
/** Distância máx. em z entre bloqueador e ponto de cruzamento para alcançar a bola. */
const BLOCK_Z_REACH = 0.85;

export interface BlockCrossing {
  t: number; // instante do cruzamento
  y: number; // altura da bola no cruzamento
  z: number; // z da bola no cruzamento
}

/**
 * Quando/onde a bola cruza o plano da rede (x = 0) dentro da janela de bloqueio.
 * `null` se não cruza a tempo: sem componente horizontal, cruzamento no passado
 * ou tarde demais (fora de {@link BLOCK_WINDOW}).
 */
export function blockCrossing(pos: Vec3, vel: Vec3): BlockCrossing | null {
  if (Math.abs(vel.x) < 0.01) return null;
  const t = -pos.x / vel.x;
  if (t <= 0 || t > BLOCK_WINDOW) return null;
  const y = pos.y + vel.y * t + 0.5 * GRAVITY * t * t;
  const z = pos.z + vel.z * t;
  return { t, y, z };
}

/** O bloqueador (posição na rede + altura do pulo) alcança a bola no cruzamento? */
export function blockerReaches(
  blockerX: number,
  blockerZ: number,
  jumpY: number,
  cross: BlockCrossing,
): boolean {
  const nearNet = Math.abs(blockerX) < NEAR_NET_X;
  const zDist = Math.abs(blockerZ - cross.z);
  if (!nearNet || zDist > BLOCK_Z_REACH) return false;
  const reach = CONTACT.blockReach + jumpY * 0.5;
  return cross.y <= reach;
}

/** Proximidade [0..1] do bloqueador ao ponto de cruzamento (1 = em cima, 0 = no limite). */
export function blockProximity(blockerZ: number, crossZ: number): number {
  return 1 - Math.abs(blockerZ - crossZ) / BLOCK_Z_REACH;
}
