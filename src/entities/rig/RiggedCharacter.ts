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
import { poseFor } from './athletePoses';

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

  constructor(look: CharLook, options: RiggedCharacterOptions = {}) {
    this.rig = buildAthleteSkeleton();
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

  // Pose paramétrica por frame com damping das juntas — mesma sensação do humanoide legado,
  // agora dirigindo ossos (substrato para blend tree/IK na 4B).
  update(dt: number): void {
    this.actionTime += dt;
    this.idleClock += dt;
    this.runPhase += dt * Math.max(2, this.moveSpeed * 2.6);

    const p = poseFor(this.action, this.actionTime, this.runPhase, this.idleClock, this.phaseSeed);
    this.body.position.y = this.jumpY + p.bounceY;

    // Ombros/quadris/joelhos são negados: pose positiva = membro à frente (+z do modelo).
    const j = this.rig.joints;
    const l = 1 - Math.exp(-16 * dt);
    j.spine.rotation.x += (p.torsoPitch - j.spine.rotation.x) * l;
    j.spine.rotation.y += (p.torsoYaw - j.spine.rotation.y) * l;
    j.head.rotation.x += (p.headPitch - j.head.rotation.x) * l;
    j.upperArmL.rotation.x += (-p.lShX - j.upperArmL.rotation.x) * l;
    j.upperArmR.rotation.x += (-p.rShX - j.upperArmR.rotation.x) * l;
    j.upperArmL.rotation.z += (p.lShZ - j.upperArmL.rotation.z) * l;
    j.upperArmR.rotation.z += (p.rShZ - j.upperArmR.rotation.z) * l;
    j.forearmL.rotation.x += (p.lElX - j.forearmL.rotation.x) * l;
    j.forearmR.rotation.x += (p.rElX - j.forearmR.rotation.x) * l;

    const lHipX = p.lHipX !== 0 ? p.lHipX : p.hips;
    const rHipX = p.rHipX !== 0 ? p.rHipX : p.hips;
    const lKneeX = p.lKneeX !== 0 ? p.lKneeX : p.knees;
    const rKneeX = p.rKneeX !== 0 ? p.rKneeX : p.knees;
    j.thighL.rotation.x += (-lHipX - j.thighL.rotation.x) * l;
    j.thighR.rotation.x += (-rHipX - j.thighR.rotation.x) * l;
    j.shinL.rotation.x += (-lKneeX - j.shinL.rotation.x) * l;
    j.shinR.rotation.x += (-rKneeX - j.shinR.rotation.x) * l;
  }
}

export const createRiggedCharacter: CharFactory = (look) => new RiggedCharacter(look);
