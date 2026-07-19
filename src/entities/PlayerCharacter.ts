import * as THREE from 'three';

// Predicado de sombra: planos decorativos (número no peito, nome nas costas) usam
// MeshBasicMaterial transparente e não devem projetar sombra — só desperdiçam draw
// calls no shadow pass, sem contribuir com nada visível (ficam colados ao peito).
// Contrato: MeshBasicMaterial = estampa decorativa sem sombra; corpo sólido usa
// MeshStandardMaterial e continua projetando sombra normalmente.
export function meshCastsShadow(mesh: THREE.Mesh): boolean {
  const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
  return !mats.some((m) => m instanceof THREE.MeshBasicMaterial);
}

export type CharAction =
  | 'idle'
  | 'run'
  | 'bump'
  | 'set'
  | 'spikeWindup'
  | 'spikeHit'
  | 'block'
  | 'serveToss'
  | 'serveHit'
  | 'dive'
  | 'celebrate'
  | 'dejected';

export interface CharLook {
  jersey: number;
  shorts: number;
  skin: number;
  hair: number;
  number: number;
  /** nome impresso nas costas da camisa */
  name?: string;
  hairstyle?: 'short' | 'long' | 'ponytail' | 'bun' | 'braid';
  female?: boolean;
  /** Escalas visuais do corpo (Fase 4C) — apresentação pura, não afetam física/alcance. */
  heightScale?: number;
  buildScale?: number;
}

// Superfície visual mínima que a lógica de Athlete/Team consome do personagem.
// Manter enxuta permite injetar um dublê nos testes (Node não tem DOM/canvas,
// que o PlayerCharacter real usa em makeJerseyTexture).
export interface CharVisual {
  root: THREE.Object3D;
  moveSpeed: number;
  jumpY: number;
  setAction(a: CharAction): void;
  update(dt: number): void;
  presentJump?(jumpY: number): void;
  /** Locomoção direcional no referencial da atleta (m/s; frente/esquerda positivos). */
  setPlanarMotion?(forward: number, lateral: number, braking: boolean): void;
  /** Alvo de contato no referencial do root; a implementação expira após `inSeconds`. */
  setContactAim?(x: number, y: number, z: number, inSeconds: number): void;
  /** Atualização puramente visual dos materiais do uniforme. */
  setUniform?(jersey: number, shorts: number): void;
}

// Fábrica de personagem visual (default no browser = new PlayerCharacter).
export type CharFactory = (look: CharLook) => CharVisual;

// Humanoide low-poly procedural com juntas animadas por código (sem assets externos).
// Convenção: frente do personagem = local +z (padrão Three.js). Braços no eixo x,
// número no peito (+z) e nome+número nas costas (−z).
export class PlayerCharacter implements CharVisual {
  root = new THREE.Group(); // no chão, rotação = direção que encara
  private body = new THREE.Group(); // sobe ao pular
  private torso!: THREE.Group;
  private head!: THREE.Mesh;
  private lSh!: THREE.Group;
  private rSh!: THREE.Group;
  private lEl!: THREE.Group;
  private rEl!: THREE.Group;
  private lHip!: THREE.Group;
  private rHip!: THREE.Group;
  private lKnee!: THREE.Group;
  private rKnee!: THREE.Group;
  private readonly jerseyMaterial: THREE.MeshStandardMaterial;
  private readonly shortsMaterial: THREE.MeshStandardMaterial;

  action: CharAction = 'idle';
  actionTime = 0;
  runPhase = 0;
  moveSpeed = 0; // velocidade atual de deslocamento (para animação de corrida)
  jumpY = 0; // altura do pulo (controlada pela lógica do jogo)

  constructor(look: CharLook) {
    const skinMat = new THREE.MeshStandardMaterial({ color: look.skin, roughness: 0.75 });
    this.jerseyMaterial = new THREE.MeshStandardMaterial({ color: look.jersey, roughness: 0.7 });
    this.shortsMaterial = new THREE.MeshStandardMaterial({ color: look.shorts, roughness: 0.75 });
    const jerseyMat = this.jerseyMaterial;
    const shortsMat = this.shortsMaterial;
    const hairMat = new THREE.MeshStandardMaterial({ color: look.hair, roughness: 0.9 });
    const shoeMat = new THREE.MeshStandardMaterial({ color: 0xf5f5f5, roughness: 0.6 });

    const chestW = look.female ? 0.38 : 0.42;

    // ----- tronco (pivô nos quadris) -----
    this.torso = new THREE.Group();
    this.torso.position.y = 0.95;

    const chest = new THREE.Mesh(new THREE.BoxGeometry(chestW, 0.52, 0.3), jerseyMat);
    chest.position.y = 0.28;
    this.torso.add(chest);

    // número no peito (frente, +z) e nome+número nas costas (−z)
    const frontTex = makeJerseyTexture(look.number);
    const front = new THREE.Mesh(
      new THREE.PlaneGeometry(0.26, 0.3),
      new THREE.MeshBasicMaterial({ map: frontTex, transparent: true }),
    );
    front.position.set(0, 0.3, 0.155);
    this.torso.add(front);

    const backTex = makeJerseyTexture(look.number, look.name);
    const back = new THREE.Mesh(
      new THREE.PlaneGeometry(0.34, 0.38),
      new THREE.MeshBasicMaterial({ map: backTex, transparent: true }),
    );
    back.position.set(0, 0.28, -0.155);
    back.rotation.y = Math.PI;
    this.torso.add(back);

    this.head = new THREE.Mesh(new THREE.SphereGeometry(0.13, 10, 8), skinMat);
    this.head.position.y = 0.68;
    this.torso.add(this.head);

    // ----- cabelo -----
    const style = look.hairstyle ?? 'short';
    const cap = new THREE.Mesh(
      new THREE.SphereGeometry(
        0.135,
        10,
        6,
        0,
        Math.PI * 2,
        0,
        Math.PI * (style === 'short' ? 0.55 : 0.62),
      ),
      hairMat,
    );
    cap.position.y = 0.71;
    this.torso.add(cap);
    if (style === 'long') {
      // cabelo liso na altura dos ombros (não cobre o nome na camisa)
      const sheet = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.24, 0.06), hairMat);
      sheet.position.set(0, 0.58, -0.13);
      this.torso.add(sheet);
      const sides = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.16, 0.16), hairMat);
      sides.position.set(0, 0.66, -0.05);
      this.torso.add(sides);
    } else if (style === 'ponytail') {
      // rabo de cavalo: tufo + cauda caindo atrás
      const tuft = new THREE.Mesh(new THREE.SphereGeometry(0.055, 8, 6), hairMat);
      tuft.position.set(0, 0.78, -0.11);
      this.torso.add(tuft);
      const tail = new THREE.Mesh(new THREE.CylinderGeometry(0.032, 0.018, 0.3, 7), hairMat);
      tail.position.set(0, 0.62, -0.16);
      tail.rotation.x = 0.25;
      this.torso.add(tail);
    }

    // ----- braços (pivô no ombro, x = lados; braço aponta para baixo em repouso) -----
    const mkArm = (side: 1 | -1) => {
      const sh = new THREE.Group();
      sh.position.set(side * (chestW / 2 + 0.05), 0.5, 0);
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
    const ra = mkArm(1); // +x = direita do personagem
    const la = mkArm(-1);
    this.rSh = ra.sh;
    this.rEl = ra.el;
    this.lSh = la.sh;
    this.lEl = la.el;

    // ----- pernas (pivô no quadril) -----
    const mkLeg = (side: 1 | -1) => {
      const hip = new THREE.Group();
      hip.position.set(side * 0.11, 0.95, 0);
      const thigh = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.06, 0.42, 7), shortsMat);
      thigh.position.y = -0.21;
      hip.add(thigh);
      const knee = new THREE.Group();
      knee.position.y = -0.42;
      const shin = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.045, 0.42, 7), skinMat);
      shin.position.y = -0.21;
      knee.add(shin);
      const shoe = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.08, 0.14), shoeMat);
      shoe.position.set(0, -0.44, 0.05);
      knee.add(shoe);
      hip.add(knee);
      this.body.add(hip);
      return { hip, knee };
    };
    const rl = mkLeg(1);
    const ll = mkLeg(-1);
    this.rHip = rl.hip;
    this.rKnee = rl.knee;
    this.lHip = ll.hip;
    this.lKnee = ll.knee;

    this.body.add(this.torso);
    this.root.add(this.body);
    this.root.traverse((o) => {
      if (o instanceof THREE.Mesh) o.castShadow = meshCastsShadow(o);
    });
  }

  setUniform(jersey: number, shorts: number): void {
    this.jerseyMaterial.color.setHex(jersey);
    this.shortsMaterial.color.setHex(shorts);
  }

  setAction(a: CharAction): void {
    if (this.action !== a) {
      this.action = a;
      this.actionTime = 0;
    }
  }

  presentJump(jumpY: number): void {
    this.body.position.y = jumpY;
  }

  // Pose paramétrica computada a cada frame — transições suaves via damping das juntas.
  // Convenção dos valores de pose: positivo = membro à frente/para cima.
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
        p.hips = 0.32;
        p.knees = -0.55;
        p.lShX = 0.65 + bob;
        p.rShX = 0.65 - bob;
        p.lElX = -0.5;
        p.rElX = -0.5;
        break;
      }
      case 'run': {
        const s = Math.sin(this.runPhase),
          c = Math.cos(this.runPhase);
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
        this.body.position.y = this.jumpY + bounce * 0.22;
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

    // aplica com amortecimento p/ transições suaves.
    // Ombros/quadris/joelhos são negados: pose positiva = à frente (+z do modelo).
    const l = 1 - Math.exp(-16 * dt);
    this.torso.rotation.x += (p.torsoPitch - this.torso.rotation.x) * l;
    this.torso.rotation.y += (p.torsoYaw - this.torso.rotation.y) * l;
    this.head.rotation.x += (p.headPitch - this.head.rotation.x) * l;
    this.lSh.rotation.x += (-p.lShX - this.lSh.rotation.x) * l;
    this.rSh.rotation.x += (-p.rShX - this.rSh.rotation.x) * l;
    this.lSh.rotation.z += (p.lShZ - this.lSh.rotation.z) * l;
    this.rSh.rotation.z += (p.rShZ - this.rSh.rotation.z) * l;
    this.lEl.rotation.x += (p.lElX - this.lEl.rotation.x) * l;
    this.rEl.rotation.x += (p.rElX - this.rEl.rotation.x) * l;

    const lHipX = p.lHipX !== 0 ? p.lHipX : p.hips;
    const rHipX = p.rHipX !== 0 ? p.rHipX : p.hips;
    const lKneeX = p.lKneeX !== 0 ? p.lKneeX : p.knees;
    const rKneeX = p.rKneeX !== 0 ? p.rKneeX : p.knees;
    this.lHip.rotation.x += (-lHipX - this.lHip.rotation.x) * l;
    this.rHip.rotation.x += (-rHipX - this.rHip.rotation.x) * l;
    this.lKnee.rotation.x += (-lKneeX - this.lKnee.rotation.x) * l;
    this.rKnee.rotation.x += (-rKneeX - this.rKnee.rotation.x) * l;
  }
}

interface Pose {
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
}

function defaultPose(): Pose {
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
  };
}

function ease01(t: number): number {
  const x = Math.min(1, Math.max(0, t));
  return 1 - Math.pow(1 - x, 3);
}

// Estampa da camisa: número (frente) ou nome + número (costas).
// Exportada para o RiggedCharacter (Fase 4A) reutilizar o mesmo decal no browser.
export function makeJerseyTexture(n: number, name?: string): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const c = canvas.getContext('2d')!;
  c.clearRect(0, 0, 256, 256);
  c.textAlign = 'center';
  c.lineWidth = 12;
  c.strokeStyle = 'rgba(0,0,0,0.35)';
  c.fillStyle = '#ffffff';

  if (name) {
    // nome legível no topo, número maior abaixo
    let size = 52;
    c.font = `bold ${size}px Arial`;
    while (c.measureText(name).width > 225 && size > 24) {
      size -= 2;
      c.font = `bold ${size}px Arial`;
    }
    c.textBaseline = 'middle';
    c.lineWidth = 8;
    c.strokeText(name, 128, 48);
    c.fillText(name, 128, 48);
    c.font = 'bold 130px Arial';
    c.lineWidth = 12;
    c.strokeText(String(n), 128, 160);
    c.fillText(String(n), 128, 160);
  } else {
    c.font = 'bold 150px Arial';
    c.textBaseline = 'middle';
    c.strokeText(String(n), 128, 135);
    c.fillText(String(n), 128, 135);
  }
  return new THREE.CanvasTexture(canvas);
}
