// Classificador puro de locomoção (Fase 4B): traduz a velocidade planar no referencial da
// atleta em um estado de animação (parada, ajuste, corrida direcional ou freada).

export type LocomotionMode = 'idle' | 'adjust' | 'run' | 'brake';

export interface LocomotionState {
  mode: LocomotionMode;
  /** Direção da passada no referencial da atleta (rad; 0 = frente, +π/2 = esquerda). */
  strideYaw: number;
  /** Velocidade escalar planar (m/s) para o ritmo da passada. */
  speed: number;
  /** Inclinação do tronco na direção do movimento (rad, ≥ 0; 0 fora da corrida). */
  lean: number;
}

const IDLE_BELOW = 0.35;
const RUN_ABOVE = 1.6;
const LEAN_PER_SPEED = 0.05;
const LEAN_MAX = 0.3;

/** `forward`/`lateral` em m/s no referencial da atleta (frente/esquerda positivos). */
export function classifyLocomotion(
  forward: number,
  lateral: number,
  braking: boolean,
): LocomotionState {
  const speed = Math.hypot(forward, lateral);
  const strideYaw = speed < 1e-6 ? 0 : Math.atan2(lateral, forward);
  if (speed < IDLE_BELOW) return { mode: 'idle', strideYaw, speed, lean: 0 };
  if (speed <= RUN_ABOVE) return { mode: 'adjust', strideYaw, speed, lean: 0 };
  if (braking) return { mode: 'brake', strideYaw, speed, lean: 0 };
  return { mode: 'run', strideYaw, speed, lean: Math.min(LEAN_MAX, speed * LEAN_PER_SPEED) };
}
