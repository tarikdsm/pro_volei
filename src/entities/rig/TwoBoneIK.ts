// Solver analítico de IK de dois ossos (Fase 4B): lei dos cossenos, sem iteração e sem
// alocação. Convenção do rig 4A: descanso aponta -y; raiz gira Ry(yaw)·Rx(pitch); a junta do
// meio flexiona em X negativo (dobra o membro para +z, como cotovelo/joelho do rig).

export interface TwoBoneSolution {
  /** Rotação do osso raiz (ombro/quadril) em torno do eixo de flexão local X. */
  rootPitch: number;
  /** Yaw do osso raiz apontando o plano da cadeia para o alvo. */
  rootYaw: number;
  /** Flexão da junta do meio (cotovelo/joelho), sempre ≤ 0 (dobra natural). */
  midFlex: number;
  /** true quando o alvo está fora do alcance (cadeia clampada na direção do alvo). */
  clamped: boolean;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Resolve a cadeia de dois ossos no referencial LOCAL do osso raiz. `target` no mesmo
 * referencial; `l1`/`l2` são os comprimentos dos ossos (m).
 */
export function solveTwoBoneIK(
  target: { x: number; y: number; z: number },
  l1: number,
  l2: number,
): TwoBoneSolution {
  const rawDistance = Math.hypot(target.x, target.y, target.z);
  const min = Math.abs(l1 - l2) + 1e-6;
  const max = l1 + l2;
  const d = clamp(rawDistance, min, max);
  const clamped = rawDistance > max || rawDistance < min;

  // Direção do alvo; alvo degenerado na origem cai no descanso (-y).
  const nx = rawDistance < 1e-9 ? 0 : target.x / rawDistance;
  const ny = rawDistance < 1e-9 ? -1 : target.y / rawDistance;
  const nz = rawDistance < 1e-9 ? 0 : target.z / rawDistance;

  // Decomposição Ry(yaw)·Rx(pitch) que leva (0,-1,0) à direção do alvo.
  // Rx(pitch) positivo leva -y em direção a -z; daí o yaw usa os componentes negados.
  const chainPitch = Math.acos(clamp(-ny, -1, 1));
  const planar = Math.hypot(nx, nz);
  const rootYaw = planar < 1e-9 ? 0 : Math.atan2(-nx, -nz);

  // Lei dos cossenos: ângulo interno do meio e desvio do osso superior sobre o eixo da cadeia.
  const cosMid = clamp((l1 * l1 + l2 * l2 - d * d) / (2 * l1 * l2), -1, 1);
  const midFlex = -(Math.PI - Math.acos(cosMid));
  const cosRoot = clamp((l1 * l1 + d * d - l2 * l2) / (2 * l1 * d), -1, 1);
  const rootOffset = Math.acos(cosRoot);

  return { rootPitch: chainPitch + rootOffset, rootYaw, midFlex, clamped };
}
