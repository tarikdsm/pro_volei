import * as THREE from 'three';
import { dampV3, clamp } from '../core/math3d';
import { TeamSide, sideSign, TouchKind } from '../core/constants';
import type { CameraGroundBasis } from '../core/input/CameraSpaceMapper';

export type CamMode = 'menu' | 'serveHome' | 'serveAway' | 'rally' | 'spike' | 'point' | 'setEnd';

// Enquadramento do próximo contato: dramático (close-up) na cortada, broadcast no resto.
// Mantém a câmera em 'spike' só durante o ataque; passe/levantamento/defesa voltam a 'rally'.
export function camModeForTouch(nextKind: TouchKind): CamMode {
  return nextKind === 'spike' ? 'spike' : 'rally';
}

// Diretor de câmera estilo transmissão de TV: enquadramentos por momento de jogo,
// transições amortecidas, cortes secos no saque, FOV punch e screen shake.
export class CameraDirector {
  camera: THREE.PerspectiveCamera;
  mode: CamMode = 'menu';
  private pos = new THREE.Vector3(20, 12, 20);
  private look = new THREE.Vector3(0, 1, 0);
  private targetPos = new THREE.Vector3();
  private targetLook = new THREE.Vector3();
  // escratch reutilizado do deslocamento do screen shake (evita 1 Vector3/frame).
  private shakeOff = new THREE.Vector3();
  private lambda = 3;
  private shake = 0;
  private baseFov = 55;
  private fovKick = 0;
  private orbitT = 0;
  private pointSide: TeamSide = TeamSide.HOME;
  private inputRight = new THREE.Vector3();
  private inputUp = new THREE.Vector3();
  private lastInputBasis: CameraGroundBasis = {
    screenRight: { x: 1, z: 0 },
    screenUp: { x: 0, z: -1 },
    revision: 0,
  };
  private hasMeasuredInputBasis = false;

  // referências dinâmicas atualizadas pelo jogo
  ballPos = new THREE.Vector3();
  servePos = new THREE.Vector3();

  constructor(aspect: number) {
    this.camera = new THREE.PerspectiveCamera(this.baseFov, aspect, 0.1, 200);
    this.camera.position.copy(this.pos);
  }

  setMode(mode: CamMode, opts?: { cut?: boolean; side?: TeamSide }): void {
    if (this.mode === mode && mode !== 'serveHome' && mode !== 'serveAway') return;
    this.mode = mode;
    this.orbitT = 0;
    if (opts?.side !== undefined) this.pointSide = opts.side;
    this.computeTargets(0);
    if (opts?.cut) {
      this.pos.copy(this.targetPos);
      this.look.copy(this.targetLook);
    }
  }

  addShake(amount: number): void {
    this.shake = Math.min(1, this.shake + amount);
  }

  kickFov(amount = 8): void {
    this.fovKick = amount;
  }

  inputBasis(): CameraGroundBasis {
    this.inputRight.set(1, 0, 0).applyQuaternion(this.camera.quaternion);
    this.inputUp.set(0, 1, 0).applyQuaternion(this.camera.quaternion);

    const rightLength = Math.hypot(this.inputRight.x, this.inputRight.z);
    const upLength = Math.hypot(this.inputUp.x, this.inputUp.z);
    if (rightLength <= 1e-9 || upLength <= 1e-9) return this.copyInputBasis();

    const screenRight = {
      x: this.inputRight.x / rightLength,
      z: this.inputRight.z / rightLength,
    };
    const screenUp = {
      x: this.inputUp.x / upLength,
      z: this.inputUp.z / upLength,
    };
    const changed =
      !this.hasMeasuredInputBasis ||
      Math.abs(screenRight.x - this.lastInputBasis.screenRight.x) > 1e-6 ||
      Math.abs(screenRight.z - this.lastInputBasis.screenRight.z) > 1e-6 ||
      Math.abs(screenUp.x - this.lastInputBasis.screenUp.x) > 1e-6 ||
      Math.abs(screenUp.z - this.lastInputBasis.screenUp.z) > 1e-6;

    if (changed) {
      this.lastInputBasis = {
        screenRight,
        screenUp,
        revision: this.lastInputBasis.revision + 1,
      };
      this.hasMeasuredInputBasis = true;
    }

    return this.copyInputBasis();
  }

  private copyInputBasis(): CameraGroundBasis {
    return {
      screenRight: { ...this.lastInputBasis.screenRight },
      screenUp: { ...this.lastInputBasis.screenUp },
      revision: this.lastInputBasis.revision,
    };
  }

  private computeTargets(dt: number): void {
    switch (this.mode) {
      case 'menu': {
        this.orbitT += dt * 0.14;
        const r = 22;
        this.targetPos.set(
          Math.cos(this.orbitT) * r,
          9 + Math.sin(this.orbitT * 0.7) * 2.5,
          Math.sin(this.orbitT) * r,
        );
        this.targetLook.set(0, 1.5, 0);
        this.lambda = 1.2;
        break;
      }
      case 'serveHome': {
        // atrás e acima do sacador humano, com ele inteiro no quadro
        this.targetPos.set(this.servePos.x - 5.2, this.servePos.y + 2.7, this.servePos.z * 0.85);
        this.targetLook.set(0.5, 1.0, this.servePos.z * 0.35);
        this.lambda = 4;
        break;
      }
      case 'serveAway': {
        // visão de quem recebe: atrás do campo humano, elevada
        this.targetPos.set(-15.5, 6.4, 0);
        this.targetLook.set(3, 1.4, 0);
        this.lambda = 3;
        break;
      }
      case 'rally': {
        // câmera broadcast lateral que acompanha a bola com amortecimento
        const bx = clamp(this.ballPos.x, -8, 8);
        this.targetPos.set(bx * 0.5, 8.6, 18.0);
        this.targetLook.set(bx * 0.55, 1.5 + this.ballPos.y * 0.12, this.ballPos.z * 0.22);
        this.lambda = 2.6;
        break;
      }
      case 'spike': {
        // aproximação dramática na hora do ataque
        const bx = clamp(this.ballPos.x, -6, 6);
        this.targetPos.set(bx * 0.4, 5.6, 13.5);
        this.targetLook.set(bx * 0.6, 2.3, this.ballPos.z * 0.4);
        this.lambda = 4.5;
        break;
      }
      case 'point': {
        // órbita lenta de celebração ao redor do lado que pontuou
        this.orbitT += dt * 0.55;
        const cx = sideSign(this.pointSide) * 4.5;
        const a = this.orbitT + Math.PI * 0.5;
        this.targetPos.set(cx + Math.cos(a) * 8.5, 3.4, Math.sin(a) * 8.5);
        this.targetLook.set(cx, 1.3, 0);
        this.lambda = 2.2;
        break;
      }
      case 'setEnd': {
        this.orbitT += dt * 0.3;
        this.targetPos.set(Math.cos(this.orbitT) * 16, 10, Math.sin(this.orbitT) * 16);
        this.targetLook.set(0, 2, 0);
        this.lambda = 1.5;
        break;
      }
    }
  }

  update(dt: number): void {
    this.computeTargets(dt);
    dampV3(this.pos, this.targetPos, this.lambda, dt);
    dampV3(this.look, this.targetLook, this.lambda * 1.3, dt);

    // screen shake com decaimento
    this.shake = Math.max(0, this.shake - dt * 2.4);
    const s = this.shake * this.shake * 0.35;
    const t = performance.now() * 0.045;
    // .set() sobrescreve x/y/z por completo — sem estado remanescente entre frames.
    this.shakeOff.set(
      Math.sin(t * 1.3) * s,
      Math.sin(t * 1.7 + 2) * s * 0.7,
      Math.cos(t * 1.1) * s,
    );

    this.camera.position.copy(this.pos).add(this.shakeOff);
    this.camera.lookAt(this.look);

    // FOV punch decai de volta ao normal
    this.fovKick = Math.max(0, this.fovKick - dt * 26);
    const fov = this.baseFov + this.fovKick;
    // só recalcula a projeção quando o FOV punch muda de fato; o aspect (resize) já
    // dispara updateProjectionMatrix() por conta própria no handler de resize (main.ts).
    if (fov !== this.camera.fov) {
      this.camera.fov = fov;
      this.camera.updateProjectionMatrix();
    }
  }
}
