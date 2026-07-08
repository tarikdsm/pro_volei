import * as THREE from 'three';
import { dampV3, clamp } from '../core/math3d';
import { TeamSide, sideSign } from '../core/constants';

export type CamMode = 'menu' | 'serveHome' | 'serveAway' | 'rally' | 'spike' | 'point' | 'setEnd';

// Diretor de câmera estilo transmissão de TV: enquadramentos por momento de jogo,
// transições amortecidas, cortes secos no saque, FOV punch e screen shake.
export class CameraDirector {
  camera: THREE.PerspectiveCamera;
  mode: CamMode = 'menu';
  private pos = new THREE.Vector3(20, 12, 20);
  private look = new THREE.Vector3(0, 1, 0);
  private targetPos = new THREE.Vector3();
  private targetLook = new THREE.Vector3();
  private lambda = 3;
  private shake = 0;
  private baseFov = 55;
  private fovKick = 0;
  private orbitT = 0;
  private pointSide: TeamSide = TeamSide.HOME;

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
    const off = new THREE.Vector3(
      Math.sin(t * 1.3) * s,
      Math.sin(t * 1.7 + 2) * s * 0.7,
      Math.cos(t * 1.1) * s,
    );

    this.camera.position.copy(this.pos).add(off);
    this.camera.lookAt(this.look);

    // FOV punch decai de volta ao normal
    this.fovKick = Math.max(0, this.fovKick - dt * 26);
    this.camera.fov = this.baseFov + this.fovKick;
    this.camera.updateProjectionMatrix();
  }
}
