// Porta fiel das 12 poses paramétricas do humanoide legado (PlayerCharacter.update) para o rig.
// Diferença deliberada: o balanço do idle usa um relógio acumulado por dt (determinístico),
// não performance.now() — apresentação avança somente pelo dt recebido (pausa/slow-mo corretos).
import type { CharAction } from '../PlayerCharacter';

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
    bounceY: 0,
  };
}

function ease01(t: number): number {
  const x = Math.min(1, Math.max(0, t));
  return 1 - Math.pow(1 - x, 3);
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
      // manchete: braços juntos estendidos à frente/baixo
      const k = ease01(t * 6);
      p.torsoPitch = 0.5 * k;
      p.hips = 0.5;
      p.knees = -0.8;
      p.lShX = 1.05 * k;
      p.rShX = 1.05 * k;
      p.lShZ = -0.25 * k;
      p.rShZ = 0.25 * k;
      p.lElX = 0;
      p.rElX = 0;
      break;
    }
    case 'set': {
      // toque: mãos acima da testa
      const k = ease01(t * 6);
      p.torsoPitch = -0.08 * k;
      p.hips = 0.25;
      p.knees = -0.4;
      p.lShX = 2.6 * k;
      p.rShX = 2.6 * k;
      p.lShZ = -0.4 * k;
      p.rShZ = 0.4 * k;
      p.lElX = -0.85 * k;
      p.rElX = -0.85 * k;
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
      // chicotada do braço
      const k = ease01(t * 10);
      p.torsoPitch = 0.35 * k;
      p.torsoYaw = 0.25 * k;
      p.rShX = -2.4 + 3.4 * k; // whip: de trás para frente/baixo
      p.rElX = -0.15;
      p.lShX = 0.6;
      p.lElX = -0.5;
      p.lKneeX = -0.5;
      p.rKneeX = -0.5;
      break;
    }
    case 'block': {
      // braços retos para cima
      const k = ease01(t * 8);
      p.torsoPitch = 0.02;
      p.lShX = 2.95 * k;
      p.rShX = 2.95 * k;
      p.lShZ = -0.18;
      p.rShZ = 0.18;
      p.lElX = 0;
      p.rElX = 0;
      break;
    }
    case 'serveToss': {
      const k = ease01(t * 4);
      p.torsoPitch = -0.1;
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
