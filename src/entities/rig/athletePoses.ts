// Porta fiel das 12 poses paramétricas do humanoide legado (PlayerCharacter.update) para o rig.
// Diferença deliberada: o balanço do idle usa um relógio acumulado por dt (determinístico),
// não performance.now() — apresentação avança somente pelo dt recebido (pausa/slow-mo corretos).
import type { CharAction } from '../PlayerCharacter';
import type { LocomotionState } from './locomotion';

/** Convenção: valor positivo = membro à frente/para cima (+z do modelo). */
export interface AthletePose {
  torsoPitch: number;
  torsoYaw: number;
  headPitch: number;
  lShX: number;
  rShX: number;
  lShZ: number;
  rShZ: number;
  lElX: number;
  rElX: number;
  lHipX: number;
  rHipX: number;
  lKneeX: number;
  rKneeX: number;
  hips: number;
  knees: number;
  /** Balanço lateral das coxas (rad) — passada lateral da locomoção direcional. */
  lHipZ: number;
  rHipZ: number;
  /** Inclinação lateral do tronco (rad) na corrida lateral. */
  spineRoll: number;
  /** Salto extra da comemoração aplicado ao body (soma ao jumpY). */
  bounceY: number;
}

function defaultPose(): AthletePose {
  return {
    torsoPitch: 0.1,
    torsoYaw: 0,
    headPitch: 0,
    lShX: 0.3,
    rShX: 0.3,
    lShZ: -0.12,
    rShZ: 0.12,
    lElX: -0.35,
    rElX: -0.35,
    lHipX: 0,
    rHipX: 0,
    lKneeX: 0,
    rKneeX: 0,
    hips: 0.12,
    knees: -0.2,
    lHipZ: 0,
    rHipZ: 0,
    spineRoll: 0,
    bounceY: 0,
  };
}

/**
 * Pose de locomoção direcional (substitui o par idle/run binário quando nenhuma ação de
 * gameplay está ativa): passada orientada por strideYaw, ajuste curto e freada.
 */
export function locomotionPose(state: LocomotionState, runPhase: number): AthletePose {
  const p = defaultPose();
  if (state.mode === 'idle') return poseFor('idle', 0, runPhase, runPhase, 0);
  if (state.mode === 'brake') {
    p.torsoPitch = -0.18;
    p.hips = 0.5;
    p.knees = -0.9;
    p.lShX = 0.9;
    p.rShX = 0.9;
    p.lElX = -0.4;
    p.rElX = -0.4;
    return p;
  }
  const amplitude = state.mode === 'adjust' ? 0.35 : 1;
  const s = Math.sin(runPhase);
  const c = Math.cos(runPhase);
  const along = Math.cos(state.strideYaw); // componente frontal da passada
  const side = Math.sin(state.strideYaw); // componente lateral (esquerda positiva)
  p.torsoPitch = (0.1 + 0.2 * Math.abs(along)) * amplitude + state.lean * along;
  p.spineRoll = -state.lean * side;
  p.lHipX = s * 0.7 * amplitude * along;
  p.rHipX = -s * 0.7 * amplitude * along;
  p.lHipZ = s * 0.55 * amplitude * side;
  p.rHipZ = -s * 0.55 * amplitude * side;
  p.lKneeX = -0.4 - Math.max(0, c) * 0.7 * amplitude;
  p.rKneeX = -0.4 - Math.max(0, -c) * 0.7 * amplitude;
  p.lShX = -s * 0.8 * amplitude * along + 0.2;
  p.rShX = s * 0.8 * amplitude * along + 0.2;
  p.lElX = -0.7;
  p.rElX = -0.7;
  return p;
}

function ease01(t: number): number {
  const x = Math.min(1, Math.max(0, t));
  return 1 - Math.pow(1 - x, 3);
}

/** Normaliza t no intervalo [start, end] com clamp em [0, 1]. */
export function phase(t: number, start: number, end: number): number {
  return Math.min(1, Math.max(0, (t - start) / (end - start)));
}

/** Ease com overshoot contido (snap de jogada): passa do alvo e acomoda. */
export function easeOutBack(t: number, s = 1.4): number {
  const x = Math.min(1, Math.max(0, t));
  const c = s + 1;
  return 1 + c * Math.pow(x - 1, 3) + s * Math.pow(x - 1, 2);
}

/**
 * Pose-alvo da ação no instante `t` (s desde o setAction). `idleClock` é o relógio acumulado do
 * personagem e `phaseSeed` dessincroniza atletas de forma determinística (ex.: número da camisa).
 */
export function poseFor(
  action: CharAction,
  t: number,
  runPhase: number,
  idleClock: number,
  phaseSeed: number,
): AthletePose {
  const p = defaultPose();
  switch (action) {
    case 'idle': {
      const bob = Math.sin(idleClock * 2.2 + phaseSeed) * 0.04;
      p.torsoPitch = 0.22;
      p.hips = 0.32;
      p.knees = -0.55;
      p.lShX = 0.65 + bob;
      p.rShX = 0.65 - bob;
      p.lElX = -0.5;
      p.rElX = -0.5;
      break;
    }
    case 'run': {
      const s = Math.sin(runPhase);
      const c = Math.cos(runPhase);
      p.torsoPitch = 0.3;
      p.lHipX = s * 0.7;
      p.rHipX = -s * 0.7;
      p.lKneeX = -0.4 - Math.max(0, c) * 0.7;
      p.rKneeX = -0.4 - Math.max(0, -c) * 0.7;
      p.lShX = -s * 0.8 + 0.2;
      p.rShX = s * 0.8 + 0.2;
      p.lElX = -0.7;
      p.rElX = -0.7;
      break;
    }
    case 'bump': {
      // manchete: dip curto (anticipação) e extensão com leve overshoot
      const dip = ease01(phase(t, 0, 0.07) * 3);
      const ext = easeOutBack(phase(t, 0.05, 0.24), 1.2);
      p.torsoPitch = 0.12 * dip + 0.4 * ext;
      p.hips = 0.5 + 0.12 * dip - 0.06 * ext;
      p.knees = -0.8 - 0.2 * dip + 0.1 * ext;
      p.lShX = 0.3 * dip + 0.78 * ext;
      p.rShX = 0.3 * dip + 0.78 * ext;
      p.lShZ = -0.25 * ext;
      p.rShZ = 0.25 * ext;
      p.lElX = 0;
      p.rElX = 0;
      break;
    }
    case 'set': {
      // toque: mãos sobem acima da testa e os cotovelos "estalam" no release
      const rise = easeOutBack(phase(t, 0, 0.18), 1.1);
      const flick = ease01(phase(t, 0.2, 0.38) * 2);
      p.torsoPitch = -0.08 * rise;
      p.hips = 0.25 + 0.08 * (1 - rise);
      p.knees = -0.4 - 0.15 * (1 - rise);
      p.lShX = 2.6 * rise;
      p.rShX = 2.6 * rise;
      p.lShZ = -0.4 * rise;
      p.rShZ = 0.4 * rise;
      p.lElX = -0.85 * rise + 0.35 * flick;
      p.rElX = -0.85 * rise + 0.35 * flick;
      break;
    }
    case 'spikeWindup': {
      // no ar, armando o braço
      const k = ease01(t * 5);
      p.torsoPitch = -0.15;
      p.torsoYaw = -0.35 * k;
      p.rShX = -2.4 * k; // braço de ataque atrás/acima
      p.rElX = -1.2 * k;
      p.lShX = 1.8 * k; // braço de equilíbrio à frente
      p.lElX = -0.4;
      p.lHipX = 0.5;
      p.rHipX = 0.2;
      p.lKneeX = -0.9;
      p.rKneeX = -0.9;
      break;
    }
    case 'spikeHit': {
      // chicotada: whip com overshoot + crunch do tronco e recolhida das pernas
      const whip = easeOutBack(phase(t, 0, 0.14), 1.7);
      p.torsoPitch = 0.42 * whip;
      p.torsoYaw = 0.28 * whip;
      p.rShX = -2.4 + 3.4 * whip;
      p.rElX = -0.15;
      p.lShX = 0.6;
      p.lElX = -0.5;
      p.lKneeX = -0.5 - 0.25 * whip;
      p.rKneeX = -0.5 - 0.25 * whip;
      break;
    }
    case 'block': {
      // braços disparam retos para cima com leve overshoot e pressão à frente
      const rise = easeOutBack(phase(t, 0, 0.13), 1.3);
      p.torsoPitch = 0.02 + 0.05 * rise;
      p.lShX = 2.95 * rise;
      p.rShX = 2.95 * rise;
      p.lShZ = -0.18;
      p.rShZ = 0.18;
      p.lElX = 0;
      p.rElX = 0;
      break;
    }
    case 'serveToss': {
      // lançamento com carga nas pernas (anticipação do saque por cima)
      const k = ease01(t * 4);
      const load = ease01(phase(t, 0, 0.2) * 2);
      p.torsoPitch = -0.1;
      p.hips = 0.12 + 0.18 * load;
      p.knees = -0.2 - 0.3 * load;
      p.lShX = 2.6 * k; // braço esquerdo lança a bola
      p.lElX = -0.2;
      p.rShX = -1.9 * k; // direito armado atrás
      p.rElX = -1.1 * k;
      break;
    }
    case 'serveHit': {
      const k = ease01(t * 9);
      p.torsoPitch = 0.3 * k;
      p.rShX = -1.9 + 3.2 * k;
      p.rElX = -0.1;
      p.lShX = 0.9 - 0.5 * k;
      break;
    }
    case 'dive': {
      // peixinho
      const k = ease01(t * 7);
      p.torsoPitch = 1.25 * k;
      p.lShX = 1.6 * k;
      p.rShX = 1.6 * k;
      p.lElX = 0;
      p.rElX = 0;
      p.lHipX = -0.6 * k;
      p.rHipX = -0.6 * k;
      p.lKneeX = -0.3;
      p.rKneeX = -0.3;
      break;
    }
    case 'celebrate': {
      const bounce = Math.abs(Math.sin(t * 6));
      p.torsoPitch = -0.12;
      p.lShX = 2.9;
      p.rShX = 2.9;
      p.lShZ = -0.45;
      p.rShZ = 0.45;
      p.lElX = -0.25;
      p.rElX = -0.25;
      p.bounceY = bounce * 0.22;
      break;
    }
    case 'dejected': {
      const k = ease01(t * 3);
      p.torsoPitch = 0.55 * k;
      p.headPitch = 0.5 * k;
      p.lShX = 0.15;
      p.rShX = 0.15;
      p.lElX = -0.1;
      p.rElX = -0.1;
      p.hips = 0.25;
      p.knees = -0.35;
      break;
    }
  }
  return p;
}
