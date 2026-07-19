import * as THREE from 'three';
import { dampV3, clamp } from '../core/math3d';
import { CAMERA_FEEL, TeamSide, sideSign } from '../core/constants';
import type { CamMode } from '../game/camera/CameraMode';
export { camModeForTouch } from '../game/camera/CameraMode';
export type { CamMode } from '../game/camera/CameraMode';
import type { CameraGroundBasis } from '../core/input/CameraSpaceMapper';
import type { MotionProfile } from './camera/MotionProfile';
import type { BroadcastFrameSolution, CameraFrame, SafeFrame } from './camera/CameraFrame';
import { solveBroadcastFrame } from './camera/solveBroadcastFrame';

// Enquadramento do próximo contato: dramático (close-up) na cortada, broadcast no resto.
// Mantém a câmera em 'spike' só durante o ataque; passe/levantamento/defesa voltam a 'rally'.
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
  private shakeAge = 0;
  private shakePhase = 0;
  private baseFov = CAMERA_FEEL.baseFov;
  private fovKick = 0;
  private fovKickStart = 0;
  private fovKickPeak = 0;
  private fovKickAge = Number.POSITIVE_INFINITY;
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
  private frame: CameraFrame | null = null;
  private safeFrame: SafeFrame | null = null;
  private solution: BroadcastFrameSolution | null = null;
  private activeMode: CamMode = 'menu';
  private viewSignature = '';
  private viewWidth = 0;
  private viewHeight = 0;
  private viewOffsetX = 0;
  private viewOffsetY = 0;
  private targetViewOffsetX = 0;
  private targetViewOffsetY = 0;
  private projectionScratch = new THREE.Vector3();

  // referências dinâmicas atualizadas pelo jogo
  ballPos = new THREE.Vector3();
  servePos = new THREE.Vector3();

  constructor(
    aspect: number,
    private motionProfile: MotionProfile = 'full',
  ) {
    this.camera = new THREE.PerspectiveCamera(this.baseFov, aspect, 0.1, 200);
    this.camera.position.copy(this.pos);
  }

  private shakeEnabled = true;

  setMotionPreferences(profile: MotionProfile, shakeEnabled: boolean): void {
    this.motionProfile = profile;
    this.shakeEnabled = profile === 'full' && shakeEnabled;
    if (this.shakeEnabled) return;
    this.shake = 0;
    this.shakeOff.set(0, 0, 0);
    this.fovKick = 0;
    this.fovKickStart = 0;
    this.fovKickPeak = 0;
  }

  private decorativeMotionEnabled(): boolean {
    return this.motionProfile === 'full' && this.shakeEnabled;
  }

  setMode(mode: CamMode, opts?: { cut?: boolean; side?: TeamSide }): void {
    if (this.mode === mode && mode !== 'serveHome' && mode !== 'serveAway') return;
    this.mode = mode;
    this.orbitT = 0;
    if (opts?.side !== undefined) this.pointSide = opts.side;
    this.computeTargets(0);
    if (opts?.cut && this.decorativeMotionEnabled()) {
      this.pos.copy(this.targetPos);
      this.look.copy(this.targetLook);
    }
  }

  setFrame(frame: CameraFrame, safeFrame: SafeFrame): void {
    this.frame = frame;
    this.safeFrame = safeFrame;
    this.solution = solveBroadcastFrame(
      frame,
      safeFrame,
      this.solution ?? undefined,
      this.solution ?? undefined,
    );
    this.applySafeViewOffset();
  }

  presentationSnapshot() {
    this.camera.updateMatrixWorld();
    const actualSubjects = this.frame
      ? Object.freeze({
          ball: this.projectToViewport(this.frame.ball),
          controlled: this.frame.controlled
            ? this.projectToViewport(this.frame.controlled)
            : undefined,
          destination: this.frame.destination
            ? this.projectToViewport(this.frame.destination)
            : undefined,
        })
      : null;
    return Object.freeze({
      requestedMode: this.mode,
      activeMode: this.activeMode,
      motionProfile: this.motionProfile,
      fov: this.camera.fov,
      position: Object.freeze({
        x: this.camera.position.x,
        y: this.camera.position.y,
        z: this.camera.position.z,
      }),
      look: Object.freeze({ x: this.look.x, y: this.look.y, z: this.look.z }),
      solution: this.solution,
      actualSubjects,
    });
  }

  private projectToViewport(point: Readonly<{ x: number; y: number; z: number }>) {
    this.projectionScratch.set(point.x, point.y, point.z).project(this.camera);
    const viewport = this.safeFrame?.viewport ?? { width: 1, height: 1 };
    return Object.freeze({
      x: ((this.projectionScratch.x + 1) * viewport.width) / 2,
      y: ((1 - this.projectionScratch.y) * viewport.height) / 2,
    });
  }

  private applySafeViewOffset(): void {
    if (!this.solution || !this.safeFrame) return;
    const { width, height } = this.safeFrame.viewport;
    const safe = this.solution.safeRect;
    const offsetX = width / 2 - (safe.x + safe.width / 2);
    const offsetY = height / 2 - (safe.y + safe.height / 2);
    const signature = `${width}:${height}:${offsetX}:${offsetY}`;
    if (signature === this.viewSignature) return;
    this.viewSignature = signature;
    this.targetViewOffsetX = offsetX;
    this.targetViewOffsetY = offsetY;
    const viewportChanged = width !== this.viewWidth || height !== this.viewHeight;
    this.viewWidth = width;
    this.viewHeight = height;
    if (viewportChanged) {
      this.viewOffsetX = offsetX;
      this.viewOffsetY = offsetY;
      this.camera.setViewOffset(width, height, offsetX, offsetY, width, height);
    }
  }

  private updateSafeViewOffset(dt: number): void {
    if (this.viewWidth <= 0 || this.viewHeight <= 0) return;
    const t = 1 - Math.exp(-8 * Math.max(0, dt));
    const nextX = this.viewOffsetX + (this.targetViewOffsetX - this.viewOffsetX) * t;
    const nextY = this.viewOffsetY + (this.targetViewOffsetY - this.viewOffsetY) * t;
    if (Math.abs(nextX - this.viewOffsetX) < 0.01 && Math.abs(nextY - this.viewOffsetY) < 0.01)
      return;
    this.viewOffsetX = nextX;
    this.viewOffsetY = nextY;
    this.camera.setViewOffset(
      this.viewWidth,
      this.viewHeight,
      this.viewOffsetX,
      this.viewOffsetY,
      this.viewWidth,
      this.viewHeight,
    );
  }

  addShake(amount: number): void {
    if (!this.decorativeMotionEnabled()) return;
    this.shake = Math.min(1, this.shake + amount);
    this.shakeAge = 0;
  }

  kickFov(amount: number = CAMERA_FEEL.fovKickMax): void {
    if (!this.decorativeMotionEnabled()) return;
    this.fovKickStart = this.fovKick;
    this.fovKickPeak = Math.min(
      CAMERA_FEEL.fovKickMax,
      Math.max(this.fovKick, Math.max(0, amount)),
    );
    this.fovKickAge = 0;
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
    this.activeMode = this.effectiveMode();
    switch (this.activeMode) {
      case 'menu': {
        if (this.decorativeMotionEnabled()) this.orbitT += dt * 0.14;
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
        if (this.solution) {
          this.applySolvedBroadcastFrame(false);
          break;
        }
        // câmera broadcast lateral que acompanha a bola com amortecimento
        const bx = clamp(this.ballPos.x, -8, 8);
        this.targetPos.set(bx * 0.5, 8.6, 18.0);
        this.targetLook.set(bx * 0.55, 1.5 + this.ballPos.y * 0.12, this.ballPos.z * 0.22);
        this.lambda = 2.6;
        break;
      }
      case 'spike': {
        if (this.solution) {
          this.applySolvedBroadcastFrame(true);
          break;
        }
        // aproximação dramática na hora do ataque
        const bx = clamp(this.ballPos.x, -6, 6);
        this.targetPos.set(bx * 0.4, 5.6, 13.5);
        this.targetLook.set(bx * 0.6, 2.3, this.ballPos.z * 0.4);
        this.lambda = 4.5;
        break;
      }
      case 'point': {
        // órbita lenta de celebração ao redor do lado que pontuou
        if (this.decorativeMotionEnabled()) this.orbitT += dt * 0.55;
        const cx = sideSign(this.pointSide) * 4.5;
        const a = this.orbitT + Math.PI * 0.5;
        this.targetPos.set(cx + Math.cos(a) * 8.5, 3.4, Math.sin(a) * 8.5);
        this.targetLook.set(cx, 1.3, 0);
        this.lambda = 2.2;
        break;
      }
      case 'setEnd': {
        if (this.decorativeMotionEnabled()) this.orbitT += dt * 0.3;
        this.targetPos.set(Math.cos(this.orbitT) * 16, 10, Math.sin(this.orbitT) * 16);
        this.targetLook.set(0, 2, 0);
        this.lambda = 1.5;
        break;
      }
    }
  }

  private effectiveMode(): CamMode {
    if (this.mode !== 'spike') return this.mode;
    const contactIn = this.frame?.contactIn;
    return contactIn !== null &&
      contactIn !== undefined &&
      contactIn <= CAMERA_FEEL.spikeAnticipationSeconds
      ? 'spike'
      : 'rally';
  }

  private applySolvedBroadcastFrame(spike: boolean): void {
    const solution = this.solution!;
    const viewportHeight = this.safeFrame?.viewport.height ?? 800;
    const distance =
      viewportHeight /
      (2 * Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2)) * solution.pixelsPerMeter);
    const zoomedDistance = clamp(distance * (spike ? 0.98 : 1.06), 10, 36);
    const focus = solution.focus;
    const centerZ = focus.z;
    const centerY = solution.projectedCenter.y + centerZ * 0.32;
    this.targetLook.set(solution.projectedCenter.x, centerY, centerZ);
    this.targetPos.set(
      solution.projectedCenter.x,
      centerY + zoomedDistance * 0.395,
      centerZ + zoomedDistance * 0.919,
    );
    this.lambda = spike ? 4.5 : 2.6;
  }

  update(dt: number): void {
    this.computeTargets(dt);
    this.updateSafeViewOffset(dt);
    dampV3(this.pos, this.targetPos, this.lambda, dt);
    dampV3(this.look, this.targetLook, this.lambda * 1.3, dt);

    // screen shake determinístico: fase e envelope avançam somente pelo dt da apresentação.
    this.shakeAge += dt;
    this.shakePhase += dt * CAMERA_FEEL.shakeFrequency;
    const shakeProgress = clamp(this.shakeAge / CAMERA_FEEL.shakeDurationSeconds, 0, 1);
    const shakePixels =
      (this.safeFrame?.viewport.height ?? 800) <= 500
        ? CAMERA_FEEL.shakeTouchPixels
        : CAMERA_FEEL.shakeDesktopPixels;
    const projectedWorldCap = shakePixels / Math.max(1, this.solution?.pixelsPerMeter ?? 1);
    const s =
      this.shake *
      (1 - shakeProgress) ** 2 *
      Math.min(CAMERA_FEEL.shakeWorldMax, projectedWorldCap);
    const t = this.shakePhase;
    // .set() sobrescreve x/y/z por completo — sem estado remanescente entre frames.
    this.shakeOff.set(
      Math.sin(t * 1.3) * s,
      Math.sin(t * 1.7 + 2) * s * 0.7,
      Math.cos(t * 1.1) * s,
    );

    this.camera.position.copy(this.pos).add(this.shakeOff);
    this.camera.lookAt(this.look);
    if (shakeProgress >= 1) this.shake = 0;

    this.updateFovEnvelope(dt);
    const fov = this.baseFov + this.fovKick;
    // só recalcula a projeção quando o FOV punch muda de fato; o aspect (resize) já
    // dispara updateProjectionMatrix() por conta própria no handler de resize (main.ts).
    if (Math.abs(fov - this.camera.fov) >= CAMERA_FEEL.fovProjectionEpsilon) {
      this.camera.fov = fov;
      this.camera.updateProjectionMatrix();
    }
  }

  private updateFovEnvelope(dt: number): void {
    if (!this.decorativeMotionEnabled()) {
      this.fovKick = 0;
      return;
    }
    this.fovKickAge += dt;
    if (this.fovKickAge <= CAMERA_FEEL.fovAttackSeconds) {
      const t = this.fovKickAge / CAMERA_FEEL.fovAttackSeconds;
      this.fovKick = this.fovKickStart + (this.fovKickPeak - this.fovKickStart) * t;
      return;
    }
    const releaseAge = this.fovKickAge - CAMERA_FEEL.fovAttackSeconds;
    if (releaseAge < CAMERA_FEEL.fovReleaseSeconds) {
      this.fovKick = this.fovKickPeak * (1 - releaseAge / CAMERA_FEEL.fovReleaseSeconds);
      return;
    }
    this.fovKick = 0;
  }
}
