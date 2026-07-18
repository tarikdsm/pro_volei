// Atleta com esqueleto real (Fase 4A): SkinnedMesh procedural + poses paramétricas em espaço de
// osso. Implementa o contrato CharVisual e substitui o humanoide de caixas via CharFactory —
// nada em game/ muda. Construtível em Node com decal desligado (decalTexture: null).
import * as THREE from 'three';
import {
  makeJerseyTexture,
  meshCastsShadow,
  type CharFactory,
  type CharAction,
  type CharLook,
  type CharVisual,
} from '../PlayerCharacter';
import { buildAthleteBodyParts, type BodyRegion } from './AthleteBodyGeometry';
import { buildAthleteSkeleton, type AthleteSkeletonRig } from './AthleteSkeleton';
import { poseFor, locomotionPose } from './athletePoses';
import { classifyLocomotion } from './locomotion';
import { solveTwoBoneIK } from './TwoBoneIK';

/** Ações de gameplay que travam braços/pernas (IK de contato não deve competir com elas). */
const ARM_LOCK_ACTIONS: ReadonlySet<CharAction> = new Set([
  'spikeWindup',
  'spikeHit',
  'serveToss',
  'serveHit',
  'block',
  'celebrate',
  'dejected',
]);

const ARM_L1 = 0.26; // ombro→cotovelo
const ARM_L2 = 0.24; // cotovelo→punho
const LEG_L1 = 0.42; // quadril→joelho
const LEG_L2 = 0.44; // joelho→tornozelo
const PLANT_REPLANT_DISTANCE = 0.25; // root além disso força um passo curto (replante)
const AIM_HOLD_SECONDS = 0.3; // follow-through após o instante do contato

export interface RiggedCharacterOptions {
  /**
   * Fábrica do decal de número/nome por face. Default: canvas do browser (makeJerseyTexture);
   * null = sem decal (necessário em Node/testes, onde não há DOM).
   */
  readonly decalTexture?: ((look: CharLook, face: 'front' | 'back') => THREE.Texture) | null;
}

const DEFAULT_DECAL = (look: CharLook, face: 'front' | 'back'): THREE.Texture =>
  face === 'front'
    ? makeJerseyTexture(look.number)
    : makeJerseyTexture(look.number, look.name ?? undefined);

export class RiggedCharacter implements CharVisual {
  readonly root = new THREE.Group();
  moveSpeed = 0;
  jumpY = 0;

  private readonly body = new THREE.Group();
  private readonly rig: AthleteSkeletonRig;
  private action: CharAction = 'idle';
  private actionTime = 0;
  private runPhase = 0;
  private idleClock = 0;
  private readonly phaseSeed: number;

  // Locomoção direcional (Fase 4B); sem setPlanarMotion cai no legado moveSpeed-para-frente.
  private planarForward = 0;
  private planarLateral = 0;
  private planarBraking = false;
  private planarFed = false;

  // Alvo de contato (referencial do root); expira sozinho.
  private readonly aim = new THREE.Vector3();
  private aimTimeLeft = Number.NEGATIVE_INFINITY;

  // Foot planting: âncoras de mundo dos tornozelos e do root no instante do plante.
  private readonly plantedL = new THREE.Vector3();
  private readonly plantedR = new THREE.Vector3();
  private readonly plantAnchor = new THREE.Vector3();
  private planted = false;

  // Temporários reutilizados (zero alocação por frame).
  private readonly tmpA = new THREE.Vector3();
  private readonly tmpB = new THREE.Vector3();
  private readonly tmpC = new THREE.Vector3();
  private readonly tmpQ = new THREE.Quaternion();

  private readonly heightScale: number;

  constructor(look: CharLook, options: RiggedCharacterOptions = {}) {
    this.heightScale = look.heightScale ?? 1;
    const buildScale = look.buildScale ?? 1;
    this.rig = buildAthleteSkeleton({ heightScale: this.heightScale, buildScale });
    this.phaseSeed = (look.number % 12) * 0.7;

    const materials: Record<BodyRegion, THREE.MeshStandardMaterial> = {
      skin: new THREE.MeshStandardMaterial({ color: look.skin, roughness: 0.75 }),
      jersey: new THREE.MeshStandardMaterial({ color: look.jersey, roughness: 0.7 }),
      shorts: new THREE.MeshStandardMaterial({ color: look.shorts, roughness: 0.75 }),
      shoes: new THREE.MeshStandardMaterial({ color: 0xf5f5f5, roughness: 0.85 }),
      hair: new THREE.MeshStandardMaterial({ color: look.hair, roughness: 0.9 }),
    };

    this.body.add(this.rig.rootBone);
    const parts = buildAthleteBodyParts(this.rig.boneIndex, {
      hairstyle: look.hairstyle ?? 'short',
      heightScale: this.heightScale,
      buildScale,
    });
    for (const part of parts) {
      const mesh = new THREE.SkinnedMesh(part.geometry, materials[part.region]);
      // Bind com matriz identidade: os vértices já estão no espaço de mundo do rest pose.
      mesh.bind(this.rig.skeleton, new THREE.Matrix4());
      // Ossos em movimento invalidam o bounding do rest pose; a atleta está sempre em quadro
      // na câmera broadcast, então desligar o culling é mais barato que recalcular por frame.
      mesh.frustumCulled = false;
      this.body.add(mesh);
    }

    const decal = options.decalTexture === undefined ? DEFAULT_DECAL : options.decalTexture;
    if (decal) {
      for (const face of ['front', 'back'] as const) {
        const plane = new THREE.Mesh(
          new THREE.PlaneGeometry(0.2, 0.2),
          new THREE.MeshBasicMaterial({ map: decal(look, face), transparent: true }),
        );
        plane.position.set(0, 0.02, face === 'front' ? 0.115 : -0.115);
        if (face === 'back') plane.rotation.y = Math.PI;
        this.rig.joints.chest.add(plane);
      }
    }

    this.root.add(this.body);
    this.root.traverse((object) => {
      if ((object as THREE.Mesh).isMesh) object.castShadow = meshCastsShadow(object as THREE.Mesh);
    });

    // Ordem YXZ nas cadeias de IK: o solver devolve Ry(yaw)·Rx(pitch).
    for (const joint of ['upperArmL', 'upperArmR', 'thighL', 'thighR'] as const) {
      this.rig.joints[joint].rotation.order = 'YXZ';
    }
  }

  setPlanarMotion(forward: number, lateral: number, braking: boolean): void {
    this.planarForward = forward;
    this.planarLateral = lateral;
    this.planarBraking = braking;
    this.planarFed = true;
  }

  setContactAim(x: number, y: number, z: number, inSeconds: number): void {
    this.aim.set(x, y, z);
    this.aimTimeLeft = inSeconds;
  }

  setAction(action: CharAction): void {
    if (this.action !== action) {
      this.action = action;
      this.actionTime = 0;
    }
  }

  presentJump(jumpY: number): void {
    this.body.position.y = jumpY;
  }

  // Pose paramétrica por frame com damping das juntas + locomoção direcional, IK de contato
  // e foot planting (Fase 4B). Tudo avança somente pelo dt recebido.
  update(dt: number): void {
    this.actionTime += dt;
    this.idleClock += dt;
    this.aimTimeLeft -= dt;

    const loco = classifyLocomotion(
      this.planarFed ? this.planarForward : this.moveSpeed,
      this.planarFed ? this.planarLateral : 0,
      this.planarFed ? this.planarBraking : false,
    );
    this.runPhase += dt * Math.max(2, loco.speed * 2.6);

    const locomotionDriven = this.action === 'idle' || this.action === 'run';
    const p = locomotionDriven
      ? locomotionPose(loco, this.action === 'idle' && loco.mode === 'idle' ? 0 : this.runPhase)
      : poseFor(this.action, this.actionTime, this.runPhase, this.idleClock, this.phaseSeed);
    if (locomotionDriven && loco.mode === 'idle') {
      // idle mantém o balanço determinístico próprio da atleta
      const bob = Math.sin(this.idleClock * 2.2 + this.phaseSeed) * 0.04;
      p.lShX += bob;
      p.rShX -= bob;
    }
    this.body.position.y = this.jumpY + p.bounceY;

    // IK resolvido ANTES do damping (com matrizes do frame anterior — 1 frame de atraso é
    // invisível) e misturado nos ALVOS: pose e IK nunca competem no mesmo damping.
    const armIK = this.solveArmAim(dt);
    const legIK = this.solveFootPlanting(dt, loco.mode, locomotionDriven);
    const mix = (pose: number, ik: number, w: number) => pose + (ik - pose) * w;

    // Ombros/quadris/joelhos são negados: pose positiva = membro à frente (+z do modelo).
    const j = this.rig.joints;
    const l = 1 - Math.exp(-16 * dt);
    j.spine.rotation.x += (p.torsoPitch - j.spine.rotation.x) * l;
    j.spine.rotation.y += (p.torsoYaw - j.spine.rotation.y) * l;
    j.spine.rotation.z += (p.spineRoll - j.spine.rotation.z) * l;
    j.head.rotation.x += (p.headPitch - j.head.rotation.x) * l;

    const aw = armIK?.weight ?? 0;
    const armLX = armIK ? mix(-p.lShX, armIK.left.rootPitch, aw) : -p.lShX;
    const armRX = armIK ? mix(-p.rShX, armIK.right.rootPitch, aw) : -p.rShX;
    const armLY = armIK ? mix(0, armIK.left.rootYaw, aw) : j.upperArmL.rotation.y;
    const armRY = armIK ? mix(0, armIK.right.rootYaw, aw) : j.upperArmR.rotation.y;
    const armLZ = armIK ? mix(p.lShZ, 0, aw) : p.lShZ;
    const armRZ = armIK ? mix(p.rShZ, 0, aw) : p.rShZ;
    const elbowL = armIK ? mix(p.lElX, armIK.left.midFlex, aw) : p.lElX;
    const elbowR = armIK ? mix(p.rElX, armIK.right.midFlex, aw) : p.rElX;
    j.upperArmL.rotation.x += (armLX - j.upperArmL.rotation.x) * l;
    j.upperArmR.rotation.x += (armRX - j.upperArmR.rotation.x) * l;
    j.upperArmL.rotation.y += (armLY - j.upperArmL.rotation.y) * l;
    j.upperArmR.rotation.y += (armRY - j.upperArmR.rotation.y) * l;
    j.upperArmL.rotation.z += (armLZ - j.upperArmL.rotation.z) * l;
    j.upperArmR.rotation.z += (armRZ - j.upperArmR.rotation.z) * l;
    j.forearmL.rotation.x += (elbowL - j.forearmL.rotation.x) * l;
    j.forearmR.rotation.x += (elbowR - j.forearmR.rotation.x) * l;

    const lHipX = p.lHipX !== 0 ? p.lHipX : p.hips;
    const rHipX = p.rHipX !== 0 ? p.rHipX : p.hips;
    const lKneeX = p.lKneeX !== 0 ? p.lKneeX : p.knees;
    const rKneeX = p.rKneeX !== 0 ? p.rKneeX : p.knees;
    const legL = legIK?.left;
    const legR = legIK?.right;
    const thighLX = legL ? -legL.rootPitch : -lHipX;
    const thighRX = legR ? -legR.rootPitch : -rHipX;
    const thighLY = legL ? -legL.rootYaw : j.thighL.rotation.y;
    const thighRY = legR ? -legR.rootYaw : j.thighR.rotation.y;
    const thighLZ = legL ? 0 : p.lHipZ;
    const thighRZ = legR ? 0 : p.rHipZ;
    const shinLX = legL ? -legL.midFlex : -lKneeX;
    const shinRX = legR ? -legR.midFlex : -rKneeX;
    const legDamp = legIK ? 1 - Math.exp(-28 * dt) : l;
    j.thighL.rotation.x += (thighLX - j.thighL.rotation.x) * legDamp;
    j.thighR.rotation.x += (thighRX - j.thighR.rotation.x) * legDamp;
    j.thighL.rotation.y += (thighLY - j.thighL.rotation.y) * legDamp;
    j.thighR.rotation.y += (thighRY - j.thighR.rotation.y) * legDamp;
    j.thighL.rotation.z += (thighLZ - j.thighL.rotation.z) * legDamp;
    j.thighR.rotation.z += (thighRZ - j.thighR.rotation.z) * legDamp;
    j.shinL.rotation.x += (shinLX - j.shinL.rotation.x) * legDamp;
    j.shinR.rotation.x += (shinRX - j.shinR.rotation.x) * legDamp;
  }

  /** Soluções de IK das mãos ao alvo de contato, ou null quando inativo. */
  private solveArmAim(dt: number): {
    weight: number;
    left: ReturnType<typeof solveTwoBoneIK>;
    right: ReturnType<typeof solveTwoBoneIK>;
  } | null {
    if (dt <= 0) return null;
    if (this.aimTimeLeft <= -AIM_HOLD_SECONDS || ARM_LOCK_ACTIONS.has(this.action)) return null;
    const weight = Math.min(1, Math.max(0, 1 - Math.max(0, this.aimTimeLeft) / 0.4));
    if (weight <= 0) return null;
    const separation = this.action === 'set' ? 0.09 : 0.05;
    this.root.updateMatrixWorld(true);
    const j = this.rig.joints;
    const solve = (side: -1 | 1) => {
      const upperArm = side < 0 ? j.upperArmL : j.upperArmR;
      const shoulder = side < 0 ? j.shoulderL : j.shoulderR;
      this.tmpB.copy(this.aim);
      this.tmpB.x += -side * separation; // lado esquerdo do modelo é +x local
      this.body.localToWorld(this.tmpB);
      upperArm.getWorldPosition(this.tmpA);
      shoulder.getWorldQuaternion(this.tmpQ).invert();
      this.tmpC.copy(this.tmpB).sub(this.tmpA).applyQuaternion(this.tmpQ);
      return solveTwoBoneIK(this.tmpC, ARM_L1 * this.heightScale, ARM_L2 * this.heightScale);
    };
    return { weight, left: solve(-1), right: solve(1) };
  }

  /** Soluções de IK das pernas para manter os pés plantados, ou null fora do plante. */
  private solveFootPlanting(
    dt: number,
    mode: string,
    locomotionDriven: boolean,
  ): { left: ReturnType<typeof solveTwoBoneIK>; right: ReturnType<typeof solveTwoBoneIK> } | null {
    const grounded = this.jumpY <= 1e-3;
    const shouldPlant = grounded && locomotionDriven && (mode === 'idle' || mode === 'adjust');
    if (!shouldPlant) {
      this.planted = false;
      return null;
    }
    if (dt <= 0) return null;
    this.root.updateMatrixWorld(true);
    if (!this.planted || this.root.position.distanceTo(this.plantAnchor) > PLANT_REPLANT_DISTANCE) {
      this.plantAnchor.copy(this.root.position);
      this.plantedL.set(0.11, 0.07, 0.04);
      this.root.localToWorld(this.plantedL);
      this.plantedR.set(-0.11, 0.07, 0.04);
      this.root.localToWorld(this.plantedR);
      this.planted = true;
    }
    const j = this.rig.joints;
    const solve = (side: -1 | 1) => {
      const thigh = side < 0 ? j.thighL : j.thighR;
      const planted = side < 0 ? this.plantedL : this.plantedR;
      thigh.getWorldPosition(this.tmpA);
      j.hips.getWorldQuaternion(this.tmpQ).invert();
      this.tmpC.copy(planted).sub(this.tmpA).applyQuaternion(this.tmpQ);
      // Joelho dobra para trás: espelha o alvo em z, resolve e desespelha os ângulos.
      this.tmpC.z = -this.tmpC.z;
      return solveTwoBoneIK(this.tmpC, LEG_L1 * this.heightScale, LEG_L2 * this.heightScale);
    };
    return { left: solve(-1), right: solve(1) };
  }
}

export const createRiggedCharacter: CharFactory = (look) => new RiggedCharacter(look);
