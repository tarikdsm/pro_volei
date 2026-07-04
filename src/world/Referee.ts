import * as THREE from 'three';
import { COURT, TeamSide } from '../core/constants';

// Juiz na cadeira elevada ao lado da rede. Gestos: apontar o lado que pontuou, apito.
export class Referee {
  group = new THREE.Group();
  private leftArm: THREE.Group;
  private rightArm: THREE.Group;
  private gestureTime = -1;
  private gestureSide: TeamSide = TeamSide.HOME;

  constructor() {
    const skin = new THREE.MeshStandardMaterial({ color: 0xd6a77a, roughness: 0.8 });
    const shirt = new THREE.MeshStandardMaterial({ color: 0xfdd835, roughness: 0.7 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x263238, roughness: 0.8 });

    const torso = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.19, 0.55, 8), shirt);
    torso.position.y = 0.62;
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.115, 8, 7), skin);
    head.position.y = 1.05;
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.06, 8), dark);
    cap.position.y = 1.14;
    const hips = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.15, 0.3, 8), dark);
    hips.position.y = 0.22;

    this.leftArm = this.makeArm(skin, shirt);
    this.leftArm.position.set(0, 0.85, -0.2);
    this.rightArm = this.makeArm(skin, shirt);
    this.rightArm.position.set(0, 0.85, 0.2);

    this.group.add(torso, head, cap, hips, this.leftArm, this.rightArm);
    this.group.traverse((o) => { if (o instanceof THREE.Mesh) o.castShadow = true; });

    // sentado na cadeira do juiz (construída em Court.ts) — encaixa na posição
    this.group.position.set(0, 2.18, -(COURT.halfWidth + 1.55));
    this.group.rotation.y = 0; // olhando para a quadra (+z)
    this.restPose();
  }

  private makeArm(skin: THREE.Material, shirt: THREE.Material): THREE.Group {
    const arm = new THREE.Group();
    const upper = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.04, 0.28, 6), shirt);
    upper.position.y = -0.14;
    const hand = new THREE.Mesh(new THREE.SphereGeometry(0.05, 6, 5), skin);
    hand.position.y = -0.3;
    arm.add(upper, hand);
    return arm;
  }

  private restPose(): void {
    this.leftArm.rotation.set(0, 0, 0.25);
    this.rightArm.rotation.set(0, 0, -0.25);
  }

  /** gesto de ponto: braço estendido apontando para o lado que vai sacar */
  signalPoint(side: TeamSide): void {
    this.gestureTime = 0;
    this.gestureSide = side;
  }

  update(dt: number): void {
    if (this.gestureTime >= 0) {
      this.gestureTime += dt;
      const t = Math.min(1, this.gestureTime * 3);
      // juiz olha para a quadra em +z; HOME está à sua direita (x-)
      if (this.gestureSide === TeamSide.HOME) {
        this.rightArm.rotation.z = -0.25 - t * 1.3; // levanta braço apontando x-
        this.leftArm.rotation.z = 0.25;
      } else {
        this.leftArm.rotation.z = 0.25 + t * 1.3;
        this.rightArm.rotation.z = -0.25;
      }
      if (this.gestureTime > 2.2) {
        this.gestureTime = -1;
        this.restPose();
      }
    } else {
      // leve balanço de "observando o jogo"
      const t = performance.now() * 0.001;
      this.group.rotation.y = Math.sin(t * 0.4) * 0.15;
    }
  }
}
