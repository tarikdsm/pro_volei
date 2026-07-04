import * as THREE from 'three';

export type CharAction =
  | 'idle' | 'run' | 'bump' | 'set' | 'spikeWindup' | 'spikeHit'
  | 'block' | 'serveToss' | 'serveHit' | 'dive' | 'celebrate' | 'dejected';

export interface CharLook {
  jersey: number;
  shorts: number;
  skin: number;
  hair: number;
  number: number;
}

// Humanoide low-poly procedural com juntas animadas por código (sem assets externos).
export class PlayerCharacter {
  root = new THREE.Group();       // no chão, rotação = direção que encara
  private body = new THREE.Group(); // sobe ao pular
  private torso!: THREE.Group;
  private head!: THREE.Mesh;
  private lSh!: THREE.Group; private rSh!: THREE.Group;
  private lEl!: THREE.Group; private rEl!: THREE.Group;
  private lHip!: THREE.Group; private rHip!: THREE.Group;
  private lKnee!: THREE.Group; private rKnee!: THREE.Group;

  action: CharAction = 'idle';
  actionTime = 0;
  runPhase = 0;
  moveSpeed = 0;       // velocidade atual de deslocamento (para animação de corrida)
  jumpY = 0;           // altura do pulo (controlada pela lógica do jogo)

  constructor(look: CharLook) {
    const skinMat = new THREE.MeshStandardMaterial({ color: look.skin, roughness: 0.75 });
    const jerseyMat = new THREE.MeshStandardMaterial({ color: look.jersey, roughness: 0.7 });
    const shortsMat = new THREE.MeshStandardMaterial({ color: look.shorts, roughness: 0.75 });
    const hairMat = new THREE.MeshStandardMaterial({ color: look.hair, roughness: 0.9 });
    const shoeMat = new THREE.MeshStandardMaterial({ color: 0xf5f5f5, roughness: 0.6 });

    // ----- tronco (pivô nos quadris) -----
    this.torso = new THREE.Group();
    this.torso.position.y = 0.95;

    const chest = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.52, 0.42), jerseyMat);
    chest.position.y = 0.28;
    this.torso.add(chest);

    // número no peito e costas (canvas)
    const numTex = makeNumberTexture(look.number);
    for (const s of [1, -1]) {
      const plane = new THREE.Mesh(
        new THREE.PlaneGeometry(0.26, 0.3),
        new THREE.MeshBasicMaterial({ map: numTex, transparent: true }),
      );
      plane.position.set(s * 0.155, 0.3, 0);
      plane.rotation.y = s > 0 ? Math.PI / 2 : -Math.PI / 2;
      this.torso.add(plane);
    }

    this.head = new THREE.Mesh(new THREE.SphereGeometry(0.13, 10, 8), skinMat);
    this.head.position.y = 0.68;
    this.torso.add(this.head);
    const hair = new THREE.Mesh(new THREE.SphereGeometry(0.135, 10, 6, 0, Math.PI * 2, 0, Math.PI * 0.55), hairMat);
    hair.position.y = 0.71;
    this.torso.add(hair);

    // ----- braços (pivô no ombro; braço aponta para baixo em repouso) -----
    const mkArm = (side: 1 | -1) => {
      const sh = new THREE.Group();
      sh.position.set(0, 0.5, side * 0.26);
      const upper = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.05, 0.3, 7), jerseyMat);
      upper.position.y = -0.15;
      sh.add(upper);
      const el = new THREE.Group();
      el.position.y = -0.3;
      const fore = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.04, 0.28, 7), skinMat);
      fore.position.y = -0.14;
      el.add(fore);
      const hand = new THREE.Mesh(new THREE.SphereGeometry(0.05, 6, 5), skinMat);
      hand.position.y = -0.3;
      el.add(hand);
      sh.add(el);
      this.torso.add(sh);
      return { sh, el };
    };
    const ra = mkArm(1);  // z+ = direita do personagem
    const la = mkArm(-1);
    this.rSh = ra.sh; this.rEl = ra.el;
    this.lSh = la.sh; this.lEl = la.el;

    // ----- pernas (pivô no quadril) -----
    const mkLeg = (side: 1 | -1) => {
      const hip = new THREE.Group();
      hip.position.set(0, 0.95, side * 0.11);
      const thigh = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.06, 0.42, 7), shortsMat);
      thigh.position.y = -0.21;
      hip.add(thigh);
      const knee = new THREE.Group();
      knee.position.y = -0.42;
      const shin = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.045, 0.42, 7), skinMat);
      shin.position.y = -0.21;
      knee.add(shin);
      const shoe = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.08, 0.1), shoeMat);
      shoe.position.set(0.05, -0.44, 0);
      knee.add(shoe);
      hip.add(knee);
      this.body.add(hip);
      return { hip, knee };
    };
    const rl = mkLeg(1);
    const ll = mkLeg(-1);
    this.rHip = rl.hip; this.rKnee = rl.knee;
    this.lHip = ll.hip; this.lKnee = ll.knee;

    this.body.add(this.torso);
    this.root.add(this.body);
    this.root.traverse((o) => { if (o instanceof THREE.Mesh) o.castShadow = true; });
  }

  setAction(a: CharAction): void {
    if (this.action !== a) {
      this.action = a;
      this.actionTime = 0;
    }
  }

  // Pose paramétrica computada a cada frame — transições suaves via damping das juntas.
  update(dt: number): void {
    this.actionTime += dt;
    this.runPhase += dt * Math.max(2, this.moveSpeed * 2.6);
    this.body.position.y = this.jumpY;

    const t = this.actionTime;
    const p: Pose = defaultPose();

    switch (this.action) {
      case 'idle': {
        const bob = Math.sin(performance.now() * 0.0022 + this.root.id) * 0.04;
        p.torsoPitch = 0.22;
        p.hips = 0.32; p.knees = -0.55;
        p.lShX = 0.65 + bob; p.rShX = 0.65 - bob;
        p.lElX = -0.5; p.rElX = -0.5;
        break;
      }
      case 'run': {
        const s = Math.sin(this.runPhase), c = Math.cos(this.runPhase);
        p.torsoPitch = 0.3;
        p.lHipX = s * 0.7; p.rHipX = -s * 0.7;
        p.lKneeX = -0.4 - Math.max(0, c) * 0.7; p.rKneeX = -0.4 - Math.max(0, -c) * 0.7;
        p.lShX = -s * 0.8 + 0.2; p.rShX = s * 0.8 + 0.2;
        p.lElX = -0.7; p.rElX = -0.7;
        break;
      }
      case 'bump': { // manchete: braços juntos estendidos à frente/baixo
        const k = ease01(t * 6);
        p.torsoPitch = 0.5 * k;
        p.hips = 0.5; p.knees = -0.8;
        p.lShX = 1.05 * k; p.rShX = 1.05 * k;
        p.lShZ = -0.25 * k; p.rShZ = 0.25 * k;
        p.lElX = 0; p.rElX = 0;
        break;
      }
      case 'set': { // toque: mãos acima da testa
        const k = ease01(t * 6);
        p.torsoPitch = -0.08 * k;
        p.hips = 0.25; p.knees = -0.4;
        p.lShX = 2.6 * k; p.rShX = 2.6 * k;
        p.lShZ = -0.4 * k; p.rShZ = 0.4 * k;
        p.lElX = -0.85 * k; p.rElX = -0.85 * k;
        break;
      }
      case 'spikeWindup': { // no ar, armando o braço
        const k = ease01(t * 5);
        p.torsoPitch = -0.15;
        p.torsoYaw = -0.35 * k;
        p.rShX = -2.4 * k;          // braço de ataque atrás/acima
        p.rElX = -1.2 * k;
        p.lShX = 1.8 * k;           // braço de equilíbrio à frente
        p.lElX = -0.4;
        p.lHipX = 0.5; p.rHipX = 0.2;
        p.lKneeX = -0.9; p.rKneeX = -0.9;
        break;
      }
      case 'spikeHit': { // chicotada do braço
        const k = ease01(t * 10);
        p.torsoPitch = 0.35 * k;
        p.torsoYaw = 0.25 * k;
        p.rShX = -2.4 + 3.4 * k;    // whip: de trás para frente/baixo
        p.rElX = -0.15;
        p.lShX = 0.6; p.lElX = -0.5;
        p.lKneeX = -0.5; p.rKneeX = -0.5;
        break;
      }
      case 'block': { // braços retos para cima
        const k = ease01(t * 8);
        p.torsoPitch = 0.02;
        p.lShX = 2.95 * k; p.rShX = 2.95 * k;
        p.lShZ = -0.18; p.rShZ = 0.18;
        p.lElX = 0; p.rElX = 0;
        break;
      }
      case 'serveToss': {
        const k = ease01(t * 4);
        p.torsoPitch = -0.1;
        p.lShX = 2.6 * k;           // braço esquerdo lança a bola
        p.lElX = -0.2;
        p.rShX = -1.9 * k;          // direito armado atrás
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
      case 'dive': { // peixinho
        const k = ease01(t * 7);
        p.torsoPitch = 1.25 * k;
        p.lShX = 1.6 * k; p.rShX = 1.6 * k;
        p.lElX = 0; p.rElX = 0;
        p.lHipX = -0.6 * k; p.rHipX = -0.6 * k;
        p.lKneeX = -0.3; p.rKneeX = -0.3;
        break;
      }
      case 'celebrate': {
        const bounce = Math.abs(Math.sin(t * 6));
        p.torsoPitch = -0.12;
        p.lShX = 2.9; p.rShX = 2.9;
        p.lShZ = -0.45; p.rShZ = 0.45;
        p.lElX = -0.25; p.rElX = -0.25;
        this.body.position.y = this.jumpY + bounce * 0.22;
        break;
      }
      case 'dejected': {
        const k = ease01(t * 3);
        p.torsoPitch = 0.55 * k;
        p.headPitch = 0.5 * k;
        p.lShX = 0.15; p.rShX = 0.15;
        p.lElX = -0.1; p.rElX = -0.1;
        p.hips = 0.25; p.knees = -0.35;
        break;
      }
    }

    // aplica com amortecimento p/ transições suaves
    const l = 1 - Math.exp(-16 * dt);
    this.torso.rotation.x += (p.torsoPitch - this.torso.rotation.x) * l;
    this.torso.rotation.y += (p.torsoYaw - this.torso.rotation.y) * l;
    this.head.rotation.x += (p.headPitch - this.head.rotation.x) * l;
    this.lSh.rotation.x += (p.lShX - this.lSh.rotation.x) * l;
    this.rSh.rotation.x += (p.rShX - this.rSh.rotation.x) * l;
    this.lSh.rotation.z += (p.lShZ - this.lSh.rotation.z) * l;
    this.rSh.rotation.z += (p.rShZ - this.rSh.rotation.z) * l;
    this.lEl.rotation.x += (p.lElX - this.lEl.rotation.x) * l;
    this.rEl.rotation.x += (p.rElX - this.rEl.rotation.x) * l;

    const lHipX = p.lHipX !== 0 ? p.lHipX : p.hips;
    const rHipX = p.rHipX !== 0 ? p.rHipX : p.hips;
    const lKneeX = p.lKneeX !== 0 ? p.lKneeX : p.knees;
    const rKneeX = p.rKneeX !== 0 ? p.rKneeX : p.knees;
    this.lHip.rotation.x += (lHipX - this.lHip.rotation.x) * l;
    this.rHip.rotation.x += (rHipX - this.rHip.rotation.x) * l;
    this.lKnee.rotation.x += (lKneeX - this.lKnee.rotation.x) * l;
    this.rKnee.rotation.x += (rKneeX - this.rKnee.rotation.x) * l;
  }
}

interface Pose {
  torsoPitch: number; torsoYaw: number; headPitch: number;
  lShX: number; rShX: number; lShZ: number; rShZ: number;
  lElX: number; rElX: number;
  lHipX: number; rHipX: number; lKneeX: number; rKneeX: number;
  hips: number; knees: number;
}

function defaultPose(): Pose {
  return {
    torsoPitch: 0.1, torsoYaw: 0, headPitch: 0,
    lShX: 0.3, rShX: 0.3, lShZ: -0.12, rShZ: 0.12,
    lElX: -0.35, rElX: -0.35,
    lHipX: 0, rHipX: 0, lKneeX: 0, rKneeX: 0,
    hips: 0.12, knees: -0.2,
  };
}

function ease01(t: number): number {
  const x = Math.min(1, Math.max(0, t));
  return 1 - Math.pow(1 - x, 3);
}

function makeNumberTexture(n: number): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 128; canvas.height = 128;
  const c = canvas.getContext('2d')!;
  c.clearRect(0, 0, 128, 128);
  c.font = 'bold 84px Arial';
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  c.lineWidth = 10;
  c.strokeStyle = 'rgba(0,0,0,0.35)';
  c.strokeText(String(n), 64, 68);
  c.fillStyle = '#ffffff';
  c.fillText(String(n), 64, 68);
  const tex = new THREE.CanvasTexture(canvas);
  return tex;
}
