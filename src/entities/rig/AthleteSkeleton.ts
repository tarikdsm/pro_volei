// Esqueleto procedural da atleta 2.0 (Fase 4A): 19 ossos nomeados, hierarquia fixa e índices
// estáveis para o skinning rígido. Puro Three.js (Bone/Skeleton) — roda em Node, sem DOM.
import * as THREE from 'three';

export type AthleteJointName =
  | 'hips'
  | 'spine'
  | 'chest'
  | 'neck'
  | 'head'
  | 'shoulderL'
  | 'upperArmL'
  | 'forearmL'
  | 'handL'
  | 'shoulderR'
  | 'upperArmR'
  | 'forearmR'
  | 'handR'
  | 'thighL'
  | 'shinL'
  | 'footL'
  | 'thighR'
  | 'shinR'
  | 'footR';

export interface AthleteSkeletonRig {
  readonly rootBone: THREE.Bone; // hips
  readonly skeleton: THREE.Skeleton;
  readonly joints: Readonly<Record<AthleteJointName, THREE.Bone>>;
  readonly boneIndex: Readonly<Record<AthleteJointName, number>>; // índice em skeleton.bones
}

/** Posição LOCAL de cada osso em relação ao pai (m); +z = frente, +y = cima. */
const BONE_TABLE: readonly {
  name: AthleteJointName;
  parent: AthleteJointName | null;
  position: readonly [number, number, number];
}[] = [
  { name: 'hips', parent: null, position: [0, 0.95, 0] },
  { name: 'spine', parent: 'hips', position: [0, 0.14, 0] },
  { name: 'chest', parent: 'spine', position: [0, 0.18, 0] },
  { name: 'neck', parent: 'chest', position: [0, 0.17, 0] },
  { name: 'head', parent: 'neck', position: [0, 0.1, 0] },
  { name: 'shoulderL', parent: 'chest', position: [0.2, 0.12, 0] },
  { name: 'upperArmL', parent: 'shoulderL', position: [0.05, 0, 0] },
  { name: 'forearmL', parent: 'upperArmL', position: [0, -0.26, 0] },
  { name: 'handL', parent: 'forearmL', position: [0, -0.24, 0] },
  { name: 'shoulderR', parent: 'chest', position: [-0.2, 0.12, 0] },
  { name: 'upperArmR', parent: 'shoulderR', position: [-0.05, 0, 0] },
  { name: 'forearmR', parent: 'upperArmR', position: [0, -0.26, 0] },
  { name: 'handR', parent: 'forearmR', position: [0, -0.24, 0] },
  { name: 'thighL', parent: 'hips', position: [0.1, -0.02, 0] },
  { name: 'shinL', parent: 'thighL', position: [0, -0.42, 0] },
  { name: 'footL', parent: 'shinL', position: [0, -0.44, 0.04] },
  { name: 'thighR', parent: 'hips', position: [-0.1, -0.02, 0] },
  { name: 'shinR', parent: 'thighR', position: [0, -0.42, 0] },
  { name: 'footR', parent: 'shinR', position: [0, -0.44, 0.04] },
];

/** Escalas visuais do corpo (Fase 4C): altura em y e largura/porte em x. Só apresentação. */
export interface AthleteBuildOptions {
  readonly heightScale?: number; // faixa recomendada [0,94, 1,06]
  readonly buildScale?: number; // faixa recomendada [0,92, 1,10]
}

/** Posição de MUNDO de cada osso no rest pose (soma da cadeia de pais), para o bind da malha. */
export function athleteRestPose(
  heightScale = 1,
  buildScale = 1,
): Readonly<Record<AthleteJointName, readonly [number, number, number]>> {
  const world = {} as Record<AthleteJointName, readonly [number, number, number]>;
  for (const entry of BONE_TABLE) {
    const base: readonly [number, number, number] = entry.parent ? world[entry.parent] : [0, 0, 0];
    world[entry.name] = [
      base[0] + entry.position[0] * buildScale,
      base[1] + entry.position[1] * heightScale,
      base[2] + entry.position[2],
    ];
  }
  return Object.freeze(world);
}

/** Rest pose padrão (escala 1), mantido para compatibilidade. */
export const ATHLETE_REST_POSE = athleteRestPose();

/** Constrói um esqueleto novo e independente (sem estado compartilhado entre chamadas). */
export function buildAthleteSkeleton(options: AthleteBuildOptions = {}): AthleteSkeletonRig {
  const heightScale = options.heightScale ?? 1;
  const buildScale = options.buildScale ?? 1;
  const joints = {} as Record<AthleteJointName, THREE.Bone>;
  const boneIndex = {} as Record<AthleteJointName, number>;
  const bones: THREE.Bone[] = [];

  BONE_TABLE.forEach((entry, index) => {
    const bone = new THREE.Bone();
    bone.name = entry.name;
    bone.position.set(
      entry.position[0] * buildScale,
      entry.position[1] * heightScale,
      entry.position[2],
    );
    if (entry.parent) joints[entry.parent].add(bone);
    joints[entry.name] = bone;
    boneIndex[entry.name] = index;
    bones.push(bone);
  });

  // O Skeleton captura os boneInverses a partir do matrixWorld ATUAL dos ossos; sem esta
  // atualização os inversos ficam identidade e o skinning "explode" (regressão testada).
  joints.hips.updateMatrixWorld(true);

  return Object.freeze({
    rootBone: joints.hips,
    skeleton: new THREE.Skeleton(bones),
    joints: Object.freeze(joints),
    boneIndex: Object.freeze(boneIndex),
  });
}
